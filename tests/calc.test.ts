import { describe, expect, it } from 'vitest';
import {
  bothGroupsTotal,
  cheapestItinerary,
  cheapestRoom,
  compareDates,
  comparisonSentence,
  computePlan,
  flightCost,
  gap,
  halfShare,
  hasNotice,
  hotelCost,
  hotelIssues,
  hotelNights,
  hotelShare,
  inclusionList,
  LINE_KEYS,
  passengerSlots,
  todoList,
} from '../src/domain/calc';
import { usd } from '../src/domain/format';
import type { GroupId } from '../src/domain/types';
import { flight, fresh, fullScenario, hotel, item, plan, run, selectRoom } from './helpers';

const strip = (s: string) => s.replace(/[⁦⁩]/g, '');

describe('seed data', () => {
  it('keeps the 12 agent prices exactly, per group and date', () => {
    const s = fresh();
    const prices = (cid: string, g: GroupId) => s.cruises.find((c) => c.id === cid)!.rooms[g].map((r) => r.price);
    expect(s.cruises.map((c) => [c.start, c.end])).toEqual([
      ['2027-09-05', '2027-09-12'],
      ['2027-09-19', '2027-09-26'],
    ]);
    expect(prices('c1', 'A')).toEqual([4805, 5280, 5880]);
    expect(prices('c1', 'B')).toEqual([3775, 5140, 4780]);
    expect(prices('c2', 'A')).toEqual([5825, 5085, 5505]);
    expect(prices('c2', 'B')).toEqual([3935, 4920, 6020]);
  });

  it('starts with nothing invented: no flights, hotels, items, tips, fee or selected rooms', () => {
    const s = fresh();
    expect(s.flights).toEqual([]);
    expect(s.hotels).toEqual([]);
    expect(s.items).toEqual([]);
    for (const c of s.cruises)
      for (const g of ['A', 'B'] as const) {
        const p = s.plans[c.id]![g];
        expect([p.roomId, p.tips, p.agentFee, p.drinks, p.internet]).toEqual([null, null, null, null, null]);
      }
    expect(s.deposit).toEqual({ A: null, B: null });
    expect(s.terms.find((t) => t.id === 't-deposit')!.status).toBe('clarify');
    expect(s.terms.find((t) => t.id === 't-cancel')!.status).toBe('clarify');
  });

  it('defines group A as 2 adults + infant and group B as 2 adults', () => {
    const s = fresh();
    expect(passengerSlots(s.passengers.A).map((x) => x.label)).toEqual(['מבוגר 1', 'מבוגר 2', 'תינוק']);
    expect(passengerSlots(s.passengers.B).map((x) => x.label)).toEqual(['מבוגר 1', 'מבוגר 2']);
  });
});

describe('full scenario – checked by hand', () => {
  it('group A = $7,392 with every line as calculated by hand', () => {
    const { state } = fullScenario();
    const a = computePlan(state, 'c1', 'A');
    expect(a.lines.cruise.amount).toBe(4805);
    expect(a.lines.flights.amount).toBe(1610); // 385+385+0 + 420+420
    expect(a.lines.seats.amount).toBe(140); // 35*2 + 35*2
    expect(a.lines.baggage.amount).toBe(210); // 70*2 + 70
    expect(a.lines.hotel.amount).toBe(490); // 2*220 + 14 + 36
    expect(a.lines.tips.amount).toBe(37); // 18.5 * 2 adults
    expect(a.lines.agentFee.amount).toBe(100);
    expect(a.total).toBe(7392);
    expect(a.cruiseOnly).toBe(4805);
    expect(a.extras).toBe(7392 - 4805);
  });

  it('group B = $7,090 with a round-trip ticket and a 50/50 shared hotel', () => {
    const { state } = fullScenario();
    const b = computePlan(state, 'c1', 'B');
    expect(b.roundTrip).toBe(true);
    expect(b.lines.flights.amount).toBe(1580);
    expect(b.lines.seats.amount).toBe(60);
    expect(b.lines.baggage.amount).toBe(140);
    expect(b.lines.hotel.amount).toBe(300);
    expect(b.lines.tips.amount).toBe(150);
    expect(b.lines.agentFee.amount).toBe(80);
    expect(b.total).toBe(7090);
    expect(b.notices.some((n) => n.code === 'flight')).toBe(false); // round trip covers both legs
  });

  it('the optional A+B figure is just the two totals added', () => {
    const { state } = fullScenario();
    expect(bothGroupsTotal(state, 'c1')).toBe(7392 + 7090);
  });
});

describe('group isolation', () => {
  it('turning group B off does not change anything in group A', () => {
    const { state } = fullScenario();
    const off = run(state, { type: 'setGroupBEnabled', enabled: false });
    const a = computePlan(state, 'c1', 'A');
    const aOff = computePlan(off, 'c1', 'A');
    expect(aOff.total).toBe(7392);
    expect(aOff.lines).toEqual(a.lines);
    expect(compareDates(off, 'A').columns.map((c) => c.result?.total)).toEqual(
      compareDates(state, 'A').columns.map((c) => c.result?.total),
    );
  });

  it('turning B off keeps B data, and turning it on brings the same B total back', () => {
    const { state } = fullScenario();
    const back = run(state, { type: 'setGroupBEnabled', enabled: false }, { type: 'setGroupBEnabled', enabled: true });
    expect(computePlan(back, 'c1', 'B').total).toBe(7090);
    expect(back.plans).toEqual(state.plans);
  });

  it('there is no combined figure when B is off', () => {
    const { state } = fullScenario();
    expect(bothGroupsTotal(run(state, { type: 'setGroupBEnabled', enabled: false }), 'c1')).toBeNull();
  });

  it('changing anything of group A leaves group B untouched (and vice versa)', () => {
    const { state, ids } = fullScenario();
    const b = computePlan(state, 'c1', 'B');
    const a = computePlan(state, 'c1', 'A');
    const changedA = run(
      state,
      selectRoom('c1', 'A', 'c1-A3'),
      plan('c1', 'A', { tips: 999, agentFee: 999, drinks: 5, internet: 5 }),
      { type: 'setFlightPrice', id: ids.aOut!, row: 'fare', slotId: 'adult-1', value: 1 },
    );
    expect(computePlan(changedA, 'c1', 'B')).toEqual(b);
    const changedB = run(state, selectRoom('c1', 'B', 'c1-B2'), plan('c1', 'B', { tips: 1, agentFee: 1 }));
    expect(computePlan(changedB, 'c1', 'A')).toEqual(a);
  });

  it('a flight of group B can never be counted for group A, even with a forced reference', () => {
    const { state, ids } = fullScenario();
    const forced = { ...state, plans: { ...state.plans, c1: { ...state.plans.c1!, A: { ...state.plans.c1!.A, outFlightId: ids.bRound! } } } };
    const a = computePlan(forced, 'c1', 'A');
    expect(a.out).toBeNull();
    expect(a.lines.flights.amount).toBe(840); // only A's own return flight
  });

  it('a hotel of group B is never counted for group A', () => {
    const h = hotel('c1', 'B', { manualNights: 2, pricePerNight: 450 });
    let s = run(fresh(), { type: 'addHotel', hotel: h }, selectRoom('c1', 'A', 'c1-A1'));
    s = { ...s, plans: { ...s.plans, c1: { ...s.plans.c1!, A: { ...s.plans.c1!.A, hotelId: h.id } } } };
    expect(computePlan(s, 'c1', 'A').lines.hotel).toEqual({ amount: 0, entered: false });
  });
});

describe('date isolation', () => {
  it('changing 05/09 does not change 19/09', () => {
    const { state } = fullScenario();
    const s0 = run(state, selectRoom('c2', 'A', 'c2-A2'), plan('c2', 'A', { tips: 10 }));
    const before = computePlan(s0, 'c2', 'A');
    const s1 = run(s0, selectRoom('c1', 'A', 'c1-A3'), plan('c1', 'A', { tips: 500, agentFee: 300 }));
    expect(computePlan(s1, 'c2', 'A')).toEqual(before);
  });

  it('flights, hotels and items of 05/09 are ignored on 19/09 even if referenced', () => {
    const { state, ids } = fullScenario();
    const forced = {
      ...state,
      plans: {
        ...state.plans,
        c2: { ...state.plans.c2!, A: { ...state.plans.c2!.A, roomId: 'c2-A1', outFlightId: ids.aOut!, hotelId: ids.hA! } },
      },
    };
    const r = computePlan(forced, 'c2', 'A');
    expect(r.total).toBe(5825);
    expect(r.lines.flights.entered).toBe(false);
    expect(r.lines.hotel.entered).toBe(false);
  });
});

describe('rooms', () => {
  it('selecting a room changes the total', () => {
    const s = run(fresh(), selectRoom('c1', 'A', 'c1-A1'));
    expect(computePlan(s, 'c1', 'A').total).toBe(4805);
    expect(computePlan(run(s, selectRoom('c1', 'A', 'c1-A2')), 'c1', 'A').total).toBe(5280);
  });

  it('a missing room is a red problem, not a $0 cruise', () => {
    const r = computePlan(fresh(), 'c1', 'A');
    expect(r.status).toBe('red');
    expect(hasNotice(r, 'room')).toBe(true);
    expect(r.lines.cruise.entered).toBe(false);
  });

  it('cheapest room is found by price, never by name (05/09 B: sea view < central park)', () => {
    const s = fresh();
    expect(cheapestRoom(s, 'c1', 'B')!.room!.id).toBe('c1-B1');
    const rooms = s.cruises[0]!.rooms.B;
    expect(rooms[2]!.price!).toBeLessThan(rooms[1]!.price!);
  });

  it('19/09 A: the central park balcony is the cheapest room of that date', () => {
    expect(cheapestRoom(fresh(), 'c2', 'A')!.room!.id).toBe('c2-A2');
  });

  it('a room without a price is never "cheapest"', () => {
    const s = run(fresh(), { type: 'addRoom', cruiseId: 'c1', group: 'A', id: 'new' });
    expect(cheapestRoom(s, 'c1', 'A')!.room!.id).toBe('c1-A1');
    expect(hasNotice(computePlan(run(s, selectRoom('c1', 'A', 'new')), 'c1', 'A'), 'roomPrice')).toBe(true);
  });

  it('removing a selected room clears the selection of that group only', () => {
    const s = run(
      fresh(),
      selectRoom('c1', 'A', 'c1-A1'),
      selectRoom('c1', 'B', 'c1-B1'),
      { type: 'removeRoom', cruiseId: 'c1', group: 'A', roomId: 'c1-A1' },
    );
    expect(s.plans.c1!.A.roomId).toBeNull();
    expect(s.plans.c1!.B.roomId).toBe('c1-B1');
  });
});

describe('flights, seats, baggage', () => {
  it('selecting a flight changes the total', () => {
    const f1 = flight('c1', 'A', 'out', { fare: { 'adult-1': 300, 'adult-2': 300 } });
    const f2 = flight('c1', 'A', 'out', { fare: { 'adult-1': 250, 'adult-2': 250 } });
    const s = run(fresh(), { type: 'addFlight', flight: f1 }, { type: 'addFlight', flight: f2 }, selectRoom('c1', 'A', 'c1-A1'));
    expect(computePlan(run(s, plan('c1', 'A', { outFlightId: f1.id })), 'c1', 'A').total).toBe(4805 + 600);
    expect(computePlan(run(s, plan('c1', 'A', { outFlightId: f2.id })), 'c1', 'A').total).toBe(4805 + 500);
  });

  it('the infant is not charged unless a price was typed', () => {
    const f = flight('c1', 'A', 'out', {
      fare: { 'adult-1': 385, 'adult-2': 385 },
      seat: { 'adult-1': 35, 'adult-2': 35 },
      baggage: { 'adult-1': 70, 'adult-2': 70 },
    });
    const c = flightCost(f, { adults: 2, infants: 1 });
    expect(c.fare).toBe(770);
    expect(c.seats).toBe(70);
    expect(c.baggage).toBe(140);
    expect(c.infantNotCharged).toEqual(['תינוק']);
    const typed = flightCost({ ...f, fare: { ...f.fare, 'infant-1': 60 } }, { adults: 2, infants: 1 });
    expect(typed.fare).toBe(830);
    expect(typed.infantNotCharged).toEqual([]);
  });

  it('adult 1 and adult 2 can have different prices', () => {
    const f = flight('c1', 'A', 'out', { fare: { 'adult-1': 385, 'adult-2': 300 }, seat: { 'adult-1': 35 } });
    const c = flightCost(f, { adults: 2, infants: 1 });
    expect(c.fare).toBe(685);
    expect(c.seats).toBe(35);
  });

  it('a missing adult fare is flagged in yellow (not silently $0)', () => {
    const f = flight('c1', 'A', 'out', { fare: { 'adult-1': 385 } });
    const s = run(fresh(), { type: 'addFlight', flight: f }, selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { outFlightId: f.id }));
    const r = computePlan(s, 'c1', 'A');
    expect(hasNotice(r, 'fare')).toBe(true);
    expect(r.notices.find((n) => n.code === 'fare')!.text).toContain('מבוגר 2');
  });

  it('seats and baggage stay separate lines and are not part of the flight price', () => {
    const { state } = fullScenario();
    const a = computePlan(state, 'c1', 'A');
    expect(a.lines.flights.amount + a.lines.seats.amount + a.lines.baggage.amount).toBe(1960);
    expect(a.lines.flights.amount).toBe(1610);
  });

  it('outbound and return are priced separately: $385 + $420 = $805 per adult', () => {
    const { state } = fullScenario();
    const a = computePlan(state, 'c1', 'A');
    expect(flightCost(a.out!, state.passengers.A).fare + flightCost(a.back!, state.passengers.A).fare).toBe(1610);
    expect((385 + 420) * 2).toBe(1610);
  });

  it('a round-trip ticket covers both legs; a one-way outbound alone still misses the return', () => {
    const oneWay = flight('c1', 'A', 'out', { fare: { 'adult-1': 1, 'adult-2': 1 } });
    const s = run(fresh(), { type: 'addFlight', flight: oneWay }, plan('c1', 'A', { outFlightId: oneWay.id }));
    expect(computePlan(s, 'c1', 'A').notices.find((n) => n.code === 'flight')!.text).toBe('חסרה טיסת חזור');
  });

  it('a return flight cannot be used as outbound', () => {
    const back = flight('c1', 'A', 'back', { fare: { 'adult-1': 100, 'adult-2': 100 } });
    let s = run(fresh(), { type: 'addFlight', flight: back });
    s = { ...s, plans: { ...s.plans, c1: { ...s.plans.c1!, A: { ...s.plans.c1!.A, outFlightId: back.id } } } };
    expect(computePlan(s, 'c1', 'A').lines.flights.entered).toBe(false);
  });

  it('changing a round-trip ticket to one-way return clears the outbound selection', () => {
    const { state, ids } = fullScenario();
    const s = run(state, { type: 'updateFlight', id: ids.bRound!, patch: { direction: 'back' } });
    expect(s.plans.c1!.B.outFlightId).toBeNull();
  });

  it('removing a flight clears it from the plan', () => {
    const { state, ids } = fullScenario();
    const s = run(state, { type: 'removeFlight', id: ids.aOut! });
    expect(s.plans.c1!.A.outFlightId).toBeNull();
    expect(s.plans.c1!.A.backFlightId).toBe(ids.aBack);
  });

  it('copying a flight to the other group creates an independent option', () => {
    const { state, ids } = fullScenario();
    const s = run(state, { type: 'copyFlight', id: ids.aOut!, newId: 'copy', group: 'B' });
    const copy = s.flights.find((f) => f.id === 'copy')!;
    expect(copy.group).toBe('B');
    expect(flightCost(copy, s.passengers.B).fare).toBe(770);
    const s2 = run(s, { type: 'setFlightPrice', id: 'copy', row: 'fare', slotId: 'adult-1', value: 1 });
    expect(s2.flights.find((f) => f.id === ids.aOut)!.fare['adult-1']).toBe(385);
  });
});

describe('hotel', () => {
  it('total = nights × rate + taxes + city tax + breakfast + other', () => {
    const h = hotel('c1', 'A', { checkIn: '2027-09-03', checkOut: '2027-09-05', pricePerNight: 250, taxes: 30, cityTax: 12.5, breakfast: 40, other: 5 });
    expect(hotelNights(h)).toEqual({ nights: 2, fromDates: true });
    expect(hotelCost(h)).toBe(587.5);
  });

  it('manual nights are used only when there are no valid dates', () => {
    expect(hotelNights(hotel('c1', 'A', { manualNights: 3 }))).toEqual({ nights: 3, fromDates: false });
    expect(hotelNights(hotel('c1', 'A', { checkIn: '2027-09-02', checkOut: '2027-09-05', manualNights: 9 })).nights).toBe(3);
  });

  it('a hotel for one group goes to that group only', () => {
    const h = hotel('c1', 'A', { manualNights: 2, pricePerNight: 250 });
    expect(hotelShare(h, 'A').amount).toBe(500);
    expect(hotelShare(h, 'B').amount).toBe(0);
  });

  it('a shared hotel is split 50/50 and the halves always add up', () => {
    const h = hotel('c1', 'both', { manualNights: 1, pricePerNight: 100.01 });
    const a = hotelShare(h, 'A').amount;
    const b = hotelShare(h, 'B').amount;
    expect(Math.round((a + b) * 100)).toBe(10001);
    expect(halfShare(10001, 'A') + halfShare(10001, 'B')).toBe(10001);
  });

  it('a shared hotel can be split by a custom amount for group A', () => {
    const h = hotel('c1', 'both', { manualNights: 2, pricePerNight: 300, split: 'custom', shareA: 400 });
    expect(hotelShare(h, 'A')).toEqual({ amount: 400, problem: null });
    expect(hotelShare(h, 'B')).toEqual({ amount: 200, problem: null });
  });

  it('a custom split that is missing or larger than the total is a red problem', () => {
    const missing = hotel('c1', 'both', { manualNights: 1, pricePerNight: 300, split: 'custom' });
    expect(hotelShare(missing, 'A').problem).not.toBeNull();
    const tooBig = { ...missing, shareA: 301 };
    expect(hotelShare(tooBig, 'B').problem).not.toBeNull();
    const s = run(fresh(), { type: 'addHotel', hotel: missing }, selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { hotelId: missing.id }));
    expect(computePlan(s, 'c1', 'A').status).toBe('red');
  });

  it('a shared hotel is still split when B is off – A does not change – and the user is told', () => {
    const { state } = fullScenario();
    const shared = run(state, plan('c1', 'A', { hotelId: state.hotels[1]!.id }));
    const on = computePlan(shared, 'c1', 'A');
    const off = computePlan(run(shared, { type: 'setGroupBEnabled', enabled: false }), 'c1', 'A');
    expect(off.total).toBe(on.total);
    expect(hasNotice(off, 'sharedHotel')).toBe(true);
  });

  it('changing a hotel from shared to B-only removes it from group A', () => {
    const { state } = fullScenario();
    const id = state.hotels[1]!.id;
    const s = run(state, plan('c1', 'A', { hotelId: id }), { type: 'updateHotel', id, patch: { owner: 'B' } });
    expect(s.plans.c1!.A.hotelId).toBeNull();
    expect(s.plans.c1!.B.hotelId).toBe(id);
  });

  it('"no hotel needed" is a decision (counts as entered), not missing data', () => {
    const s = run(fresh(), plan('c1', 'A', { noHotel: true }));
    const r = computePlan(s, 'c1', 'A');
    expect(r.lines.hotel).toEqual({ amount: 0, entered: true, label: 'לא צריך' });
    expect(hasNotice(r, 'hotelUndecided')).toBe(false);
  });

  it('flags hotel dates that do not make sense', () => {
    const cruise = fresh().cruises[0]!;
    expect(hotelIssues(hotel('c1', 'A', { checkIn: '2027-09-05', checkOut: '2027-09-03' }), cruise)).toHaveLength(1);
    expect(hotelIssues(hotel('c1', 'A', { checkIn: '2027-09-03', checkOut: '2027-09-07' }), cruise)).toHaveLength(1);
    expect(hotelIssues(hotel('c1', 'A', { checkIn: '2027-09-03', checkOut: '2027-09-05' }), cruise)).toHaveLength(0);
  });
});

describe('tips, agent fee, drinks, internet, transport, other', () => {
  it('tips are a separate line – per group', () => {
    const s = run(fresh(), selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { tips: 250 }));
    const r = computePlan(s, 'c1', 'A');
    expect(r.lines.tips).toEqual({ amount: 250, entered: true });
    expect(r.total).toBe(4805 + 250);
  });

  it('tips per person use the number of adults unless a number of people is typed', () => {
    const s = run(fresh(), plan('c1', 'A', { tips: 20, tipsMode: 'person' }));
    expect(computePlan(s, 'c1', 'A').lines.tips.amount).toBe(40);
    expect(computePlan(run(s, plan('c1', 'A', { tipsPeople: 3 })), 'c1', 'A').lines.tips.amount).toBe(60);
  });

  it('agent fee is a separate line, per group', () => {
    const s = run(fresh(), selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { agentFee: 100 }), plan('c1', 'B', { agentFee: 70 }));
    expect(computePlan(s, 'c1', 'A').lines.agentFee.amount).toBe(100);
    expect(computePlan(s, 'c1', 'B').lines.agentFee.amount).toBe(70);
    expect(computePlan(s, 'c1', 'A').total).toBe(4905);
  });

  it('"not entered" is different from an explicit $0', () => {
    const blank = computePlan(fresh(), 'c1', 'A');
    expect(blank.lines.tips).toEqual({ amount: 0, entered: false });
    expect(blank.lines.agentFee.entered).toBe(false);
    expect(blank.lines.drinks.entered).toBe(false);
    const zero = computePlan(run(fresh(), plan('c1', 'A', { tips: 0, agentFee: 0 })), 'c1', 'A');
    expect(zero.lines.tips).toEqual({ amount: 0, entered: true });
    expect(zero.lines.agentFee).toEqual({ amount: 0, entered: true });
  });

  it('transport and other rows go to their group; shared rows are split in half', () => {
    const s = run(
      fresh(),
      { type: 'addItem', item: item('c1', 'transport', 'A', { amount: 60 }) },
      { type: 'addItem', item: item('c1', 'transport', 'both', { amount: 50 }) },
      { type: 'addItem', item: item('c1', 'other', 'B', { amount: 999 }) },
      { type: 'addItem', item: item('c2', 'other', 'A', { amount: 7 }) },
    );
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.transport).toEqual({ amount: 85, entered: true });
    expect(a.lines.other).toEqual({ amount: 0, entered: false });
    expect(computePlan(s, 'c1', 'B').lines.other.amount).toBe(999);
    expect(computePlan(s, 'c1', 'B').lines.transport.amount).toBe(25);
  });

  it('blank, NaN, Infinity and undefined never break a total', () => {
    let s = run(fresh(), selectRoom('c1', 'A', 'c1-A1'));
    s = run(s, plan('c1', 'A', { tips: Number.NaN, agentFee: undefined as unknown as null, drinks: Infinity }));
    const f = flight('c1', 'A', 'out', { fare: { 'adult-1': Number.NaN, 'adult-2': null } });
    s = run(s, { type: 'addFlight', flight: f }, plan('c1', 'A', { outFlightId: f.id }));
    s = run(s, { type: 'addItem', item: item('c1', 'other', 'A', { amount: null }) });
    const r = computePlan(s, 'c1', 'A');
    expect(r.total).toBe(4805);
    expect(Number.isFinite(r.total)).toBe(true);
    for (const k of LINE_KEYS) expect(Number.isFinite(r.lines[k].amount)).toBe(true);
  });

  it('decimal amounts do not produce float noise', () => {
    const s = run(fresh(), selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { tips: 0.1, agentFee: 0.2 }));
    expect(computePlan(s, 'c1', 'A').total).toBe(4805.3);
    expect(gap(0.3, 0.1 + 0.2)).toBe(0);
  });
});

describe('status and date comparison', () => {
  it('status: red without room, yellow with missing data, green when everything main is entered', () => {
    expect(computePlan(fresh(), 'c1', 'A').status).toBe('red');
    const { state } = fullScenario();
    expect(computePlan(state, 'c1', 'A').status).toBe('green');
    expect(computePlan(state, 'c1', 'B').status).toBe('green');
    expect(computePlan(run(state, plan('c1', 'A', { tips: null })), 'c1', 'A').status).toBe('yellow');
  });

  it('with nothing selected the comparison uses the cheapest room of each date and says it is partial', () => {
    const cmp = compareDates(fresh(), 'A');
    expect(cmp.columns.map((c) => c.basis)).toEqual(['cheapest', 'cheapest']);
    expect(cmp.columns.map((c) => c.result!.total)).toEqual([4805, 5085]);
    expect(cmp.cheapestIndex).toBe(0);
    expect(cmp.gap).toBe(280);
    expect(cmp.partial).toBe(true);
    expect(strip(comparisonSentence(cmp, usd)!)).toBe('05/09 זול ב-$280');
  });

  it('the comparison uses the selected room once chosen', () => {
    const s = run(fresh(), selectRoom('c1', 'A', 'c1-A3'), selectRoom('c2', 'A', 'c2-A2'));
    const cmp = compareDates(s, 'A');
    expect(cmp.columns.map((c) => c.basis)).toEqual(['selected', 'selected']);
    expect(cmp.cheapestIndex).toBe(1);
    expect(cmp.gap).toBe(5880 - 5085);
    expect(strip(comparisonSentence(cmp, usd)!)).toBe('19/09 זול ב-$795');
  });

  it('is partial when one date has flights/tips and the other does not', () => {
    const { state } = fullScenario();
    const s = run(state, selectRoom('c2', 'A', 'c2-A2'));
    const cmp = compareDates(s, 'A');
    expect(cmp.partial).toBe(true);
    expect(cmp.reasons.map(strip).join(' | ')).toContain('ב-19/09 חסרות טיסות');
    expect(cmp.reasons.map(strip).join(' | ')).toContain('טיפים לצוות הוזנו רק ב-05/09');
  });

  it('group B comparison never includes group A data', () => {
    const { state } = fullScenario();
    const cmp = compareDates(state, 'B');
    expect(cmp.columns[0]!.result!.total).toBe(7090);
    expect(cmp.columns[1]!.result!.total).toBe(3935); // cheapest B room on 19/09, nothing else
  });
});

describe('what now? list', () => {
  it('starts with the obvious steps, in order', () => {
    const ids = todoList(fresh()).map((t) => t.id);
    expect(ids).toEqual(['rooms', 'flights-c1', 'flights-c2', 'hotel', 'tips', 'fee', 'terms']);
  });

  it('ignores group B when B is off', () => {
    const { state } = fullScenario();
    const onlyA = run(state, { type: 'setGroupBEnabled', enabled: false }, selectRoom('c2', 'A', 'c2-A2'));
    const ids = todoList(onlyA).map((t) => t.id);
    expect(ids).toContain('flights-c2');
    expect(ids).not.toContain('flights-c1');
  });

  it('lists what is not included, without inventing amounts', () => {
    const list = inclusionList(fresh());
    expect(list.included.map((i) => i.text)).toEqual(['מיסים (לפי הסוכן)']);
    expect(list.notIncluded.map((i) => i.text)).toContain('טיסות – עדיין לא נבדקו');
    expect(list.notIncluded.map((i) => i.text)).toContain('עמלת סוכן – עדיין לא ידועה');
  });
});

describe('cruise management', () => {
  it('adding a cruise copies room names but not prices', () => {
    const s = run(fresh(), { type: 'addCruise', id: 'c3' });
    const c3 = s.cruises.find((c) => c.id === 'c3')!;
    expect(c3.rooms.A.map((r) => r.name)).toEqual(s.cruises[1]!.rooms.A.map((r) => r.name));
    expect(c3.rooms.A.every((r) => r.price === null)).toBe(true);
    expect(s.plans.c3).toBeDefined();
  });

  it('removing a cruise removes its flights, hotels, items, plans and favorites, and nothing else', () => {
    const { state } = fullScenario();
    const keep = flight('c2', 'A', 'out');
    const s = run(
      state,
      { type: 'addFlight', flight: keep },
      { type: 'addItem', item: item('c1', 'other', 'A', { amount: 1 }) },
      { type: 'setFavorite', group: 'A', cruiseId: 'c1' },
      { type: 'removeCruise', id: 'c1' },
    );
    expect(s.cruises.map((c) => c.id)).toEqual(['c2']);
    expect(s.flights.map((x) => x.id)).toEqual([keep.id]);
    expect(s.hotels).toEqual([]);
    expect(s.items).toEqual([]);
    expect(s.plans.c1).toBeUndefined();
    expect(s.favorite.A).toBeNull();
  });
});

describe('not entered vs $0 for flights', () => {
  it('a selected flight without any fare is "not entered", not $0', () => {
    const f = flight('c1', 'A', 'out');
    const s = run(fresh(), { type: 'addFlight', flight: f }, plan('c1', 'A', { outFlightId: f.id }));
    expect(computePlan(s, 'c1', 'A').lines.flights).toEqual({ amount: 0, entered: false });
  });

  it('a fare of $0 that was typed counts as entered', () => {
    const f = flight('c1', 'A', 'out', { fare: { 'adult-1': 0, 'adult-2': 0 } });
    const s = run(fresh(), { type: 'addFlight', flight: f }, plan('c1', 'A', { outFlightId: f.id }));
    expect(computePlan(s, 'c1', 'A').lines.flights).toEqual({ amount: 0, entered: true });
  });
});

describe('review fixes', () => {
  it('a selected hotel without any price is "not entered", keeps the to-do and the yellow status', () => {
    const { state } = fullScenario();
    const empty = hotel('c1', 'A');
    const s = run(state, { type: 'addHotel', hotel: empty }, plan('c1', 'A', { hotelId: empty.id }));
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.hotel).toEqual({ amount: 0, entered: false });
    expect(hasNotice(a, 'hotelPrice')).toBe(true);
    expect(a.status).toBe('yellow');
    expect(todoList(s).map((t) => t.id)).toContain('hotel');
  });

  it('a price per night without nights is flagged, not silently $0', () => {
    const h = hotel('c1', 'A', { pricePerNight: 220 });
    const s = run(fresh(), { type: 'addHotel', hotel: h }, plan('c1', 'A', { hotelId: h.id }));
    const r = computePlan(s, 'c1', 'A');
    expect(r.lines.hotel.entered).toBe(false);
    expect(r.notices.map((n) => n.text)).toContain('מלון לפני הקרוז – חסר מספר לילות');
  });

  it('impossible hotel dates are a red problem on the plan itself', () => {
    const h = hotel('c1', 'A', { checkIn: '2027-09-05', checkOut: '2027-09-03', pricePerNight: 220, cityTax: 14 });
    const s = run(fresh(), { type: 'addHotel', hotel: h }, selectRoom('c1', 'A', 'c1-A1'), plan('c1', 'A', { hotelId: h.id }));
    const r = computePlan(s, 'c1', 'A');
    expect(hasNotice(r, 'hotelDates')).toBe(true);
    expect(r.status).toBe('red');
    expect(todoList(s).map((t) => t.id)).toContain('hotel-fix');
  });

  it('the comparison is partial while hotel/tips/fee are missing on every date', () => {
    const f1 = flight('c1', 'A', 'round', { fare: { 'adult-1': 500, 'adult-2': 500 } });
    const f2 = flight('c2', 'A', 'round', { fare: { 'adult-1': 500, 'adult-2': 500 } });
    const s = run(
      fresh(),
      { type: 'addFlight', flight: f1 },
      { type: 'addFlight', flight: f2 },
      plan('c1', 'A', { roomId: 'c1-A1', outFlightId: f1.id }),
      plan('c2', 'A', { roomId: 'c2-A2', outFlightId: f2.id }),
    );
    const cmp = compareDates(s, 'A');
    expect(cmp.partial).toBe(true);
    expect(cmp.reasons.map(strip)).toContain('ב-05/09 חסר: מלון, טיפים, עמלת סוכן');
  });

  it('the comparison is final only when both dates are complete', () => {
    const { state } = fullScenario();
    const f2 = flight('c2', 'A', 'round', { fare: { 'adult-1': 500, 'adult-2': 500, 'infant-1': 0 } });
    const s = run(
      state,
      { type: 'addFlight', flight: f2 },
      plan('c2', 'A', { roomId: 'c2-A2', outFlightId: f2.id, noHotel: true, tips: 37, agentFee: 100 }),
    );
    const cmp = compareDates(s, 'A');
    // "No hotel needed" on 19/09 is a decision, so only seats/baggage differ.
    expect(cmp.reasons.map(strip)).toEqual(['מושבים הוזנו רק ב-05/09', 'מזוודות הוזנו רק ב-05/09']);
    const s2 = run(
      s,
      plan('c1', 'A', { hotelId: null, noHotel: true }),
      { type: 'setFlightPrice', id: f2.id, row: 'seat', slotId: 'adult-1', value: 0 },
      { type: 'setFlightPrice', id: f2.id, row: 'baggage', slotId: 'adult-1', value: 0 },
    );
    const final = compareDates(s2, 'A');
    expect(final.partial).toBe(false);
    expect(final.reasons).toEqual([]);
  });

  it('a selected room without a price is not compared as a $0 cruise', () => {
    let s = run(fresh(), { type: 'addRoom', cruiseId: 'c2', group: 'A', id: 'noprice' });
    s = run(s, selectRoom('c1', 'A', 'c1-A1'), selectRoom('c2', 'A', 'noprice'));
    const cmp = compareDates(s, 'A');
    expect(cmp.columns[1]!.basis).toBe('none');
    expect(cmp.cheapestIndex).toBeNull();
    expect(todoList(s).map((t) => t.id)).toContain('room-price');
  });

  it('cheapest flights: a cheaper round trip beats a one-way pair; fare-less options are ignored', () => {
    const out = flight('c1', 'B', 'out', { airline: 'OUT', fare: { 'adult-1': 385, 'adult-2': 385 } });
    const back = flight('c1', 'B', 'back', { airline: 'BACK', fare: { 'adult-1': 420, 'adult-2': 420 } });
    const round = flight('c1', 'B', 'round', { airline: 'ROUND', fare: { 'adult-1': 700, 'adult-2': 700 } });
    const seatOnly = flight('c1', 'B', 'out', { airline: 'SEATONLY', seat: { 'adult-1': 35 } });
    const s = run(fresh(), ...[out, back, round, seatOnly].map((f) => ({ type: 'addFlight', flight: f }) as const));
    const it = cheapestItinerary(s, 'c1', 'B')!;
    expect(it.legs.map((f) => f.airline)).toEqual(['ROUND']);
    expect(it.total).toBe(1400);
    const noRound = run(s, { type: 'removeFlight', id: round.id });
    expect(cheapestItinerary(noRound, 'c1', 'B')!.legs.map((f) => f.airline)).toEqual(['OUT', 'BACK']);
    const onlyOut = run(noRound, { type: 'removeFlight', id: back.id });
    expect(cheapestItinerary(onlyOut, 'c1', 'B')!.oneWayOnly).toBe(true);
  });

  it('an infant-only $0 fare does not make the flights line "entered"', () => {
    const f = flight('c1', 'A', 'round', { fare: { 'infant-1': 0 } });
    const s = run(fresh(), { type: 'addFlight', flight: f }, plan('c1', 'A', { outFlightId: f.id }));
    expect(computePlan(s, 'c1', 'A').lines.flights.entered).toBe(false);
  });

  it('the to-do asks to check flights for the group that has no options', () => {
    const { state, ids } = fullScenario();
    const s = run(state, { type: 'removeFlight', id: ids.bRound! });
    const todo = todoList(s).find((t) => t.id === 'flights-c1')!;
    expect(strip(todo.text)).toBe('בדקו טיסות ל-05/09 (קבוצה B)');
  });

  it('invalid cruise dates appear in the to-do list', () => {
    const s = run(fresh(), { type: 'updateCruise', id: 'c2', patch: { end: '2027-09-01' } });
    expect(todoList(s).map((t) => t.id)).toContain('dates-c2');
  });

  it('flights of a hidden group B do not count as "flights entered"', () => {
    const f = flight('c1', 'B', 'round', { fare: { 'adult-1': 1, 'adult-2': 1 } });
    const s = run(fresh(), { type: 'addFlight', flight: f }, { type: 'setGroupBEnabled', enabled: false });
    expect(inclusionList(s).notIncluded.map((i) => i.text)).toContain('טיסות – עדיין לא נבדקו');
  });

  it('a shared hotel picked by one group only says so (amounts are not changed)', () => {
    const { state } = fullScenario();
    const b = computePlan(state, 'c1', 'B');
    expect(b.lines.hotel.amount).toBe(300);
    expect(hasNotice(b, 'sharedHotel')).toBe(true);
  });

  it('shared transport rows while B is off are flagged for group A', () => {
    const s = run(fresh(), { type: 'addItem', item: item('c1', 'transport', 'both', { amount: 80 }) }, { type: 'setGroupBEnabled', enabled: false });
    const a = computePlan(s, 'c1', 'A');
    expect(a.lines.transport.amount).toBe(40);
    expect(hasNotice(a, 'sharedItems')).toBe(true);
  });
});
