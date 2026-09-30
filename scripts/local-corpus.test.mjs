import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { PDFDocument } from 'pdf-lib';

const exec = promisify(execFile);
const temporary = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
async function fixture(change = () => {}) {
  const dir = await mkdtemp(resolve(tmpdir(), 'ibqf-corpus-'));
  temporary.push(dir);
  const root = resolve(dir, 'private');
  await mkdir(resolve(root, '.web-corpus'), { recursive: true });
  await mkdir(resolve(root, 'papers'));
  await mkdir(resolve(root, 'markschemes'));
  await mkdir(resolve(dir, 'frontend'));
  await symlink(resolve(root, '.web-corpus'), resolve(dir, 'frontend/.web-corpus'));
  const pdf = await PDFDocument.create(); pdf.addPage();
  const pdfBytes = await pdf.save();
  const catalog = {
    schemaVersion: 1, subjects: [{ id: 'physics', name: 'Physics', topics: ['Motion'] }],
    documents: [{ id: 'doc', subject: 'physics', year: 2024, session: 'May', level: 'HL', paper: 'Paper 2', paperKey: 'test/papers/p.pdf', markschemeKey: 'test/markschemes/m.pdf' }],
    questions: [{ id: 'doc::Q1', doc: 0, label: 'Q1', order: 0, topics: ['Motion'], q: [[0, 0, 100]], a: [[0, 0, 100]], refs: [] }],
  };
  const objects = [];
  for (const [key, file, bytes, contentType] of [
    ['test/papers/p.pdf', 'papers/p.pdf', pdfBytes, 'application/pdf'],
    ['test/markschemes/m.pdf', 'markschemes/m.pdf', pdfBytes, 'application/pdf'],
    ['test/catalog.json', '.web-corpus/catalog.json', Buffer.from(JSON.stringify(catalog)), 'application/json'],
  ]) {
    await writeFile(resolve(root, file), bytes);
    objects.push({ key, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType });
  }
  const manifest = { prefix: 'test', catalogKey: 'test/catalog.json', objectCount: 3, documentCount: 1, questionCount: 1, totalBytes: objects.reduce((n, o) => n + o.bytes, 0), largestBytes: Math.max(...objects.map(o => o.bytes)), objects };
  await change({ dir, root, manifest, catalog });
  await writeFile(resolve(root, '.web-corpus/upload-manifest.json'), JSON.stringify(manifest));
  return { dir, root, manifestPath: resolve(dir, 'frontend/.web-corpus/upload-manifest.json') };
}
async function check(manifestPath) {
  try { return (await exec(process.execPath, ['scripts/check-corpus-pdfs.mjs', manifestPath])).stdout; }
  catch (error) { return error.stderr; }
}

describe('corpus gate invariants', () => {
  it('accepts a complete hashed corpus through a separate frontend symlink without fixed counts', async () => {
    expect(await check((await fixture()).manifestPath)).toContain('PASS: pdf-lib loaded 2/2 PDFs');
  });
  it('rejects duplicate object keys', async () => {
    const f = await fixture(({ manifest }) => { manifest.objects[1].key = manifest.objects[0].key; });
    expect(await check(f.manifestPath)).toContain('Duplicate manifest key');
  });
  it('checks sha256, not only file size', async () => {
    const f = await fixture(async ({ root }) => {
      const path = resolve(root, 'papers/p.pdf'); const bytes = await readFile(path); bytes[10] ^= 1; await writeFile(path, bytes);
    });
    expect(await check(f.manifestPath)).toContain('Manifest hash mismatch');
  });
  it('rejects mismatched catalog document counts', async () => {
    const f = await fixture(({ manifest }) => { manifest.documentCount = 2; });
    expect(await check(f.manifestPath)).toContain('Catalog documentCount mismatch');
  });
  it('rejects unsupported catalog schema', async () => {
    const f = await fixture(async ({ root, manifest, catalog }) => {
      catalog.schemaVersion = 2;
      const bytes = Buffer.from(JSON.stringify(catalog)); await writeFile(resolve(root, '.web-corpus/catalog.json'), bytes);
      const item = manifest.objects[2]; item.bytes = bytes.length; item.sha256 = createHash('sha256').update(bytes).digest('hex');
    });
    expect(await check(f.manifestPath)).toContain('Unsupported catalog schema');
  });
  it('rejects lexical path escape', async () => {
    const f = await fixture(({ manifest }) => { manifest.objects[0].file = '../outside.pdf'; });
    expect(await check(f.manifestPath)).toContain('escapes repository root');
  });
  it('rejects symlink path escape', async () => {
    const f = await fixture(async ({ dir, root }) => {
      await writeFile(resolve(dir, 'outside.pdf'), 'private');
      await rm(resolve(root, 'papers/p.pdf')); await symlink(resolve(dir, 'outside.pdf'), resolve(root, 'papers/p.pdf'));
    });
    expect(await check(f.manifestPath)).toContain('escapes repository root');
  });
});
