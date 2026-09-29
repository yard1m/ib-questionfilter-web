import { describe, expect, it } from 'vitest';
import type { Question } from './catalog';
import { emptyProgress, loadProgress, pickSet, record, saveProgress, weakestTopics, weakness } from './practice';

const q = (id: string, topics: string[]) => ({ id, topics } as unknown as Question);
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
};

describe('practice progress', () => {
  it('records right and wrong answers per question and per topic', () => {
    let p = emptyProgress();
    p = record(p, q('a', ['Kinematics', 'Gravitation']), false, 1);
    p = record(p, q('a', ['Kinematics', 'Gravitation']), true, 2);
    expect(p.questions.a).toEqual({ right: 1, wrong: 1, last: 2 });
    expect(p.topics.Kinematics).toEqual({ right: 1, wrong: 1, last: 2 });
    expect(record(emptyProgress(), q('b', []), false).topics['Needs review'].wrong).toBe(1);
  });

  it('scores untried topics in the middle and ranks the weakest first', () => {
    expect(weakness(undefined)).toBe(0.5);
    let p = emptyProgress();
    for (let i = 0; i < 3; i += 1) p = record(p, q('x', ['Waves']), false);
    p = record(p, q('y', ['Kinematics']), true);
    expect(weakestTopics(p).map((t) => t.topic)).toEqual(['Waves', 'Kinematics']);
  });

  it('puts questions from weak topics first and survives broken storage', () => {
    let p = emptyProgress();
    for (let i = 0; i < 4; i += 1) p = record(p, q('old', ['Waves']), false);
    for (let i = 0; i < 4; i += 1) p = record(p, q('ok', ['Kinematics']), true);
    const pool = [q('k1', ['Kinematics']), q('w1', ['Waves']), q('k2', ['Kinematics']), q('w2', ['Waves'])];
    const set = pickSet(pool, 2, p, 'weakest', () => 0.5);
    expect(set.map((s) => s.id).sort()).toEqual(['w1', 'w2']);
    expect(pickSet(pool, 10, p, 'random', () => 0.3)).toHaveLength(4);
    const store = memory();
    saveProgress(p, store);
    expect(loadProgress(store).topics.Waves.wrong).toBe(4);
    expect(loadProgress({ getItem: () => '{not json' })).toEqual(emptyProgress());
    expect(loadProgress({ getItem: () => { throw new Error('blocked'); } })).toEqual(emptyProgress());
  });
});
