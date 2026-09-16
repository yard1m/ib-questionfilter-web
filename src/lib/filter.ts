import type { Question, Subject } from './catalog';

/**
 * Filter state, reproducing the desktop AppModel: every year, session, level and paper starts
 * selected and at least one of each stays selected; no topic starts selected.
 */
export interface Filters {
  years: Set<number>;
  sessions: Set<string>;
  levels: Set<string>;
  papers: Set<string>;
  topics: Set<string>;
  /** Show only questions whose topics all lie within the selected topics. */
  onlySelectedTopics: boolean;
  /** Show only questions that carry every selected topic. */
  requireAllTopics: boolean;
}

export function defaultFilters(subject: Subject): Filters {
  return {
    years: new Set(subject.years),
    sessions: new Set(subject.sessions),
    levels: new Set(subject.levels),
    papers: new Set(subject.papers),
    topics: new Set(),
    onlySelectedTopics: false,
    requireAllTopics: false,
  };
}

/** Toggles a facet value but never deselects the last one, like the desktop app. */
export function toggleFacet<T>(values: Set<T>, value: T): Set<T> {
  const next = new Set(values);
  if (next.has(value)) {
    if (next.size > 1) next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

export function toggleTopic(topics: Set<string>, topic: string): Set<string> {
  const next = new Set(topics);
  if (next.has(topic)) next.delete(topic);
  else next.add(topic);
  return next;
}

/** The two topic modes are mutually exclusive. */
export function setTopicMode(filters: Filters, mode: 'onlySelectedTopics' | 'requireAllTopics', on: boolean): Filters {
  return {
    ...filters,
    onlySelectedTopics: mode === 'onlySelectedTopics' ? on : on ? false : filters.onlySelectedTopics,
    requireAllTopics: mode === 'requireAllTopics' ? on : on ? false : filters.requireAllTopics,
  };
}

export function matchesTopics(question: Question, filters: Filters): boolean {
  const topics = new Set(question.topics);
  if (filters.onlySelectedTopics) {
    for (const topic of topics) if (!filters.topics.has(topic)) return false;
    return true;
  }
  if (filters.topics.size === 0) return true;
  if (filters.requireAllTopics) {
    for (const topic of filters.topics) if (!topics.has(topic)) return false;
    return true;
  }
  for (const topic of topics) if (filters.topics.has(topic)) return true;
  return false;
}

export function filterQuestions(questions: Question[], subjectId: string, filters: Filters): Question[] {
  return questions
    .filter((q) =>
      q.subject === subjectId &&
      filters.years.has(q.document.year) &&
      filters.sessions.has(q.document.session) &&
      filters.levels.has(q.document.level) &&
      filters.papers.has(q.document.paper) &&
      matchesTopics(q, filters))
    .sort(displayOrder);
}

/** Desktop display order: catalog document order, then question order within the document. */
export function displayOrder(a: Question, b: Question): number {
  return a.document.order - b.document.order || a.order - b.order;
}

/** Drops selected questions that are no longer visible, like pruneSelectionToVisibleQuestions. */
export function pruneSelection(selected: Set<string>, visible: Question[]): Set<string> {
  const ids = new Set(visible.map((q) => q.id));
  const next = new Set([...selected].filter((id) => ids.has(id)));
  return next.size === selected.size ? selected : next;
}
