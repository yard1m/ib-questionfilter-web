import { useCallback, useEffect, useRef, useState } from 'react';
import type { Slice } from '../lib/catalog';
import { openForRendering, renderSlice } from '../lib/render';
import topicsData from './topics.json';
import {
  buildDecisionLine,
  candidatesFor,
  keyIndex,
  type DossierSlice,
  type DossierUnit,
} from './triageLib';

/**
 * Dev-only Needs-review triage page (local tool).
 *
 * Served only by the development server in local-corpus mode
 * (`npm run dev:local`, open `?triage=1`). It is compiled out of production:
 * `main.tsx` loads it through a `DEV`-guarded dynamic import, and
 * `scripts/verify-bundle.mjs` fails the build if `TriagePage` or `__triage`
 * ever reaches `dist/`.
 *
 * For each dossier unit it renders the question crop and the markscheme crop
 * with `lib/render.ts` + `lib/geometry.ts`, shows the current reason and the
 * subject's approved topics with their book-section codes, and records
 * decisions through the dev-only `/__triage/decisions` endpoint (Vite
 * middleware in `vite.config.ts`), which appends
 * `.triage/decisions_<subject>.txt` in the exact format `apply.py` reads.
 *
 * Keys: `1`-`9` pick candidate topics, `N` keeps Needs review with a reason,
 * `S` skips the unit.
 */

const TOPICS: Record<string, { code: string; topic: string }[]> = topicsData as Record<
  string,
  { code: string; topic: string }[]
>;

function toSlice(slice: DossierSlice, horizontal: boolean): Slice {
  return {
    page: slice.page_index,
    lower: slice.lower,
    upper: slice.upper,
    left: horizontal && typeof slice.left === 'number' ? slice.left : null,
    right: horizontal && typeof slice.right === 'number' ? slice.right : null,
  };
}

async function renderCrop(
  host: HTMLElement,
  filePath: string | null,
  slices: DossierSlice[] | null,
  horizontal: boolean,
): Promise<void> {
  host.replaceChildren();
  if (!filePath || !slices || slices.length === 0) {
    host.textContent = 'No crop available.';
    return;
  }
  const response = await fetch(`/__triage/file?path=${encodeURIComponent(filePath)}`);
  if (!response.ok) {
    host.textContent = 'Could not load the source PDF.';
    return;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const { promise, destroy } = openForRendering(bytes);
  try {
    const doc = await promise;
    for (const slice of slices) {
      const canvas = await renderSlice(doc, toSlice(slice, horizontal), 640, window.devicePixelRatio || 1);
      host.appendChild(canvas);
    }
  } finally {
    await destroy();
  }
}

export function TriagePage() {
  const [units, setUnits] = useState<DossierUnit[]>([]);
  const [index, setIndex] = useState(0);
  const [lines, setLines] = useState<string[]>([]);
  const [nrReason, setNrReason] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const questionHost = useRef<HTMLDivElement>(null);
  const answerHost = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/__triage/dossier')
      .then((response) => {
        if (!response.ok) throw new Error('dossier missing');
        return response.json();
      })
      .then((data: DossierUnit[]) => setUnits(data))
      .catch(() => setLoadError('Run Scripts/needs_review_dossier.py first, then reload.'));
  }, []);

  const unit = units[index] ?? null;

  useEffect(() => {
    setLines([]);
    setNrReason('');
    setStatus(null);
    if (unit && questionHost.current && answerHost.current) {
      void renderCrop(questionHost.current, unit.paperFile, unit.questionSlices, false);
      void renderCrop(answerHost.current, unit.markschemeFile, unit.answerSlices, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, units.length]);

  const subjectTopics = unit ? (TOPICS[unit.subject.toLowerCase()] ?? []) : [];
  const candidates = candidatesFor([], subjectTopics.map((entry) => `${entry.code} ${entry.topic}`));

  const submit = useCallback(async (decisionLines: string[]) => {
    if (!unit || decisionLines.length === 0) return;
    const response = await fetch('/__triage/decisions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unit: unit.unit, subject: unit.subject, lines: decisionLines }),
    });
    if (response.ok) {
      setStatus(`Recorded ${decisionLines.length} line(s) for ${unit.unit}.`);
      setLines([]);
      setIndex((i) => Math.min(i + 1, units.length - 1));
    } else {
      const body = await response.text();
      setStatus(`Not recorded (${response.status}): ${body.slice(0, 200)}`);
    }
  }, [unit, units.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!unit) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const candidate = keyIndex(event.key);
      if (candidate !== null && candidates[candidate]) {
        const [code] = candidates[candidate].split(' ');
        const reason = window.prompt(`Reason for ${code} (names the marked part, 40+ characters):`, '');
        if (reason && reason.trim().length >= 40) {
          setLines((prev) => [...prev, buildDecisionLine(code, reason.trim())]);
        } else if (reason !== null) {
          setStatus('The reason needs at least 40 characters.');
        }
        return;
      }
      if (event.key === 'N' || event.key === 'n') {
        const reason = window.prompt('Reason it stays Needs review (40+ characters):', nrReason || '');
        if (reason && reason.trim().length >= 40) {
          void submit([buildDecisionLine('NR', reason.trim())]);
        } else if (reason !== null) {
          setStatus('The reason needs at least 40 characters.');
        }
        return;
      }
      if (event.key === 'S' || event.key === 's') {
        setIndex((i) => Math.min(i + 1, units.length - 1));
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [unit, candidates, nrReason, submit, units.length]);

  if (loadError) {
    return <main className="panel"><h1>Triage</h1><p className="error">{loadError}</p></main>;
  }
  if (!unit) {
    return <main className="panel"><h1>Triage</h1><p className="muted">Loading the dossier…</p></main>;
  }

  return (
    <main className="panel">
      <h1>Triage ({index + 1} of {units.length})</h1>
      <p className="muted small">{unit.unit} · {unit.year} {unit.paperType} · pages {unit.questionPages.join(', ')}</p>
      {unit.members.map((member) => (
        <p key={`${member.sourceFile}::${member.questionNumber}`} className="muted small">
          {member.sourceFile} {member.questionNumber} — {member.reason}
        </p>
      ))}
      <div className="triage-crops">
        <div><h2>Question</h2><div ref={questionHost} /></div>
        <div><h2>Markscheme</h2><div ref={answerHost} /></div>
      </div>
      <h2>Topics ({unit.subject})</h2>
      <ol>
        {candidates.slice(0, 9).map((candidate, i) => (
          <li key={candidate}>{i + 1}. {candidate}</li>
        ))}
      </ol>
      <p className="muted small">Keys 1-9 pick topics, N keeps Needs review with a reason, S skips.</p>
      {lines.length > 0 && (
        <div>
          <h2>Decision for {unit.unit}</h2>
          <pre>{lines.join('\n')}</pre>
          <button type="button" className="btn" onClick={() => { void submit(lines); }}>Record decision</button>
          <button type="button" className="btn secondary" onClick={() => setLines([])}>Clear</button>
        </div>
      )}
      <label className="field">
        <span>NR reason draft (or press N)</span>
        <input value={nrReason} onChange={(e) => setNrReason(e.target.value)} />
      </label>
      {status && <p className="status ok" role="status">{status}</p>}
    </main>
  );
}
