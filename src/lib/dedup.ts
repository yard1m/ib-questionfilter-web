import type { Corpus, QuestionRecord, SharedGroup } from './types';

/**
 * Deduplication identity key.
 *
 * The boundary is: subject + examination year + verified question content.
 * Including examYear is what keeps identical content in two different years
 * as two separate canonical questions - one per year - instead of collapsing
 * them globally.
 */
export function identityKey(q: Pick<QuestionRecord, 'subject' | 'examYear'>, contentHash: string): string {
  return `${q.subject}::${q.examYear}::${contentHash}`;
}

/** Normalizes renderable content into a comparable string. */
export function contentHash(q: QuestionRecord): string {
  return q.content
    .map((b) => {
      switch (b.kind) {
        case 'text':
        case 'formula':
          return b.text;
        case 'table':
          return [b.caption ?? '', ...b.headers, ...b.rows.flat()].join('|');
        case 'diagram':
          return `diagram:${b.caption ?? ''}:${b.svg.replace(/\s+/g, '')}`;
        case 'options':
          return b.options.map((o) => `${o.label}${o.text}`).join('|');
      }
    })
    .join('~')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Rejects any group that spans more than one examination year.
 *
 * A cross-year group would collapse the same content across years, which the
 * duplicate/shared invariant forbids: identical content in different years must
 * keep one canonical copy in EACH year.
 */
export function validateGroups(corpus: Corpus): string[] {
  const byId = new Map(corpus.questions.map((q) => [q.id, q]));
  const failures: string[] = [];

  for (const g of corpus.sharedGroups) {
    const members = [g.canonicalId, ...g.suppressedIds];
    if (members.length < 2) {
      failures.push(`${g.groupId}: a shared group needs at least two occurrences`);
    }
    const years = new Set<number>();
    const subjects = new Set<string>();
    for (const id of members) {
      const q = byId.get(id);
      if (!q) {
        failures.push(`${g.groupId}: occurrence ${id} is not in the corpus`);
        continue;
      }
      years.add(q.examYear);
      subjects.add(q.subject);
    }
    if (years.size > 1) {
      failures.push(
        `${g.groupId}: spans examination years ${[...years].sort().join(', ')}. ` +
          `Identical content in different years must stay separate.`,
      );
    }
    if (subjects.size > 1) {
      failures.push(`${g.groupId}: spans multiple subjects`);
    }
    if (!byId.has(g.canonicalId)) {
      failures.push(`${g.groupId}: canonical ${g.canonicalId} is not in the corpus`);
    }
  }

  // A question may be suppressed by at most one group.
  const seen = new Map<string, string>();
  for (const g of corpus.sharedGroups) {
    for (const id of g.suppressedIds) {
      const prev = seen.get(id);
      if (prev) failures.push(`${id} is suppressed by both ${prev} and ${g.groupId}`);
      seen.set(id, g.groupId);
    }
  }
  return failures;
}

/** Ids that must never appear as an independently selectable row. */
export function suppressedIds(corpus: Corpus): Set<string> {
  const s = new Set<string>();
  for (const g of corpus.sharedGroups) for (const id of g.suppressedIds) s.add(id);
  return s;
}

/** Source references for a canonical question, including its suppressed occurrences. */
export function provenanceFor(corpus: Corpus, canonicalId: string): string[] {
  const byId = new Map(corpus.questions.map((q) => [q.id, q]));
  const refs: string[] = [];
  const self = byId.get(canonicalId);
  if (self) refs.push(self.sourceRef);
  for (const g of corpus.sharedGroups) {
    if (g.canonicalId !== canonicalId) continue;
    for (const id of g.suppressedIds) {
      const q = byId.get(id);
      if (q) refs.push(q.sourceRef);
    }
  }
  return refs;
}

/** The canonical, selectable question list: exactly one row per shared group. */
export function canonicalQuestions(corpus: Corpus): QuestionRecord[] {
  const suppressed = suppressedIds(corpus);
  return corpus.questions.filter((q) => !suppressed.has(q.id));
}

/**
 * Detects same-year duplicates that are NOT covered by a declared group.
 * Used as a safety net so a duplicate visible row can never be introduced.
 */
export function undeclaredDuplicates(corpus: Corpus): string[][] {
  const groups = new Map<string, string[]>();
  for (const q of canonicalQuestions(corpus)) {
    const k = identityKey(q, contentHash(q));
    groups.set(k, [...(groups.get(k) ?? []), q.id]);
  }
  return [...groups.values()].filter((ids) => ids.length > 1);
}

export type { SharedGroup };
