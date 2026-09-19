// Browser checks for the public authenticated shell and the development-only local-corpus app.
// The local corpus is read only from the ignored checkout and is never used by a production build.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { chromium } from 'playwright';
import { inspectBundle } from './verify-bundle.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = resolve(WEB_ROOT, '..');
const DIST = resolve(WEB_ROOT, 'dist');
const CORPUS_DIR = resolve(REPO_ROOT, '.web-corpus');
const BASE = '/ib-questionfilter-web/';
const TYPES = {
  '.bcmap': 'application/octet-stream',
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

function requireCondition(condition, detail) {
  if (!condition) throw new Error(detail);
}

async function runCheck(name, action) {
  try {
    const detail = await action();
    check(name, true, detail ?? '');
    return true;
  } catch (error) {
    check(name, false, error instanceof Error ? error.message : String(error));
    return false;
  }
}

function unique(values) {
  return [...new Set(values)];
}

function subjectInfo(raw, subject) {
  const documents = raw.documents.filter((doc) => doc.subject === subject.id);
  const documentIndexes = new Set(documents.map((doc) => raw.documents.indexOf(doc)));
  const questions = raw.questions.filter((question) => documentIndexes.has(question.doc));
  const paperOrder = { 'paper 1': 0, 'paper 1a': 0, 'paper 1b': 1, 'paper 2': 2, 'paper 3': 3 };
  return {
    ...subject,
    questions,
    years: unique(documents.map((doc) => doc.year)).sort((a, b) => b - a),
    sessions: unique(documents.map((doc) => doc.session)).sort(),
    levels: unique(documents.map((doc) => doc.level)).sort(),
    papers: unique(documents.map((doc) => doc.paper)).sort((a, b) =>
      (paperOrder[a.toLowerCase()] ?? 99) - (paperOrder[b.toLowerCase()] ?? 99) || a.localeCompare(b)),
    topics: unique([...subject.topics, ...questions.flatMap((question) => question.topics ?? [])]),
  };
}

function questionSubject(raw, question) {
  return raw.documents[question.doc]?.subject;
}

function findSubsetTopic(subject) {
  return subject.topics.find((topic) =>
    subject.questions.some((question) => question.topics?.length === 1 && question.topics.includes(topic)) &&
    subject.questions.some((question) => question.topics?.includes(topic) && question.topics.some((other) => other !== topic)),
  );
}

function findRequireAllPair(subject) {
  for (const question of subject.questions) {
    const topics = unique(question.topics ?? []);
    if (topics.length >= 2) return topics.slice(0, 2);
  }
  return null;
}

async function loadLocalCorpus() {
  const [manifestText, catalogText] = await Promise.all([
    readFile(join(CORPUS_DIR, 'upload-manifest.json'), 'utf8'),
    readFile(join(CORPUS_DIR, 'catalog.json'), 'utf8'),
  ]);
  const manifest = JSON.parse(manifestText);
  const catalog = JSON.parse(catalogText);
  requireCondition(manifest.objectCount === 717 && manifest.objects?.length === 717, 'local manifest must contain exactly 717 objects');
  return { manifest, catalog, objects: new Map(manifest.objects.map((item) => [item.key, item])) };
}

async function findRotatedAnswer(local) {
  const questionsByKey = new Map();
  for (const question of local.catalog.questions) {
    const document = local.catalog.documents[question.doc];
    if (!document?.markschemeKey || !Array.isArray(question.a)) continue;
    const list = questionsByKey.get(document.markschemeKey) ?? [];
    list.push({ question, document });
    questionsByKey.set(document.markschemeKey, list);
  }

  for (const [key, entries] of questionsByKey) {
    const item = local.objects.get(key);
    if (!item) continue;
    const bytes = await readFile(resolve(REPO_ROOT, item.file));
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
    for (const entry of entries) {
      for (const answer of entry.question.a) {
        const angle = document.getPage(answer[0]).getRotation().angle;
        if (angle === 90 || angle === 270) return { ...entry, answer, angle };
      }
    }
  }
  throw new Error('no rotated markscheme answer slice was found in the local corpus');
}

async function listen(server) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  return server.address().port;
}

async function closeServer(server) {
  if (!server) return;
  // Playwright can leave an HTTP keep-alive socket open after the last assertion. Close
  // those sockets explicitly so a failed browser check never leaves the harness listening.
  server.closeAllConnections?.();
  server.closeIdleConnections?.();
  await Promise.race([
    new Promise((resolveClose) => server.close(() => resolveClose())),
    new Promise((resolveClose) => setTimeout(resolveClose, 2_000)),
  ]);
}

async function staticServer() {
  const server = createServer(async (request, response) => {
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    } catch {
      response.writeHead(400).end('bad path');
      return;
    }
    if (!pathname.startsWith(BASE)) {
      response.writeHead(404).end('outside base path');
      return;
    }
    const rel = pathname.slice(BASE.length) || 'index.html';
    const candidate = resolve(DIST, rel);
    const inside = candidate === DIST || candidate.startsWith(`${DIST}${sep}`);
    let file = inside ? candidate : resolve(DIST, 'index.html');
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      response.writeHead(200, {
        'cache-control': 'no-store',
        'content-type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      }).end(body);
    } catch {
      if (extname(rel)) response.writeHead(404).end('not found');
      else {
        try {
          const body = await readFile(join(DIST, 'index.html'));
          response.writeHead(200, { 'cache-control': 'no-store', 'content-type': TYPES['.html'] }).end(body);
        } catch {
          response.writeHead(404).end('not found');
        }
      }
    }
  });
  const port = await listen(server);
  return { server, url: `http://127.0.0.1:${port}${BASE}` };
}

function runNode(args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, args, {
      cwd: WEB_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', rejectRun);
    child.once('close', (code, signal) => resolveRun({ child, code, signal, stdout, stderr }));
  });
}

async function startLocalVite() {
  const viteBin = join(WEB_ROOT, 'node_modules/vite/bin/vite.js');
  const child = spawn(process.execPath, [viteBin, '--mode', 'local-corpus', '--host', '127.0.0.1', '--port', '0'], {
    cwd: WEB_ROOT,
    env: { ...process.env, VITE_LOCAL_CORPUS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let settled = false;
  let timer;
  const portPromise = new Promise((resolvePort, rejectPort) => {
    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? rejectPort(error) : resolvePort(port);
    };
    const read = (chunk) => {
      output += chunk.toString();
      const match = output.match(/https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\//);
      if (match) finish(null, Number(match[1]));
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('error', (error) => finish(error));
    child.once('close', (code) => finish(new Error(`Vite exited before serving (code ${code}): ${output.trim()}`)));
    timer = setTimeout(() => finish(new Error(`Timed out waiting for Vite: ${output.trim()}`)), 30_000);
  });
  try {
    const port = await portPromise;
    return { child, url: `http://127.0.0.1:${port}/`, output: () => output };
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolveStop) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
      resolveStop();
    }, 2_000);
    child.once('close', () => { clearTimeout(timer); resolveStop(); });
  });
}

async function closeResource(action, timeout = 2_000) {
  await Promise.race([
    Promise.resolve().then(action).catch(() => {}),
    new Promise((resolveClose) => setTimeout(resolveClose, timeout)),
  ]);
}

async function ensurePdfAssets() {
  const result = await runNode([join(WEB_ROOT, 'scripts/copy-pdfjs-assets.mjs')]);
  requireCondition(result.code === 0, `copying pdf.js assets failed: ${result.stderr || result.stdout}`);
}

async function checkbox(page, name) {
  const locator = page.getByRole('checkbox', { name });
  await locator.first().waitFor({ state: 'attached' });
  return locator.first();
}

async function setChecked(page, name, checked) {
  const locator = await checkbox(page, name);
  if ((await locator.isChecked()) !== checked) await locator.click();
}

async function setFacetExclusive(page, values, keep) {
  requireCondition(values.includes(keep), `facet does not contain ${keep}`);
  await setChecked(page, String(keep), true);
  for (const value of values) {
    if (value !== keep) await setChecked(page, String(value), false);
  }
  await page.waitForTimeout(80);
}

async function waitForCards(page) {
  await page.waitForFunction(() => document.querySelectorAll('.qcard').length > 0, undefined, { timeout: 30_000 });
}

async function allQuestionTitles(page) {
  return page.locator('.qtitle').allInnerTexts();
}

async function downloadBytes(download) {
  const path = await download.path();
  requireCondition(Boolean(path), `download ${download.suggestedFilename()} has no temporary path`);
  return readFile(path);
}

async function collectDownloads(page, action, expected, timeout = 45_000) {
  return new Promise((resolveDownloads, rejectDownloads) => {
    const downloads = [];
    let timer;
    const cleanup = () => {
      page.off('download', onDownload);
      clearTimeout(timer);
    };
    const finish = (error, value) => {
      cleanup();
      if (error) rejectDownloads(error);
      else resolveDownloads(value);
    };
    const onDownload = (download) => {
      downloads.push(download);
      if (downloads.length === expected) finish(null, downloads);
    };
    page.on('download', onDownload);
    timer = setTimeout(() => finish(new Error(`timed out waiting for ${expected} downloads; found ${downloads.length}`)), timeout);
    Promise.resolve().then(action).catch((error) => finish(error));
  });
}

async function main() {
  let browser;
  let pagesContext;
  let localContext;
  let mobileContext;
  let publicServer;
  let localVite;
  try {
    const local = await loadLocalCorpus();
    const rotated = await findRotatedAnswer(local);
    const subjects = local.catalog.subjects.map((subject) => subjectInfo(local.catalog, subject));
    const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));

    await runCheck('local manifest contains all 717 expected objects', async () => {
      requireCondition(local.manifest.objects.length === 717, `found ${local.manifest.objects.length}`);
      return `${local.manifest.objects.length} objects`;
    });

    const bundle = inspectBundle(DIST);
    await runCheck('production bundle contains no public corpus leakage', async () => {
      requireCondition(bundle.failures.length === 0, bundle.failures.join(' | '));
      return `${bundle.files.length} files scanned`;
    });

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
    pagesContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const publicPage = await pagesContext.newPage();
    const publicFailedRequests = [];
    const publicConsoleErrors = [];
    const publicCorpusRequests = [];
    publicPage.on('requestfailed', (request) => publicFailedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`));
    publicPage.on('console', (message) => { if (message.type() === 'error') publicConsoleErrors.push(message.text()); });
    publicPage.on('request', (request) => {
      if (/__local-corpus|\/catalog\.json|\/papers\/|\/markschemes\//i.test(request.url())) publicCorpusRequests.push(request.url());
    });

    publicServer = await staticServer();
    await runCheck('public build serves the authenticated login page', async () => {
      await publicPage.goto(publicServer.url, { waitUntil: 'networkidle', timeout: 30_000 });
      requireCondition((await publicPage.title()) === 'IB Question Filter', `title=${await publicPage.title()}`);
      requireCondition(await publicPage.locator('input[name="username"]').isVisible(), 'username input is not visible');
      requireCondition(await publicPage.locator('input[name="password"]').isVisible(), 'password input is not visible');
      return 'username/password form visible';
    });
    await runCheck('public login exposes no sign-up control or whole-paper route', async () => {
      requireCondition(await publicPage.locator('a,button').filter({ hasText: /sign.?up|open whole paper/i }).count() === 0, 'unexpected public control found');
      return 'no sign-up or whole-paper control';
    });
    await runCheck('public login exposes no corpus rows or requests', async () => {
      requireCondition(await publicPage.locator('.qcard').count() === 0, 'question cards are visible before authentication');
      requireCondition(publicCorpusRequests.length === 0, publicCorpusRequests.join(' | '));
      return 'no question cards and no corpus request before sign-in';
    });
    await runCheck('public login has no browser errors or failed requests', async () => {
      requireCondition(publicConsoleErrors.length === 0, publicConsoleErrors.join(' | '));
      requireCondition(publicFailedRequests.length === 0, publicFailedRequests.join(' | '));
      return 'clean console and network';
    });

    await ensurePdfAssets();
    localVite = await startLocalVite();
    localContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await localContext.newPage();
    const localFailedRequests = [];
    const localConsoleErrors = [];
    const localSupabaseRequests = [];
    page.on('requestfailed', (request) => localFailedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`));
    page.on('console', (message) => { if (message.type() === 'error') localConsoleErrors.push(message.text()); });
    page.on('request', (request) => { if (/supabase\.co/i.test(request.url())) localSupabaseRequests.push(request.url()); });

    await runCheck('local-corpus dev route loads the full app without login', async () => {
      await page.goto(localVite.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForCards(page);
      requireCondition(await page.locator('input[name="username"]').count() === 0, 'login form is shown in local mode');
      // The archive design renders the account name uppercase, so compare the rendered text case-insensitively.
      requireCondition((await page.locator('.account').innerText()).toLowerCase().includes('local corpus (development)'), 'local account marker is missing');
      return `${await page.locator('.qcard').count()} question cards`;
    });
    await runCheck('local-corpus app makes no Supabase request', async () => {
      requireCondition(localSupabaseRequests.length === 0, localSupabaseRequests.join(' | '));
      return 'all local data requests stayed on the dev server';
    });

    // The subject buttons carry the course suffix the app prints (Mathematics AA), so match the
    // subject name inside the rendered label rather than as the whole accessible name.
    const subjectButton = (name) => page.locator('nav.subjects button').filter({ hasText: name }).first();

    for (const subject of subjects) {
      await runCheck(`${subject.name} subject selection shows questions`, async () => {
        await subjectButton(subject.name).click();
        await waitForCards(page);
        requireCondition(await page.locator('.qcard').count() > 0, 'no question cards');
        return `${await page.locator('.qcard').count()} cards`;
      });
    }

    const physics = subjectById.get('physics');
    requireCondition(physics, 'the local catalog has no Physics subject');
    await subjectButton(physics.name).click();
    await waitForCards(page);
    await runCheck('year filter narrows the local app', async () => {
      const keep = physics.years.find((year) => physics.questions.some((question) => local.catalog.documents[question.doc].year === year));
      requireCondition(keep !== undefined, 'no usable year facet');
      await setFacetExclusive(page, physics.years, keep);
      const titles = await allQuestionTitles(page);
      requireCondition(titles.length > 0 && titles.every((title) => title.includes(String(keep))), `unexpected titles: ${titles.slice(0, 2).join(' | ')}`);
      return `${titles.length} questions in ${keep}`;
    });
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await waitForCards(page);
    await runCheck('level filter narrows the local app', async () => {
      const keep = physics.levels.find((level) => physics.questions.some((question) => local.catalog.documents[question.doc].level === level));
      requireCondition(keep !== undefined, 'no usable level facet');
      await setFacetExclusive(page, physics.levels, keep);
      const titles = await allQuestionTitles(page);
      requireCondition(titles.length > 0 && titles.every((title) => title.includes(` ${keep} `)), `unexpected titles: ${titles.slice(0, 2).join(' | ')}`);
      return `${titles.length} questions at ${keep}`;
    });
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await waitForCards(page);
    await runCheck('paper filter narrows the local app', async () => {
      const keep = physics.papers.find((paper) => physics.questions.some((question) => local.catalog.documents[question.doc].paper === paper));
      requireCondition(keep !== undefined, 'no usable paper facet');
      await setFacetExclusive(page, physics.papers, keep);
      const titles = await allQuestionTitles(page);
      requireCondition(titles.length > 0 && titles.every((title) => title.includes(`· ${keep}`)), `unexpected titles: ${titles.slice(0, 2).join(' | ')}`);
      return `${titles.length} questions in ${keep}`;
    });
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await waitForCards(page);

    const subsetTopic = findSubsetTopic(physics);
    await runCheck('only-selected topic mode applies the subset rule', async () => {
      requireCondition(subsetTopic, 'no single-topic/multi-topic subset fixture exists');
      await setChecked(page, subsetTopic, true);
      const anyCount = await page.locator('.qcard').count();
      requireCondition(anyCount > 0, 'topic any-mode returned no questions');
      await setChecked(page, /^Only selected topics/ , true);
      const subsetCount = await page.locator('.qcard').count();
      requireCondition(subsetCount > 0 && subsetCount < anyCount, `any=${anyCount}, subset=${subsetCount}`);
      await setChecked(page, /^Only selected topics/, false);
      await setChecked(page, subsetTopic, false);
      return `any=${anyCount}, subset=${subsetCount}`;
    });
    const requirePair = findRequireAllPair(physics);
    await runCheck('require-every-topic mode applies the all-topics rule', async () => {
      requireCondition(requirePair, 'no multi-topic require-all fixture exists');
      for (const topic of requirePair) await setChecked(page, topic, true);
      const anyCount = await page.locator('.qcard').count();
      await setChecked(page, /^Require every selected topic$/, true);
      const allCount = await page.locator('.qcard').count();
      requireCondition(allCount > 0 && allCount <= anyCount, `any=${anyCount}, all=${allCount}`);
      requireCondition(!(await (await checkbox(page, /^Only selected topics/)).isChecked()), 'topic modes are not mutually exclusive');
      await setChecked(page, /^Require every selected topic$/, false);
      for (const topic of requirePair) await setChecked(page, topic, false);
      return `any=${anyCount}, all=${allCount}`;
    });
    await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
    await waitForCards(page);

    await runCheck('rotated markscheme source is present in the local corpus', async () => {
      requireCondition(rotated.angle === 90 || rotated.angle === 270, `angle=${rotated.angle}`);
      requireCondition(Array.isArray(rotated.question.a) && rotated.question.a.length > 0, 'rotated question has no answer slice');
      return `${rotated.document.subject} ${rotated.document.year} ${rotated.question.label} at ${rotated.angle} degrees`;
    });

    const rotatedSubject = subjectById.get(rotated.document.subject);
    requireCondition(rotatedSubject, `unknown rotated subject ${rotated.document.subject}`);
    await page.getByRole('button', { name: rotatedSubject.name, exact: true }).click();
    await waitForCards(page);
    await runCheck('rotated question is reachable through year/session/level/paper filters', async () => {
      await setFacetExclusive(page, rotatedSubject.years, rotated.document.year);
      await setFacetExclusive(page, rotatedSubject.sessions, rotated.document.session);
      await setFacetExclusive(page, rotatedSubject.levels, rotated.document.level);
      await setFacetExclusive(page, rotatedSubject.papers, rotated.document.paper);
      const expected = `${rotated.question.label} · ${rotated.document.paper}${rotated.document.paperOption ? ` (${rotated.document.paperOption})` : ''} ${rotated.document.level}${rotated.document.timeZone ? ` ${rotated.document.timeZone}` : ''} · ${rotated.document.session} ${rotated.document.year}`;
      const card = page.locator('.qcard').filter({ hasText: expected });
      requireCondition(await card.count() === 1, `expected one card, found ${await card.count()} for ${expected}`);
      return expected;
    });
    const rotatedCard = page.locator('.qcard').filter({ hasText: `${rotated.question.label} · ${rotated.document.paper}` }).first();
    await runCheck('selected question preview renders only the selected slices', async () => {
      requireCondition(await rotatedCard.count() === 1, 'rotated question card is unavailable');
      // The card action carries both design labels ("Preview" and "Read"); only one is ever shown.
      await rotatedCard.locator('button.qaction').first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor({ state: 'visible', timeout: 30_000 });
      await page.waitForFunction(
        (expected) => document.querySelectorAll('[role="dialog"] canvas').length === expected,
        rotated.question.q.length,
        { timeout: 30_000 },
      );
      requireCondition(await dialog.locator('canvas').count() === rotated.question.q.length, `expected ${rotated.question.q.length} canvases, found ${await dialog.locator('canvas').count()}`);
      requireCondition(await page.locator('button, a').filter({ hasText: /Open whole paper/i }).count() === 0, 'whole-paper route/control is visible');
      await dialog.getByRole('button', { name: 'Close', exact: true }).click();
      return `${rotated.question.q.length} rendered slice(s)`;
    });

    await runCheck('selected question and rotated markscheme PDFs both download', async () => {
      requireCondition(await rotatedCard.count() === 1, 'rotated question card is unavailable');
      await rotatedCard.locator('input[type="checkbox"]').first().check();
      await setChecked(page, /^Generate selected-question markscheme PDF$/, true);
      const files = await collectDownloads(
        page,
        () => page.getByRole('button', { name: 'Export PDF', exact: true }).click(),
        2,
      );
      requireCondition(files.length === 2, `expected two downloads, found ${files.length}`);
      const questionName = `${rotatedSubject.name} Filtered Questions.pdf`;
      const markschemeName = `${rotatedSubject.name} Filtered Questions Markscheme.pdf`;
      const questionDownload = files.find((download) => download.suggestedFilename() === questionName);
      const markschemeDownload = files.find((download) => download.suggestedFilename() === markschemeName);
      requireCondition(questionDownload && markschemeDownload, files.map((download) => download.suggestedFilename()).join(' | '));
      const questionPdf = await PDFDocument.load(await downloadBytes(questionDownload));
      const markschemePdf = await PDFDocument.load(await downloadBytes(markschemeDownload));
      requireCondition(questionPdf.getPageCount() === rotated.question.q.length, `question pages=${questionPdf.getPageCount()}`);
      requireCondition(markschemePdf.getPageCount() > 0, 'markscheme has no pages');
      requireCondition(markschemePdf.getPages().every((pdfPage) => Math.round(pdfPage.getWidth()) === 842 && Math.round(pdfPage.getHeight()) === 595), 'markscheme output contains a review/portrait page');
      return `${questionName}; ${markschemeName}; ${markschemePdf.getPageCount()} landscape page(s)`;
    });

    mobileContext = await browser.newContext({ viewport: { width: 390, height: 780 } });
    const mobilePage = await mobileContext.newPage();
    const mobileErrors = [];
    mobilePage.on('console', (message) => { if (message.type() === 'error') mobileErrors.push(message.text()); });
    await runCheck('mobile local-corpus layout has no horizontal overflow', async () => {
      await mobilePage.goto(localVite.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForCards(mobilePage);
      const dimensions = await mobilePage.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      requireCondition(dimensions.scroll <= dimensions.client + 1, `scroll=${dimensions.scroll}, client=${dimensions.client}`);
      requireCondition(await mobilePage.locator('aside.panel').count() === 1 && await mobilePage.locator('.qcard').count() > 0, 'filters or questions are missing');
      await mobilePage.getByRole('button', { name: 'Show filters', exact: true }).click();
      requireCondition(await mobilePage.getByRole('checkbox', { name: /^Only selected topics/ }).isVisible(), 'mobile filter controls did not open');
      return `${dimensions.client}px viewport; filters and questions visible`;
    });
    await runCheck('local-corpus browser run has no console errors or failed requests', async () => {
      requireCondition(localConsoleErrors.length === 0, localConsoleErrors.join(' | '));
      requireCondition(localFailedRequests.length === 0, localFailedRequests.join(' | '));
      requireCondition(mobileErrors.length === 0, mobileErrors.join(' | '));
      return 'clean local desktop/mobile console and network';
    });
  } catch (error) {
    check('browser check setup completed', false, error instanceof Error ? error.message : String(error));
  } finally {
    // Stop the dev server before closing PDF.js/Playwright contexts. A PDF worker can keep a
    // context close pending, but it must not prevent the harness from releasing its sockets.
    await closeServer(publicServer).catch(() => {});
    await stopChild(localVite?.child).catch(() => {});
    if (mobileContext) await closeResource(() => mobileContext.close());
    if (localContext) await closeResource(() => localContext.close());
    if (pagesContext) await closeResource(() => pagesContext.close());
    if (browser) await closeResource(() => browser.close());
  }
}

await main();
let failed = 0;
for (const result of results) {
  if (!result.ok) failed += 1;
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.detail ? `  (${result.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
process.exit(failed ? 1 : 0);
