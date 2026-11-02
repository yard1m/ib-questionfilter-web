import type { Question } from './catalog';

/**
 * Word search over question text. The corpus ships search.json (the text inside each question's
 * slices, read from the papers' text layer by Scripts/build_search_index.py); the app downloads it
 * the first time someone searches. Matching is by word start, case- and accent-insensitive, so
 * "hess law" finds "Hess's law" and "project" finds "projectile". Quoted phrases must appear together.
 */

export type SearchTexts = Record<string, string>;

export function normalise(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`ʼ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Splits a query into normalised terms; "quoted phrases" stay together. */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const match of query.matchAll(/"([^"]*)"|(\S+)/g)) {
    const term = normalise(match[1] ?? match[2] ?? '');
    if (term) terms.push(term);
  }
  return terms;
}

/** Normalised searchable text per question: its label, paper, topics and question text. */
export function searchIndex(questions: Question[], texts: SearchTexts): Map<string, string> {
  const index = new Map<string, string>();
  for (const q of questions) {
    index.set(q.id, ` ${normalise([q.label, q.document.name, q.document.paper, ...q.topics, texts[q.id] ?? ''].join(' '))} `);
  }
  return index;
}

/** Every term must start a word in the question's text. */
export function matchesSearch(text: string | undefined, terms: string[]): boolean {
  if (!terms.length) return true;
  if (!text) return false;
  return terms.every((term) => text.includes(` ${term}`));
}

export function parseSearchTexts(raw: unknown): SearchTexts {
  const text = (raw as { schemaVersion?: number; text?: unknown } | null)?.text;
  if ((raw as { schemaVersion?: number })?.schemaVersion !== 1 || !text || typeof text !== 'object') throw new Error('The search index is not valid');
  return text as SearchTexts;
}
