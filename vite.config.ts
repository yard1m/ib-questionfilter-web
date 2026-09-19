import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// GitHub Pages project site is served from https://<user>.github.io/<repo>/
// so the base path must match the repository name exactly.
const repoName = 'ib-questionfilter-web';

/**
 * Development only (`vite --mode local-corpus`): serves the private corpus from the private
 * checkout on the loopback dev server, so the full app can be tested without an account.
 * It is never part of a production build.
 */
function localCorpus(): Plugin {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const corpusDir = resolve(repoRoot, '.web-corpus');
  return {
    name: 'local-corpus',
    apply: 'serve',
    configureServer(server) {
      const manifestPath = resolve(corpusDir, 'upload-manifest.json');
      if (!existsSync(manifestPath)) throw new Error('Run Scripts/build_web_corpus.py first');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { objects: { key: string; file: string; contentType: string }[] };
      const files = new Map(manifest.objects.map((o) => [o.key, o]));
      server.middlewares.use('/__local-corpus/', (req, res) => {
        const remote = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) { res.statusCode = 403; res.end(); return; }
        const path = decodeURIComponent((req.url ?? '').split('?')[0]);
        const key = path === '/catalog.json'
          ? manifest.objects.find((o) => o.key.endsWith('/catalog.json'))?.key
          : path.startsWith('/object/') ? path.slice('/object/'.length) : undefined;
        const item = key ? files.get(key) : undefined;
        if (!item) { res.statusCode = 404; res.end(); return; }
        const file = resolve(repoRoot, item.file);
        if (!file.startsWith(repoRoot) || !existsSync(file)) { res.statusCode = 404; res.end(); return; }
        res.setHeader('content-type', item.contentType);
        res.setHeader('content-length', String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

/**
 * Development only (`vite --mode local-corpus`): the Needs-review triage
 * writer. Serves the dossier built by Scripts/needs_review_dossier.py and
 * appends `.triage/decisions_<subject>.txt` in the exact format
 * Scripts/apply_triage.py reads. Like `localCorpus()` it is serve-only,
 * loopback-only, and never part of a production build.
 */
function triage(): Plugin {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const triageDir = resolve(repoRoot, '.triage');
  // Kept in sync with web/src/triage/triageLib.ts and Scripts/apply_triage.py:
  // a topic line is `<code>[+<code>...] | <40+ char reason>`, or `NR | <reason>`.
  const CODE = '(?:[CP][0-9]+(?:\\.[0-9]+)?|M[CA][0-9]{1,2}[A-Z]?)';
  const LINE = new RegExp(`^\\s*(?:${CODE}(?:\\+${CODE})*|NR)\\s*\\|\\s*.{40,}\\s*$`);
  const SUBJECTS = new Set(['chemistry', 'physics', 'mathematics']);
  return {
    name: 'triage',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__triage/dossier', (req, res) => {
        const remote = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) { res.statusCode = 403; res.end(); return; }
        const path = resolve(triageDir, 'dossier.jsonl');
        if (!existsSync(path)) { res.statusCode = 404; res.end('Run Scripts/needs_review_dossier.py first'); return; }
        const units = readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(units));
      });
      server.middlewares.use('/__triage/file', (req, res) => {
        const remote = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) { res.statusCode = 403; res.end(); return; }
        const query = new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('path') ?? '';
        const file = resolve(repoRoot, query);
        const allowed = query.endsWith('.pdf')
          && (query.startsWith('papers/') || query.startsWith('markschemes/'))
          && file.startsWith(repoRoot) && existsSync(file);
        if (!allowed) { res.statusCode = 404; res.end(); return; }
        res.setHeader('content-type', 'application/pdf');
        res.setHeader('content-length', String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
      server.middlewares.use('/__triage/decisions', (req, res) => {
        const remote = req.socket.remoteAddress ?? '';
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) { res.statusCode = 403; res.end(); return; }
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        let raw = '';
        req.on('data', (chunk) => { raw += chunk; });
        req.on('end', () => {
          try {
            const body = JSON.parse(raw) as { unit?: unknown; subject?: unknown; lines?: unknown };
            const unit = typeof body.unit === 'string' ? body.unit : '';
            const subject = typeof body.subject === 'string' ? body.subject.toLowerCase() : '';
            const lines = Array.isArray(body.lines) ? body.lines : [];
            if (!unit.includes('::') || !SUBJECTS.has(subject)
              || lines.length === 0 || !lines.every((line) => typeof line === 'string' && LINE.test(line))) {
              res.statusCode = 400;
              res.end('Send {unit "<file>::<Qn>", subject, lines: ["<code> | <40+ char reason>" or "NR | <reason>"]}');
              return;
            }
            const target = resolve(triageDir, `decisions_${subject}.txt`);
            const block = `U ${unit}\n${(lines as string[]).map((line) => (line.startsWith(' ') ? line : `  ${line}`)).join('\n')}\n`;
            const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
            mkdirSync(triageDir, { recursive: true });
            appendFileSync(target, `${current.endsWith('\n') || current === '' ? '' : '\n'}${block}`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ recorded: (lines as string[]).length }));
          } catch {
            res.statusCode = 400;
            res.end('Send JSON.');
          }
        });
      });
    },
  };
}
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins: [react(), contentSecurityPolicy(), ...(command === 'serve' && mode === 'local-corpus' ? [localCorpus(), triage()] : [])],
  base: command === 'build' ? `/${repoName}/` : '/',
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
}));
