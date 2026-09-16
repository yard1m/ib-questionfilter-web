// Copies the pdf.js runtime assets (worker-side decoders, standard fonts, CMaps, ICC profiles)
// into public/pdfjs so Vite serves them in development and publishes them with the build.
// These are open-source pdf.js files; no corpus data is involved.
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = `${root}node_modules/pdfjs-dist/`;
const target = `${root}public/pdfjs/`;

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'iccs']) {
  cpSync(`${source}${dir}`, `${target}${dir}`, { recursive: true });
}
mkdirSync(`${target}wasm`, { recursive: true });
for (const file of ['openjpeg.wasm', 'openjpeg_nowasm_fallback.js', 'jbig2.wasm', 'jbig2_nowasm_fallback.js', 'qcms_bg.wasm']) {
  cpSync(`${source}wasm/${file}`, `${target}wasm/${file}`);
}
console.log('Copied pdf.js assets to public/pdfjs');
