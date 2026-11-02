import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import type { Question, Slice } from './catalog';
import type { PlannedSlice } from './sliceContent';

/**
 * An export needs only a few pages of each paper, yet whole papers average about 1 MB, which made
 * a 60-question export download over 100 MB. The plan lists the pages each source PDF must
 * provide, in the order the builders use them, and re-points the questions at those smaller PDFs
 * (page numbers renumbered within each one), so the builders and content checks work unchanged.
 */

export interface PlannedFile {
  /** Corpus object the pages come from. */
  key: string;
  /** Source page indexes, ascending; the smaller PDF holds exactly these, in this order. */
  pages: number[];
  /** Name the re-pointed questions use for the smaller PDF. */
  subsetKey: string;
}

export interface ExportPlan {
  files: PlannedFile[];
  questions: Question[];
  /** Every slice the builders will check, in the order they need them. */
  slices: PlannedSlice[];
}

export function pagePlan(questions: Question[], withMarkscheme: boolean): ExportPlan {
  const needed = new Map<string, Set<number>>();
  const add = (key: string, slices: Slice[]) => {
    let pages = needed.get(key);
    if (!pages) needed.set(key, (pages = new Set()));
    for (const slice of slices) pages.add(slice.page);
  };
  const answers = (q: Question) => (withMarkscheme && q.answerSlices && q.document.markschemeKey ? q.answerSlices : null);
  for (const q of questions) {
    add(q.document.paperKey, q.questionSlices);
    const a = answers(q);
    if (a) add(q.document.markschemeKey!, a);
  }
  const files = new Map<string, PlannedFile>();
  for (const [key, pages] of needed) {
    const sorted = [...pages].sort((x, y) => x - y);
    files.set(key, { key, pages: sorted, subsetKey: `${key}#pages=${sorted.join(',')}` });
  }
  const remap = (file: PlannedFile, slices: Slice[]) => slices.map((s) => ({ ...s, page: file.pages.indexOf(s.page) }));
  const slices: PlannedSlice[] = [];
  const planned = questions.map((q) => {
    const paper = files.get(q.document.paperKey)!;
    const questionSlices = remap(paper, q.questionSlices);
    slices.push(...questionSlices.map((slice) => ({ key: paper.subsetKey, slice })));
    const a = answers(q);
    const markscheme = a ? files.get(q.document.markschemeKey!)! : null;
    const answerSlices = markscheme && a ? remap(markscheme, a) : q.answerSlices;
    if (markscheme && answerSlices) slices.push(...answerSlices.map((slice) => ({ key: markscheme.subsetKey, slice })));
    return {
      ...q,
      document: { ...q.document, paperKey: paper.subsetKey, markschemeKey: markscheme ? markscheme.subsetKey : q.document.markschemeKey },
      questionSlices,
      answerSlices,
    };
  });
  return { files: [...files.values()], questions: planned, slices };
}

/**
 * Drops what an export never shows: XMP metadata (often one per embedded font) and application
 * private data on every object, and the pages' annotations and thumbnails. A link annotation can
 * also pull whole other pages into the copy. Keep in step with the `pages` Edge Function.
 */
export function stripForExport(doc: PDFDocument, pages: number[]): void {
  for (const [, object] of doc.context.enumerateIndirectObjects()) {
    const dict = object instanceof PDFRawStream ? object.dict : object instanceof PDFDict ? object : null;
    if (!dict || dict === doc.catalog) continue;
    dict.delete(PDFName.of('Metadata'));
    dict.delete(PDFName.of('PieceInfo'));
  }
  for (const index of pages) {
    const page = doc.getPage(index).node;
    page.delete(PDFName.of('Annots'));
    page.delete(PDFName.of('Thumb'));
  }
}

/**
 * Copies the given pages of a PDF into a new one, in order: the fallback when the server cannot
 * send just those pages (local development, or an older server without the pages function).
 */
export async function subsetPdf(bytes: Uint8Array, pages: number[]): Promise<Uint8Array> {
  const source = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false });
  stripForExport(source, pages);
  const out = await PDFDocument.create({ updateMetadata: false });
  for (const page of await out.copyPages(source, pages)) out.addPage(page);
  return out.save();
}
