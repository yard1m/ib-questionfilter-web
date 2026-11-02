import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalog, Question } from '../lib/catalog';
import { questionTitle } from '../lib/catalog';
import { exportDetail } from '../lib/activity';

/** "Paper 1 HL TZ2 · May 2024" for the admin activity log. */
const paperOf = (q: Question) => questionTitle(q).split(' · ').slice(1).join(' · ');
import {
  cycleTopic, defaultFilters, filterQuestions, isHlOnly, pruneSelection, setTopicMode, toggleFacet, topicState, type Filters, type TopicState,
} from '../lib/filter';
import type { DesignMode } from '../lib/design';
import { DesignToggle } from './DesignToggle';
import { Preview } from './Preview';
import { TopicStats } from './TopicStats';
import { Practice } from './Practice';

import type { LoadPages, LoadPdf } from '../lib/slicePages';
import { matchesSearch, searchIndex, searchTerms, type SearchTexts } from '../lib/search';
import { MAX_SAVED_QUESTIONS, type SavedSelection, type SavedSelectionStore } from '../lib/savedSelections';

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  );
}

const TOPIC_STATE_LABEL: Record<TopicState, string> = { off: 'not selected', required: 'required', secondary: 'also allowed' };

/** A topic row that cycles off -> required -> secondary (also allowed) -> off. */
function TopicRow({ label, state, onCycle }: { label: string; state: TopicState; onCycle: () => void }) {
  return (
    <button type="button" className={`topic-row ${state}`} onClick={onCycle}
      aria-label={`${label}: ${TOPIC_STATE_LABEL[state]}. Click to change.`}>
      <span className="topic-mark" aria-hidden="true">{state === 'required' ? '✓' : state === 'secondary' ? '+' : ''}</span>
      <span className="topic-name">{label}</span>
      {state !== 'off' && <span className="topic-badge">{state === 'required' ? 'Required' : 'Also allowed'}</span>}
    </button>
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

/** Settles like `work`, but rejects with Error('timeout') after `ms`, or with the abort reason. */
function limited<T>(work: () => Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const finish = (error: unknown, value?: T) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      if (error !== undefined) reject(error);
      else resolve(value as T);
    };
    const onAbort = () => finish(signal.reason);
    const timer = setTimeout(() => finish(new Error('timeout')), ms);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    else Promise.resolve().then(work).then((value) => finish(undefined, value), (error) => finish(error ?? new Error('Download failed')));
  });
}

function formatSeconds(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
}

export function QuestionBrowser({ catalog, loadPdf, loadPages, loadSearch, savedSelections, account, onSignOut, designMode, onDesignModeChange, accountTools, stamp, onActivity, isAdmin = false }: {
  catalog: Catalog;
  loadPdf: LoadPdf;
  /** Fetches just some pages of a paper; exports fall back to whole papers without it. */
  loadPages?: LoadPages;
  /** Downloads the question texts for word search (first search only). */
  loadSearch?: () => Promise<SearchTexts>;
  /** Named question sets kept with the account. */
  savedSelections?: SavedSelectionStore;
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
  onActivity?: (kind: 'preview' | 'export' | 'markscheme', subject: string, items: number, detail?: string) => void;
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
  const [progress, setProgress] = useState<{ stage: string; done: number; total: number; detail: string } | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  useEffect(() => () => { cancelRef.current?.abort(); }, []);
  // Timing for the progress panel: when the export started.
  const startedRef = useRef(0);
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

  const filtered = useMemo(() => filterQuestions(catalog.questions, subject.id, filters), [catalog, subject, filters]);
  // Word search narrows what is shown, but never drops ticked questions: a student can search, tick,
  // and search again. Without the downloaded texts it still matches labels, papers and topics.
  const [query, setQuery] = useState('');
  const [searchTexts, setSearchTexts] = useState<SearchTexts | null>(null);
  const [searchState, setSearchState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const loadSearchTexts = useCallback(() => {
    if (!loadSearch || searchState === 'loading' || searchState === 'ready') return;
    setSearchState('loading');
    loadSearch().then((texts) => { setSearchTexts(texts); setSearchState('ready'); }, () => setSearchState('error'));
  }, [loadSearch, searchState]);
  const index = useMemo(() => searchIndex(catalog.questions, searchTexts ?? {}), [catalog, searchTexts]);
  const terms = useMemo(() => searchTerms(query), [query]);
  const visible = useMemo(() => (terms.length ? filtered.filter((q) => matchesSearch(index.get(q.id), terms)) : filtered), [filtered, index, terms]);

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
    setQuery('');
    setMessage(null);
  }

  // Saved sets: loading one resets the filters and search so every saved question is in scope.
  const [showSaved, setShowSaved] = useState(false);
  const [sets, setSets] = useState<SavedSelection[] | null>(null);
  const [setName, setSetName] = useState('');
  const [setsMessage, setSetsMessage] = useState<string | null>(null);
  const refreshSets = useCallback(() => {
    if (!savedSelections) return;
    savedSelections.list().then(setSets, () => setSetsMessage('Saved sets could not be loaded. Try again.'));
  }, [savedSelections]);
  useEffect(() => { if (showSaved && sets === null) refreshSets(); }, [showSaved, sets, refreshSets]);
  const subjectSets = (sets ?? []).filter((s) => s.subject === subject.id);
  const questionsOf = (set: SavedSelection) => {
    const ids = new Set(set.questionIds);
    return filterQuestions(catalog.questions, subject.id, defaultFilters(subject)).filter((q) => ids.has(q.id));
  };
  async function saveSet() {
    if (!savedSelections || !chosen.length) return;
    const name = setName.trim() || `Set ${subjectSets.length + 1}`;
    setSetsMessage(null);
    try {
      await savedSelections.save(subject.id, name, chosen.map((q) => q.id));
      setSetName('');
      setSetsMessage(`Saved “${name}” (${Math.min(chosen.length, MAX_SAVED_QUESTIONS)} questions).`);
      refreshSets();
    } catch {
      setSetsMessage('The set could not be saved. Try again.');
    }
  }
  function loadSet(set: SavedSelection): Question[] {
    const list = questionsOf(set);
    setFilters(defaultFilters(subject));
    setQuery('');
    setSelected(new Set(list.map((q) => q.id)));
    setMessage(null);
    setSetsMessage(list.length < set.questionIds.length
      ? `Loaded “${set.name}”: ${list.length} of ${set.questionIds.length} questions are still in the bank.`
      : `Loaded “${set.name}” (${list.length} questions).`);
    return list;
  }
  async function deleteSet(set: SavedSelection) {
    if (!savedSelections || !window.confirm(`Delete the saved set “${set.name}”?`)) return;
    try { await savedSelections.remove(set.id); refreshSets(); } catch { setSetsMessage('The set could not be deleted. Try again.'); }
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

  const chosen = filtered.filter((q) => selected.has(q.id));
  const hiddenChosen = chosen.length - visible.filter((q) => selected.has(q.id)).length;
  const answers = chosen.filter((q) => q.answerSlices).length;
  const pagesToCompile = new Set(chosen.flatMap((q) => q.questionSlices.map((slice) => `${q.id}:${slice.page}`))).size;

  async function exportSelection(list: Question[] = chosen) {
    if (!list.length || busy) return;
    const controller = new AbortController();
    cancelRef.current = controller;
    const { signal } = controller;
    setBusy(true);
    setMessage(null);
    try {
      const [{ exportMarkscheme, exportQuestions, exportQuestionsClean }, { pagePlan, subsetPdf }, { renderWorkers }, { pdfContentCheck }] = await Promise.all([
        import('../lib/exportPdf'), import('../lib/exportPlan'), import('../lib/render'), import('../lib/sliceContent'),
      ]);
      signal.throwIfAborted();
      // Fetch only the pages the export uses, a few files at a time in the order the builders need
      // them. Building starts at once and waits only for pages it has not received yet.
      const plan = pagePlan(list, withMarkscheme);
      const counts = { files: 0, questions: 0, answers: 0 };
      const totals = { files: plan.files.length, questions: list.length, answers: withMarkscheme ? list.length : 0 };
      const report = () => setProgress({
        stage: counts.files < totals.files ? 'Downloading pages' : 'Building PDFs',
        done: counts.files + counts.questions + counts.answers,
        total: totals.files + totals.questions + totals.answers,
        detail: [`${counts.files}/${totals.files} files`, `${counts.questions}/${totals.questions} questions`,
          ...(totals.answers ? [`${counts.answers}/${totals.answers} answers`] : [])].join(' · '),
      });
      startedRef.current = Date.now();
      report();
      const settle = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: unknown) => void }>();
      const ready = new Map<string, Promise<Uint8Array>>();
      for (const file of plan.files) {
        const bytes = new Promise<Uint8Array>((resolve, reject) => settle.set(file.subsetKey, { resolve, reject }));
        bytes.catch(() => undefined); // a failure is reported by whichever builder needs the file
        ready.set(file.subsetKey, bytes);
      }
      signal.addEventListener('abort', () => { for (const { reject } of settle.values()) reject(signal.reason); }, { once: true });
      const load = (key: string) => ready.get(key) ?? Promise.reject(new Error('Unplanned export source'));
      const queue = [...plan.files];
      const downloader = async () => {
        for (let file = queue.shift(); file && !signal.aborted; file = queue.shift()) {
          const { key, pages } = file;
          const { resolve, reject } = settle.get(file.subsetKey)!;
          try {
            // Whole papers cut down here are the fallback when the server cannot send the pages.
            resolve(await limited(async () => {
              if (loadPages) {
                try { return await loadPages(key, pages); } catch { signal.throwIfAborted(); }
              }
              return subsetPdf(await loadPdf(key), pages);
            }, 240_000, signal));
            counts.files += 1;
            report();
          } catch (error) {
            reject(error);
          }
        }
      };
      void Promise.all(Array.from({ length: Math.min(4, plan.files.length) }, downloader));
      // Content boxes are worked out a few pages at a time, on shared pdf.js workers, while the
      // pages arrive; the builders then mostly read finished results.
      const concurrency = Math.max(2, Math.min(4, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
      const workers = renderWorkers(concurrency);
      const content = pdfContentCheck(load, workers.open, signal);
      void content.prefetch(plan.slices, { concurrency, boxes: cleanLayout });
      const base = `${subject.name} Filtered Questions`;
      let text: string;
      try {
        const decoration = { subject: subject.name, stamp, exportedAt: new Date(), admin: unmarked, siteUrl, signal };
        const onQuestions = (done: number) => { counts.questions = done; report(); };
        const onAnswers = (done: number) => { counts.answers = done; report(); };
        const [questions, markscheme] = await Promise.all([
          cleanLayout
            ? exportQuestionsClean(plan.questions, load, base, { ...decoration, contentBox: content.contentBox, onProgress: onQuestions })
            : exportQuestions(plan.questions, load, base, stamp, content.hasContent, signal, onQuestions),
          withMarkscheme
            ? exportMarkscheme(plan.questions, load, `${base} Markscheme`, cleanLayout ? undefined : stamp, content.hasContent, cleanLayout ? content.contentBox : undefined, signal,
              { onProgress: onAnswers, decorate: cleanLayout ? decoration : undefined })
            : Promise.resolve(null),
        ]);
        signal.throwIfAborted();
        download(questions.bytes, `${base}.pdf`);
        text = `Exported ${questions.exported} question${questions.exported === 1 ? '' : 's'} (${questions.pages} pages).`;
        if (markscheme) {
          download(markscheme.bytes, `${base} Markscheme.pdf`);
          text += ` Markscheme: ${markscheme.exported} answer${markscheme.exported === 1 ? '' : 's'}`;
          text += markscheme.skipped.length ? `, ${markscheme.skipped.length} listed for manual review.` : '.';
        }
        onActivity?.('export', subject.id, questions.exported, exportDetail(list.map(paperOf)));
        if (markscheme) onActivity?.('markscheme', subject.id, markscheme.exported, exportDetail(list.map(paperOf)));
      } finally {
        await content.close();
        workers.destroy();
      }
      signal.throwIfAborted();
      setMessage({ kind: 'ok', text: `${text} Took ${formatSeconds(Date.now() - startedRef.current)}.` });
    } catch (error) {
      const userCancelled = signal.aborted && signal.reason === 'cancelled';
      controller.abort(error);
      setMessage(userCancelled
        ? { kind: 'ok', text: 'Export cancelled.' }
        : { kind: 'error', text: error instanceof Error && error.message === 'timeout'
          ? 'A paper took too long to download. Check your connection and try again.'
          : 'The export failed. Try again, or select fewer questions.' });
    } finally {
      if (cancelRef.current === controller) cancelRef.current = null;
      setProgress(null);
      setBusy(false);
    }
  }

  const facet = <T extends string | number>(legend: string, values: T[], chosenValues: Set<T>, key: 'years' | 'sessions' | 'levels' | 'papers') => (
    values.length > 1 ? (
      <fieldset>
        <legend>{legend}</legend>
        {values.map((value) => (
          <Fragment key={String(value)}>
            <ToggleRow label={String(value)} checked={chosenValues.has(value)}
              onChange={() => update({ ...filters, [key]: toggleFacet(chosenValues, value),
                ...(key === 'levels' ? { includeSlHlShared: false } : {}) })} />
            {key === 'levels' && value === 'HL' && isHlOnly(filters) && (
              <div className="level-suboption">
                <ToggleRow label="Include SL-HL shared questions" checked={filters.includeSlHlShared}
                  onChange={() => update({ ...filters, includeSlHlShared: !filters.includeSlHlShared })} />
              </div>
            )}
          </Fragment>
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
            {isAdmin && accountTools && (
              <button type="button" className="btn" onClick={() => window.open(`${window.location.pathname}?admin=1`, 'lrb-admin')}>
                Admin ↗
              </button>
            )}
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
                {(filters.topics.size > 0 || filters.secondaryTopics.size > 0) && (
                  <button type="button" className="link" onClick={() => update({ ...filters, topics: new Set(), secondaryTopics: new Set() })}>Clear</button>
                )}
              </legend>
              <p className="muted small topic-help">
                Click a topic once for <strong>required</strong>, twice for <strong>also allowed</strong>.
                With any “also allowed” topic set, questions need at least one required topic and no topics outside your picks.
              </p>
              <label className="check switch">
                <input type="checkbox" checked={filters.requireAllTopics} disabled={filters.secondaryTopics.size > 0}
                  onChange={(e) => update(setTopicMode(filters, 'requireAllTopics', e.target.checked))} />
                <span>Require every selected topic</span>
              </label>
              <label className="check switch">
                <input type="checkbox" checked={filters.onlySelectedTopics} disabled={filters.secondaryTopics.size > 0}
                  onChange={(e) => update(setTopicMode(filters, 'onlySelectedTopics', e.target.checked))} />
                <span>Only selected topics <small>Exclude questions with unselected extra topics.</small></span>
              </label>
              <div className="topics">
                {subject.topics.map((topic) => (
                  <TopicRow key={topic} label={topic} state={topicState(filters, topic)}
                    onCycle={() => update(cycleTopic(filters, topic))} />
                ))}
              </div>
            </fieldset>
            <button type="button" className="btn secondary" onClick={() => update(defaultFilters(subject))}>Reset filters</button>
          </div>
        </aside>

        <main>
          <div className="search-bar" role="search">
            <input type="search" value={query} placeholder="Search question text, e.g. Hess's law, projectile, “standing wave”"
              aria-label="Search question text" onFocus={loadSearchTexts}
              onChange={(e) => { setQuery(e.target.value); loadSearchTexts(); }} />
            {terms.length > 0 && (
              <span className="muted small" role="status">
                {searchState === 'loading' ? 'Loading question text… (matching titles and topics meanwhile)'
                  : searchState === 'error' ? 'Question text could not be loaded; matching titles and topics only.'
                  : `${visible.length} match${visible.length === 1 ? '' : 'es'}`}
              </span>
            )}
          </div>
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
                  {hiddenChosen > 0 ? ` · ${hiddenChosen} hidden by the search` : ''}
                </span>
              </div>
              <div className="toolbar-actions">
                <button type="button" className="btn secondary" disabled={!visible.length}
                  onClick={() => setSelected((prev) => new Set([...prev, ...visible.map((q) => q.id)]))}>{terms.length ? 'Select results' : 'Select filtered'}</button>
                <button type="button" className="btn secondary" disabled={!chosen.length}
                  onClick={() => setSelected(new Set())}>Clear selection</button>
                {savedSelections && (
                  <button type="button" className="btn secondary" aria-expanded={showSaved}
                    onClick={() => setShowSaved((open) => !open)}>{showSaved ? 'Hide saved sets' : 'Saved sets'}</button>
                )}
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
              <button type="button" className="btn export-btn" disabled={!chosen.length || busy} onClick={() => { void exportSelection(); }}>
                {busy ? (progress ? `Exporting… ${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` : 'Exporting…') : chosen.length ? `Export ${chosen.length} question${chosen.length === 1 ? '' : 's'}` : 'Export PDF'}
              </button>
            </div>
            {busy && progress && (
              <div className="export-progress" role="status" aria-live="polite">
                <div className="export-progress-head">
                  <span>{progress.stage}</span>
                  <span>
                    {progress.done > 0 && progress.done < progress.total
                      ? `About ${formatSeconds(((now - startedRef.current) / progress.done) * (progress.total - progress.done))} left`
                      : progress.done >= progress.total ? 'Saving…' : 'Starting…'}
                    {' · '}{Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%
                  </span>
                </div>
                <div className="export-progress-head muted small">
                  <span>{progress.detail}</span>
                  <span>Elapsed {formatSeconds(now - startedRef.current)}</span>
                </div>
                <div className="export-progress-track">
                  <div className="export-progress-bar" style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
                </div>
                <button type="button" className="link" onClick={() => { cancelRef.current?.abort('cancelled'); }}>Cancel</button>
              </div>
            )}
            {message && <div className={`status ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</div>}
          </div>
          {showSaved && savedSelections && (
            <section className="panel saved-panel" aria-label="Saved sets">
              <form className="saved-new" onSubmit={(e) => { e.preventDefault(); void saveSet(); }}>
                <input type="text" value={setName} maxLength={80} onChange={(e) => setSetName(e.target.value)}
                  placeholder={`Name, e.g. Mock ${subjectSets.length + 1}`} aria-label="Name for the saved set" />
                <button type="submit" className="btn" disabled={!chosen.length}>
                  Save {chosen.length ? `${chosen.length} selected` : 'selection'}
                </button>
              </form>
              {setsMessage && <p className="muted small" role="status">{setsMessage}</p>}
              {sets === null ? <p className="muted small">Loading saved sets…</p>
                : subjectSets.length === 0 ? <p className="muted small">No saved {subject.name} sets yet. Tick some questions and save them here.</p>
                : (
                  <ul className="saved-list">
                    {subjectSets.map((set) => (
                      <li key={set.id}>
                        <div>
                          <strong>{set.name}</strong>
                          <span className="muted small"> · {set.questionIds.length} question{set.questionIds.length === 1 ? '' : 's'} · {new Date(set.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <div className="saved-actions">
                          <button type="button" className="btn secondary" disabled={busy} onClick={() => loadSet(set)}>Load</button>
                          <button type="button" className="btn secondary" disabled={busy} onClick={() => { void exportSelection(loadSet(set)); }}>Export</button>
                          <button type="button" className="link" disabled={busy} onClick={() => { void deleteSet(set); }}>Delete</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
            </section>
          )}
          {showStats && (
            <section className="panel stats-panel" aria-label="Topic statistics">
              <TopicStats questions={visible} />
            </section>
          )}

          {visible.length === 0 ? (
            <div className="panel empty">
              <p><strong>No matching questions</strong></p>
              <p className="muted">
                {terms.length > 0 && filtered.length > 0
                  ? 'No question text matches the search. Try fewer or shorter words.'
                  : filters.secondaryTopics.size > 0 && filters.topics.size === 0
                  ? '“Also allowed” topics need at least one required topic.'
                  : filters.onlySelectedTopics && filters.topics.size === 0
                  ? '"Only selected topics" needs at least one selected topic.'
                  : 'Adjust the selected filters to see more questions.'}
              </p>
            </div>
          ) : (
            <ul className="qlist">
              {visible.map((q, index) => (
                <li key={q.id} data-question-id={q.id} className={`qcard${selected.has(q.id) ? ' selected' : ''}`}>
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
                  <button type="button" className="btn secondary qaction" onClick={() => { setPreview(q); onActivity?.('preview', subject.id, 1, questionTitle(q)); }}>
                    <span className="classic-action">Preview</span>
                    <span className="archive-action">Read</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      {preview && <Preview question={preview} loadPdf={loadPdf} loadPages={loadPages} onClose={closePreview} />}
      {practising && <Practice pool={chosen.length ? chosen : visible} loadPdf={loadPdf} loadPages={loadPages} onClose={closePractice} />}
    </>
  );
}
