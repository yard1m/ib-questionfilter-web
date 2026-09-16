import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', '.git', 'dist', 'pdfjs'].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

// Decode URL path segments so the test also works when the checkout path contains spaces.
const webRoot = fileURLToPath(new URL('../..', import.meta.url));
const sources = walk(join(webRoot, 'src'));

describe('public repository sanitization', () => {
  it('contains no PDF, book, archive or corpus data file', () => {
    const banned = ['.pdf', '.docx', '.epub', '.mobi', '.zip', '.7z', '.rar'];
    const bad = walk(webRoot).filter((p) => banned.includes(extname(p).toLowerCase()) || /catalog\.json$|upload-manifest\.json$/.test(p));
    expect(bad).toEqual([]);
  });

  it('contains no credential-like file', () => {
    const bad = walk(webRoot).filter((p) => /(^|\/)\.env($|\.)|id_rsa|\.pem$|\.p12$|credentials\.json$/i.test(p));
    expect(bad).toEqual([]);
  });

  it('contains no secret Supabase key or service-role token', () => {
    for (const p of walk(webRoot)) {
      if (!/\.(ts|tsx|js|mjs|json|html|yml|yaml|md|css)$/.test(p)) continue;
      const text = readFileSync(p, 'utf8');
      expect(text, p).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
      expect(text, p).not.toMatch(/eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl/);
    }
  });

  it('references no private corpus path or real IB paper code', () => {
    for (const p of sources) {
      const text = readFileSync(p, 'utf8');
      expect(text, p).not.toMatch(/markschemes\/(may|nov)\d{4}/);
      expect(text, p).not.toMatch(/references\/books/);
      expect(text, p).not.toMatch(/papers\/(chemistry|physics|mathematics) /);
      expect(text, p).not.toMatch(/[MN]\d{2}\/\d\/[A-Z]{4,5}\/[A-Z0-9]{2,4}\/ENG\//);
    }
  });

  it('fetches corpus data only through the private Supabase bucket', () => {
    for (const p of sources) {
      if (p.endsWith('.test.ts') || p.endsWith('localSource.ts')) continue;
      const text = readFileSync(p, 'utf8');
      expect(text, p).not.toMatch(/\bfetch\s*\(/);
      expect(text, p).not.toMatch(/XMLHttpRequest/);
    }
  });

  it('never renders untrusted HTML', () => {
    for (const p of sources) {
      if (p.endsWith('.test.ts')) continue;
      expect(readFileSync(p, 'utf8'), p).not.toMatch(/dangerouslySetInnerHTML|innerHTML\s*=/);
    }
  });
});
