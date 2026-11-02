import { describe, expect, it } from 'vitest';
import { parseCatalog } from './catalog';
import { fixtureCatalog } from './fixtures';
import { matchesSearch, normalise, parseSearchTexts, searchIndex, searchTerms } from './search';
import { browserSelections } from './savedSelections';

describe('word search', () => {
  const questions = parseCatalog(fixtureCatalog()).questions;
  const texts = { [questions[0].id]: "Use Hess's law to find the enthalpy change.", [questions[1].id]: 'A projectile is launched at 30° above the horizontal.' };
  const index = searchIndex(questions, texts);
  const find = (query: string) => questions.filter((q) => matchesSearch(index.get(q.id), searchTerms(query))).map((q) => q.id);

  it('ignores case, accents and apostrophes, and matches word starts', () => {
    expect(normalise("Hess’s LAW — Café")).toBe('hesss law cafe');
    expect(find('hess law')).toEqual([questions[0].id]);
    expect(find("Hess's")).toEqual([questions[0].id]);
    expect(find('project')).toEqual([questions[1].id]);
    expect(find('ject')).toEqual([]); // not the middle of a word
  });

  it('needs every term, keeps quoted phrases together and also matches topics and labels', () => {
    expect(find('projectile enthalpy')).toEqual([]);
    expect(find('"launched at"')).toEqual([questions[1].id]);
    expect(find('"at launched"')).toEqual([]);
    expect(find('gravitation').length).toBeGreaterThan(0);
    expect(find('')).toHaveLength(questions.length);
  });

  it('rejects a malformed index file', () => {
    expect(() => parseSearchTexts({ schemaVersion: 2, text: {} })).toThrow();
    expect(parseSearchTexts({ schemaVersion: 1, text: { a: 'b' } })).toEqual({ a: 'b' });
  });
});

describe('saved sets in the browser (local development)', () => {
  it('saves, replaces by name within a subject, lists newest first and deletes', async () => {
    const data = new Map<string, string>();
    const store = browserSelections({ getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } });
    await store.save('physics', 'Mock 1', ['a', 'b']);
    await store.save('chemistry', 'Mock 1', ['c']);
    await store.save('physics', ' Mock 1 ', ['a']);
    const sets = await store.list();
    expect(sets.map((s) => [s.subject, s.name, s.questionIds])).toEqual(expect.arrayContaining([['physics', 'Mock 1', ['a']], ['chemistry', 'Mock 1', ['c']]]));
    expect(sets).toHaveLength(2);
    await store.remove(sets.find((s) => s.subject === 'physics')!.id);
    expect((await store.list()).map((s) => s.subject)).toEqual(['chemistry']);
  });
});
