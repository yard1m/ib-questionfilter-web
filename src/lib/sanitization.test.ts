import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { demoCorpus } from '../data/demo';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const repoRoot = new URL('../..', import.meta.url).pathname;

describe('public bundle sanitization', () => {
  it('ships no PDF, book or corpus binary', () => {
    const banned = ['.pdf', '.docx', '.epub', '.mobi', '.zip'];
    const bad = walk(repoRoot).filter((p) => banned.includes(extname(p).toLowerCase()));
    expect(bad).toEqual([]);
  });

  it('ships no credential-like file', () => {
    const bad = walk(repoRoot).filter((p) =>
      /(^|\/)\.env($|\.)|id_rsa|\.pem$|\.p12$|credentials\.json$/i.test(p));
    expect(bad).toEqual([]);
  });

  it('contains no reference to the private corpus directories', () => {
    const sources = walk(join(repoRoot, 'src'));
    for (const p of sources) {
      const text = readFileSync(p, 'utf8');
      expect(text).not.toMatch(/markschemes\//);
      expect(text).not.toMatch(/references\/books/);
      expect(text).not.toMatch(/papers\/(chemistry|physics|mathematics)/);
    }
  });

  it('carries no real IB paper code', () => {
    const sources = walk(join(repoRoot, 'src'));
    for (const p of sources) {
      // Matches the IB session/subject/paper code format printed on real papers.
      expect(readFileSync(p, 'utf8')).not.toMatch(/[MN]\d{2}\/\d\/[A-Z]{4,5}\/[A-Z0-9]{2,4}\/ENG\//);
    }
  });

  it('makes no network request for corpus assets at runtime', () => {
    const sources = walk(join(repoRoot, 'src'));
    for (const p of sources) {
      if (p.endsWith('.test.ts')) continue;
      const text = readFileSync(p, 'utf8');
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/XMLHttpRequest/);
    }
  });

  it('is explicitly flagged as demonstration data', () => {
    expect(demoCorpus.isDemoData).toBe(true);
    expect(demoCorpus.label.toLowerCase()).toContain('no ib questions');
  });

  it('every shipped question is demo content', () => {
    for (const q of demoCorpus.questions) {
      expect(q.sourceRef.startsWith('Demo ')).toBe(true);
      if (q.answer) expect(q.answer.markschemeRef.toLowerCase()).toContain('demo');
    }
  });
});
