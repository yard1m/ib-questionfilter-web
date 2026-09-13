import type { Corpus, QuestionRecord } from './types';
import { canonicalQuestions, provenanceFor, suppressedIds } from './dedup';
import { sortQuestions } from './filter';

export interface ExportItem {
  question: QuestionRecord;
  provenance: string[];
}
export interface ExportModel {
  items: ExportItem[];
  /** Selected ids that could not be exported, with the reason. Never silently dropped. */
  rejected: { id: string; reason: string }[];
}
export interface MarkschemeModel {
  entries: { questionId: string; heading: string; markschemeRef: string; lines: string[] }[];
  /** Selected questions that have no answer slice available. */
  missing: { questionId: string; heading: string; reason: string }[];
}

export function headingFor(q: QuestionRecord): string {
  const level = q.level.toUpperCase();
  return `${titleCase(q.subject)} ${q.examYear} ${q.session} - ${q.paperType} ${level} ${q.timeZone} - ${q.questionNumber}`;
}

function titleCase(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * Builds the export set from the current selection.
 *
 * A suppressed (non-canonical) occurrence can never be exported: a generated PDF must
 * never contain two canonical rows from the same duplicate/shared component.
 */
export function buildExportModel(corpus: Corpus, selected: Set<string>): ExportModel {
  const byId = new Map(corpus.questions.map((q) => [q.id, q]));
  const suppressed = suppressedIds(corpus);
  const items: ExportItem[] = [];
  const rejected: ExportModel['rejected'] = [];

  for (const id of selected) {
    const q = byId.get(id);
    if (!q) { rejected.push({ id, reason: 'Question is not present in the loaded corpus.' }); continue; }
    if (suppressed.has(id)) {
      rejected.push({ id, reason: 'Non-canonical occurrence of a shared question; only the canonical copy is exportable.' });
      continue;
    }
    items.push({ question: q, provenance: provenanceFor(corpus, id) });
  }
  items.sort((a, b) => sortQuestions(a.question, b.question));
  return { items, rejected };
}

/**
 * Builds a NEW markscheme containing only the answer slices for the selected questions.
 * A whole source markscheme is never attached or reproduced.
 */
export function buildMarkschemeModel(corpus: Corpus, selected: Set<string>): MarkschemeModel {
  const { items } = buildExportModel(corpus, selected);
  const entries: MarkschemeModel['entries'] = [];
  const missing: MarkschemeModel['missing'] = [];
  for (const { question } of items) {
    const heading = headingFor(question);
    if (!question.answer) {
      missing.push({
        questionId: question.id, heading,
        reason: 'No markscheme is paired with this source paper, so no answer slice exists.',
      });
      continue;
    }
    entries.push({
      questionId: question.id, heading,
      markschemeRef: question.answer.markschemeRef,
      lines: question.answer.lines,
    });
  }
  return { entries, missing };
}

/** Plain-text rendering, used by tests and as the PDF text source. */
export function renderQuestionText(q: QuestionRecord): string[] {
  const out: string[] = [];
  for (const b of q.content) {
    switch (b.kind) {
      case 'text': out.push(b.text); break;
      case 'formula': out.push(`    ${b.text}`); break;
      case 'options': for (const o of b.options) out.push(`    ${o.label}.  ${o.text}`); break;
      case 'diagram': out.push(`[diagram: ${b.caption ?? 'figure'}]`); break;
      case 'table': {
        if (b.caption) out.push(`[table: ${b.caption}]`);
        out.push(`    ${b.headers.join('  |  ')}`);
        for (const r of b.rows) out.push(`    ${r.join('  |  ')}`);
        break;
      }
    }
  }
  return out;
}

export function selectableIds(corpus: Corpus): Set<string> {
  return new Set(canonicalQuestions(corpus).map((q) => q.id));
}
