import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalog, Question } from '../lib/catalog';
import { questionTitle } from '../lib/catalog';
import {
  defaultFilters, filterQuestions, pruneSelection, setTopicMode, toggleFacet, toggleTopic, type Filters,
} from '../lib/filter';
import type { DesignMode } from '../lib/design';
import { DesignToggle } from './DesignToggle';
import { Preview } from './Preview';
import { TopicStats } from './TopicStats';
import { Practice } from './Practice';

type LoadPdf = (key: string) => Promise<Uint8Array>;

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

function download(bytes: Uint8Array, filename: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/pdf' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function formatSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function QuestionBrowser({ catalog, loadPdf, account, onSignOut, designMode, onDesignModeChange, accountTools, stamp, onActivity, isAdmin = false }: {
  catalog: Catalog;
  loadPdf: LoadPdf;
  account: string;
  onSignOut: () => void;
  designMode: DesignMode;
  onDesignModeChange: (mode: DesignMode) => void;
  /** Password change, and member management for admins; opened from the Account button. */
  accountTools?: ReactNode;
  /** Printed at the foot of every exported page (the account name and date). */
  stamp?: string;
  isAdmin?: boolean;
  /** Counts previews and exports for the admin panel's usage columns. */
  onActivity?: (kind: 'preview' | 'export' | 'markscheme', subject: string, items: number) => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [subjectId, setSubjectId] = useState(catalog.subjects[0]?.id ?? '');
  const subject = catalog.subjects.find((s) => s.id === subjectId) ?? catalog.subjects[0];
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(subject));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withMarkscheme, setWithMarkscheme] = useState(true);
  // Clean layout (trimmed crops on A4 with header, footer and watermark) is the default; the
  // original layout stays available. The choice is remembered per browser.
  const [cleanLayout, setCleanLayout] = useState(() => {
    try { return window.localStorage.getItem('ibqf.exportLayout') !== 'original'; } catch { return true; }
  });
  const [adminFormat, setAdminFormat] = useState(true);
  const [showStats, setShowStats] = useState(false);
  const [practising, setPractising] = useState(false);
  const closePractice = useCallback(() => setPractising(false), []);
  const unmarked = isAdmin && adminFormat;
  const siteUrl = `${window.location.origin}${import.meta.env.BASE_URL}`;
  const chooseLayout = (clean: boolean) => {
    setCleanLayout(clean);
    try { window.localStorage.setItem('ibqf.exportLayout', clean ? 'clean' : 'original'); } catch { /* per-browser convenience only */ }
  };
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number } | null>(null);
  const cancelRef = useRef(false);
  // Timing for the progress panel: when the export and the current stage started.
  const startedRef = useRef(0);
  const stageStartedRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  const [preview, setPreview] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [busy]);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const closePreview = useCallback(() => setPreview(null), []);

  const visible = useMemo(() => filterQuestions(catalog.questions, subject.id, filters), [catalog, subject, filters]);

  const update = useCallback((next: Filters) => {
    setFilters(next);
    setSelected((prev) => pruneSelection(prev, filterQuestions(catalog.questions, subject.id, next)));
    setMessage(null);
  }, [catalog, subject]);

  function chooseSubject(id: string) {
    const next = catalog.subjects.find((s) => s.id === id);
    if (!next) return;
    setSubjectId(id);
    setFilters(defaultFilters(next));
    setSelected(new Set());
    setMessage(null);
  }

  function toggleQuestion(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMessage(null);
  }

  const chosen = visible.filter((q) => selected.has(q.id));
  const answers = chosen.filter((q) => q.answerSlices).length;
  const pagesToCompile = new Set(chosen.flatMap((q) => q.questionSlices.map((slice) => `${q.id}:${slice.page}`))).size;

  async function exportSelection() {
    if (!chosen.length || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const { exportMarkscheme, exportQuestions, exportQuestionsClean, decorateExport } = await import('../lib/exportPdf');
      // Fetch every paper the export needs up front, several at a time; the builders then read
      // them from the in-memory cache. One at a time took minutes for a large selection.
      const keys = [...new Set(chosen.flatMap((q) => [
        q.document.paperKey,
        ...(withMarkscheme && q.answerSlices && q.document.markschemeKey ? [q.document.markschemeKey] : []),
      ]))];
      let done = 0;
      cancelRef.current = false;
      startedRef.current = Date.now();
      stageStartedRef.current = Date.now();
      setProgress({ stage: 'Downloading papers', done: 0, total: keys.length });
      const queue = [...keys];
      const worker = async () => {
        for (let key = queue.shift(); key; key = queue.shift()) {
          if (cancelRef.current) throw new Error('cancelled');
          await Promise.race([
            loadPdf(key),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 90_000)),
          ]);
          done += 1;
          setProgress({ stage: 'Downloading papers', done, total: keys.length });
        }
      };
      await Promise.all(Array.from({ length: Math.min(6, keys.length) }, worker));
      if (cancelRef.current) throw new Error('cancelled');
      stageStartedRef.current = Date.now();
      setProgress({ stage: 'Building PDFs', done: keys.length, total: keys.length });
      const base = `${subject.name} Filtered Questions`;
      const [{ openForRendering }, { pdfContentCheck }] = await Promise.all([import('../lib/render'), import('../lib/sliceContent')]);
      const content = pdfContentCheck(loadPdf, openForRendering);
      let text: string;
      try {
        const exportedAt = new Date();
        const questions = cleanLayout
          ? await exportQuestionsClean(chosen, loadPdf, base, { subject: subject.name, stamp, exportedAt, contentBox: content.contentBox, admin: unmarked, siteUrl })
          : await exportQuestions(chosen, loadPdf, base, stamp, content.hasContent);
        onActivity?.('export', subject.id, chosen.length);
        download(questions.bytes, `${base}.pdf`);
        text = `Exported ${questions.exported} question${questions.exported === 1 ? '' : 's'} (${questions.pages} pages).`;
        if (withMarkscheme) {
          const markscheme = await exportMarkscheme(chosen, loadPdf, `${base} Markscheme`, cleanLayout ? undefined : stamp, content.hasContent, cleanLayout ? content.contentBox : undefined);
          const markschemeBytes = cleanLayout
            ? await decorateExport(markscheme.bytes, `${base} Markscheme`, { subject: subject.name, stamp, exportedAt, admin: unmarked, siteUrl })
            : markscheme.bytes;
          onActivity?.('markscheme', subject.id, chosen.length);
          download(markschemeBytes, `${base} Markscheme.pdf`);
          text += ` Markscheme: ${markscheme.exported} answer${markscheme.exported === 1 ? '' : 's'}`;
          text += markscheme.skipped.length ? `, ${markscheme.skipped.length} listed for manual review.` : '.';
        }
      } finally {
        await content.close();
      }
      setMessage({ kind: 'ok', text: `${text} Took ${formatSeconds(Date.now() - startedRef.current)}.` });
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'cancelled'
        ? { kind: 'ok', text: 'Export cancelled.' }
        : { kind: 'error', text: error instanceof Error && error.message === 'timeout'
          ? 'A paper took too long to download. Check your connection and try again.'
          : 'The export failed. Try again, or select fewer questions.' });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }

  const facet = <T extends string | number>(legend: string, values: T[], chosenValues: Set<T>, key: 'years' | 'sessions' | 'levels' | 'papers') => (
    values.length > 1 ? (
      <fieldset>
        <legend>{legend}</legend>
        {values.map((value) => (
          <ToggleRow key={String(value)} label={String(value)} checked={chosenValues.has(value)}
            onChange={() => update({ ...filters, [key]: toggleFacet(chosenValues, value) })} />
        ))}
      </fieldset>
    ) : null
  );

  return (
    <>
      <header className="app">
        <div className="app-topline">
          <div className="archive-kicker" aria-hidden="true">L.R.B. &nbsp; ARCHIVUM QUAESTIONUM &nbsp; · &nbsp; ACCESS BY INVITATION</div>
          <div className="account">
            <span className="muted small account-name">{account}</span>
            <DesignToggle mode={designMode} onChange={onDesignModeChange} />
            {accountTools && (
              <button type="button" className="btn secondary" aria-expanded={accountOpen} onClick={() => setAccountOpen((open) => !open)}>
                Account
              </button>
            )}
            <button type="button" className="btn secondary" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
        <div className="masthead">
          <div className="app-title">
            <div className="archive-wordmark" aria-hidden="true">LITTLE <strong>RED</strong> BANK</div>
            <h1>IB Question Filter</h1>
            <p className="archive-subtitle" aria-hidden="true">
              <span>Question archive</span><span>Filter</span><span>Compile</span><span>Issue MMXXVI</span>
            </p>
            <div className="archive-attribution" aria-label="Site attribution">
              <div className="archive-motto">OMNIBUS PATEAT AEQUA VIA AD SCIENTIAM!</div>
              <div className="archive-credit">Built By yard1m_42</div>
            </div>
          </div>
          <div className="archive-seal" role="img" aria-label="aleph-null"><span aria-hidden="true">ℵ₀</span></div>
        </div>
        <nav className="subjects" aria-label="Subject">
          {catalog.subjects.map((s, index) => (
            <button key={s.id} type="button" aria-pressed={s.id === subject.id} onClick={() => chooseSubject(s.id)}>
              <span className="subject-index" aria-hidden="true">{['I', 'II', 'III'][index] ?? String(index + 1)}</span>
              <span>{s.name}{s.id === 'mathematics' ? ' AA' : ''}</span>
            </button>
          ))}
        </nav>
      </header>
      {accountTools && accountOpen && <section className="layout account-tools" aria-label="Account">{accountTools}</section>}

      <div className="layout">
        <aside className={`panel filters${filtersOpen ? ' open' : ''}`} aria-label="Filters">
          <button type="button" className="btn secondary filters-toggle" aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}>
            {filtersOpen ? 'Hide filters' : 'Show filters'}
          </button>
          <div className="filters-body">
            {facet('Examination year', subject.years, filters.years, 'years')}
            {facet('Session', subject.sessions, filters.sessions, 'sessions')}
            {facet('Level', subject.levels, filters.levels, 'levels')}
            {facet('Paper', subject.papers, filters.papers, 'papers')}
            <fieldset>
              <legend>
                Topics
                {filters.topics.size > 0 && (
                  <button type="button" className="link" onClick={() => update({ ...filters, topics: new Set() })}>Clear</button>
                )}
              </legend>
              <label className="check switch">
                <input type="checkbox" checked={filters.requireAllTopics}
                  onChange={(e) => update(setTopicMode(filters, 'requireAllTopics', e.target.checked))} />
                <span>Require every selected topic</span>
              </label>
              <label className="check switch">
                <input type="checkbox" checked={filters.onlySelectedTopics}
                  onChange={(e) => update(setTopicMode(filters, 'onlySelectedTopics', e.target.checked))} />
                <span>Only selected topics <small>Exclude questions with unselected extra topics.</small></span>
              </label>
              <div className="topics">
                {subject.topics.map((topic) => (
                  <ToggleRow key={topic} label={topic} checked={filters.topics.has(topic)}
                    onChange={() => update({ ...filters, topics: toggleTopic(filters.topics, topic) })} />
                ))}
              </div>
            </fieldset>
            <button type="button" className="btn secondary" onClick={() => update(defaultFilters(subject))}>Reset filters</button>
          </div>
        </aside>

        <main>
          <section className="archive-stats" aria-label="Selection summary">
            <div><strong>{visible.length}</strong><span>IN SCOPE</span></div>
            <div><strong>{chosen.length}</strong><span>SELECTED</span></div>
            <div><strong>{answers}</strong><span>MARKSCHEME ANSWERS</span></div>
            <div><strong>{pagesToCompile}</strong><span>PAGES TO COMPILE</span></div>
          </section>
          <div className="toolbar">
            <div className="toolbar-row">
              <div className="count">
                <strong>{visible.length} matching question{visible.length === 1 ? '' : 's'}</strong>
                <span className="muted small">
                  {chosen.length} selected{chosen.length ? ` · ${answers} markscheme answer${answers === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              <div className="toolbar-actions">
                <button type="button" className="btn secondary" disabled={!visible.length}
                  onClick={() => setSelected(new Set(visible.map((q) => q.id)))}>Select filtered</button>
                <button type="button" className="btn secondary" disabled={!chosen.length}
                  onClick={() => setSelected(new Set())}>Clear selection</button>
                <button type="button" className="btn secondary" aria-expanded={showStats} disabled={!visible.length}
                  onClick={() => setShowStats((open) => !open)}>{showStats ? 'Hide topic stats' : 'Topic stats'}</button>
                <button type="button" className="btn secondary" disabled={!visible.length}
                  title="One question at a time with the markscheme; progress is saved in this browser."
                  onClick={() => setPractising(true)}>Practice</button>
              </div>
            </div>
            <div className="toolbar-row toolbar-export">
              <div className="toolbar-options">
                <label className="check inline">
                  <input type="checkbox" checked={withMarkscheme} disabled={busy} onChange={(e) => setWithMarkscheme(e.target.checked)} />
                  <span>Markscheme PDF</span>
                </label>
                <label className="check inline" title="Trimmed questions on A4 pages with labels, page numbers and a watermark. Untick for the original layout.">
                  <input type="checkbox" checked={cleanLayout} disabled={busy} onChange={(e) => chooseLayout(e.target.checked)} />
                  <span>Clean layout</span>
                </label>
                {isAdmin && cleanLayout && (
                  <label className="check inline" title="Admin accounts only: no watermark and no sharing stamp.">
                    <input type="checkbox" checked={adminFormat} disabled={busy} onChange={(e) => setAdminFormat(e.target.checked)} />
                    <span>Admin format (no watermark)</span>
                  </label>
                )}
              </div>
              <button type="button" className="btn export-btn" disabled={!chosen.length || busy} onClick={exportSelection}>
                {busy ? 'Exporting…' : chosen.length ? `Export ${chosen.length} question${chosen.length === 1 ? '' : 's'}` : 'Export PDF'}
              </button>
            </div>
          </div>
          {showStats && (
            <section className="panel stats-panel" aria-label="Topic statistics">
              <TopicStats questions={visible} />
            </section>
          )}
          {busy && progress && (
            <div className="export-progress" role="status" aria-live="polite">
              <div className="export-progress-head">
                <span>{progress.stage}</span>
                <span>{progress.done}/{progress.total} papers · {Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%</span>
              </div>
              <div className="export-progress-head muted small">
                <span>
                  {progress.stage === 'Building PDFs'
                    ? `Building for ${formatSeconds(now - stageStartedRef.current)}`
                    : progress.done > 0 && progress.done < progress.total
                      ? `About ${formatSeconds(((now - stageStartedRef.current) / progress.done) * (progress.total - progress.done))} left`
                      : 'Estimating time…'}
                </span>
                <span>Elapsed {formatSeconds(now - startedRef.current)}</span>
              </div>
              <div className="export-progress-track">
                <div className={`export-progress-bar${progress.stage === 'Building PDFs' ? ' building' : ''}`}
                  style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
              <button type="button" className="link" onClick={() => { cancelRef.current = true; }}>Cancel</button>
            </div>
          )}
          {message && <div className={`status ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}

          {visible.length === 0 ? (
            <div className="panel empty">
              <p><strong>No matching questions</strong></p>
              <p className="muted">
                {filters.onlySelectedTopics && filters.topics.size === 0
                  ? '"Only selected topics" needs at least one selected topic.'
                  : 'Adjust the selected filters to see more questions.'}
              </p>
            </div>
          ) : (
            <ul className="qlist">
              {visible.map((q, index) => (
                <li key={q.id} className={`qcard${selected.has(q.id) ? ' selected' : ''}`}>
                  <input type="checkbox" checked={selected.has(q.id)} onChange={() => toggleQuestion(q.id)}
                    aria-label={`Select ${questionTitle(q)}`} />
                  <span className="qnumber" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <div className="qinfo">
                    <div className="qtitle">{questionTitle(q)}</div>
                    <div className="qtopics">
                      {q.topics.map((t) => <span key={t} className={`tag${t === 'Needs review' ? ' review' : ''}`}>{t}</span>)}
                    </div>
                    <div className="muted small">
                      {q.answerSlices ? 'Markscheme answer available' : 'Markscheme: not available for this question'}
                    </div>
                    {q.references.length > 1 && (
                      <div className="muted small">
                        Appears in: {q.references.map((r) => `${r.question}, ${r.page}, ${r.paper}, ${r.sourceFile.replace(/\.pdf$/i, '')}`).join('; ')}
                      </div>
                    )}
                  </div>
                  <button type="button" className="btn secondary qaction" onClick={() => { setPreview(q); onActivity?.('preview', subject.id, 1); }}>
                    <span className="classic-action">Preview</span>
                    <span className="archive-action">Read</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      {preview && <Preview question={preview} loadPdf={loadPdf} onClose={closePreview} />}
      {practising && <Practice pool={chosen.length ? chosen : visible} loadPdf={loadPdf} onClose={closePractice} />}
    </>
  );
}
