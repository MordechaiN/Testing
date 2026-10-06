import { hotelServesGroup } from './calc';
import { initialState, plansFor, uid } from './seed';
import type {
  AppState,
  Cruise,
  Flight,
  GroupId,
  Hotel,
  Money,
  Passengers,
  Plan,
  Room,
  Term,
} from './types';
import { GROUPS } from './types';

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
  | { type: 'updateFlight'; id: string; patch: Partial<Flight> }
  | { type: 'removeFlight'; id: string }
  | { type: 'addHotel'; hotel: Hotel }
  | { type: 'updateHotel'; id: string; patch: Partial<Hotel> }
  | { type: 'removeHotel'; id: string }
  | { type: 'setDeposit'; group: GroupId; value: Money }
  | { type: 'updateTerm'; id: string; patch: Partial<Pick<Term, 'status' | 'note' | 'said'>> }
  | { type: 'replaceAll'; state: AppState }
  | { type: 'reset' };

/** Change one group's plan on one cruise. Nothing else is touched. */
function mapPlan(
  state: AppState,
  cruiseId: string,
  group: GroupId,
  fn: (p: Plan) => Plan,
): AppState {
  const cruisePlans = state.plans[cruiseId];
  if (!cruisePlans) return state;
  return {
    ...state,
    plans: { ...state.plans, [cruiseId]: { ...cruisePlans, [group]: fn(cruisePlans[group]) } },
  };
}

/** Clear references to a flight/hotel that no longer exists or no longer fits. */
function mapAllPlans(state: AppState, fn: (p: Plan, cruiseId: string, group: GroupId) => Plan): AppState {
  const plans: AppState['plans'] = {};
  for (const [cruiseId, byGroup] of Object.entries(state.plans)) {
    plans[cruiseId] = { A: fn(byGroup.A, cruiseId, 'A'), B: fn(byGroup.B, cruiseId, 'B') };
  }
  return { ...state, plans };
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setGroupBEnabled':
      return { ...state, groupBEnabled: action.enabled };

    case 'setPassengers':
      return {
        ...state,
        passengers: {
          ...state.passengers,
          [action.group]: { ...state.passengers[action.group], ...action.patch },
        },
      };

    case 'addCruise': {
      const last = state.cruises[state.cruises.length - 1];
      const copyRooms = (g: GroupId): Room[] =>
        (last?.rooms[g] ?? []).map((r) => ({ id: uid('r'), name: r.name, price: null }));
      const cruise: Cruise = {
        id: action.id,
        start: '',
        end: '',
        rooms: { A: copyRooms('A'), B: copyRooms('B') },
      };
      return {
        ...state,
        cruises: [...state.cruises, cruise],
        plans: { ...state.plans, [cruise.id]: plansFor() },
      };
    }

    case 'updateCruise':
      return {
        ...state,
        cruises: state.cruises.map((c) => (c.id === action.id ? { ...c, ...action.patch } : c)),
      };

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
        plans,
        favorite,
      };
    }

    case 'addRoom':
      return {
        ...state,
        cruises: state.cruises.map((c) =>
          c.id === action.cruiseId
            ? {
                ...c,
                rooms: { ...c.rooms, [action.group]: [...c.rooms[action.group], { id: action.id, name: '', price: null }] },
              }
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
                  [action.group]: c.rooms[action.group].map((r) =>
                    r.id === action.roomId ? { ...r, ...action.patch } : r,
                  ),
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
      return mapPlan(next, action.cruiseId, action.group, (p) =>
        p.roomId === action.roomId ? { ...p, roomId: null } : p,
      );
    }

    case 'updatePlan':
      return mapPlan(state, action.cruiseId, action.group, (p) => ({ ...p, ...action.patch }));

    case 'setFavorite':
      return { ...state, favorite: { ...state.favorite, [action.group]: action.cruiseId } };

    case 'addFlight':
      return { ...state, flights: [...state.flights, action.flight] };

    case 'updateFlight':
      return {
        ...state,
        flights: state.flights.map((f) => (f.id === action.id ? { ...f, ...action.patch } : f)),
      };

    case 'removeFlight': {
      const next = { ...state, flights: state.flights.filter((f) => f.id !== action.id) };
      return mapAllPlans(next, (p) => ({
        ...p,
        outFlightId: p.outFlightId === action.id ? null : p.outFlightId,
        backFlightId: p.backFlightId === action.id ? null : p.backFlightId,
      }));
    }

    case 'addHotel':
      return { ...state, hotels: [...state.hotels, action.hotel] };

    case 'updateHotel': {
      const hotels = state.hotels.map((h) => (h.id === action.id ? { ...h, ...action.patch } : h));
      const next = { ...state, hotels };
      // If the hotel stopped serving a group, that group must not keep it selected.
      return mapAllPlans(next, (p, _cruiseId, group) => {
        if (p.hotelId !== action.id) return p;
        const hotel = hotels.find((h) => h.id === action.id);
        return hotel && hotelServesGroup(hotel, group) ? p : { ...p, hotelId: null };
      });
    }

    case 'removeHotel': {
      const next = { ...state, hotels: state.hotels.filter((h) => h.id !== action.id) };
      return mapAllPlans(next, (p) => (p.hotelId === action.id ? { ...p, hotelId: null } : p));
    }

    case 'setDeposit':
      return { ...state, deposit: { ...state.deposit, [action.group]: action.value } };

    case 'updateTerm':
      return {
        ...state,
        terms: state.terms.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      };

    case 'replaceAll':
      return action.state;

    case 'reset':
      return initialState();
  }
}
