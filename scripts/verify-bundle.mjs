// Fails the build if anything private, or any credential-like file, reaches dist/.
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const BANNED_EXT = ['.pdf', '.docx', '.epub', '.mobi', '.zip', '.7z', '.rar'];
const BANNED_PATH = /(^|\/)\.env($|\.)|id_rsa|\.pem$|\.p12$|credentials\.json$/i;
// Real IB session/subject/paper code format printed on genuine papers.
const PAPER_CODE = /[MN]\d{2}\/\d\/[A-Z]{4,5}\/[A-Z0-9]{2,4}\/ENG\//;
const CORPUS_PATHS = /(markschemes\/|references\/books|papers\/(chemistry|physics|mathematics))/;

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

const files = walk(DIST);
const failures = [];

for (const f of files) {
  const rel = f.slice(DIST.length + 1);
  if (BANNED_EXT.includes(extname(f).toLowerCase())) failures.push(`${rel}: banned file type`);
  if (BANNED_PATH.test(f)) failures.push(`${rel}: credential-like file`);
  if (/\.(js|css|html|json|svg|txt|map)$/i.test(f)) {
    const text = readFileSync(f, 'utf8');
    if (PAPER_CODE.test(text)) failures.push(`${rel}: contains a real IB paper code`);
    if (CORPUS_PATHS.test(text)) failures.push(`${rel}: references a private corpus path`);
  }
}

console.log(`inspected ${files.length} published files`);
if (failures.length) {
  console.error('\nBundle verification FAILED:');
  for (const f of failures) console.error('  -', f);
  process.exit(1);
}
console.log('Bundle verification passed: no private corpus assets, paper codes or credentials.');
