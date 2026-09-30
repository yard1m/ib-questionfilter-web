import { useEffect, useMemo, useRef, useState } from 'react';
import type { Question, Slice } from '../lib/catalog';
import { questionTitle } from '../lib/catalog';
import { clearProgress, loadProgress, pickSet, record, saveProgress, topicsOf, weakestTopics, type Progress } from '../lib/practice';

type LoadPdf = (key: string) => Promise<Uint8Array>;

/** Renders the given slices of one PDF into a host element (question or markscheme). */
function Slices({ pdfKey, slices, loadPdf, label, onReadyChange }: { pdfKey: string; slices: Slice[]; loadPdf: LoadPdf; label: string; onReadyChange: (ready: boolean) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    host.current?.replaceChildren();
    setState('loading');
    onReadyChange(false);
    (async () => {
      try {
        const { openForRendering, renderSlice } = await import('../lib/render');
        const bytes = await loadPdf(pdfKey);
        if (cancelled) return;
        const opened = openForRendering(bytes);
        destroy = () => { void opened.destroy(); };
        const doc = await opened.promise;
        const target = host.current;
        if (!target || cancelled) return;
        const width = Math.min(820, target.clientWidth || 820);
        const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
        target.replaceChildren();
        for (const slice of slices) {
          const canvas = await renderSlice(doc, slice, width, ratio);
          if (cancelled) return;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', label);
          target.appendChild(canvas);
        }
        setState('ready');
        onReadyChange(slices.length > 0);
      } catch {
        if (!cancelled) {
          host.current?.replaceChildren();
          setState('error');
          onReadyChange(false);
        }
      }
    })();
    return () => { cancelled = true; destroy?.(); };
  }, [pdfKey, slices, loadPdf, label, onReadyChange]);
  return (
    <>
      {state === 'loading' && <p className="muted" role="status">Loading…</p>}
      {state === 'error' && <p className="error" role="alert">This could not be displayed.</p>}
      <div className="slices" ref={host} />
    </>
  );
}

const COUNTS = [5, 10, 20, 40];

/**
 * Practice mode: one question at a time, reveal the markscheme, self-mark. Progress is kept in
 * this browser (localStorage) and steers the next set towards weak topics.
 */
export function Practice({ pool, loadPdf, onClose }: { pool: Question[]; loadPdf: LoadPdf; onClose: () => void }) {
  const [progress, setProgress] = useState<Progress>(() => loadProgress());
  const [count, setCount] = useState(10);
  const [mode, setMode] = useState<'weakest' | 'random'>('weakest');
  const [set, setSet] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [questionReady, setQuestionReady] = useState(false);
  const [answerReady, setAnswerReady] = useState(false);
  const [results, setResults] = useState<{ question: Question; correct: boolean | null }[]>([]);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const weakest = useMemo(() => weakestTopics(progress, 5), [progress]);
  const start = () => {
    setSet(pickSet(pool, Math.min(count, pool.length), progress, mode));
    setIndex(0); setRevealed(false); setResults([]); setQuestionReady(false); setAnswerReady(false);
  };
  const answer = (correct: boolean | null) => {
    if (!set) return;
    if (correct !== null && (!questionReady || !answerReady)) return;
    const question = set[index];
    if (correct !== null) {
      const next = record(progress, question, correct);
      setProgress(next);
      saveProgress(next);
    }
    setResults((r) => [...r, { question, correct }]);
    setIndex((i) => i + 1);
    setRevealed(false);
    setQuestionReady(false);
    setAnswerReady(false);
  };
  const reset = () => {
    if (!window.confirm('Clear all practice history saved in this browser?')) return;
    clearProgress();
    setProgress(loadProgress());
  };

  const current = set && index < set.length ? set[index] : null;
  const finished = set && index >= set.length;
  const marked = results.filter((r) => r.correct !== null);
  const right = marked.filter((r) => r.correct).length;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal practice" role="dialog" aria-modal="true" aria-labelledby="practice-title">
        <div className="modal-head">
          <h2 id="practice-title">
            {current ? `Practice · ${index + 1} of ${set!.length}` : finished ? 'Practice complete' : 'Practice'}
          </h2>
          <button ref={closeButton} type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>

        {!set && (
          <div className="practice-setup">
            <p className="muted">
              {pool.length} question{pool.length === 1 ? '' : 's'} available from your current {pool.length ? 'filters or selection' : 'filters'}.
              Progress is saved in this browser only.
            </p>
            <fieldset>
              <legend>How many questions</legend>
              <div className="practice-choices">
                {COUNTS.map((n) => (
                  <label key={n} className="check inline">
                    <input type="radio" name="practice-count" checked={count === n} onChange={() => setCount(n)} />
                    <span>{n}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend>Order</legend>
              <div className="practice-choices">
                <label className="check inline"><input type="radio" name="practice-mode" checked={mode === 'weakest'} onChange={() => setMode('weakest')} /><span>Weakest topics first</span></label>
                <label className="check inline"><input type="radio" name="practice-mode" checked={mode === 'random'} onChange={() => setMode('random')} /><span>Random</span></label>
              </div>
            </fieldset>
            {weakest.length > 0 && (
              <div className="practice-weak">
                <h3>Your weakest topics so far</h3>
                <ul>{weakest.map((w) => <li key={w.topic}>{w.topic} <span className="muted small">· {Math.round((1 - w.score) * 100)}% · {w.attempts} tried</span></li>)}</ul>
              </div>
            )}
            <div className="practice-actions">
              <button type="button" className="btn" disabled={!pool.length} onClick={start}>Start practice</button>
              {Object.keys(progress.questions).length > 0 && <button type="button" className="btn secondary" onClick={reset}>Reset progress</button>}
            </div>
          </div>
        )}

        {current && (
          <div className="practice-question">
            <p className="practice-meta">
              <strong>{questionTitle(current)}</strong>
              <span className="qtopics">{topicsOf(current).map((t) => <span key={t} className="tag">{t}</span>)}</span>
            </p>
            <Slices key={current.id} pdfKey={current.document.paperKey} slices={current.questionSlices} loadPdf={loadPdf} label={`${current.label} question`} onReadyChange={setQuestionReady} />
            {revealed && (
              <div className="practice-answer">
                <h3>Markscheme</h3>
                {current.answerSlices && current.document.markschemeKey
                  ? <Slices key={current.id} pdfKey={current.document.markschemeKey} slices={current.answerSlices} loadPdf={loadPdf} label={`${current.label} markscheme`} onReadyChange={setAnswerReady} />
                  : <p className="muted">{current.answerSkipReason ?? 'No markscheme answer is available for this question.'}</p>}
              </div>
            )}
            <div className="practice-actions sticky">
              {!revealed
                ? <button type="button" className="btn" disabled={!questionReady} onClick={() => setRevealed(true)}>Show markscheme</button>
                : <>
                    <button type="button" className="btn practice-right" disabled={!questionReady || !answerReady} onClick={() => answer(true)}>Got it</button>
                    <button type="button" className="btn practice-wrong" disabled={!questionReady || !answerReady} onClick={() => answer(false)}>Missed it</button>
                  </>}
              <button type="button" className="btn secondary" onClick={() => answer(null)}>Skip</button>
            </div>
          </div>
        )}

        {finished && (
          <div className="practice-setup">
            <p className="practice-score"><strong>{right}</strong> of {marked.length} marked correct{results.length > marked.length ? ` · ${results.length - marked.length} skipped` : ''}</p>
            <ul className="practice-results">
              {results.map((r) => (
                <li key={r.question.id} className={r.correct === null ? 'skipped' : r.correct ? 'right' : 'wrong'}>
                  <span>{r.correct === null ? '–' : r.correct ? '✓' : '✗'}</span> {questionTitle(r.question)}
                </li>
              ))}
            </ul>
            {weakest.length > 0 && (
              <div className="practice-weak">
                <h3>Weakest topics</h3>
                <ul>{weakest.map((w) => <li key={w.topic}>{w.topic} <span className="muted small">· {Math.round((1 - w.score) * 100)}%</span></li>)}</ul>
              </div>
            )}
            <div className="practice-actions">
              <button type="button" className="btn" onClick={start}>Practise again</button>
              <button type="button" className="btn secondary" onClick={() => setSet(null)}>Change settings</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
