import { useCallback, useMemo, useState } from 'react';
import type { Catalog, Question } from '../lib/catalog';
import { questionTitle } from '../lib/catalog';
import {
  defaultFilters, filterQuestions, pruneSelection, setTopicMode, toggleFacet, toggleTopic, type Filters,
} from '../lib/filter';
import type { DesignMode } from '../lib/design';
import { DesignToggle } from './DesignToggle';
import { Preview } from './Preview';

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

export function QuestionBrowser({ catalog, loadPdf, account, onSignOut, designMode, onDesignModeChange }: {
  catalog: Catalog;
  loadPdf: LoadPdf;
  account: string;
  onSignOut: () => void;
  designMode: DesignMode;
  onDesignModeChange: (mode: DesignMode) => void;
}) {
  const [subjectId, setSubjectId] = useState(catalog.subjects[0]?.id ?? '');
  const subject = catalog.subjects.find((s) => s.id === subjectId) ?? catalog.subjects[0];
  const [filters, setFilters] = useState<Filters>(() => defaultFilters(subject));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [withMarkscheme, setWithMarkscheme] = useState(true);
  const [preview, setPreview] = useState<Question | null>(null);
  const [busy, setBusy] = useState(false);
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
      const { exportMarkscheme, exportQuestions } = await import('../lib/exportPdf');
      const base = `${subject.name} Filtered Questions`;
      const questions = await exportQuestions(chosen, loadPdf, base);
      download(questions.bytes, `${base}.pdf`);
      let text = `Exported ${questions.exported} question${questions.exported === 1 ? '' : 's'} (${questions.pages} pages).`;
      if (withMarkscheme) {
        const markscheme = await exportMarkscheme(chosen, loadPdf, `${base} Markscheme`);
        download(markscheme.bytes, `${base} Markscheme.pdf`);
        text += ` Markscheme: ${markscheme.exported} answer${markscheme.exported === 1 ? '' : 's'}`;
        text += markscheme.skipped.length ? `, ${markscheme.skipped.length} listed for manual review.` : '.';
      }
      setMessage({ kind: 'ok', text });
    } catch {
      setMessage({ kind: 'error', text: 'The export failed. Try again, or select fewer questions.' });
    } finally {
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
            <button type="button" className="btn secondary" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
        <div className="masthead">
          <div className="app-title">
            <div className="archive-wordmark" aria-hidden="true">LITTLE <strong>RED</strong> BANK</div>
            <h1>IB Question Filter</h1>
            <p className="archive-subtitle" aria-hidden="true">QUESTION ARCHIVE &nbsp;·&nbsp; FILTER &nbsp;·&nbsp; COMPILE &nbsp;·&nbsp; ISSUE MMXXVI</p>
          </div>
          <div className="archive-seal" aria-hidden="true"><span>Q</span></div>
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
            <div className="count">
              <strong>{visible.length} matching question{visible.length === 1 ? '' : 's'}</strong>
              <span className="muted small">
                {chosen.length} selected{chosen.length ? ` · ${answers} markscheme answer${answers === 1 ? '' : 's'}` : ''}
              </span>
            </div>
            <button type="button" className="btn secondary" disabled={!visible.length}
              onClick={() => setSelected(new Set(visible.map((q) => q.id)))}>Select filtered</button>
            <button type="button" className="btn secondary" disabled={!chosen.length}
              onClick={() => setSelected(new Set())}>Clear selection</button>
            <label className="check inline">
              <input type="checkbox" checked={withMarkscheme} disabled={busy} onChange={(e) => setWithMarkscheme(e.target.checked)} />
              <span>Generate selected-question markscheme PDF</span>
            </label>
            <button type="button" className="btn" disabled={!chosen.length || busy} onClick={exportSelection}>
              {busy ? 'Exporting…' : 'Export PDF'}
            </button>
          </div>
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
                  <button type="button" className="btn secondary qaction" onClick={() => setPreview(q)}>
                    <span className="classic-action">Preview</span>
                    <span className="archive-action">Read</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>

      <footer className="archive-footer" aria-label="Site attribution">
        <div className="archive-motto">OMNIBUS PATEAT AEQUA VIA AD SCIENTIAM!</div>
        <div className="archive-credit">Built By yard1m_42</div>
      </footer>

      {preview && <Preview question={preview} loadPdf={loadPdf} onClose={closePreview} />}
    </>
  );
}
