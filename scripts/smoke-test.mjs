// End-to-end check of the real app in a real browser.
// Used locally and by GitHub Actions against the live GitHub Pages URL.
//
//   node scripts/smoke-test.mjs <url> [--screenshots <dir>]
//
// Browser: CHROME_PATH=/path/to/chrome (optional). Needs the "playwright-core" or "playwright"
// package (resolved through NODE_PATH too). Exits with code 1 on the first failed check.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
for (const name of ['playwright-core', 'playwright']) {
  try {
    playwright = require(name);
    break;
  } catch {
    // try the next one
  }
}
if (!playwright) {
  console.error('playwright-core is not installed (npm install --no-save playwright-core)');
  process.exit(2);
}

const url = process.argv[2];
const shotsIndex = process.argv.indexOf('--screenshots');
const shotsDir = shotsIndex > 0 ? process.argv[shotsIndex + 1] : null;
if (!url) {
  console.error('usage: node scripts/smoke-test.mjs <url> [--screenshots <dir>]');
  process.exit(2);
}
if (shotsDir) mkdirSync(shotsDir, { recursive: true });

const strip = (s) => (s ?? '').replace(/[⁦⁩]/g, '').replace(/\s+/g, ' ').trim();
let failures = 0;
function check(ok, message) {
  if (ok) {
    console.log(`  ✓ ${message}`);
  } else {
    failures += 1;
    console.log(`  ✗ ${message}`);
  }
}

/** Page and console problems of the page currently under test – printed when a step crashes. */
let current = { page: null, problems: [] };

async function step(name, fn) {
  console.log(`\n${name}`);
  try {
    await fn();
  } catch (error) {
    failures += 1;
    console.log(`  ✗ step crashed: ${String(error.message ?? error).split('\n').slice(0, 6).join('\n    ')}`);
    await diagnose(name);
    await browser.close();
    console.log(`\n${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
}

async function diagnose(name) {
  const { page, problems } = current;
  console.log('  --- diagnostics ---');
  console.log(`  browser problems: ${problems.length === 0 ? 'none' : '\n    ' + problems.join('\n    ')}`);
  if (!page) return;
  try {
    console.log(`  url: ${page.url()}`);
    const info = await page.evaluate(() => ({
      main: (document.querySelector('main')?.innerText ?? '(no <main>)').slice(0, 1500),
      groupCards: document.querySelectorAll('.group-card').length,
      selects: Array.from(document.querySelectorAll('select')).map((el) => el.getAttribute('aria-label')).slice(0, 12),
    }));
    console.log(`  group cards: ${info.groupCards}`);
    console.log(`  select aria-labels: ${JSON.stringify(info.selects)}`);
    console.log(`  page text:\n${info.main}`);
    const dir = shotsDir ?? 'screenshots';
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `failure-${name.split('.')[0]}.png`), fullPage: true });
  } catch (e) {
    console.log(`  (diagnostics failed: ${e.message})`);
  }
}

const browser = await playwright.chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
console.log(`Browser: ${browser.version()} · URL: ${url}`);

/** Collects everything that would show up as a red line in the browser console. */
function watch(page) {
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`uncaught error: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  page.on('dialog', (d) => void d.accept());
  return problems;
}

/** Top navigation (exact names, so "להזנת נתונים" buttons in the page never match). */
const nav = (p, name) => p.locator('nav.nav').getByRole('button', { name, exact: true });

async function selectContaining(select, text) {
  const value = await select.evaluate((el, t) => {
    const opt = Array.from(el.options).find((o) => o.textContent.includes(t));
    return opt ? opt.value : null;
  }, text);
  if (value === null) throw new Error(`no option containing "${text}"`);
  await select.selectOption(value);
}

async function totalRowText(page, group) {
  const name = group === 'A' ? 'קבוצה A – זוג + תינוק' : 'קבוצה B – זוג';
  const row = page.locator(`section[aria-label="${name}"] tr.row-total td`).first();
  return strip(await row.textContent());
}

// ---------------------------------------------------------------- desktop
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: 'he-IL' });
const page = await context.newPage();
const problems = watch(page);
current = { page, problems };

await step('1. Page loads (JavaScript, CSS, React)', async () => {
  const response = await page.goto(url, { waitUntil: 'load' });
  check(response?.status() === 200, `HTTP 200 for ${url} (got ${response?.status()})`);
  await nav(page, 'סיכום והשוואה').waitFor({ timeout: 15000 });
  check(true, 'React rendered the app');
  check((await page.title()) === 'השוואת קרוז – ברצלונה 2027', 'page title');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(bg === 'rgb(246, 247, 249)', `CSS applied (body background ${bg})`);
  check((await page.evaluate(() => document.documentElement.dir)) === 'rtl', 'RTL document');
});

await step('2. The 12 agent prices are shown exactly', async () => {
  const text = strip(await page.locator('main').textContent());
  for (const p of ['4,805', '5,280', '5,880', '3,775', '5,140', '4,780', '5,825', '5,085', '5,505', '3,935', '4,920', '6,020']) {
    check(text.includes(`$${p}`), `$${p}`);
  }
});

await step('3. Dates read 05/09/2027 → 12/09/2027 (never reversed)', async () => {
  const titles = (await page.locator('section[aria-label="קבוצה A – זוג + תינוק"] .col-title').allTextContents()).map(strip);
  check(titles[0] === '05/09/2027 → 12/09/2027', `first date column: "${titles[0]}"`);
  check(titles[1] === '19/09/2027 → 26/09/2027', `second date column: "${titles[1]}"`);
  const visualOrderOk = await page.evaluate(() => {
    const el = document.querySelector('.col-title');
    const node = el?.firstChild;
    if (!node || !node.textContent) return false;
    const rectOf = (needle) => {
      const i = node.textContent.indexOf(needle);
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + needle.length);
      return r.getBoundingClientRect();
    };
    return rectOf('05/09/2027').left < rectOf('12/09/2027').left;
  });
  check(visualOrderOk, 'on screen the start date is left of the end date');
});

await step('3b. The EL AL cart is part of the starting data', async () => {
  const flights = page.locator('section[aria-label="השוואת טיסות"]');
  const text = strip(await flights.textContent());
  check(text.includes('$915.96'), 'EL AL round trip $915.96 is shown');
  check(text.includes('Benchmark'), 'marked as benchmark');
  check(text.includes('ישירה בשני הכיוונים') && text.includes('מגיעה יומיים לפני הקרוז'), 'rated ⭐ with the reasons');
  check(text.includes('לא מחיר מובטח'), 'shown as a checked price, not a guaranteed one');
  check(text.includes('$837.76') && text.includes('לא מאומת'), 'group B derived price is marked unverified');
  const rec = strip(await page.locator('section[aria-label="האפשרות המומלצת"]').textContent());
  check(rec.includes('עדיין מוקדם לבחור'), 'recommendation says "too early to choose" while data is missing');
  const a = page.locator('section[aria-label="קבוצה A – זוג + תינוק"]');
  await a.locator('input[type=radio]').first().check();
  const totalText = await totalRowText(page, 'A');
  check(totalText.includes('$5,720.96'), `room $4,805 + cart $915.96 = $5,720.96 (not doubled): ${totalText.slice(0, 40)}`);
  const route = strip(await a.locator('tr.row-route td').first().textContent());
  check(route.includes('03/09') && route.includes('05/09–12/09') && route.includes('14/09'), `trip route: ${route}`);
  await page.getByRole('button', { name: 'איפוס לנתונים ההתחלתיים' }).count();
});

await step('4. Full scenario entered through the UI', async () => {
  await nav(page, 'הזנת נתונים').click();
  // Start from an empty trip: delete the two EL AL cart records (also tests deleting).
  while ((await page.locator('.flight-card').count()) > 0) {
    await page.locator('.flight-card').first().getByRole('button', { name: 'מחק' }).click();
  }
  check((await page.locator('.flight-card').count()) === 0, 'EL AL cart records deleted');
  const formA = page.locator('.group-card.group-A');
  const formB = page.locator('.group-card.group-B');
  const sectionA = page.locator('section[aria-label="הזנה – קבוצה A – זוג + תינוק"]');
  const sectionB = page.locator('section[aria-label="הזנה – קבוצה B – זוג"]');

  // Group A
  await selectContaining(formA.getByLabel('חדר – זוג + תינוק'), 'מרפסת פנימי');
  await sectionA.getByRole('button', { name: '+ טיסת הלוך' }).click();
  let card = sectionA.locator('.flight-card').nth(0);
  await card.getByLabel('חברת תעופה').fill('El Al');
  await card.getByLabel('מספר טיסה').fill('LY395');
  for (const [label, value] of [
    ['מחיר טיסה – מבוגר 1', '385'],
    ['מחיר טיסה – מבוגר 2', '385'],
    ['מחיר טיסה – תינוק', '0'],
    ['מושב – מבוגר 1', '35'],
    ['מושב – מבוגר 2', '35'],
    ['מזוודה – מבוגר 1', '70'],
    ['מזוודה – מבוגר 2', '70'],
  ]) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await sectionA.getByRole('button', { name: '+ טיסת חזור' }).click();
  card = sectionA.locator('.flight-card').nth(1);
  await card.getByLabel('חברת תעופה').fill('El Al');
  for (const [label, value] of [
    ['מחיר טיסה – מבוגר 1', '420'],
    ['מחיר טיסה – מבוגר 2', '420'],
    ['מושב – מבוגר 1', '35'],
    ['מושב – מבוגר 2', '35'],
    ['מזוודה – מבוגר 1', '70'],
  ]) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await formA.getByRole('button', { name: '+ מלון חדש' }).first().click();
  let hotel = page.locator('.hotel-card').nth(0);
  await hotel.getByLabel('שם המלון').fill('Hotel A');
  await hotel.getByLabel('Check-in').fill('2027-09-03');
  await hotel.getByLabel('Check-out').fill('2027-09-05');
  await hotel.getByLabel('מחיר ללילה').fill('220');
  await hotel.getByLabel('City tax / מס מקומי (סה״כ)').fill('14');
  await hotel.getByLabel('ארוחת בוקר (סה״כ)').fill('36');
  await formA.getByLabel('טיפים – זוג + תינוק').fill('18.5');
  await formA.getByLabel('איך הוזנו הטיפים').selectOption('person');
  await formA.getByLabel('עמלת סוכן').fill('100');

  // Group B
  await selectContaining(formB.getByLabel('חדר – זוג'), 'פונה לים');
  await sectionB.getByRole('button', { name: '+ כרטיס הלוך-חזור' }).click();
  card = sectionB.locator('.flight-card').nth(0);
  await card.getByLabel('חברת תעופה').fill('Vueling');
  for (const [label, value] of [
    ['מחיר טיסה – מבוגר 1', '790'],
    ['מחיר טיסה – מבוגר 2', '790'],
    ['מושב – מבוגר 1', '30'],
    ['מושב – מבוגר 2', '30'],
    ['מזוודה – מבוגר 1', '70'],
    ['מזוודה – מבוגר 2', '70'],
  ]) {
    await card.getByLabel(label, { exact: true }).fill(value);
  }
  await page.getByRole('button', { name: '+ מלון לפני הקרוז' }).click();
  hotel = page.locator('.hotel-card').nth(1);
  await hotel.getByLabel('שייך ל').selectOption('both');
  await hotel.getByLabel('שם המלון').fill('Shared hotel');
  await hotel.getByLabel('מחיר ללילה').fill('300'); // nights come from the pre-filled dates 03/09 → 05/09
  await selectContaining(formB.getByLabel('מלון – זוג'), 'Shared hotel');
  await formB.getByLabel('טיפים – זוג').fill('150');
  await formB.getByLabel('עמלת סוכן').fill('80');

  const a = strip(await formA.locator('.total-main').textContent());
  const b = strip(await formB.locator('.total-main').textContent());
  check(a.includes('$7,392'), `entry screen: group A total ${a} (expected $7,392)`);
  check(b.includes('$7,090'), `entry screen: group B total ${b} (expected $7,090)`);
  const linesA = strip(await formA.locator('.total-lines').textContent());
  for (const part of ['קרוז: $4,805', 'טיסות: $1,610', 'מושבים: $140', 'מזוודות: $210', 'מלון בברצלונה לפני הקרוז: $490', 'טיפים לצוות: $37', 'עמלת סוכן: $100']) {
    check(linesA.includes(part), `group A line "${part}"`);
  }
  const linesB = strip(await formB.locator('.total-lines').textContent());
  for (const part of ['קרוז: $4,780', 'טיסות: $1,580', 'מושבים: $60', 'מזוודות: $140', 'מלון בברצלונה לפני הקרוז: $300', 'טיפים לצוות: $150', 'עמלת סוכן: $80']) {
    check(linesB.includes(part), `group B line "${part}"`);
  }
});

await step('5. Summary shows the same totals; B off/on never changes A', async () => {
  await nav(page, 'סיכום והשוואה').click();
  check((await totalRowText(page, 'A')).includes('$7,392'), 'summary: A = $7,392');
  check((await totalRowText(page, 'B')).includes('$7,090'), 'summary: B = $7,090');
  if (shotsDir) await page.screenshot({ path: join(shotsDir, 'desktop-summary.png'), fullPage: true });

  await page.getByRole('button', { name: 'לא – רק קבוצה A' }).click();
  check((await totalRowText(page, 'A')).includes('$7,392'), 'B off: A is still $7,392');
  check((await page.locator('section[aria-label="קבוצה B – זוג"]').count()) === 0, 'B off: group B is hidden');
  check(!strip(await page.locator('main').textContent()).includes('$7,090'), 'B off: no B amount anywhere');

  await page.getByRole('button', { name: 'כן', exact: true }).click();
  check((await totalRowText(page, 'B')).includes('$7,090'), 'B on again: B data is back ($7,090)');
  check((await totalRowText(page, 'A')).includes('$7,392'), 'B on again: A unchanged');
});

await step('6. Refresh keeps everything (localStorage)', async () => {
  await page.reload({ waitUntil: 'load' });
  await nav(page, 'סיכום והשוואה').waitFor();
  check((await totalRowText(page, 'A')).includes('$7,392'), 'after refresh: A = $7,392');
  check((await totalRowText(page, 'B')).includes('$7,090'), 'after refresh: B = $7,090');
});

let backupPath = null;
await step('7. Details screen, export and import', async () => {
  await nav(page, 'פרטים ותנאים').click();
  const text = strip(await page.locator('main').textContent());
  check(text.includes('90 יום לפני = 07/06/2027'), '90 days before 05/09/2027 = 07/06/2027');
  check(text.includes('90 יום לפני = 21/06/2027'), '90 days before 19/09/2027 = 21/06/2027');
  check(text.includes('מקדמה – דורש בירור'), 'deposit marked "needs clarification"');

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ייצוא נתונים (JSON)' }).click()]);
  backupPath = await download.path();
  const data = JSON.parse(readFileSync(backupPath, 'utf8'));
  check(data.version === 3 && data.flights.length === 3 && data.hotels.length === 2, 'export: JSON with all flights and hotels');

  await page.getByRole('button', { name: 'איפוס לנתונים ההתחלתיים' }).click();
  await nav(page, 'סיכום והשוואה').click();
  check(!(await totalRowText(page, 'A')).includes('$7,392'), 'reset: entered data is gone');

  await nav(page, 'פרטים ותנאים').click();
  await page.getByLabel('קובץ גיבוי').setInputFiles(backupPath);
  await page.getByText('הגיבוי נטען.').waitFor();
  await nav(page, 'סיכום והשוואה').click();
  check((await totalRowText(page, 'A')).includes('$7,392'), 'import: A = $7,392 again');
  check((await totalRowText(page, 'B')).includes('$7,090'), 'import: B = $7,090 again');
});

await step('8. Browser console is clean', async () => {
  check(problems.length === 0, problems.length === 0 ? 'no errors, no failed requests, no 404' : problems.join('\n    '));
});
await context.close();

// ---------------------------------------------------------------- mobile
await step('9. Mobile (390 × 844): no horizontal overflow on any screen', async () => {
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await mobile.newPage();
  const mobileProblems = watch(m);
  current = { page: m, problems: mobileProblems };
  await m.goto(url, { waitUntil: 'load' });
  for (const [button, file] of [
    ['סיכום והשוואה', 'mobile-summary.png'],
    ['הזנת נתונים', 'mobile-entry.png'],
    ['פרטים ותנאים', 'mobile-details.png'],
  ]) {
    await nav(m, button).click();
    if (button === 'הזנת נתונים') {
      await m.locator('section[aria-label="הזנה – קבוצה A – זוג + תינוק"]').getByRole('button', { name: '+ טיסת הלוך' }).click();
    }
    const { scrollWidth, innerWidth } = await m.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    check(scrollWidth <= innerWidth, `${button}: page width ${scrollWidth}px ≤ ${innerWidth}px`);
    if (shotsDir) await m.screenshot({ path: join(shotsDir, file), fullPage: true });
  }
  const small = await m.evaluate(() =>
    Array.from(document.querySelectorAll('button, select, input[type=radio]'))
      .filter((el) => el.offsetParent !== null && el.type !== 'radio')
      .filter((el) => el.getBoundingClientRect().height < 30).length,
  );
  check(small === 0, `all buttons/selects are at least 30px tall (${small} too small)`);
  check(mobileProblems.length === 0, mobileProblems.length === 0 ? 'mobile console clean' : mobileProblems.join('\n    '));
  await mobile.close();
});

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
