import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

export function withinRoot(path, root) {
  const rel = relative(root, path);
  return rel !== '..' && !isAbsolute(rel) && !rel.startsWith(`..${sep}`);
}

export function corpusPaths(webRoot, manifestPath) {
  const candidate = manifestPath ?? [resolve(webRoot, '.web-corpus/upload-manifest.json'), resolve(webRoot, '../.web-corpus/upload-manifest.json')].find(existsSync);
  if (!candidate) throw new Error('Run Scripts/build_web_corpus.py first');
  const manifestFile = realpathSync(candidate);
  // Resolve the symlink before choosing the base for repository-relative manifest paths.
  return { manifestPath: manifestFile, repoRoot: dirname(dirname(manifestFile)) };
}

export function corpusFile(root, file) {
  if (typeof file !== 'string' || isAbsolute(file) || !withinRoot(resolve(root, file), root)) throw new Error(`Manifest object escapes repository root: ${file}`);
  const whitelisted = value => /^(papers\/.*\.pdf|markschemes\/.*\.pdf|\.web-corpus\/catalog\.json)$/.test(value);
  if (file.split('/').some(part => part === '..' || part === '.') || !whitelisted(file)) throw new Error(`Manifest file is not whitelisted: ${file}`);
  const path = realpathSync(resolve(root, file));
  if (!withinRoot(path, root)) throw new Error(`Manifest object escapes repository root: ${file}`);
  if (!whitelisted(relative(root, path).split(sep).join('/'))) throw new Error(`Manifest file is not whitelisted: ${file}`);
  if (!statSync(path).isFile()) throw new Error(`Manifest object is not a file: ${file}`);
  return path;
}

export function validateManifest(manifest) {
  if (!Array.isArray(manifest.objects) || manifest.objectCount !== manifest.objects.length || manifest.objectCount < 2) throw new Error('Manifest objectCount does not match its objects array');
  if (typeof manifest.prefix !== 'string' || !manifest.prefix || manifest.catalogKey !== `${manifest.prefix}/catalog.json`) throw new Error('Invalid manifest catalogKey/prefix');
  const keys = new Set();
  const files = new Set();
  for (const item of manifest.objects) {
    if (!item || typeof item.key !== 'string' || typeof item.file !== 'string' || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !/^[a-f0-9]{64}$/.test(item.sha256 ?? '')) throw new Error('Malformed manifest object');
    if (keys.has(item.key)) throw new Error(`Duplicate manifest key: ${item.key}`);
    if (files.has(item.file)) throw new Error(`Duplicate manifest file: ${item.file}`);
    keys.add(item.key); files.add(item.file);
    if (item.key === manifest.catalogKey) {
      if (item.contentType !== 'application/json' || item.file !== '.web-corpus/catalog.json') throw new Error('Invalid catalog object');
    } else if (item.contentType !== 'application/pdf' || !item.key.startsWith(`${manifest.prefix}/`) || !/^(papers|markschemes)\/.+\.pdf$/.test(item.key.slice(manifest.prefix.length + 1))) throw new Error(`Unexpected manifest object type for ${item.key}`);
  }
  if (!keys.has(manifest.catalogKey)) throw new Error('Manifest catalog object is missing');
  if (manifest.totalBytes !== manifest.objects.reduce((sum, o) => sum + o.bytes, 0) || manifest.largestBytes !== Math.max(...manifest.objects.map(o => o.bytes))) throw new Error('Manifest byte totals mismatch');
  return manifest;
}

export function verifiedBytes(root, item) {
  const bytes = readFileSync(corpusFile(root, item.file));
  if (bytes.length !== item.bytes) throw new Error(`Manifest size mismatch for ${item.key}`);
  if (createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw new Error(`Manifest hash mismatch for ${item.key}`);
  return bytes;
}

export function validateCatalog(catalog, manifest) {
  if (catalog.schemaVersion !== 1) throw new Error('Unsupported catalog schema');
  if (!Array.isArray(catalog.documents) || catalog.documents.length !== manifest.documentCount) throw new Error('Catalog documentCount mismatch');
  if (!Array.isArray(catalog.questions) || catalog.questions.length !== manifest.questionCount) throw new Error('Catalog questionCount mismatch');
  if (!Array.isArray(catalog.subjects) || !catalog.subjects.length) throw new Error('Catalog subjects are missing');
  const subjects = new Set(catalog.subjects.map(s => s.id));
  if (subjects.size !== catalog.subjects.length || [...subjects].some(s => !['physics', 'chemistry', 'mathematics'].includes(s))) throw new Error('Invalid catalog subjects');
  const objects = new Map(manifest.objects.map(o => [o.key, o]));
  const documentIds = new Set();
  const referenced = new Set([manifest.catalogKey]);
  for (const doc of catalog.documents) {
    if (!doc.id || documentIds.has(doc.id) || !subjects.has(doc.subject) || !Number.isInteger(doc.year) || !['HL', 'SL'].includes(doc.level)) throw new Error('Invalid catalog document');
    documentIds.add(doc.id);
    for (const [key, kind] of [[doc.paperKey, 'papers'], [doc.markschemeKey, 'markschemes']]) {
      if (kind === 'markschemes' && key == null) continue;
      if (objects.get(key)?.contentType !== 'application/pdf' || !key.startsWith(`${manifest.prefix}/${kind}/`)) throw new Error(`Catalog source is missing from manifest: ${key}`);
      referenced.add(key);
    }
  }
  const questionIds = new Set();
  const validSlices = slices => Array.isArray(slices) && slices.length > 0 && slices.every(s => Array.isArray(s) && [3, 5].includes(s.length) && Number.isInteger(s[0]) && s[0] >= 0 && Number.isFinite(s[1]) && Number.isFinite(s[2]) && s[2] > s[1] && (s.length === 3 || (s[3] == null && s[4] == null) || (Number.isFinite(s[3]) && Number.isFinite(s[4]) && s[4] > s[3])));
  for (const question of catalog.questions) {
    if (!question.id || questionIds.has(question.id) || !Number.isInteger(question.doc) || !catalog.documents[question.doc] || !validSlices(question.q) || !Array.isArray(question.topics) || question.topics.some(t => typeof t !== 'string') || (question.a != null && (!validSlices(question.a) || !catalog.documents[question.doc].markschemeKey))) throw new Error('Invalid catalog question');
    questionIds.add(question.id);
  }
  if (referenced.size !== objects.size) throw new Error('Manifest contains unreferenced corpus objects');
  return catalog;
}

export function loadCorpus(webRoot, manifestPath) {
  const paths = corpusPaths(webRoot, manifestPath);
  const manifest = validateManifest(JSON.parse(readFileSync(paths.manifestPath, 'utf8')));
  const objects = new Map(manifest.objects.map(o => [o.key, o]));
  const catalog = validateCatalog(JSON.parse(verifiedBytes(paths.repoRoot, objects.get(manifest.catalogKey)).toString('utf8')), manifest);
  return { ...paths, manifest, catalog, objects };
}
