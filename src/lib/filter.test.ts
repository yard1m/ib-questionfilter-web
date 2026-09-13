import { describe, it, expect } from 'vitest';
import { demoCorpus } from '../data/demo';
import { applyFilters, emptyFilters, facetsFor, matchesTopics, pruneSelection } from './filter';
import type { QuestionRecord } from './types';

const f = (over: Partial<ReturnType<typeof emptyFilters>> = {}) => ({ ...emptyFilters('chemistry'), ...over });
const ids = (qs: QuestionRecord[]) => qs.map((q) => q.id);

describe('subject selection', () => {
  it('offers all three subjects', () => {
    const subjects = new Set(demoCorpus.questions.map((q) => q.subject));
    expect([...subjects].sort()).toEqual(['chemistry', 'mathematics', 'physics']);
  });
  it('returns only the selected subject', () => {
    for (const s of ['chemistry', 'mathematics', 'physics'] as const) {
      const out = applyFilters(demoCorpus, f({ subject: s }));
      expect(out.every((q) => q.subject === s)).toBe(true);
      expect(out.length).toBeGreaterThan(0);
    }
  });
});

describe('facet filters', () => {
  it('filters by examination year', () => {
    const out = applyFilters(demoCorpus, f({ years: new Set([2018]) }));
    expect(out.every((q) => q.examYear === 2018)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
  });
  it('filters by session', () => {
    const out = applyFilters(demoCorpus, f({ sessions: new Set(['November']) }));
    expect(out.every((q) => q.session === 'November')).toBe(true);
  });
  it('filters by level', () => {
    const out = applyFilters(demoCorpus, f({ levels: new Set(['hl']) }));
    expect(out.every((q) => q.level === 'hl')).toBe(true);
  });
  it('filters by paper and paper type', () => {
    expect(applyFilters(demoCorpus, f({ papers: new Set(['paper1']) })).every((q) => q.paper === 'paper1')).toBe(true);
    expect(applyFilters(demoCorpus, f({ paperTypes: new Set(['Paper 1A']) })).every((q) => q.paperType === 'Paper 1A')).toBe(true);
  });
  it('treats an empty facet as no constraint', () => {
    expect(applyFilters(demoCorpus, f()).length).toBe(
      demoCorpus.questions.filter((q) => q.subject === 'chemistry').length - 2, // two suppressed
    );
  });
  it('derives facet values from canonical rows only', () => {
    const facets = facetsFor(demoCorpus, 'chemistry');
    expect(facets.years).toEqual([2025, 2018]);
    expect(facets.levels).toContain('sl');
  });
});

describe('topic filtering', () => {
  const q = (topics: string[]) => ({ topicIds: topics } as QuestionRecord);

  it('matches any selected topic by default', () => {
    const state = f({ topics: new Set(['Ideal gases']) });
    const out = applyFilters(demoCorpus, state);
    expect(out.every((x) => x.topicIds.includes('Ideal gases'))).toBe(true);
    expect(out.length).toBe(1);
  });

  it('"only selected topics" keeps a question whose topics are a SUBSET of the selection', () => {
    const state = f({ onlySelectedTopics: true, topics: new Set(['Electron configurations', 'The periodic table']) });
    // exactly-both question qualifies
    expect(matchesTopics(q(['Electron configurations', 'The periodic table']), state)).toBe(true);
    // a strict subset qualifies
    expect(matchesTopics(q(['The periodic table']), state)).toBe(true);
    // anything carrying an unselected topic is excluded
    expect(matchesTopics(q(['The periodic table', 'Ideal gases']), state)).toBe(false);
  });

  it('"only selected topics" excludes multi-topic questions that reach outside the selection', () => {
    const state = f({ onlySelectedTopics: true, topics: new Set(['Electron configurations']) });
    const out = applyFilters(demoCorpus, state);
    // The chemistry Paper 2 question carries Electron configurations AND The periodic table,
    // so it must NOT appear when only Electron configurations is selected.
    expect(ids(out)).not.toContain('chem-2025-p2-tz1-hl-q2');
  });

  it('"require all topics" keeps questions carrying every selected topic', () => {
    const state = f({ requireAllTopics: true, topics: new Set(['Electron configurations', 'The periodic table']) });
    expect(matchesTopics(q(['Electron configurations', 'The periodic table', 'Ideal gases']), state)).toBe(true);
    expect(matchesTopics(q(['Electron configurations']), state)).toBe(false);
  });

  it('an empty topic selection under the subset rule shows nothing with topics', () => {
    const state = f({ onlySelectedTopics: true, topics: new Set<string>() });
    expect(matchesTopics(q(['Ideal gases']), state)).toBe(false);
  });
});

describe('selection pruning and ordering', () => {
  it('drops selections that are no longer visible', () => {
    const visible = applyFilters(demoCorpus, f({ years: new Set([2018]) }));
    const pruned = pruneSelection(new Set(['chem-2025-p1a-tz1-sl-q1', visible[0].id]), visible);
    expect([...pruned]).toEqual([visible[0].id]);
  });
  it('orders stably, newest year first', () => {
    const out = applyFilters(demoCorpus, f());
    const years = out.map((q) => q.examYear);
    expect(years).toEqual([...years].sort((a, b) => b - a));
    expect(ids(applyFilters(demoCorpus, f()))).toEqual(ids(applyFilters(demoCorpus, f())));
  });
});
