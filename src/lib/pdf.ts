import type { jsPDF } from 'jspdf';

/** jsPDF is loaded on demand so it never blocks first paint. */
async function loadJsPDF() {
  const mod = await import('jspdf');
  return mod.jsPDF;
}
import type { Corpus } from './types';
import { buildExportModel, buildMarkschemeModel, headingFor, renderQuestionText } from './export';

const MARGIN = 48;
const LINE = 15;

async function newDoc(title: string) {
  const JsPDF = await loadJsPDF();
  const doc = new JsPDF({ unit: 'pt', format: 'a4' });
  doc.setProperties({ title });
  return doc;
}

function writer(doc: jsPDF) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();
  let y = MARGIN;
  return {
    get y() { return y; },
    space(n = LINE) {
      if (y + n > pageH - MARGIN) { doc.addPage(); y = MARGIN; }
      y += n;
    },
    text(s: string, opts: { size?: number; bold?: boolean; indent?: number } = {}) {
      doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
      doc.setFontSize(opts.size ?? 11);
      const indent = opts.indent ?? 0;
      const lines = doc.splitTextToSize(s, pageW - MARGIN * 2 - indent) as string[];
      for (const l of lines) {
        if (y + LINE > pageH - MARGIN) { doc.addPage(); y = MARGIN; }
        doc.text(l, MARGIN + indent, y);
        y += LINE;
      }
    },
    rule() {
      if (y + 8 > pageH - MARGIN) { doc.addPage(); y = MARGIN; }
      doc.setDrawColor(190);
      doc.line(MARGIN, y, pageW - MARGIN, y);
      y += 10;
    },
  };
}

/** Exports ONLY the selected questions. Answers are never included here. */
export async function exportQuestionsPDF(corpus: Corpus, selected: Set<string>): Promise<{ filename: string; count: number }> {
  const model = buildExportModel(corpus, selected);
  const doc = await newDoc('Selected questions');
  const w = writer(doc);

  w.text('Selected questions', { size: 17, bold: true });
  w.text(`${model.items.length} question${model.items.length === 1 ? '' : 's'}`, { size: 10 });
  if (corpus.isDemoData) w.text(corpus.label, { size: 9 });
  w.space(6);
  w.rule();

  model.items.forEach((item, i) => {
    w.text(`${i + 1}.  ${headingFor(item.question)}`, { size: 12, bold: true });
    w.space(2);
    for (const line of renderQuestionText(item.question)) w.text(line, { indent: 12 });
    if (item.provenance.length > 1) {
      w.space(2);
      w.text(`Also appears as: ${item.provenance.slice(1).join('; ')}`, { size: 8, indent: 12 });
    }
    if (item.question.needsReview) {
      w.text('Flagged: Needs review', { size: 8, indent: 12 });
    }
    w.space(8);
    w.rule();
  });

  if (model.rejected.length) {
    w.space(6);
    w.text('Not exported', { size: 12, bold: true });
    for (const r of model.rejected) w.text(`${r.id}: ${r.reason}`, { size: 9, indent: 12 });
  }

  const filename = `selected-questions-${stamp()}.pdf`;
  doc.save(filename);
  return { filename, count: model.items.length };
}

/**
 * Generates a NEW markscheme containing only the answer slices for the selected
 * questions. A whole source markscheme is never attached or reproduced.
 */
export async function exportMarkschemePDF(corpus: Corpus, selected: Set<string>): Promise<{ filename: string; count: number; missing: number }> {
  const model = buildMarkschemeModel(corpus, selected);
  const doc = await newDoc('Markscheme for selected questions');
  const w = writer(doc);

  w.text('Markscheme for selected questions', { size: 17, bold: true });
  w.text('Generated from the current selection. Contains answers for the selected questions only.', { size: 10 });
  if (corpus.isDemoData) w.text(corpus.label, { size: 9 });
  w.space(6);
  w.rule();

  model.entries.forEach((e, i) => {
    w.text(`${i + 1}.  ${e.heading}`, { size: 12, bold: true });
    for (const l of e.lines) w.text(l, { indent: 12 });
    w.text(e.markschemeRef, { size: 8, indent: 12 });
    w.space(8);
    w.rule();
  });

  if (model.missing.length) {
    w.space(6);
    w.text('No answer slice available', { size: 12, bold: true });
    for (const m of model.missing) {
      w.text(m.heading, { size: 10, indent: 12 });
      w.text(m.reason, { size: 9, indent: 24 });
    }
  }

  const filename = `selected-markscheme-${stamp()}.pdf`;
  doc.save(filename);
  return { filename, count: model.entries.length, missing: model.missing.length };
}

function stamp() {
  return new Date().toISOString().slice(0, 10);
}
