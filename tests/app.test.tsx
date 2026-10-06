import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { saveState } from '../src/domain/storage';
import { fullScenario } from './helpers';

const nav = (name: string) => screen.getByRole('button', { name });
const region = (name: RegExp) => screen.getByRole('region', { name });
const strip = (s: string | null) => (s ?? '').replace(/[⁦⁩]/g, '');

/** The main entry form of a group (not the agent-price list). */
function groupCard(group: 'A' | 'B'): HTMLElement {
  return document.querySelector(`.group-card.group-${group}`) as HTMLElement;
}

describe('summary screen', () => {
  it('opens with the agent prices, separate per group, and no "price for everyone"', () => {
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const b = region(/^קבוצה B – זוג$/);
    expect(within(a).getAllByText('מרפסת פנימי').length).toBeGreaterThan(0);
    expect(within(a).getAllByText('$4,805').length).toBeGreaterThan(0);
    expect(within(b).getAllByText('$6,020').length).toBeGreaterThan(0);
    expect(within(a).queryByText('$6,020')).toBeNull();
    expect(screen.queryByText(/מחיר לכולם/)).toBeNull();
  });

  it('shows dates in the right order (05/09/2027 → 12/09/2027)', () => {
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const titles = Array.from(a.querySelectorAll('.col-title')).map((e) => strip(e.textContent));
    expect(titles).toEqual(['05/09/2027 → 12/09/2027', '19/09/2027 → 26/09/2027']);
  });

  it('shows "not entered" for tips/fee instead of $0', () => {
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const tipsRow = within(a).getByRole('rowheader', { name: 'טיפים לצוות' }).closest('tr') as HTMLElement;
    expect(within(tipsRow).getAllByText('טרם הוזן')).toHaveLength(2);
    expect(within(tipsRow).queryByText('$0')).toBeNull();
  });

  it('has a "what now?" list', () => {
    render(<App />);
    const todo = region(/מה עכשיו/);
    expect(within(todo).getByText('בחרו חדר לכל קבוצה ותאריך')).toBeTruthy();
    expect(within(todo).getByText(/בדקו טיסות ל-.*05\/09/)).toBeTruthy();
    expect(within(todo).getByText(/Crew tips/)).toBeTruthy();
    expect(within(todo).getByText(/עמלת הסוכן/)).toBeTruthy();
    expect(within(todo).getByText(/מקדמה וביטול/)).toBeTruthy();
  });

  it('gives a first picture before any room is chosen (cheapest room, marked partial)', () => {
    render(<App />);
    const quick = region(/בקצרה/);
    expect(strip(quick.textContent)).toContain('05/09 זול ב-$280');
    expect(within(quick).getAllByText(/השוואה חלקית/).length).toBeGreaterThan(0);
  });

  it('choosing a room updates the total of that group only', async () => {
    const user = userEvent.setup();
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const b = region(/^קבוצה B – זוג$/);
    const bBefore = b.textContent;
    const radios = within(a).getAllByRole('radio');
    await user.click(radios[1]!); // 05/09 – central park $5,280
    const totalRow = within(a).getByRole('row', { name: /סה״כ/ });
    expect(within(totalRow).getByText('$5,280')).toBeTruthy();
    expect(b.textContent).toBe(bBefore);
  });

  it('shows "19/09 is cheaper by $795" after choosing rooms on both dates', async () => {
    const user = userEvent.setup();
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const radios = within(a).getAllByRole('radio');
    await user.click(radios[2]!); // 05/09 sea $5,880
    await user.click(radios[4]!); // 19/09 central park $5,085
    expect(strip(a.textContent)).toContain('19/09 זול ב-$795');
  });

  it('turning group B off hides it everywhere and leaves group A exactly the same', async () => {
    const user = userEvent.setup();
    render(<App />);
    const before = region(/^קבוצה A – זוג \+ תינוק$/).textContent;
    await user.click(screen.getByRole('button', { name: /לא – רק קבוצה A/ }));
    expect(screen.queryByRole('region', { name: /^קבוצה B – זוג$/ })).toBeNull();
    expect(region(/^קבוצה A – זוג \+ תינוק$/).textContent).toBe(before);
    expect(screen.queryByText(/A \+ B יחד/)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'כן' }));
    expect(region(/^קבוצה B – זוג$/)).toBeTruthy();
  });

  it('a complete scenario shows A = $7,392 and B = $7,090, and A stays $7,392 when B is off', async () => {
    saveState(fullScenario().state);
    const user = userEvent.setup();
    render(<App />);
    const totalA = within(region(/^קבוצה A – זוג \+ תינוק$/)).getByRole('row', { name: /סה״כ/ });
    const totalB = within(region(/^קבוצה B – זוג$/)).getByRole('row', { name: /סה״כ/ });
    expect(within(totalA).getByText('$7,392')).toBeTruthy();
    expect(within(totalB).getByText('$7,090')).toBeTruthy();
    expect(strip(region(/בקצרה/).textContent)).toContain('$14,482'); // A + B, secondary only
    await user.click(screen.getByRole('button', { name: /לא – רק קבוצה A/ }));
    const totalAOff = within(region(/^קבוצה A – זוג \+ תינוק$/)).getByRole('row', { name: /סה״כ/ });
    expect(within(totalAOff).getByText('$7,392')).toBeTruthy();
    expect(screen.queryByText('$7,090')).toBeNull();
  });

  it('selecting a flight in the summary changes the total', async () => {
    const { state, ids } = fullScenario();
    saveState({ ...state, plans: { ...state.plans, c1: { ...state.plans.c1!, A: { ...state.plans.c1!.A, outFlightId: null } } } });
    const user = userEvent.setup();
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const totalRow = () => within(a).getByRole('row', { name: /סה״כ/ });
    expect(within(totalRow()).getByText('$6,412')).toBeTruthy(); // 7,392 - (770 + 70 + 140)
    await user.selectOptions(within(a).getAllByLabelText(/^טיסת הלוך – זוג \+ תינוק/)[0]!, ids.aOut!);
    expect(within(totalRow()).getByText('$7,392')).toBeTruthy();
  });
});

describe('entry screen', () => {
  it('typing tips for group A changes only group A, and survives a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(nav('הזנת נתונים'));
    const aForm = groupCard('A');
    await user.selectOptions(within(aForm).getByLabelText(/^חדר – זוג \+ תינוק/), 'c1-A1');
    await user.type(within(aForm).getByLabelText(/^טיפים – זוג \+ תינוק/), '250');
    expect(within(aForm).getByText('$5,055')).toBeTruthy();
    expect(within(groupCard('B')).queryByText('$5,055')).toBeNull();

    unmount();
    render(<App />); // reload: data comes back from localStorage
    await user.click(nav('הזנת נתונים'));
    expect(within(groupCard('A')).getByText('$5,055')).toBeTruthy();
  });

  it('a new flight has one price column per passenger; the infant is not charged unless typed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    const aSection = region(/הזנה – קבוצה A/);
    await user.click(within(aSection).getByRole('button', { name: '+ טיסת הלוך' }));
    const card = aSection.querySelector('.flight-card') as HTMLElement;
    expect(within(card).getByRole('columnheader', { name: 'מבוגר 1' })).toBeTruthy();
    expect(within(card).getByRole('columnheader', { name: 'מבוגר 2' })).toBeTruthy();
    expect(within(card).getByRole('columnheader', { name: 'תינוק' })).toBeTruthy();
    await user.type(within(card).getByLabelText('מחיר טיסה – מבוגר 1'), '385');
    await user.type(within(card).getByLabelText('מחיר טיסה – מבוגר 2'), '385');
    await user.type(within(card).getByLabelText('מושב – מבוגר 1'), '35');
    await user.type(within(card).getByLabelText('מושב – מבוגר 2'), '35');
    // the new option was selected automatically → the group total includes it
    const lines = groupCard('A').querySelector('.total-lines')!;
    expect(strip(lines.textContent)).toContain('טיסות: $770');
    expect(strip(lines.textContent)).toContain('מושבים: $70');
    expect(within(groupCard('A')).getByText(/תינוק: לא הוזן מחיר טיסה/)).toBeTruthy();
  });

  it('group B flights have only two passenger columns', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    const bSection = region(/הזנה – קבוצה B/);
    await user.click(within(bSection).getByRole('button', { name: '+ כרטיס הלוך-חזור' }));
    const card = bSection.querySelector('.flight-card') as HTMLElement;
    expect(within(card).queryByRole('columnheader', { name: 'תינוק' })).toBeNull();
    expect(within(card).getByText('פרטי החזור')).toBeTruthy();
  });

  it('a shared hotel is split 50/50 between the groups', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    await user.click(screen.getByRole('button', { name: '+ הוסף מלון' }));
    const card = document.querySelector('.hotel-card') as HTMLElement;
    await user.selectOptions(within(card).getByLabelText('שייך ל'), 'both');
    await user.type(within(card).getByLabelText('מספר לילות'), '2');
    await user.type(within(card).getByLabelText('מחיר ללילה'), '300');
    expect(strip(card.textContent)).toContain('קבוצה A: $300 · קבוצה B: $300');
  });

  it('transport rows are added to the right group', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    await user.click(screen.getByRole('button', { name: '+ תחבורה' }));
    const row = document.querySelector('.item-row') as HTMLElement;
    await user.type(within(row).getByLabelText('סכום'), '60');
    expect(strip(groupCard('A').querySelector('.total-lines')!.textContent)).toContain('תחבורה: $60');
    expect(strip(groupCard('B').querySelector('.total-lines')!.textContent)).toContain('תחבורה: טרם הוזן');
  });

  it('can add a new cruise proposal (room names copied, prices empty)', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    await user.click(screen.getByRole('button', { name: '+ הצעת קרוז חדשה' }));
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getAllByText(/הזינו תאריכים/).length).toBeGreaterThan(0);
  });
});

describe('details screen', () => {
  it('flags the deposit as needing clarification and does not pick a number', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('פרטים ותנאים'));
    expect(screen.getByText(/מקדמה – דורש בירור/)).toBeTruthy();
    const deposits = screen.getAllByLabelText(/מקדמה בפועל/) as HTMLInputElement[];
    expect(deposits.map((d) => d.value)).toEqual(['', '']);
  });

  it('shows the cancellation dates 90 days before each sailing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('פרטים ותנאים'));
    const text = strip(document.body.textContent);
    expect(text).toContain('90 יום לפני = 07/06/2027');
    expect(text).toContain('90 יום לפני = 21/06/2027');
    expect(text).toContain('דורש אישור בכתב');
  });

  it('lists what is included and what is not', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('פרטים ותנאים'));
    const inclusion = region(/מה כלול/);
    expect(within(inclusion).getByText(/מיסים \(לפי הסוכן\)/)).toBeTruthy();
    expect(within(inclusion).getByText(/טיפים לצוות \(Crew tips\)/)).toBeTruthy();
    expect(within(inclusion).getByText(/טיסות – עדיין לא נבדקו/)).toBeTruthy();
  });

  it('import replaces the data after confirmation; a bad file changes nothing', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await user.click(nav('פרטים ותנאים'));
    const input = screen.getByLabelText('קובץ גיבוי') as HTMLInputElement;
    await user.upload(input, new File(['{"x":1}'], 'bad.json', { type: 'application/json' }));
    expect(await screen.findByText(/לא נראה כמו גיבוי/)).toBeTruthy();

    const good = JSON.stringify(fullScenario().state);
    await user.upload(input, new File([good], 'backup.json', { type: 'application/json' }));
    expect(await screen.findByText('הגיבוי נטען.')).toBeTruthy();
    await user.click(nav('סיכום והשוואה'));
    expect(within(within(region(/^קבוצה A – זוג \+ תינוק$/)).getByRole('row', { name: /סה״כ/ })).getByText('$7,392')).toBeTruthy();
    vi.restoreAllMocks();
  });
});

describe('review fixes (UI)', () => {
  it('no green "cheapest" tag while the comparison is partial', async () => {
    const user = userEvent.setup();
    render(<App />);
    const a = region(/^קבוצה A – זוג \+ תינוק$/);
    const radios = within(a).getAllByRole('radio');
    await user.click(radios[0]!);
    await user.click(radios[4]!);
    expect(within(a).queryByText('הזול מבין התאריכים')).toBeNull();
    expect(a.querySelector('.is-min')).toBeNull();
    expect(within(a).getAllByText(/השוואה חלקית/).length).toBeGreaterThan(0);
  });

  it('a new flight option says "missing price", never "$0"', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    const aSection = region(/הזנה – קבוצה A/);
    await user.click(within(aSection).getByRole('button', { name: '+ טיסת הלוך' }));
    const select = within(groupCard('A')).getByLabelText(/^טיסת הלוך – זוג \+ תינוק/) as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('חסר מחיר'))).toBe(true);
    expect(options.some((t) => t.includes('$0'))).toBe(false);
    expect(within(aSection.querySelector('.flight-card') as HTMLElement).getByText('חסר מחיר')).toBeTruthy();
  });

  it('the tips "number of people" field can be cleared and retyped', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    const form = groupCard('A');
    await user.type(within(form).getByLabelText(/^טיפים – זוג \+ תינוק/), '20');
    await user.selectOptions(within(form).getByLabelText('איך הוזנו הטיפים'), 'person');
    const people = within(form).getByLabelText('מספר אנשים לטיפים') as HTMLInputElement;
    expect(people.value).toBe('');
    expect(people.placeholder).toBe('2');
    await user.type(people, '3');
    expect(people.value).toBe('3');
    expect(strip(form.querySelector('.total-lines')!.textContent)).toContain('טיפים לצוות: $60');
    await user.clear(people);
    await user.type(people, '2');
    expect(strip(form.querySelector('.total-lines')!.textContent)).toContain('טיפים לצוות: $40');
  });

  it('with B off, the details screen shows no B deposit or passengers', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /לא – רק קבוצה A/ }));
    await user.click(nav('פרטים ותנאים'));
    expect(screen.getAllByLabelText(/מקדמה בפועל/)).toHaveLength(1);
    expect(screen.queryByText('קבוצה B – זוג')).toBeNull();
  });

  it('a change saved by another tab is picked up instead of being overwritten', async () => {
    render(<App />);
    const other = fullScenario().state;
    localStorage.setItem('cruise-compare-v1', JSON.stringify(other));
    window.dispatchEvent(new StorageEvent('storage', { key: 'cruise-compare-v1', newValue: JSON.stringify(other) }));
    const totalA = await screen.findAllByText('$7,392');
    expect(totalA.length).toBeGreaterThan(0);
  });

  it('date fields repeat the date as dd/mm/yyyy', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    const head = document.querySelector('.cruise-head') as HTMLElement;
    expect(within(head).getByText('05/09/2027')).toBeTruthy();
    expect(within(head).getByText('12/09/2027')).toBeTruthy();
  });
});

describe('browser compatibility', () => {
  it('switching screens works when scrollTo() returns a Promise (Chrome 154+)', async () => {
    const user = userEvent.setup();
    const original = window.scrollTo;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    window.scrollTo = (() => Promise.resolve()) as unknown as typeof window.scrollTo;
    try {
      render(<App />);
      await user.click(nav('הזנת נתונים'));
      await user.click(nav('פרטים ותנאים'));
      await user.click(nav('סיכום והשוואה'));
      expect(document.querySelector('main')).not.toBeNull();
      expect(region(/^קבוצה A – זוג \+ תינוק$/)).toBeTruthy();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      window.scrollTo = original;
      errors.mockRestore();
    }
  });
});
