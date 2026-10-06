import { flightFitsSlot, flightServesGroup, hotelServesGroup } from './calc';
import { freshState, plansFor, uid } from './seed';
import type {
  AppState,
  Cruise,
  ExtraItem,
  Flight,
  GroupId,
  Hotel,
  Money,
  Passengers,
  Plan,
  Room,
  Term,
  VerifiedTotals,
} from './types';
import { GROUPS } from './types';

export type PriceRow = 'fare' | 'seat' | 'baggage';

export type FarePriceField =
  | 'displayedOut'
  | 'displayedBack'
  | 'adultFare'
  | 'carrierSurcharge'
  | 'adultTaxes'
  | 'babyFare'
  | 'babyTaxes';

export type Action =
  | { type: 'setGroupBEnabled'; enabled: boolean }
  | { type: 'setPassengers'; group: GroupId; patch: Partial<Passengers> }
  | { type: 'addCruise'; id: string }
  | { type: 'updateCruise'; id: string; patch: Partial<Pick<Cruise, 'start' | 'end'>> }
  | { type: 'removeCruise'; id: string }
  | { type: 'addRoom'; cruiseId: string; group: GroupId; id: string }
  | { type: 'updateRoom'; cruiseId: string; group: GroupId; roomId: string; patch: Partial<Pick<Room, 'name' | 'price'>> }
  | { type: 'removeRoom'; cruiseId: string; group: GroupId; roomId: string }
  | { type: 'updatePlan'; cruiseId: string; group: GroupId; patch: Partial<Plan> }
  | { type: 'setFavorite'; group: GroupId; cruiseId: string | null }
  | { type: 'addFlight'; flight: Flight }
  | { type: 'updateFlight'; id: string; patch: Partial<Omit<Flight, 'id' | 'cruiseId' | 'group'>> }
  | { type: 'setFlightPrice'; id: string; row: PriceRow; slotId: string; value: Money }
  | { type: 'copyFlight'; id: string; newId: string; group: GroupId }
  | { type: 'removeFlight'; id: string }
  | { type: 'setFarePrice'; id: string; field: FarePriceField; value: Money }
  | { type: 'setVerifiedTotal'; id: string; key: keyof VerifiedTotals; value: Money }
  | { type: 'setFareExtra'; id: string; row: 'seat' | 'baggage'; group: GroupId; value: Money }
  | { type: 'archiveFareCheck'; id: string; checkId: string }
  | { type: 'selectFare'; cruiseId: string; flightId: string }
  | { type: 'addHotel'; hotel: Hotel }
  | { type: 'updateHotel'; id: string; patch: Partial<Omit<Hotel, 'id' | 'cruiseId'>> }
  | { type: 'removeHotel'; id: string }
  | { type: 'addItem'; item: ExtraItem }
  | { type: 'updateItem'; id: string; patch: Partial<Omit<ExtraItem, 'id' | 'cruiseId'>> }
  | { type: 'removeItem'; id: string }
  | { type: 'setDeposit'; group: GroupId; value: Money }
  | { type: 'updateTerm'; id: string; patch: Partial<Pick<Term, 'status' | 'note'>> }
  | { type: 'setNotes'; notes: string }
  | { type: 'replaceAll'; state: AppState }
  | { type: 'reset' };

/** Change one group's plan on one cruise. Nothing else is touched. */
function mapPlan(state: AppState, cruiseId: string, group: GroupId, fn: (p: Plan) => Plan): AppState {
  const cruisePlans = state.plans[cruiseId];
  if (!cruisePlans) return state;
  return {
    ...state,
    plans: { ...state.plans, [cruiseId]: { ...cruisePlans, [group]: fn(cruisePlans[group]) } },
  };
}

/** Used to clear references to a flight/hotel that no longer exists or no longer fits. */
function mapAllPlans(state: AppState, fn: (p: Plan, cruiseId: string, group: GroupId) => Plan): AppState {
  const plans: AppState['plans'] = {};
  for (const [cruiseId, byGroup] of Object.entries(state.plans)) {
    plans[cruiseId] = { A: fn(byGroup.A, cruiseId, 'A'), B: fn(byGroup.B, cruiseId, 'B') };
  }
  return { ...state, plans };
}

function clearInvalidFlightRefs(state: AppState): AppState {
  return mapAllPlans(state, (p, cruiseId, group) => {
    const ok = (id: string | null, slot: 'out' | 'back') =>
      id !== null &&
      state.flights.some((f) => f.id === id && f.cruiseId === cruiseId && flightServesGroup(f, group) && flightFitsSlot(f, slot));
    const outFlightId = ok(p.outFlightId, 'out') ? p.outFlightId : null;
    const backFlightId = ok(p.backFlightId, 'back') ? p.backFlightId : null;
    return outFlightId === p.outFlightId && backFlightId === p.backFlightId ? p : { ...p, outFlightId, backFlightId };
  });
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setGroupBEnabled':
      // Only visibility changes. Group B data is kept, and nothing of group A is touched.
      return { ...state, groupBEnabled: action.enabled };

    case 'setPassengers': {
      const clean = (v: number | undefined, d: number) =>
        typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(9, Math.floor(v))) : d;
      const cur = state.passengers[action.group];
      return {
        ...state,
        passengers: {
          ...state.passengers,
          [action.group]: { adults: clean(action.patch.adults, cur.adults), infants: clean(action.patch.infants, cur.infants) },
        },
      };
    }

    case 'addCruise': {
      const last = state.cruises[state.cruises.length - 1];
      const copyRooms = (g: GroupId): Room[] =>
        (last?.rooms[g] ?? []).map((r) => ({ id: uid('r'), name: r.name, price: null }));
      const cruise: Cruise = { id: action.id, start: '', end: '', rooms: { A: copyRooms('A'), B: copyRooms('B') } };
      return { ...state, cruises: [...state.cruises, cruise], plans: { ...state.plans, [cruise.id]: plansFor() } };
    }

    case 'updateCruise':
      return { ...state, cruises: state.cruises.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)) };

    case 'removeCruise': {
      const plans = { ...state.plans };
      delete plans[action.id];
      const favorite = { ...state.favorite };
      for (const g of GROUPS) if (favorite[g] === action.id) favorite[g] = null;
      return {
        ...state,
        cruises: state.cruises.filter((c) => c.id !== action.id),
        flights: state.flights.filter((f) => f.cruiseId !== action.id),
        hotels: state.hotels.filter((h) => h.cruiseId !== action.id),
        items: state.items.filter((i) => i.cruiseId !== action.id),
        plans,
        favorite,
      };
    }

    case 'addRoom':
      return {
        ...state,
        cruises: state.cruises.map((c) =>
          c.id === action.cruiseId
            ? { ...c, rooms: { ...c.rooms, [action.group]: [...c.rooms[action.group], { id: action.id, name: '', price: null }] } }
            : c,
        ),
      };

    case 'updateRoom':
      return {
        ...state,
        cruises: state.cruises.map((c) =>
          c.id === action.cruiseId
            ? {
                ...c,
                rooms: {
                  ...c.rooms,
                  [action.group]: c.rooms[action.group].map((r) => (r.id === action.roomId ? { ...r, ...action.patch } : r)),
                },
              }
            : c,
        ),
      };

    case 'removeRoom': {
      const next: AppState = {
        ...state,
        cruises: state.cruises.map((c) =>
          c.id === action.cruiseId
            ? { ...c, rooms: { ...c.rooms, [action.group]: c.rooms[action.group].filter((r) => r.id !== action.roomId) } }
            : c,
        ),
      };
      return mapPlan(next, action.cruiseId, action.group, (p) => (p.roomId === action.roomId ? { ...p, roomId: null } : p));
    }

    case 'updatePlan':
      return mapPlan(state, action.cruiseId, action.group, (p) => ({ ...p, ...action.patch }));

    case 'setFavorite':
      return { ...state, favorite: { ...state.favorite, [action.group]: action.cruiseId } };

    case 'addFlight':
      return { ...state, flights: [...state.flights, action.flight] };

    case 'updateFlight':
      // Changing the direction may make a selection invalid (e.g. round-trip -> return only).
      return clearInvalidFlightRefs({
        ...state,
        flights: state.flights.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)),
      });

    case 'setFlightPrice':
      return {
        ...state,
        flights: state.flights.map((f) =>
          f.id === action.id ? { ...f, [action.row]: { ...f[action.row], [action.slotId]: action.value } } : f,
        ),
      };

    case 'copyFlight': {
      const src = state.flights.find((f) => f.id === action.id);
      if (!src) return state;
      const copy: Flight = {
        ...src,
        id: action.newId,
        group: action.group,
        fare: { ...src.fare },
        seat: { ...src.seat },
        baggage: { ...src.baggage },
      };
      return { ...state, flights: [...state.flights, copy] };
    }

    case 'setFarePrice':
      return {
        ...state,
        flights: state.flights.map((f) => (f.id === action.id ? { ...f, [action.field]: action.value } : f)),
      };

    case 'setVerifiedTotal':
      return {
        ...state,
        flights: state.flights.map((f) =>
          f.id === action.id ? { ...f, verifiedTotal: { ...f.verifiedTotal, [action.key]: action.value } } : f,
        ),
      };

    case 'setFareExtra': {
      const key = action.row === 'seat' ? 'extraSeat' : 'extraBaggage';
      return {
        ...state,
        flights: state.flights.map((f) =>
          f.id === action.id ? { ...f, [key]: { ...f[key], [action.group]: action.value } } : f,
        ),
      };
    }

    // Keeps the current figures as "בדיקה קודמת" so a new check never overwrites the old one.
    case 'archiveFareCheck':
      return {
        ...state,
        flights: state.flights.map((f) =>
          f.id === action.id
            ? {
                ...f,
                history: [
                  ...f.history,
                  {
                    id: action.checkId,
                    checkedAt: f.checkedAt,
                    source: f.source,
                    note: f.notes,
                    displayedOut: f.displayedOut,
                    displayedBack: f.displayedBack,
                    adultFare: f.adultFare,
                    carrierSurcharge: f.carrierSurcharge,
                    adultTaxes: f.adultTaxes,
                    babyFare: f.babyFare,
                    babyTaxes: f.babyTaxes,
                  },
                ],
                // The new check starts unverified, with its own date, until the user decides which price counts.
                priceMode: 'unverified',
                checkedAt: '',
              }
            : f,
        ),
      };

    // One click on the summary: this fare record for BOTH groups of the cruise (each group's plan on its own).
    case 'selectFare': {
      const flight = state.flights.find((f) => f.id === action.flightId && f.cruiseId === action.cruiseId);
      if (!flight) return state;
      const cruisePlans = state.plans[action.cruiseId];
      if (!cruisePlans) return state;
      const plans = { ...cruisePlans };
      for (const g of GROUPS) plans[g] = { ...plans[g], outFlightId: flight.id, backFlightId: null };
      return { ...state, plans: { ...state.plans, [action.cruiseId]: plans } };
    }

    case 'removeFlight':
      return clearInvalidFlightRefs({ ...state, flights: state.flights.filter((f) => f.id !== action.id) });

    case 'addHotel':
      return { ...state, hotels: [...state.hotels, action.hotel] };

    case 'updateHotel': {
      const hotels = state.hotels.map((h) => (h.id === action.id ? { ...h, ...action.patch } : h));
      // If the hotel stopped serving a group (or changed phase), that group must not keep it selected.
      const hotel = hotels.find((h) => h.id === action.id);
      return mapAllPlans({ ...state, hotels }, (p, _cruiseId, group) => {
        const fits = (phase: 'before' | 'after') =>
          !!hotel && hotelServesGroup(hotel, group) && (hotel.phase ?? 'before') === phase;
        return {
          ...p,
          hotelId: p.hotelId === action.id && !fits('before') ? null : p.hotelId,
          hotelAfterId: p.hotelAfterId === action.id && !fits('after') ? null : p.hotelAfterId,
        };
      });
    }

    case 'removeHotel':
      return mapAllPlans({ ...state, hotels: state.hotels.filter((h) => h.id !== action.id) }, (p) => ({
        ...p,
        hotelId: p.hotelId === action.id ? null : p.hotelId,
        hotelAfterId: p.hotelAfterId === action.id ? null : p.hotelAfterId,
      }));

    case 'addItem':
      return { ...state, items: [...state.items, action.item] };

    case 'updateItem':
      return { ...state, items: state.items.map((i) => (i.id === action.id ? { ...i, ...action.patch } : i)) };

    case 'removeItem':
      return { ...state, items: state.items.filter((i) => i.id !== action.id) };

    case 'setDeposit':
      return { ...state, deposit: { ...state.deposit, [action.group]: action.value } };

    case 'updateTerm':
      return { ...state, terms: state.terms.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)) };

    case 'setNotes':
      return { ...state, notes: action.notes };

    case 'replaceAll':
      return action.state;

    case 'reset':
      return freshState();
  }
}
