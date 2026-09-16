// Validate every object named by the ignored local-corpus manifest without copying it into web/.
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = resolve(WEB_ROOT, '..');
const DEFAULT_MANIFEST = resolve(REPO_ROOT, '.web-corpus/upload-manifest.json');
const EXPECTED_OBJECTS = 687;

function withinRoot(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`));
}

async function loadJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const manifestPath = resolve(process.argv[2] ?? DEFAULT_MANIFEST);
  const manifest = await loadJson(manifestPath);
  if (!Array.isArray(manifest.objects) || manifest.objectCount !== manifest.objects.length) {
    throw new Error('Manifest objectCount does not match its objects array');
  }
  if (manifest.objectCount !== EXPECTED_OBJECTS) {
    throw new Error(`Expected ${EXPECTED_OBJECTS} manifest objects, found ${manifest.objectCount}`);
  }

  let pdfCount = 0;
  let catalogCount = 0;
  for (const [index, item] of manifest.objects.entries()) {
    if (!item || typeof item.file !== 'string' || typeof item.contentType !== 'string') {
      throw new Error(`Manifest object ${index} is malformed`);
    }
    const path = resolve(REPO_ROOT, item.file);
    if (!withinRoot(path, REPO_ROOT)) throw new Error(`Manifest object escapes repository root: ${item.file}`);
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Manifest object is not a file: ${item.file}`);
    if (typeof item.bytes === 'number' && item.bytes !== info.size) {
      throw new Error(`Manifest size mismatch for ${item.key}: expected ${item.bytes}, found ${info.size}`);
    }

    if (item.contentType === 'application/pdf') {
      const bytes = await readFile(path);
      await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        updateMetadata: false,
      });
      pdfCount += 1;
    } else if (item.key === manifest.catalogKey && item.contentType === 'application/json') {
      await loadJson(path);
      catalogCount += 1;
    } else {
      throw new Error(`Unexpected manifest object type for ${item.key}: ${item.contentType}`);
    }
  }

  if (pdfCount + catalogCount !== manifest.objectCount || pdfCount !== manifest.objectCount - 1 || catalogCount !== 1) {
    throw new Error(`Checked ${pdfCount} PDFs and ${catalogCount} catalog objects, expected 686 PDFs and 1 catalog`);
  }
  console.log(`PASS: pdf-lib loaded ${pdfCount}/${pdfCount} PDFs and parsed ${catalogCount}/${catalogCount} catalog; checked ${manifest.objectCount}/${manifest.objectCount} manifest objects.`);
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
