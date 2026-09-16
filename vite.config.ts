import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
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

/** Production builds get a strict Content-Security-Policy (dev needs Vite's inline scripts). */
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
  plugins: [react(), contentSecurityPolicy(), ...(command === 'serve' && mode === 'local-corpus' ? [localCorpus()] : [])],
  base: command === 'build' ? `/${repoName}/` : '/',
  server: { host: '127.0.0.1' },
  build: { outDir: 'dist', sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 1600 },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'scripts/**/*.test.mjs'] },
}));
