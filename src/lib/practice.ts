import type { Question } from './catalog';

/**
 * Practice mode state, kept in this browser only (localStorage). Every access is guarded: storage
 * can be missing or blocked (private windows, strict settings), and practice must still work, just
 * without memory between visits.
 */

export interface Tally { right: number; wrong: number; last: number }
export interface Progress { version: 1; topics: Record<string, Tally>; questions: Record<string, Tally> }

const KEY = 'lrb.practice.v1';
const NO_TOPIC = 'Needs review';

export function emptyProgress(): Progress {
  return { version: 1, topics: {}, questions: {} };
}

export function loadProgress(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Progress {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return emptyProgress();
    const parsed = JSON.parse(raw) as Progress;
    if (parsed?.version !== 1 || typeof parsed.topics !== 'object' || typeof parsed.questions !== 'object') return emptyProgress();
    return parsed;
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: Progress, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try { storage?.setItem(KEY, JSON.stringify(progress)); } catch { /* storage full or blocked: keep going without memory */ }
}

export function clearProgress(storage: Pick<Storage, 'removeItem'> | undefined = safeStorage()): void {
  try { storage?.removeItem(KEY); } catch { /* nothing to clear */ }
}

function safeStorage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.localStorage; } catch { return undefined; }
}

export function topicsOf(question: Question): string[] {
  return question.topics.length ? question.topics : [NO_TOPIC];
}

/** Records one self-marked attempt; returns a new progress object. */
export function record(progress: Progress, question: Question, correct: boolean, now = Date.now()): Progress {
  const bump = (t: Tally | undefined): Tally => ({
    right: (t?.right ?? 0) + (correct ? 1 : 0),
    wrong: (t?.wrong ?? 0) + (correct ? 0 : 1),
    last: now,
  });
  const topics = { ...progress.topics };
  for (const t of topicsOf(question)) topics[t] = bump(topics[t]);
  return { ...progress, topics, questions: { ...progress.questions, [question.id]: bump(progress.questions[question.id]) } };
}

/** Share of attempts missed, smoothed so an untried topic sits in the middle (0.5). */
export function weakness(tally: Tally | undefined): number {
  return ((tally?.wrong ?? 0) + 1) / ((tally?.right ?? 0) + (tally?.wrong ?? 0) + 2);
}

/** Topics with at least one attempt, weakest first. */
export function weakestTopics(progress: Progress, limit = 5): { topic: string; score: number; attempts: number }[] {
  return Object.entries(progress.topics)
    .map(([topic, t]) => ({ topic, score: weakness(t), attempts: t.right + t.wrong }))
    .sort((a, b) => b.score - a.score || b.attempts - a.attempts)
    .slice(0, limit);
}

/**
 * Chooses a practice set. 'weakest' ranks questions by the weakness of their topics, favours
 * questions never attempted or last got wrong, and pushes recently correct ones back; a little
 * randomness keeps sets from repeating. 'random' is a plain shuffle.
 */
export function pickSet(questions: Question[], count: number, progress: Progress, mode: 'weakest' | 'random', random = Math.random): Question[] {
  if (mode === 'random') return shuffle(questions, random).slice(0, count);
  const scored = questions.map((q) => {
    const topic = Math.max(...topicsOf(q).map((t) => weakness(progress.topics[t])));
    const own = progress.questions[q.id];
    const history = !own ? 0.35 : own.wrong > own.right ? 0.5 : -0.4;
    return { q, score: topic + history + random() * 0.25 };
  });
  return scored.sort((a, b) => b.score - a.score).slice(0, count).map((s) => s.q);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
