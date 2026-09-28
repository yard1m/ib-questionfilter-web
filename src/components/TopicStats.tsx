import { useMemo } from 'react';
import type { Question } from '../lib/catalog';

/**
 * How often each topic is examined, for the questions currently in scope (the active filters).
 * Rows are topics (most examined first), columns are examination years (newest first), plus a
 * paper breakdown and the total. Needs-review questions are counted under their own row.
 */
export function TopicStats({ questions }: { questions: Question[] }) {
  const { years, papers, rows } = useMemo(() => {
    const years = [...new Set(questions.map((q) => q.document.year))].sort((a, b) => b - a);
    const papers = [...new Set(questions.map((q) => q.document.paper))].sort();
    const byTopic = new Map<string, { total: number; year: Map<number, number>; paper: Map<string, number> }>();
    for (const q of questions) {
      const topics = q.topics.length ? q.topics : ['Needs review'];
      for (const t of topics) {
        let r = byTopic.get(t);
        if (!r) { r = { total: 0, year: new Map(), paper: new Map() }; byTopic.set(t, r); }
        r.total += 1;
        r.year.set(q.document.year, (r.year.get(q.document.year) ?? 0) + 1);
        r.paper.set(q.document.paper, (r.paper.get(q.document.paper) ?? 0) + 1);
      }
    }
    const rows = [...byTopic.entries()].sort((a, b) => b[1].total - a[1].total);
    return { years, papers, rows };
  }, [questions]);

  if (!questions.length) return <p className="muted">No questions match the current filters.</p>;
  const max = Math.max(...rows.map(([, r]) => r.total));
  return (
    <div className="topic-stats">
      <p className="muted small">
        {questions.length} question{questions.length === 1 ? '' : 's'} in scope. A question with several topics counts once under each.
      </p>
      <div className="topic-stats-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Topic</th>
              <th scope="col" className="num">Total</th>
              {years.map((y) => <th key={y} scope="col" className="num">{y}</th>)}
              {papers.map((p) => <th key={p} scope="col" className="num paper">{p.replace('Paper ', 'P')}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([topic, r]) => (
              <tr key={topic}>
                <th scope="row">
                  <span>{topic}</span>
                  <span className="bar" style={{ width: `${Math.round((r.total / max) * 100)}%` }} aria-hidden="true" />
                </th>
                <td className="num strong">{r.total}</td>
                {years.map((y) => <td key={y} className="num">{r.year.get(y) || ''}</td>)}
                {papers.map((p) => <td key={p} className="num paper">{r.paper.get(p) || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
