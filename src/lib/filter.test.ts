import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog';
import { fixtureCatalog } from './fixtures';
import { cycleTopic, defaultFilters, filterQuestions, matchesTopics, pruneSelection, setTopicMode, toggleFacet, toggleTopic, topicState } from './filter';

const catalog = parseCatalog(fixtureCatalog());
const physics = catalog.subjects[0];
const ids = (list: { id: string }[]) => list.map((q) => q.id);

describe('filters', () => {
  it('starts with every facet value selected and no topic', () => {
    const f = defaultFilters(physics);
    expect([...f.years]).toEqual([2024, 2019]);
    expect(f.topics.size).toBe(0);
    expect(ids(filterQuestions(catalog.questions, 'physics', f))).toEqual([
      'physics-p1-hl-2024::Q1', 'physics-p1-hl-2024::Q2', 'physics-p2-sl-2019::Q1',
    ]);
  });

  it('never deselects the last value of a facet', () => {
    let years = toggleFacet(new Set([2024, 2019]), 2024);
    expect([...years]).toEqual([2019]);
    years = toggleFacet(years, 2019);
    expect([...years]).toEqual([2019]);
  });

  it('filters by year, level and paper', () => {
    const f = { ...defaultFilters(physics), levels: new Set(['SL']) };
    expect(ids(filterQuestions(catalog.questions, 'physics', f))).toEqual(['physics-p2-sl-2019::Q1']);
    const g = { ...defaultFilters(physics), papers: new Set(['Paper 1A']), years: new Set([2024]) };
    expect(ids(filterQuestions(catalog.questions, 'physics', g))).toEqual(['physics-p1-hl-2024::Q1', 'physics-p1-hl-2024::Q2']);
  });

  it('matches any overlapping topic by default', () => {
    const f = { ...defaultFilters(physics), topics: new Set(['Gravitation']) };
    expect(ids(filterQuestions(catalog.questions, 'physics', f))).toEqual(['physics-p1-hl-2024::Q1', 'physics-p1-hl-2024::Q2']);
  });

  it('requires every selected topic in require-all mode', () => {
    const f = setTopicMode({ ...defaultFilters(physics), topics: new Set(['Gravitation', 'Kinematics']) }, 'requireAllTopics', true);
    expect(ids(filterQuestions(catalog.questions, 'physics', f))).toEqual(['physics-p1-hl-2024::Q1']);
  });

  it('keeps only questions within the selection in only-selected mode', () => {
    const f = setTopicMode({ ...defaultFilters(physics), topics: new Set(['Kinematics']) }, 'onlySelectedTopics', true);
    expect(ids(filterQuestions(catalog.questions, 'physics', f))).toEqual(['physics-p2-sl-2019::Q1']);
    const none = setTopicMode(defaultFilters(physics), 'onlySelectedTopics', true);
    expect(filterQuestions(catalog.questions, 'physics', none)).toEqual([]);
  });

  it('keeps the two topic modes mutually exclusive', () => {
    const a = setTopicMode(defaultFilters(physics), 'requireAllTopics', true);
    const b = setTopicMode(a, 'onlySelectedTopics', true);
    expect(b.requireAllTopics).toBe(false);
    expect(b.onlySelectedTopics).toBe(true);
    const c = setTopicMode(b, 'requireAllTopics', false);
    expect(c.onlySelectedTopics).toBe(true);
  });

  it('toggles topics freely', () => {
    const t = toggleTopic(toggleTopic(new Set<string>(), 'Rates'), 'Rates');
    expect(t.size).toBe(0);
  });

  it('matchesTopics treats an empty selection as no constraint', () => {
    expect(matchesTopics(catalog.questions[0], defaultFilters(physics))).toBe(true);
  });

  it('prunes selections that are no longer visible', () => {
    const selected = new Set(['physics-p1-hl-2024::Q1', 'physics-p2-sl-2019::Q1']);
    const visible = filterQuestions(catalog.questions, 'physics', { ...defaultFilters(physics), levels: new Set(['HL']) });
    expect([...pruneSelection(selected, visible)]).toEqual(['physics-p1-hl-2024::Q1']);
    const unchanged = new Set(['physics-p1-hl-2024::Q1']);
    expect(pruneSelection(unchanged, visible)).toBe(unchanged);
  });
});

describe('required and secondary topics', () => {
  const q = (topics: string[]) => ({ topics } as unknown as Parameters<typeof matchesTopics>[0]);
  const base = defaultFilters({ id: 'x', name: 'X', topics: [], years: [2024], sessions: ['May'], levels: ['HL'], papers: ['1'] } as never);

  it('cycles a topic off -> required -> secondary -> off', () => {
    let f = cycleTopic(base, 'Rates');
    expect(topicState(f, 'Rates')).toBe('required');
    f = cycleTopic(f, 'Rates');
    expect(topicState(f, 'Rates')).toBe('secondary');
    expect(f.topics.has('Rates')).toBe(false);
    f = cycleTopic(f, 'Rates');
    expect(topicState(f, 'Rates')).toBe('off');
  });

  it('needs one required topic and allows only required or secondary topics', () => {
    const f = { ...base, topics: new Set(['Rates']), secondaryTopics: new Set(['The mole']) };
    expect(matchesTopics(q(['Rates']), f)).toBe(true);
    expect(matchesTopics(q(['Rates', 'The mole']), f)).toBe(true);
    expect(matchesTopics(q(['The mole']), f)).toBe(false); // secondary alone is not enough
    expect(matchesTopics(q(['Rates', 'Equilibrium']), f)).toBe(false); // unpicked topic
    expect(matchesTopics(q([]), f)).toBe(false);
  });

  it('matches nothing when only secondary topics are set, and ignores the old modes while active', () => {
    expect(matchesTopics(q(['The mole']), { ...base, secondaryTopics: new Set(['The mole']) })).toBe(false);
    const f = { ...base, topics: new Set(['Rates', 'Kinetics']), secondaryTopics: new Set(['The mole']), requireAllTopics: true };
    expect(matchesTopics(q(['Rates', 'The mole']), f)).toBe(true);
  });
});

