// Browser smoke check against the production build served at the Pages base path.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/ib-questionfilter-web/';
const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.json':'application/json' };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!p.startsWith(BASE)) { res.writeHead(404).end('outside base path'); return; }
  let rel = p.slice(BASE.length) || 'index.html';
  let file = join(DIST, rel);
  try { if ((await stat(file)).isDirectory()) file = join(file, 'index.html'); }
  catch { file = join(DIST, 'index.html'); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}${BASE}`;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); };

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const failedRequests = [];
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} ${r.failure()?.errorText}`));
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

await page.goto(url, { waitUntil: 'networkidle' });

check('page loads at the repository base path', (await page.title()) === 'IB Question Filter');
check('demo-data banner is shown', (await page.locator('.banner').first().innerText()).includes('Demonstration data'));
check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
check('no failed requests', failedRequests.length === 0, failedRequests.join(' | '));

// Subject switching
for (const s of ['Chemistry', 'Mathematics', 'Physics']) {
  await page.getByRole('button', { name: s, exact: true }).click();
  await page.waitForTimeout(60);
  const n = await page.locator('.qcard').count();
  check(`${s} selection lists questions`, n > 0, `${n} cards`);
}

// Physics: cross-year separation must show BOTH years of the identical question
await page.getByRole('button', { name: 'Physics', exact: true }).click();
await page.waitForTimeout(60);
const physText = await page.locator('main').innerText();
check('identical physics question appears in 2024 AND 2025',
  physText.includes('2024 May') && physText.includes('2025 May'));

// Chemistry: same-year duplicate collapsed to one row
await page.getByRole('button', { name: 'Chemistry', exact: true }).click();
await page.waitForTimeout(60);
const empirical = await page.locator('.qcard', { hasText: 'empirical formula' }).count();
check('same-year duplicate collapses to exactly one visible row', empirical === 1, `${empirical} rows`);
const prov = await page.locator('.prov').first().innerText().catch(() => '');
check('suppressed occurrence is still shown as provenance', prov.includes('Also appears as'));

// Diagram + table rendering
await page.locator('.qcard', { hasText: 'electronic transitions' }).scrollIntoViewIfNeeded();
const svgCount = await page.locator('.qcard svg').count();
check('diagram questions render an SVG figure', svgCount > 0, `${svgCount} svg`);
const tableCells = await page.locator('.qcard table td').count();
check('table questions render a real table', tableCells > 0, `${tableCells} cells`);
const svgBox = await page.locator('.qcard svg').first().boundingBox();
check('rendered diagram has non-zero size', !!svgBox && svgBox.width > 40 && svgBox.height > 20,
  svgBox ? `${Math.round(svgBox.width)}x${Math.round(svgBox.height)}` : 'no box');

// Year filter
await page.getByRole('button', { name: '2018', exact: true }).click();
await page.waitForTimeout(60);
const after = await page.locator('.qcard').allInnerTexts();
check('year filter narrows to the chosen year', after.length > 0 && after.every((t) => t.includes('2018')));
await page.getByRole('button', { name: '2018', exact: true }).click();
await page.waitForTimeout(60);

// Only selected topics
await page.getByRole('checkbox', { name: /Electron configurations/ }).check();
await page.waitForTimeout(60);
const anyMode = await page.locator('.qcard').count();
await page.getByText('Only selected topics').click();
await page.waitForTimeout(80);
const subsetMode = await page.locator('.qcard').count();
check('"Only selected topics" excludes questions reaching outside the selection',
  subsetMode < anyMode, `any=${anyMode} subset=${subsetMode}`);
await page.getByText('Only selected topics').click();
await page.getByRole('checkbox', { name: /Electron configurations/ }).uncheck();
await page.waitForTimeout(60);

// Exports
await page.getByRole('button', { name: 'Select all shown' }).click();
await page.waitForTimeout(60);
const dl1 = page.waitForEvent('download', { timeout: 20000 });
await page.getByRole('button', { name: 'Export questions PDF' }).click();
const q = await dl1;
check('selected-question PDF downloads', /^selected-questions-\d{4}-\d{2}-\d{2}\.pdf$/.test(q.suggestedFilename()), q.suggestedFilename());

const dl2 = page.waitForEvent('download', { timeout: 20000 });
await page.getByRole('button', { name: 'Generate markscheme' }).click();
const m = await dl2;
check('generated markscheme PDF downloads', /^selected-markscheme-\d{4}-\d{2}-\d{2}\.pdf$/.test(m.suggestedFilename()), m.suggestedFilename());

// Mobile layout
const mobile = await browser.newContext({ viewport: { width: 390, height: 780 } });
const mp = await mobile.newPage();
await mp.goto(url, { waitUntil: 'networkidle' });
const scrollW = await mp.evaluate(() => document.documentElement.scrollWidth);
const clientW = await mp.evaluate(() => document.documentElement.clientWidth);
check('no horizontal overflow at 390px', scrollW <= clientW + 1, `scroll=${scrollW} client=${clientW}`);
check('filters and list both present on mobile',
  (await mp.locator('aside.panel').count()) === 1 && (await mp.locator('.qcard').count()) > 0);
await mp.screenshot({ path: 'scripts/mobile.png', fullPage: false });
await page.screenshot({ path: 'scripts/desktop.png', fullPage: false });

await browser.close();
server.close();

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
