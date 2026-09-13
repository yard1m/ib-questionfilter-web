import { useMemo, useState } from 'react';
import { demoCorpus } from './data/demo';
import { applyFilters, emptyFilters, facetsFor, pruneSelection, type FilterState } from './lib/filter';
import { provenanceFor, validateGroups } from './lib/dedup';
import { exportMarkschemePDF, exportQuestionsPDF } from './lib/pdf';
import { QuestionCard } from './components/QuestionView';
import type { SubjectId } from './lib/types';

const SUBJECTS: { id: SubjectId; label: string }[] = [
  { id: 'chemistry', label: 'Chemistry' },
  { id: 'mathematics', label: 'Mathematics' },
  { id: 'physics', label: 'Physics' },
];
const PAPER_LABEL: Record<string, string> = { paper1: 'Paper 1', paper2: 'Paper 2', paper3: 'Paper 3' };

function toggleIn<T>(set: Set<T>, v: T): Set<T> {
  const next = new Set(set);
  next.has(v) ? next.delete(v) : next.add(v);
  return next;
}

function ChipGroup<T extends string | number>({
  legend, values, selected, format, onToggle,
}: {
  legend: string; values: T[]; selected: Set<T>;
  format?: (v: T) => string; onToggle: (v: T) => void;
}) {
  if (values.length === 0) return null;
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="chips">
        {values.map((v) => (
          <button
            key={String(v)} type="button" className="chip"
            aria-pressed={selected.has(v)} onClick={() => onToggle(v)}
          >
            {format ? format(v) : String(v)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function App() {
  const corpus = demoCorpus;
  const [subject, setSubject] = useState<SubjectId>('chemistry');
  const [filters, setFilters] = useState<FilterState>(() => emptyFilters('chemistry'));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<string | null>(null);

  const groupIssues = useMemo(() => validateGroups(corpus), [corpus]);
  const facets = useMemo(() => facetsFor(corpus, subject), [corpus, subject]);
  const visible = useMemo(() => applyFilters(corpus, { ...filters, subject }), [corpus, filters, subject]);

  function update(next: Partial<FilterState>) {
    const merged: FilterState = { ...filters, ...next, subject };
    // The subset rule and the require-all rule are mutually exclusive.
    if (next.onlySelectedTopics) merged.requireAllTopics = false;
    if (next.requireAllTopics) merged.onlySelectedTopics = false;
    setFilters(merged);
    setSelected((prev) => pruneSelection(prev, applyFilters(corpus, merged)));
    setStatus(null);
  }

  function pickSubject(s: SubjectId) {
    setSubject(s);
    setFilters(emptyFilters(s));
    setSelected(new Set());
    setStatus(null);
  }

  function toggleQuestion(id: string) {
    setSelected((prev) => toggleIn(prev, id));
    setStatus(null);
  }

  const canExport = selected.size > 0;

  return (
    <>
      {corpus.isDemoData && (
        <div className="banner" role="status">
          <strong>Demonstration data.</strong> {corpus.label} The private IB corpus is not published here and is
          not reachable from this site.
        </div>
      )}

      <header className="app">
        <h1>IB Question Filter</h1>
        <nav className="subjects" aria-label="Subject">
          {SUBJECTS.map((s) => (
            <button
              key={s.id} type="button" aria-pressed={subject === s.id}
              onClick={() => pickSubject(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      {groupIssues.length > 0 && (
        <div className="banner" role="alert">
          <strong>Duplicate/shared data problem.</strong> {groupIssues[0]}
        </div>
      )}

      <div className="layout">
        <aside className="panel" aria-label="Filters">
          <h2>Filters</h2>

          <ChipGroup legend="Examination year" values={facets.years} selected={filters.years}
            onToggle={(v) => update({ years: toggleIn(filters.years, v) })} />
          <ChipGroup legend="Session" values={facets.sessions} selected={filters.sessions}
            onToggle={(v) => update({ sessions: toggleIn(filters.sessions, v) })} />
          <ChipGroup legend="Level" values={facets.levels} selected={filters.levels}
            format={(v) => v.toUpperCase()}
            onToggle={(v) => update({ levels: toggleIn(filters.levels, v) })} />
          <ChipGroup legend="Paper" values={facets.papers} selected={filters.papers}
            format={(v) => PAPER_LABEL[v] ?? v}
            onToggle={(v) => update({ papers: toggleIn(filters.papers, v) })} />
          <ChipGroup legend="Paper type" values={facets.paperTypes} selected={filters.paperTypes}
            onToggle={(v) => update({ paperTypes: toggleIn(filters.paperTypes, v) })} />

          <fieldset>
            <legend>Topics</legend>
            <label className="toggle">
              <input type="checkbox" checked={filters.onlySelectedTopics}
                onChange={(e) => update({ onlySelectedTopics: e.target.checked })} />
              <span>
                Only selected topics
                <small>Hides any question that also tests a topic you have not selected.</small>
              </span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={filters.requireAllTopics}
                onChange={(e) => update({ requireAllTopics: e.target.checked })} />
              <span>
                Must include every selected topic
                <small>Keeps only questions carrying all of your selected topics.</small>
              </span>
            </label>
            <div className="topics">
              {facets.topics.map((t) => (
                <label className="topic" key={t}>
                  <input type="checkbox" checked={filters.topics.has(t)}
                    onChange={() => update({ topics: toggleIn(filters.topics, t) })} />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button type="button" className="btn secondary" onClick={() => pickSubject(subject)}>
            Reset filters
          </button>
        </aside>

        <main>
          <div className="toolbar">
            <span className="count">
              {visible.length} question{visible.length === 1 ? '' : 's'} &middot; {selected.size} selected
            </span>
            <button type="button" className="btn secondary" disabled={visible.length === 0}
              onClick={() => setSelected(new Set(visible.map((q) => q.id)))}>
              Select all shown
            </button>
            <button type="button" className="btn secondary" disabled={selected.size === 0}
              onClick={() => setSelected(new Set())}>
              Clear
            </button>
            <button type="button" className="btn" disabled={!canExport}
              onClick={async () => {
                setStatus('Preparing question PDF...');
                const r = await exportQuestionsPDF(corpus, selected);
                setStatus(`Exported ${r.count} question${r.count === 1 ? '' : 's'} to ${r.filename}.`);
              }}>
              Export questions PDF
            </button>
            <button type="button" className="btn" disabled={!canExport}
              onClick={async () => {
                setStatus('Generating markscheme...');
                const r = await exportMarkschemePDF(corpus, selected);
                setStatus(
                  `Generated a markscheme with ${r.count} answer${r.count === 1 ? '' : 's'} to ${r.filename}` +
                  (r.missing ? `. ${r.missing} selected question(s) have no answer slice and are listed as missing.` : '.'),
                );
              }}>
              Generate markscheme
            </button>
          </div>

          {status && <div className="status" role="status">{status}</div>}

          {visible.length === 0 ? (
            <div className="panel empty">
              <p><strong>No questions match these filters.</strong></p>
              <p>
                {filters.onlySelectedTopics && filters.topics.size === 0
                  ? 'The "Only selected topics" rule needs at least one topic selected.'
                  : 'Try clearing a filter, or reset the panel on the left.'}
              </p>
            </div>
          ) : (
            <div className="qlist">
              {visible.map((q) => (
                <QuestionCard
                  key={q.id} question={q} selected={selected.has(q.id)}
                  provenance={provenanceFor(corpus, q.id)} onToggle={toggleQuestion}
                />
              ))}
            </div>
          )}
        </main>
      </div>

      <footer className="app">
        One canonical question per examination year. Identical content in different years is kept separately for each year.
      </footer>
    </>
  );
}
