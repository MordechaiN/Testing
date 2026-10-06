import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../src/App';

const nav = (name: string) => screen.getByRole('button', { name });

/** The main entry form of a group (not the agent-price list). */
function groupCard(group: 'A' | 'B'): HTMLElement {
  return document.querySelector(`.group-card.group-${group}`) as HTMLElement;
}

function groupSection(name: RegExp) {
  return screen.getByRole('region', { name });
}

describe('summary screen', () => {
  it('shows the seeded cruise prices without any "total for everyone" number', () => {
    render(<App />);
    const a = groupSection(/קבוצה A/);
    const b = groupSection(/קבוצה B/);
    expect(within(a).getByRole('option', { name: /מרפסת פנימי – \$4,805/ })).toBeTruthy();
    expect(within(b).getByRole('option', { name: /פונה לים – \$6,020/ })).toBeTruthy();
    expect(screen.queryByText(/מחיר לכולם/)).toBeNull();
  });

  it('selecting a room for group A changes only group A', async () => {
    const user = userEvent.setup();
    render(<App />);
    const a = groupSection(/קבוצה A/);
    const b = groupSection(/קבוצה B/);
    const [first] = within(a).getAllByLabelText(/^חדר – זוג \+ תינוק/);
    await user.selectOptions(first!, within(a).getByRole('option', { name: /מרפסת לסנטרל פארק – \$5,280/ }));
    expect(within(a).getAllByText('$5,280').length).toBeGreaterThan(0);
    // Group B still asks to choose a room and shows no total.
    expect(within(b).getAllByText('בחרו חדר').length).toBe(2);
    expect(within(b).queryByText('$5,280')).toBeNull();
  });

  it('a total appears and a date gap is computed once both dates have a room', async () => {
    const user = userEvent.setup();
    render(<App />);
    const a = groupSection(/קבוצה A/);
    const [d1, d2] = within(a).getAllByLabelText(/^חדר – זוג \+ תינוק/);
    await user.selectOptions(d1!, within(a).getByRole('option', { name: /מרפסת פנימי – \$4,805/ }));
    await user.selectOptions(d2!, within(a).getByRole('option', { name: /מרפסת לסנטרל פארק – \$5,085/ }));
    expect(within(a).getAllByText('$4,805').length).toBeGreaterThan(0);
    expect(within(a).getAllByText('$5,085').length).toBeGreaterThan(0);
    expect(within(a).getAllByText('$280').length).toBeGreaterThan(0); // 5,085 - 4,805
  });

  it('turning group B off hides it completely and leaves group A alone', async () => {
    const user = userEvent.setup();
    render(<App />);
    const a = groupSection(/קבוצה A/);
    const before = a.textContent;
    await user.click(screen.getByRole('button', { name: /רק קבוצה A/ }));
    expect(screen.queryByRole('region', { name: /קבוצה B/ })).toBeNull();
    expect(groupSection(/קבוצה A/).textContent).toBe(before);
    expect(screen.queryByText(/הזול ביותר – קבוצה B/)).toBeNull();
    await user.click(screen.getByRole('button', { name: /A \+ קבוצה B/ }));
    expect(groupSection(/קבוצה B/)).toBeTruthy();
  });

  it('tells the user what to do next', () => {
    render(<App />);
    expect(screen.getByText(/מה עכשיו\?/)).toBeTruthy();
    expect(screen.getByText(/הוסיפו אפשרויות טיסה/)).toBeTruthy();
  });
});

describe('entry screen', () => {
  it('tips entered for group A change only group A and persist after reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await user.click(nav('הזנת נתונים'));
    const aForm = groupCard('A');
    await user.selectOptions(within(aForm).getByLabelText(/^חדר – זוג \+ תינוק/), within(aForm).getByRole('option', { name: /מרפסת פנימי/ }));
    const tips = within(aForm).getByLabelText(/טיפים/);
    await user.type(tips, '250');
    expect(within(aForm).getByText('$5,055')).toBeTruthy();

    const bForm = groupCard('B');
    expect(within(bForm).queryByText('$5,055')).toBeNull();

    unmount();
    render(<App />); // reload: data comes back from localStorage
    await user.click(nav('הזנת נתונים'));
    const aAgain = groupCard('A');
    expect(within(aAgain).getByText('$5,055')).toBeTruthy();
  });

  it('a new flight is selected for the group and added to its total', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    const aForm = groupCard('A');
    await user.click(within(aForm).getAllByRole('button', { name: '+ טיסה חדשה' })[0]!);
    await user.type(screen.getByLabelText('מחיר טיסה – מבוגר'), '300');
    // group A: 2 adults x 300 = 600, infant not priced -> counts 0, and the user is warned.
    expect(within(aForm).getAllByText('$600').length).toBeGreaterThan(0);
    expect(screen.getByText(/מחיר תינוק לא הוזן/)).toBeTruthy();
  });

  it('can add a new cruise proposal with copied room names but no prices', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('הזנת נתונים'));
    await user.click(screen.getByRole('button', { name: '+ הצעת קרוז חדשה' }));
    expect(screen.getAllByRole('tab').length).toBe(3);
    expect(screen.getAllByText(/הזינו תאריכים/).length).toBeGreaterThan(0);
  });
});

describe('details screen', () => {
  it('marks the deposit as needing clarification and does not pick a number', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(nav('פרטים ותנאים'));
    expect(screen.getByText(/דורש בירור – הסוכנת מסרה נתונים סותרים/)).toBeTruthy();
    const deposits = screen.getAllByLabelText(/מקדמה בפועל/) as HTMLInputElement[];
    expect(deposits.every((d) => d.value === '')).toBe(true);
  });
});
