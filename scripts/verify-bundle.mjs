// Fails the build if anything private, or any credential-like file, reaches dist/.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const BANNED_EXTENSIONS = new Set(['.pdf', '.docx', '.epub', '.mobi', '.zip', '.7z', '.rar']);
const BANNED_PATH = /(^|[\\/])(?:\.env(?:\.|$)|id_rsa|credentials\.json$|[^/]+\.(?:pem|p12)$)/i;
const DATA_ARTIFACT_PATH = /(?:^|\/)(?:catalog|manifest|data)(?:[-_.][a-z0-9]+)*\.(?:json|js|mjs|bin|txt)$/i;
const PRIVATE_ROUTE = /(?:__local-corpus|local-corpus|VITE_LOCAL_CORPUS|upload-manifest\.json|\.web-corpus)/i;
const CORPUS_PATHS = /(?:markschemes[\\/]|references[\\/]books|papers[\\/](?:chemistry|physics|mathematics)(?:[\\/ ]))/i;
// Real IB session/subject/paper code format printed on genuine papers.
const PAPER_CODE = /[MN]\d{2}\/\d\/[A-Z]{4,5}\/[A-Z0-9]{2,4}\/ENG\//;
const SECRET_MARKER = /(?:sb_secret_[A-Za-z0-9_-]{8,}|(?:VITE_|NEXT_PUBLIC_|PUBLIC_)?SUPABASE[_A-Z0-9-]*(?:SERVICE[_-]?ROLE|SECRET)[_A-Z0-9-]*(?:KEY)?|service[_-]?role\s*[:=]\s*["'][A-Za-z0-9._-]{8,}["'])/i;
const JWT = /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const PDF_SIGNATURE = '%PDF-';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

function decodeBase64Url(value) {
  try {
    return Buffer.from(value, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

function containsServiceRoleJwt(text) {
  // A JWT payload containing JSON always starts with the base64url encoding of `{\"`.
  // Avoid running the token regexp over every large renderer/vendor file.
  if (!text.includes('eyJ')) return false;
  for (const token of text.match(JWT) ?? []) {
    const payload = decodeBase64Url(token.split('.')[1]);
    if (!payload) continue;
    try {
      const parsed = JSON.parse(payload);
      if (String(parsed.role ?? '').toLowerCase() === 'service_role') return true;
    } catch {
      // Not every dotted string in a JavaScript bundle is a JWT.
    }
  }
  return false;
}

function hasObjectKey(text, key) {
  // Match actual object properties so ordinary UI/vendor prose containing these words stays allowed.
  return new RegExp(`(?:^|[,{])\\s*(?:"${key}"|'${key}'|${key})\\s*:`).test(text);
}

// These structural signatures catch a renamed/hashed JSON artifact without matching ordinary
// UI references to the words "catalog", "questions", or "objects".
function containsDataSignature(text) {
  const catalog = ['schemaVersion', 'subjects', 'documents', 'questions'].every((key) => hasObjectKey(text, key));
  const manifest = ['objectCount', 'objects'].every((key) => hasObjectKey(text, key));
  return catalog || manifest;
}

export function inspectBundle(root = DIST) {
  const failures = [];
  if (!existsSync(root)) return { files: [], failures: [`${root}: dist directory is missing`] };
  const files = walk(root);
  for (const file of files) {
    const rel = relative(root, file).split('\\').join('/');
    if (BANNED_EXTENSIONS.has(extname(file).toLowerCase())) failures.push(`${rel}: banned private file type`);
    if (BANNED_PATH.test(rel)) failures.push(`${rel}: credential-like path`);
    if (DATA_ARTIFACT_PATH.test(rel)) failures.push(`${rel}: private catalog/data artifact path`);

    const bytes = readFileSync(file);
    if (bytes.subarray(0, PDF_SIGNATURE.length).toString('ascii') === PDF_SIGNATURE) {
      failures.push(`${rel}: PDF file content`);
    }
    const text = bytes.toString('utf8');
    if (containsDataSignature(text)) {
      failures.push(`${rel}: private catalog/data artifact signature`);
    }
    if (PAPER_CODE.test(text)) failures.push(`${rel}: contains a real IB paper code`);
    if (CORPUS_PATHS.test(text)) failures.push(`${rel}: references a private corpus path`);
    if (PRIVATE_ROUTE.test(text)) failures.push(`${rel}: contains a local-corpus route or manifest marker`);
    if (SECRET_MARKER.test(text) || containsServiceRoleJwt(text)) {
      failures.push(`${rel}: contains secret or service-role key material`);
    }
  }
  return { files, failures };
}

function isMain() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
}

if (isMain()) {
  const { files, failures } = inspectBundle();
  console.log(`inspected ${files.length} published files`);
  if (failures.length) {
    console.error('\nBundle verification FAILED:');
    for (const failure of failures) console.error('  -', failure);
    process.exit(1);
  }
  console.log('Bundle verification passed: no private corpus assets, paper codes, local routes or credentials.');
}
