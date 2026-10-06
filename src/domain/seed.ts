import type { AppState, Cruise, Flight, FlightDirection, GroupId, Hotel, HotelGroup, Plan } from './types';

let counter = 0;
/** Short unique id. Counter keeps ids unique within one millisecond. */
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function emptyPlan(): Plan {
  return {
    roomId: null,
    outFlightId: null,
    backFlightId: null,
    hotelId: null,
    tips: null,
    agentFee: null,
    drinks: null,
    internet: null,
    transport: null,
    other: null,
  };
}

export function emptyFlight(cruiseId: string, direction: FlightDirection): Flight {
  const none = { adult: null, infant: null };
  return {
    id: uid('f'),
    cruiseId,
    direction,
    airline: '',
    flightNo: '',
    date: '',
    depTime: '',
    arrTime: '',
    airport: '',
    stops: null,
    duration: '',
    baggageInfo: '',
    base: { ...none },
    seat: { ...none },
    baggage: { ...none },
    other: { ...none },
    notes: '',
  };
}

export function emptyHotel(cruiseId: string, group: HotelGroup): Hotel {
  return {
    id: uid('h'),
    cruiseId,
    group,
    name: '',
    checkIn: '',
    checkOut: '',
    manualNights: null,
    pricePerNight: null,
    taxes: null,
    cityTax: null,
    breakfast: null,
    other: null,
    notes: '',
  };
}

export function plansFor(): Record<GroupId, Plan> {
  return { A: emptyPlan(), B: emptyPlan() };
}

function room(id: string, name: string, price: number) {
  return { id, name, price };
}

/** The 12 prices received from the agent. Everything else starts empty. */
function initialCruises(): Cruise[] {
  return [
    {
      id: 'c1',
      start: '2027-09-05',
      end: '2027-09-12',
      rooms: {
        A: [
          room('c1-A1', 'מרפסת פנימי', 4805),
          room('c1-A2', 'מרפסת לסנטרל פארק', 5280),
          room('c1-A3', 'מרפסת פונה לים (עם יציאה)', 5880),
        ],
        B: [
          room('c1-B1', 'פנימי (בחירת האונייה)', 3775),
          room('c1-B2', 'פונה לסנטרל פארק', 5140),
          room('c1-B3', 'פונה לים', 4780),
        ],
      },
    },
    {
      id: 'c2',
      start: '2027-09-19',
      end: '2027-09-26',
      rooms: {
        A: [
          room('c2-A1', 'מרפסת פנימי', 5825),
          room('c2-A2', 'מרפסת לסנטרל פארק', 5085),
          room('c2-A3', 'מרפסת פונה לים (עם יציאה למרפסת)', 5505),
        ],
        B: [
          room('c2-B1', 'פנימי (בחירת האונייה)', 3935),
          room('c2-B2', 'פונה לסנטרל פארק', 4920),
          room('c2-B3', 'פונה לים', 6020),
        ],
      },
    },
  ];
}

export function initialState(): AppState {
  const cruises = initialCruises();
  const plans: AppState['plans'] = {};
  for (const c of cruises) plans[c.id] = plansFor();
  return {
    version: 1,
    groupBEnabled: true,
    passengers: {
      A: { adults: 2, infants: 1 },
      B: { adults: 2, infants: 0 },
    },
    cruises,
    flights: [],
    hotels: [],
    plans,
    favorite: { A: null, B: null },
    deposit: { A: null, B: null },
    terms: [
      {
        id: 't-deposit',
        topic: 'מקדמה',
        said: '170$ לאדם / 200$ לחדר / 540$ לזוג רגיל',
        status: 'clarify',
        note: 'הנתונים סותרים (170$ × 2 = 340$, לא 540$). לא נבחר מספר – יש לברר עם הסוכנת.',
      },
      {
        id: 't-cancel',
        topic: 'ביטול',
        said: 'אפשר לבטל עד 90 יום לפני המועד ואז הלכה המקדמה',
        status: 'clarify',
        note: 'התקבל מהסוכנת. נדרש אישור בכתב.',
      },
      {
        id: 't-fee',
        topic: 'עמלת סוכנת',
        said: 'לא נלקחה עמלה, אבל כנראה תהיה עלות נוספת',
        status: 'clarify',
        note: 'הסכום לא ידוע. יש לברר ולהזין בטופס.',
      },
      {
        id: 't-tax',
        topic: 'מיסים',
        said: 'כלולים במחיר',
        status: 'ok',
        note: '',
      },
      {
        id: 't-tips',
        topic: 'טיפים לצוות',
        said: 'לא כלולים',
        status: 'missing',
        note: 'יש להזין סכום בטופס.',
      },
      {
        id: 't-drinks',
        topic: 'חבילת שתייה',
        said: 'לא כלולה',
        status: 'info',
        note: 'אופציונלי – מזינים רק אם קונים.',
      },
      {
        id: 't-internet',
        topic: 'אינטרנט',
        said: 'לא כלול',
        status: 'info',
        note: 'אופציונלי – מזינים רק אם קונים.',
      },
      {
        id: 't-flights',
        topic: 'טיסות',
        said: 'עדיין לא נבדקו',
        status: 'missing',
        note: 'יש להוסיף אפשרויות טיסה במסך "הזנת נתונים".',
      },
    ],
  };
}
