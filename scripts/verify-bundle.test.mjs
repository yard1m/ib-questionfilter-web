import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectBundle } from './verify-bundle.mjs';

function fixture(entries) {
  const root = mkdtempSync(join(tmpdir(), 'ibqf-bundle-'));
  for (const [name, value] of entries) {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    if (value instanceof Uint8Array) writeFileSync(path, value);
    else writeFileSync(path, value, 'utf8');
  }
  return root;
}

describe('published bundle verifier', () => {
  it('rejects local-corpus routes, secret/service-role material, data artifacts and PDFs', () => {
    const serviceRolePayload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
    const secretKey = ['sb', '_secret_12345678'].join('');
    const catalogArtifact = JSON.stringify({ schemaVersion: 1, subjects: [], documents: [], questions: [] });
    const minifiedCatalogArtifact = '(()=>{const e={schemaVersion:1,subjects:[],documents:[],questions:[]};return e})()';
    const root = fixture([
      ['assets/app.js', `fetch('/__local-corpus/catalog.json'); const key = '${secretKey}';`],
      ['assets/legacy.js', `const key = 'headersegment.${serviceRolePayload}.signaturesegment';`],
      ['private/questions.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D, 0x31])],
      ['private/renamed.bin', '%PDF-1.7\n'],
      ['private/opaque.bin', "const key = 'service_role=\"abcdefghijklmnop\"';"],
      ['assets/catalog.json', catalogArtifact],
      ['assets/chunk-opaque.json', catalogArtifact],
      ['assets/index-7ac9f2.js', minifiedCatalogArtifact],
    ]);
    try {
      const result = inspectBundle(root);
      expect(result.failures).toEqual(expect.arrayContaining([
        'assets/app.js: contains a local-corpus route or manifest marker',
        'assets/app.js: contains secret or service-role key material',
        'assets/legacy.js: contains secret or service-role key material',
        'private/questions.pdf: banned private file type',
        'private/questions.pdf: PDF file content',
        'private/renamed.bin: PDF file content',
        'private/opaque.bin: contains secret or service-role key material',
        'assets/catalog.json: private catalog/data artifact path',
        'assets/catalog.json: private catalog/data artifact signature',
        'assets/chunk-opaque.json: private catalog/data artifact signature',
        'assets/index-7ac9f2.js: private catalog/data artifact signature',
      ]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows a publishable anon key and ordinary UI text', () => {
    const anonPayload = Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url');
    const root = fixture([
      ['assets/app.js', `const supabaseKey = 'header.${anonPayload}.signature'; const label = 'Sign in'; const genericWord = 'service_role';`],
      ['assets/vendor.js', 'const labels = { schemaVersionLabel: "schemaVersion", subjectsLabel: "subjects", documentsLabel: "documents", questionsLabel: "questions" };'],
      ['assets/app.css', '.app { color: blue; }'],
    ]);
    try {
      expect(inspectBundle(root).failures).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
