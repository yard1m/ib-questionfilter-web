import type { Corpus, QuestionRecord, SubjectId } from './types';
import { canonicalQuestions } from './dedup';

export interface FilterState {
  subject: SubjectId;
  years: Set<number>;       // examination year
  sessions: Set<string>;    // 'May' | 'November'
  levels: Set<string>;      // 'hl' | 'sl'
  papers: Set<string>;      // 'paper1' ...
  paperTypes: Set<string>;  // 'Paper 1A' ...
  topics: Set<string>;
  /** Subset rule: show only questions whose topics are all within the selection. */
  onlySelectedTopics: boolean;
  /** Show only questions that carry every selected topic. */
  requireAllTopics: boolean;
}

export function emptyFilters(subject: SubjectId): FilterState {
  return {
    subject,
    years: new Set(),
    sessions: new Set(),
    levels: new Set(),
    papers: new Set(),
    paperTypes: new Set(),
    topics: new Set(),
    onlySelectedTopics: false,
    requireAllTopics: false,
  };
}

/** An empty facet selection means "no constraint", matching the desktop app. */
function facetMatches<T>(selected: Set<T>, value: T): boolean {
  return selected.size === 0 || selected.has(value);
}

/**
 * Topic matching, reproducing AppModel.matchesTopics:
 *   - onlySelectedTopics: question topics must be a SUBSET of the selection.
 *   - requireAllTopics:   the selection must be a subset of the question topics.
 *   - otherwise:          any overlap, and an empty selection matches everything.
 * onlySelectedTopics and requireAllTopics are mutually exclusive.
 */
export function matchesTopics(q: QuestionRecord, f: FilterState): boolean {
  const topics = new Set(q.topicIds);
  if (f.onlySelectedTopics) {
    for (const t of topics) if (!f.topics.has(t)) return false;
    return true;
  }
  if (f.topics.size === 0) return true;
  if (f.requireAllTopics) {
    for (const t of f.topics) if (!topics.has(t)) return false;
    return true;
  }
  for (const t of topics) if (f.topics.has(t)) return true;
  return false;
}

/** Applies every facet to the canonical (deduplicated) question list. */
export function applyFilters(corpus: Corpus, f: FilterState): QuestionRecord[] {
  return canonicalQuestions(corpus)
    .filter(
      (q) =>
        q.subject === f.subject &&
        facetMatches(f.years, q.examYear) &&
        facetMatches(f.sessions, q.session) &&
        facetMatches(f.levels, q.level) &&
        facetMatches(f.papers, q.paper) &&
        facetMatches(f.paperTypes, q.paperType) &&
        matchesTopics(q, f),
    )
    .sort(sortQuestions);
}

/** Stable ordering so a selected question and its answer slice stay paired. */
export function sortQuestions(a: QuestionRecord, b: QuestionRecord): number {
  return (
    b.examYear - a.examYear ||
    a.session.localeCompare(b.session) ||
    a.level.localeCompare(b.level) ||
    a.paper.localeCompare(b.paper) ||
    a.timeZone.localeCompare(b.timeZone) ||
    numeric(a.questionNumber) - numeric(b.questionNumber) ||
    a.id.localeCompare(b.id)
  );
}

function numeric(label: string): number {
  const m = label.match(/\d+/);
  return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER;
}

/** Drops selections that are no longer visible, matching pruneSelectionToVisibleQuestions. */
export function pruneSelection(selected: Set<string>, visible: QuestionRecord[]): Set<string> {
  const ids = new Set(visible.map((q) => q.id));
  return new Set([...selected].filter((id) => ids.has(id)));
}

/** Facet values available for a subject, derived from the canonical rows. */
export function facetsFor(corpus: Corpus, subject: SubjectId) {
  const qs = canonicalQuestions(corpus).filter((q) => q.subject === subject);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    years: uniq(qs.map((q) => q.examYear)).sort((a, b) => b - a),
    sessions: uniq(qs.map((q) => q.session)).sort(),
    levels: uniq(qs.map((q) => q.level)).sort(),
    papers: uniq(qs.map((q) => q.paper)).sort(),
    paperTypes: uniq(qs.map((q) => q.paperType)).sort(),
    topics: uniq(qs.flatMap((q) => q.topicIds)).sort(),
  };
}
