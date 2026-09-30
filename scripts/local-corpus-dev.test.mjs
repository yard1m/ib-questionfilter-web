import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'vite';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { corpusFile, loadCorpus } from './local-corpus.mjs';
import { localCorpus } from '../vite.config.ts';

let server, url, corpus, directory, root, middleware;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), 'ibqf-dev-source-'));
  const privateRoot = resolve(directory, 'private');
  root = resolve(directory, 'frontend');
  await mkdir(resolve(privateRoot, '.web-corpus'), { recursive: true });
  await mkdir(resolve(privateRoot, 'papers'));
  await mkdir(root);
  await symlink(resolve(privateRoot, '.web-corpus'), resolve(root, '.web-corpus'));
  const catalog = { schemaVersion: 1, subjects: [{ id: 'physics' }], documents: [{ id: 'doc', subject: 'physics', year: 2024, level: 'HL', paperKey: 'test/papers/p.pdf' }], questions: [{ id: 'doc::Q1', doc: 0, topics: ['Motion'], q: [[0, 0, 100]] }] };
  const objects = [];
  for (const [key, file, bytes, contentType] of [
    ['test/papers/p.pdf', 'papers/p.pdf', Buffer.from('%PDF-synthetic-http-fixture'), 'application/pdf'],
    ['test/catalog.json', '.web-corpus/catalog.json', Buffer.from(JSON.stringify(catalog)), 'application/json'],
  ]) {
    await writeFile(resolve(privateRoot, file), bytes);
    objects.push({ key, file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), contentType });
  }
  await writeFile(resolve(privateRoot, '.web-corpus/upload-manifest.json'), JSON.stringify({ prefix: 'test', catalogKey: 'test/catalog.json', objects, objectCount: objects.length, documentCount: 1, questionCount: 1, totalBytes: objects.reduce((n, o) => n + o.bytes, 0), largestBytes: Math.max(...objects.map(o => o.bytes)) }));
  corpus = loadCorpus(root);
  const plugin = localCorpus(root);
  plugin.configureServer({ middlewares: { use: (_path, handler) => { middleware = handler; } } });
  server = await createServer({ configFile: false, root, plugins: [plugin], optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  url = `http://127.0.0.1:${server.httpServer.address().port}`;
}, 30000);
afterAll(async () => { await server?.close(); if (directory) await rm(directory, { recursive: true, force: true }); });

describe('loopback manifest-only dev source', () => {
  it('serves the catalog from the real private manifest root', async () => {
    const response = await fetch(`${url}/__local-corpus/catalog.json`);
    expect(response.status).toBe(200);
    expect((await response.json()).documents.length).toBe(corpus.manifest.documentCount);
  });
  it('serves a manifest PDF header from that root', async () => {
    const item = corpus.manifest.objects.find(item => item.contentType === 'application/pdf');
    const response = await fetch(`${url}/__local-corpus/object/${item.key}`, { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(Number(response.headers.get('content-length'))).toBe(item.bytes);
  });
  it('refuses files outside the manifest and malformed request encoding', async () => {
    expect((await fetch(`${url}/__local-corpus/object/not-in-manifest.pdf`)).status).toBe(404);
    expect((await fetch(`${url}/__local-corpus/object/%ZZ`)).status).toBe(400);
    expect(() => corpusFile(corpus.repoRoot, 'supabase/config.toml')).toThrow('not whitelisted');
  });
  it('retains the explicit loopback allowlist', async () => {
    const response = { statusCode: 200, end() {} };
    middleware({ socket: { remoteAddress: '203.0.113.1' }, url: '/catalog.json' }, response);
    expect(response.statusCode).toBe(403);
  });
});
