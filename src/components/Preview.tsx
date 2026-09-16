import { useEffect, useRef, useState } from 'react';
import type { Question } from '../lib/catalog';
import { questionTitle } from '../lib/catalog';

/** Shows only the chosen question: its slices, rendered from the private source paper. */
export function Preview({ question, loadPdf, onClose }: {
  question: Question;
  loadPdf: (key: string) => Promise<Uint8Array>;
  onClose: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const { openForRendering, renderSlice } = await import('../lib/render');
        const bytes = await loadPdf(question.document.paperKey);
        const opened = openForRendering(bytes);
        destroy = () => { void opened.destroy(); };
        const doc = await opened.promise;
        const target = host.current;
        if (!target || cancelled) return;
        const width = Math.min(820, target.clientWidth || 820);
        const ratio = Math.min(window.devicePixelRatio || 1, 2.5);
        target.replaceChildren();
        for (const slice of question.questionSlices) {
          const canvas = await renderSlice(doc, slice, width, ratio);
          if (cancelled) return;
          canvas.setAttribute('role', 'img');
          canvas.setAttribute('aria-label', `${question.label}, page ${slice.page + 1}`);
          target.appendChild(canvas);
        }
        if (!cancelled) setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => { cancelled = true; destroy?.(); };
  }, [question, loadPdf]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="preview-title">
        <div className="modal-head">
          <h2 id="preview-title">{questionTitle(question)}</h2>
          <button ref={closeButton} type="button" className="btn secondary" onClick={onClose}>Close</button>
        </div>
        {state === 'loading' && <p className="muted" role="status">Loading question…</p>}
        {state === 'error' && <p className="error" role="alert">The question could not be displayed. Try again.</p>}
        <div className="slices" ref={host} />
      </div>
    </div>
  );
}
