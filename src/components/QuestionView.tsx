import type { ContentBlock, QuestionRecord } from '../lib/types';

export function ContentBlockView({ block }: { block: ContentBlock }) {
  switch (block.kind) {
    case 'text':
      return <p>{block.text}</p>;
    case 'formula':
      return <div className="formula">{block.text}</div>;
    case 'options':
      return (
        <ul className="options">
          {block.options.map((o) => (
            <li key={o.label}><b>{o.label}.</b><span>{o.text}</span></li>
          ))}
        </ul>
      );
    case 'table':
      return (
        <figure>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>{block.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((r, i) => (
                  <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
    case 'diagram':
      // Demo SVG authored in this repository; not fetched and not IB artwork.
      return (
        <figure>
          <div dangerouslySetInnerHTML={{ __html: block.svg }} />
          {block.caption && <figcaption>{block.caption}</figcaption>}
        </figure>
      );
  }
}

export function QuestionCard({
  question, selected, provenance, onToggle,
}: {
  question: QuestionRecord;
  selected: boolean;
  provenance: string[];
  onToggle: (id: string) => void;
}) {
  const inputId = `sel-${question.id}`;
  return (
    <article className={`qcard${selected ? ' selected' : ''}`}>
      <div className="qhead">
        <input
          id={inputId}
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(question.id)}
          aria-label={`Select ${question.questionNumber}`}
        />
        <div style={{ minWidth: 0 }}>
          <label htmlFor={inputId} className="qtitle">
            {question.questionNumber} &middot; {question.paperType} {question.level.toUpperCase()} {question.timeZone}
          </label>
          <div className="qmeta">
            <span>{question.examYear} {question.session}</span>
            {question.topicIds.map((t) => <span className="tag" key={t}>{t}</span>)}
          </div>
        </div>
      </div>

      <div className="qbody">
        {question.content.map((b, i) => <ContentBlockView key={i} block={b} />)}
        {question.needsReview && (
          <div className="review">Needs review - this item is flagged and has no confirmed topic mapping.</div>
        )}
        {provenance.length > 1 && (
          <div className="prov">
            Also appears as: {provenance.slice(1).join('; ')}
            <br />
            <em>Shown once. The other occurrence is not separately selectable.</em>
          </div>
        )}
      </div>
    </article>
  );
}
