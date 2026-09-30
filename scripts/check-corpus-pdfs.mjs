// Validate every object named by the ignored local-corpus manifest without copying it into web/.
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { loadCorpus, verifiedBytes } from './local-corpus.mjs';

const WEB_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function main() {
  const { manifest, repoRoot } = loadCorpus(WEB_ROOT, process.argv[2]);

  let pdfCount = 0;
  let catalogCount = 0;
  for (const item of manifest.objects) {
    const bytes = verifiedBytes(repoRoot, item);
    if (item.contentType === 'application/pdf') {
      await PDFDocument.load(bytes, {
        ignoreEncryption: true,
        throwOnInvalidObject: false,
        updateMetadata: false,
      });
      pdfCount += 1;
    } else if (item.key === manifest.catalogKey && item.contentType === 'application/json') {
      // Schema, document/question counts and source-key coverage were checked by loadCorpus.
      catalogCount += 1;
    } else {
      throw new Error(`Unexpected manifest object type for ${item.key}: ${item.contentType}`);
    }
  }

  if (pdfCount + catalogCount !== manifest.objectCount || pdfCount !== manifest.objectCount - 1 || catalogCount !== 1) {
    throw new Error(`Checked ${pdfCount} PDFs and ${catalogCount} catalog objects, expected ${manifest.objectCount - 1} PDFs and 1 catalog`);
  }
  console.log(`PASS: pdf-lib loaded ${pdfCount}/${pdfCount} PDFs and parsed ${catalogCount}/${catalogCount} catalog; checked ${manifest.objectCount}/${manifest.objectCount} manifest objects.`);
}

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
