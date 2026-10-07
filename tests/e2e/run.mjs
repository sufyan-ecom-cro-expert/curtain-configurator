// Usage: STORE_URL=https://store.myshopify.com STORE_PASSWORD=... THEME_ID=123 node run.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';

const STORE = process.env.STORE_URL;
const THEME = process.env.THEME_ID;
const password = process.env.STORE_PASSWORD;
const PDP = `/products/made-to-measure-curtain?preview_theme_id=${THEME}`;
const OUT = new URL('./out/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const consoleMessages = [];
page.on('console', (m) => consoleMessages.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => consoleMessages.push(`pageerror: ${e.message}`));

await page.goto(`${STORE}/password`);
await page.fill('input[type="password"]', password);
await Promise.all([page.waitForLoadState('load'), page.press('input[type="password"]', 'Enter')]);
await page.waitForTimeout(1500);

await page.goto(`${STORE}${PDP}`, { waitUntil: 'load' });
await page.evaluate(() => {
  window.__shifts = [];
  new PerformanceObserver((list) => list.getEntries().forEach((e) => window.__shifts.push({ value: e.value, sources: e.sources.map((s) => s.node?.className || s.node?.nodeName) }))).observe({
    type: 'layout-shift',
    buffered: false,
  });
});

const revealAll = async () => {
  for (let y = 0; y < (await page.evaluate(() => document.body.scrollHeight)); y += 400) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await page.waitForTimeout(80);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
};
await page.addStyleTag({ content: '#PBarNextFrameWrapper, #preview-bar-iframe { display: none !important; }' }).catch(() => {});
await page.screenshot({ path: `${OUT}desktop-initial.png` });

const cc = page.locator('curtain-configurator');
check('configurator rendered', (await cc.count()) === 1);
check('no Panels control on page', (await page.locator('[name="panels"], [name*="Panels"], variant-selects, select').count()) === 0);
check('no Dawn product-form on template', (await page.locator('product-form').count()) === 0);

const price = () => page.locator('[data-price]').innerText();
const label = () => page.locator('[data-submit-label]').innerText();
const spec = (n) => page.locator(`[data-spec="${n}"]`).innerText();
const setWidth = async (v) => {
  await page.fill('[name="width"]', String(v));
};
const pickDrop = (v) => page.locator(`label.cc__drop:has-text("${v}")`).click();
const pickColor = (v) => page.locator(`label.cc__swatch:has-text("${v}")`).click();

const expectedDay = (days) => {
  const date = new Date();
  while (days > 0) {
    date.setDate(date.getDate() + 1);
    if (date.getDay() % 6 !== 0) days--;
  }
  return `${date.getDate()} ${date.toLocaleDateString('en', { month: 'long' })}`;
};
const note = await page.locator('.cc__note').innerText();
check('delivery dates', note === `Made to order · Ships ${expectedDay(7)} to ${expectedDay(10)}`, note);

const layout = await page.evaluate(() => {
  const rect = (el) => el.getBoundingClientRect();
  const stage = rect(document.querySelector('.cc__stage'));
  const thumb = rect(document.querySelector('.cc__thumb'));
  const main = document.getElementById('MainContent').offsetTop;
  const padTop = parseFloat(getComputedStyle(document.querySelector('.cc')).paddingTop);
  const summary = document.querySelector('.cc__summary');
  const rows = [...document.querySelectorAll('.cc__panel > .cc__row')];
  return {
    thumbLeftOfStage: thumb.right <= stage.left && Math.abs(thumb.top - stage.top) < 2,
    stageHeight: Math.round(stage.height),
    expectedHeight: Math.round(window.innerHeight - main - padTop),
    rows: rows.length,
    rowsAfterSummary: rows.every((row) => summary.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING),
  };
});
check('desktop thumbnails left of main image', layout.thumbLeftOfStage);
check('main image fills screen below header', Math.abs(layout.stageHeight - layout.expectedHeight) <= 1, `${layout.stageHeight} vs ${layout.expectedHeight}`);
check('three collapsible rows below add to cart', layout.rows === 3 && layout.rowsAfterSummary, String(layout.rows));

check('initial price', (await price()) === 'Rs.22,000.00', await price());
check('initial label', (await label()).includes('Rs.22,000.00'), await label());

const cases = [
  { width: 80, drop: '150cm', panels: '1', price: 'Rs.12,000.00' },
  { width: 120, drop: '200cm', panels: '1', price: 'Rs.14,500.00' },
  { width: 121, drop: '200cm', panels: '2', price: 'Rs.26,500.00' },
  { width: 240, drop: '250cm', panels: '2', price: 'Rs.31,000.00' },
  { width: 241, drop: '250cm', panels: '3', price: 'Rs.45,000.00' },
  { width: 360, drop: '150cm', panels: '3', price: 'Rs.32,000.00' },
  { width: 50, drop: '250cm', panels: '1', price: 'Rs.17,000.00' },
];
for (const c of cases) {
  await pickDrop(c.drop);
  await setWidth(c.width);
  const ok = (await price()) === c.price && (await spec('panels')) === c.panels && (await label()).endsWith(c.price);
  check(`width ${c.width} drop ${c.drop}`, ok, `${await price()} / ${await spec('panels')} panels / "${await label()}"`);
}

for (const [value, message] of [
  [49, 'between'],
  [361, 'between'],
  ['180.5', 'whole'],
  ['', 'Enter your width'],
]) {
  await setWidth(value);
  await page.waitForTimeout(900);
  const error = page.locator('[data-width-error]');
  const disabled = await page.locator('[data-submit]').isDisabled();
  check(
    `invalid width "${value}"`,
    (await error.isVisible()) && (await error.innerText()).includes(message) && disabled,
    `${await error.innerText()} / disabled=${disabled}`
  );
}

await setWidth(180);
await page.waitForTimeout(100);
check('error clears when valid', !(await page.locator('[data-width-error]').isVisible()));

const activeMedia = () => page.locator('.cc__slide.is-active').getAttribute('data-media-id');
const before = await activeMedia();
await pickColor('Teal');
await page.waitForTimeout(600);
const after = await activeMedia();
check('color switches gallery image', before !== after, `${before} -> ${after}`);

// Keyboard: arrow keys move through the swatch radio group.
await page.locator('[name="color"]:checked').focus();
await page.keyboard.press('ArrowLeft');
const keyboardColor = await page.locator('[name="color"]:checked').inputValue();
check('swatches keyboard navigable', keyboardColor === 'Stone Grey', keyboardColor);

await pickDrop('200cm');
await setWidth(180);
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}desktop.png`, fullPage: false });
check('summary for 180/200/Stone Grey', (await price()) === 'Rs.26,500.00' && (await spec('color')) === 'Stone Grey', await price());

const shifts = await page.evaluate(() => window.__shifts);
check('zero layout shift during interaction', shifts.reduce((a, b) => a + b.value, 0) === 0, JSON.stringify(shifts));

const openRows = () => page.locator('.cc__row').evaluateAll((rows) => rows.map((row) => row.open));
check('all rows closed by default', (await openRows()).every((open) => !open));
await page.locator('.cc__row-title').nth(0).click();
await page.waitForTimeout(500);
await page.locator('.cc__row-title').nth(1).click();
await page.waitForTimeout(500);
check('only one row open at a time', JSON.stringify(await openRows()) === '[false,true,false]', JSON.stringify(await openRows()));
await page.locator('.cc__row-title').nth(1).click();
await page.waitForTimeout(500);
check('row closes again', (await openRows()).every((open) => !open));

await page.locator('[data-submit]').hover();
await page.waitForTimeout(900);
const hover = await page.locator('[data-submit]').evaluate((el) => ({
  curtain: getComputedStyle(el, '::before').transform,
  color: getComputedStyle(el).color,
  accent: getComputedStyle(el).borderTopColor,
}));
check('button curtain drops on hover', hover.curtain === 'matrix(1, 0, 0, 1, 0, 0)' && hover.color === hover.accent, JSON.stringify(hover));
await page.mouse.move(0, 0);

// Add to cart.
const requestPromise = page.waitForRequest((r) => r.url().includes('/cart/add.js'));
const responsePromise = page.waitForResponse((r) => r.url().includes('/cart/add.js'));
await page.click('[data-submit]');
const request = await requestPromise;
const response = await responsePromise;
const payload = JSON.parse(request.postData());
fs.writeFileSync(`${OUT}payload.json`, JSON.stringify(payload, null, 2));
check('payload properties', JSON.stringify(payload.properties) === JSON.stringify({ Width: '180cm', Drop: '200cm', _fabric_panels: 2 }), JSON.stringify(payload.properties));
check('payload sections', JSON.stringify(payload.sections) === JSON.stringify(['cart-drawer', 'cart-icon-bubble']) && !!payload.sections_url, JSON.stringify(payload.sections));
check('add.js 200', response.status() === 200, String(response.status()));
const added = await response.json();
check('response has rendered sections', !!added.sections?.['cart-drawer'] && !!added.sections?.['cart-icon-bubble']);

await page.waitForSelector('cart-drawer.active', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
const drawer = page.locator('cart-drawer');
const drawerText = await drawer.innerText();
check('drawer opened', await drawer.evaluate((el) => el.classList.contains('active')));
check('drawer shows Width/Drop', /Width:\s*180cm/.test(drawerText) && /Drop:\s*200cm/.test(drawerText));
check('drawer hides _fabric_panels', !drawerText.includes('_fabric_panels') && !/fabric_panels/i.test(drawerText));
check('drawer hides Panels option and duplicate Drop', !/Panels:/.test(drawerText) && (drawerText.match(/Drop:/g) || []).length === 1 && /Color:\s*Stone Grey/.test(drawerText));
check('button success state', (await label()) === 'Added to cart', await label());
await page.screenshot({ path: `${OUT}drawer.png` });

const cart = await page.evaluate(() => fetch('/cart.js').then((r) => r.json()));
const line = cart.items.find((i) => i.product_title === 'Made-to-Measure Curtain');
fs.writeFileSync(`${OUT}cart.json`, JSON.stringify(line, null, 2));
check(
  'cart line variant + properties',
  line &&
    line.variant_options.join('/') === 'Stone Grey/200cm/2' &&
    line.properties.Width === '180cm' &&
    line.properties.Drop === '200cm' &&
    String(line.properties._fabric_panels) === '2' &&
    line.price === 2650000,
  line && `${line.variant_options.join('/')} ${JSON.stringify(line.properties)} ${line.price}`
);
check('cart icon bubble updated', (await page.locator('#cart-icon-bubble .cart-count-bubble').count()) > 0);

await page.goto(`${STORE}/cart?preview_theme_id=${THEME}`, { waitUntil: 'load' });
const cartText = await page.locator('main').innerText();
check('cart page shows Width/Drop', /Width:\s*180cm/.test(cartText) && /Drop:\s*200cm/.test(cartText));
check('cart page hides _fabric_panels', !/fabric_panels/i.test(cartText));
check('cart page hides Panels option and duplicate Drop', !/Panels:/.test(cartText) && (cartText.match(/Drop:/g) || []).length === 1);
await page.screenshot({ path: `${OUT}cart-page.png`, fullPage: true });

// Error handling: simulate a 422 from the Ajax API.
await page.goto(`${STORE}${PDP}`, { waitUntil: 'load' });
await page.route('**/cart/add.js', (route) =>
  route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ status: 422, message: 'Cart Error', description: 'Only 0 items available.' }) })
);
await page.click('[data-submit]');
await page.waitForTimeout(500);
check('API error shown', (await page.locator('[data-form-error]').innerText()) === 'Only 0 items available.');
check('button re-enabled after error', !(await page.locator('[data-submit]').isDisabled()) && (await label()).startsWith('Add to cart'), await label());
await page.unroute('**/cart/add.js');

await page.route('**/cart/add.js', (route) => route.abort('failed'));
await page.click('[data-submit]');
await page.waitForTimeout(500);
check('network error shown', (await page.locator('[data-form-error]').innerText()).startsWith('Something went wrong'));
await page.unroute('**/cart/add.js');

for (const [name, width, height] of [
  ['tablet', 900, 1100],
  ['mobile', 390, 844],
]) {
  await page.setViewportSize({ width, height });
  await page.goto(`${STORE}${PDP}`, { waitUntil: 'load' });
  await page.addStyleTag({ content: '#PBarNextFrameWrapper, #preview-bar-iframe { display: none !important; }' }).catch(() => {});
  await revealAll();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(`${name}: no horizontal overflow`, overflow <= 0, String(overflow));
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
}

fs.writeFileSync(`${OUT}console.txt`, consoleMessages.join('\n'));
const beforeSimulatedFailure = consoleMessages.slice(0, consoleMessages.findIndex((m) => m.includes('Failed to fetch')));
check('no configurator errors or price warnings', !beforeSimulatedFailure.some((m) => /curtain-configurator/.test(m)));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
