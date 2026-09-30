import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import react from '@vitejs/plugin-react';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

// Real React/DOM regressions with synthetic questions and deferred PDF work. No account or corpus access.
const root = fileURLToPath(new URL('..', import.meta.url));
let server, browser, url;
beforeAll(async () => {
  server = await createServer({ configFile: false, root, plugins: [react()], server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { include: ['react', 'react-dom/client'] } });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
  const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || (existsSync(macChrome) ? macChrome : undefined) });
}, 30000);
afterAll(async () => { await browser?.close(); await server?.close(); });

async function scenario(mode) {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/src/main.tsx*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    const { createRoot } = ReactDOM;
    import { Practice } from '/src/components/Practice.tsx';
    import { QuestionBrowser } from '/src/components/QuestionBrowser.tsx';
    import { App } from '/src/App.tsx';
    import { parseCatalog } from '/src/lib/catalog.ts';
    import { fixtureCatalog } from '/src/lib/fixtures.ts';
    import '/src/styles.css';
    window.rawFixture = fixtureCatalog();
    const catalog = parseCatalog(window.rawFixture);
    window.activity = []; window.downloads = []; window.signOuts = []; window.builderSignals = [];
    window.pdfMode = 'ok'; window.pendingPdfs = [];
    const loadPdf = async key => {
      if (window.pdfMode === 'error') throw Error('download failed');
      if (window.pdfMode === 'pending') await new Promise(resolve => window.releasePdf = resolve);
      if (window.pdfMode === 'controlled') await new Promise((resolve, reject) => window.pendingPdfs.push({ key, resolve, reject }));
      return new Uint8Array([1]);
    };
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (this.download) window.downloads.push(this.download); else originalClick.call(this); };
    const props = ${JSON.stringify(mode)} === 'practice'
      ? [Practice, { pool: catalog.questions.slice(0, 2), loadPdf, onClose() {} }]
      : ${JSON.stringify(mode)} === 'replaced'
      ? [App, { config: { localCorpus: false, supabaseUrl: 'https://example.supabase.co', supabaseKey: 'synthetic', usernameDomain: 'example.test', bucket: 'corpus', corpusPrefix: 'test' } }]
      : [QuestionBrowser, { catalog, loadPdf, account: 'synthetic', onSignOut() {}, designMode: 'classic', onDesignModeChange() {}, onActivity: (...args) => window.activity.push(args) }];
    createRoot(document.getElementById('root')).render(React.createElement(...props));
  ` }));
  await page.route('**/src/lib/render.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export function openForRendering() { return { promise: Promise.resolve({}), destroy: async () => {} }; }
    export async function renderSlice() {
      if (window.renderMode === 'error') throw Error('render failed');
      return document.createElement('canvas');
    }
  ` }));
  await page.route('**/src/lib/sliceContent.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export function pdfContentCheck() { return { hasContent: async () => true, contentBox: async () => null, close: async () => {} }; }
  ` }));
  await page.route('**/src/lib/exportPdf.ts*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    async function build(options) {
      window.builderSignals.push(options?.signal);
      await new Promise(resolve => window.releaseBuild = resolve);
      return { bytes: new Uint8Array([1]), exported: window.builderExported ?? 1, pages: 1, skipped: [] };
    }
    export const exportQuestionsClean = (q, load, title, options) => build(options);
    export const exportQuestions = (q, load, title, stamp, content, signal) => build({ signal });
    export const exportMarkscheme = (q, load, title, stamp, content, box, signal) => build({ signal });
    export const decorateExport = async bytes => bytes;
  ` }));
  await page.route('**/*supabase*supabase-js*', (route) => route.fulfill({ contentType: 'text/javascript', body: `
    export function createClient() { return {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: 'synthetic', email: 'synthetic@example.test' } } } }),
        onAuthStateChange(callback) { window.authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; },
        signOut: async options => { window.signOuts.push(options); window.authCallback('SIGNED_OUT', null); return { error: null }; }
      },
      rpc: async () => ({ data: 'replaced', error: null }),
      functions: { invoke: async () => ({ data: null, error: new Error('not admin') }) }
    }; }
  ` }));
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('button') || document.querySelector('vite-error-overlay'), undefined, { timeout: 8000 }).catch(error => { throw new Error(`${error.message}; ${errors.join(' | ')}; ${page.url()}`); });
  expect(errors).toEqual([]);
  return page;
}

describe('recovery and cancellable UI', () => {
  it('facet controls filter exact canonical IDs, not shared-source reference titles', async () => {
    const page = await scenario('export');
    try {
      for (const [facet, values, keep] of [['year', [2024, 2019], 2019], ['level', ['HL', 'SL'], 'SL'], ['paper', ['Paper 1A', 'Paper 2'], 'Paper 1A']]) {
        for (const value of values) {
          const checkbox = page.getByRole('checkbox', { name: String(value), exact: true });
          if (await checkbox.isChecked() !== (value === keep)) await checkbox.click();
        }
        const expected = await page.evaluate(({ facet, keep }) => {
          const raw = window.rawFixture;
          return raw.questions.filter(q => raw.documents[q.doc].subject === 'physics' && raw.documents[q.doc][facet] === keep).map(q => q.id).sort();
        }, { facet, keep });
        expect((await page.locator('.qcard').evaluateAll(cards => cards.map(card => card.dataset.questionId))).sort()).toEqual(expected);
        await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
      }
    } finally { await page.close(); }
  }, 30000);
  it('fits the mobile toolbar and topic statistics without horizontal page overflow', async () => {
    const page = await scenario('export');
    try {
      await page.setViewportSize({ width: 390, height: 780 });
      for (const design of ['classic', 'archive']) {
        await page.evaluate(design => { document.documentElement.dataset.design = design; }, design);
        const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, overflowing: [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > 391).map(element => element.className).slice(0, 10) }));
        expect(dimensions.scroll, JSON.stringify(dimensions)).toBeLessThanOrEqual(dimensions.client + 1);
        await page.getByRole('button', { name: 'Topic stats', exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);
        await page.getByRole('button', { name: 'Hide topic stats', exact: true }).click();
      }
    } finally { await page.close(); }
  }, 30000);
  it('replaced-device recovery signs out locally, not the newer session', async () => {
    const page = await scenario('replaced');
    try {
      await page.getByRole('button', { name: 'Sign in again' }).click();
      expect(await page.evaluate(() => window.signOuts)).toEqual([{ scope: 'local' }]);
      await page.locator('input[name="username"]').waitFor();
    } finally { await page.close(); }
  }, 30000);

  it('clears the old question immediately and cannot mark a failed next load', async () => {
    const page = await scenario('practice');
    try {
      await page.getByRole('button', { name: 'Start practice' }).click();
      await page.locator('.practice-question > .slices canvas').first().waitFor();
      await page.evaluate(() => { window.pdfMode = 'pending'; });
      await page.getByRole('button', { name: 'Skip', exact: true }).click();
      await page.waitForFunction(() => !!window.releasePdf);
      expect(await page.locator('canvas').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Show markscheme' }).isDisabled()).toBe(true);
      await page.evaluate(() => { window.renderMode = 'error'; window.releasePdf(); });
      await page.getByRole('alert').waitFor();
      expect(await page.locator('canvas').count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Show markscheme' }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  it('does not enable self-marking before the markscheme has rendered', async () => {
    const page = await scenario('practice');
    try {
      await page.getByRole('button', { name: 'Start practice' }).click();
      await page.locator('canvas').first().waitFor();
      await page.evaluate(() => { window.pdfMode = 'error'; });
      await page.getByRole('button', { name: 'Show markscheme' }).click();
      await page.getByRole('alert').waitFor();
      expect(await page.getByRole('button', { name: 'Got it' }).isDisabled()).toBe(true);
      expect(await page.getByRole('button', { name: 'Missed it' }).isDisabled()).toBe(true);
    } finally { await page.close(); }
  }, 30000);

  for (const phase of ['questions', 'markscheme']) for (const layout of ['clean', 'original']) {
    it(`cancel during ${layout} ${phase} building aborts and suppresses downloads/activity`, async () => {
      const page = await scenario('export');
      try {
        if (layout === 'original') await page.getByRole('checkbox', { name: 'Clean layout', exact: true }).uncheck();
        await page.locator('.qcard input[type="checkbox"]').first().check();
        await page.getByRole('button', { name: 'Export 1 question', exact: true }).click();
        await page.waitForFunction(() => !!window.releaseBuild);
        if (phase === 'markscheme') {
          await page.evaluate(() => { const release = window.releaseBuild; window.releaseBuild = null; release(); });
          await page.waitForFunction(() => window.builderSignals.length === 2 && !!window.releaseBuild);
        }
        await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        expect(await page.evaluate(() => window.builderSignals.every(signal => signal?.aborted))).toBe(true);
        await page.evaluate(() => window.releaseBuild());
        await page.getByText('Export cancelled.', { exact: true }).waitFor();
        expect(await page.evaluate(() => window.downloads)).toEqual([]);
        expect(await page.evaluate(() => window.activity)).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  for (const outcome of ['cancel', 'timeout', 'failure']) {
    it(`cleans download waits immediately on ${outcome} and ignores late worker completions`, async () => {
      const page = await scenario('export');
      try {
        await page.evaluate(() => {
          window.pdfMode = 'controlled'; window.downloadTimers = new Map();
          const set = window.setTimeout.bind(window), clear = window.clearTimeout.bind(window);
          window.setTimeout = (callback, ms, ...args) => {
            if (ms !== 90000) return set(callback, ms, ...args);
            const id = set(() => {}, 60000); window.downloadTimers.set(id, callback); return id;
          };
          window.clearTimeout = id => { window.downloadTimers.delete(id); clear(id); };
        });
        await page.locator('.qcard input[type="checkbox"]').first().check();
        await page.getByRole('button', { name: 'Export 1 question', exact: true }).click();
        await page.waitForFunction(() => window.pendingPdfs.length === 2);
        if (outcome === 'cancel') await page.getByRole('button', { name: 'Cancel', exact: true }).click();
        else await page.evaluate(outcome => {
          if (outcome === 'timeout') window.downloadTimers.values().next().value();
          else window.pendingPdfs[0].reject(Error('failed'));
        }, outcome);
        await page.getByText(outcome === 'cancel' ? 'Export cancelled.' : outcome === 'timeout'
          ? 'A paper took too long to download. Check your connection and try again.'
          : 'The export failed. Try again, or select fewer questions.', { exact: true }).waitFor();
        expect(await page.evaluate(() => window.downloadTimers.size)).toBe(0);
        await page.evaluate(() => window.pendingPdfs.forEach(pending => pending.resolve()));
        await page.waitForTimeout(25);
        expect(await page.locator('.export-progress').count()).toBe(0);
        expect(await page.evaluate(() => window.downloads)).toEqual([]);
        expect(await page.evaluate(() => window.activity)).toEqual([]);
      } finally { await page.close(); }
    }, 30000);
  }

  it('logs builder exported counts rather than the selection size', async () => {
    const page = await scenario('export');
    try {
      await page.evaluate(() => { window.builderExported = 0; });
      await page.locator('.qcard input[type="checkbox"]').first().check();
      await page.getByRole('button', { name: 'Export 1 question', exact: true }).click();
      await page.waitForFunction(() => !!window.releaseBuild);
      await page.evaluate(() => { const release = window.releaseBuild; window.releaseBuild = null; release(); });
      await page.waitForFunction(() => window.builderSignals.length === 2 && !!window.releaseBuild);
      await page.evaluate(() => window.releaseBuild());
      await page.waitForFunction(() => window.activity.length === 2);
      expect(await page.evaluate(() => window.activity.map(([kind, subject, items]) => [kind, subject, items]))).toEqual([['export', 'physics', 0], ['markscheme', 'physics', 0]]);
    } finally { await page.close(); }
  }, 30000);
});
