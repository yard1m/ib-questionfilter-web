import { PDFDocument, StandardFonts, degrees, rgb, type PDFPage } from 'pdf-lib';
import type { Question } from './catalog';
import { displayedRect, normaliseRotation, placement, userRect, type PageBox, type Rect } from './geometry';

/**
 * Builds the two exports the desktop app produces, entirely in the browser:
 *  - questions: one page per question slice, cropped to the slice (Scripts/export_questions.py);
 *  - markscheme: the selected questions' answer slices only, stacked on landscape pages with the
 *    desktop app's scaling rules (Scripts/export_markschemes.py). Questions without an answer
 *    slice are listed on a closing review page instead of being dropped silently. A source page
 *    without a content stream is an invalid export source and fails closed.
 * Pages are embedded as vector content, never rasterised.
 */

const OUTPUT_PAGE_WIDTH = 842;
const OUTPUT_PAGE_HEIGHT = 595;
const OUTPUT_MARGIN = 32;
const OUTPUT_GAP = 10;
const SMALL_SLICE_WIDTH = 180;
const SMALL_SLICE_HEIGHT = 72;

export type LoadPdf = (key: string) => Promise<Uint8Array>;

export interface ExportResult {
  bytes: Uint8Array;
  pages: number;
  exported: number;
  skipped: { question: Question; reason: string }[];
}

async function openSource(load: LoadPdf, key: string, cache: Map<string, Promise<PDFDocument>>) {
  let doc = cache.get(key);
  if (!doc) {
    doc = load(key).then((bytes) => PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false, updateMetadata: false }));
    cache.set(key, doc);
  }
  return doc;
}

async function embedRegion(out: PDFDocument, page: PDFPage, region: Rect) {
  // Do not turn a blank source page into a silently empty answer/question page. The caller must
  // receive the pdf-lib error so the export is rejected rather than producing misleading output.
  return out.embedPage(page, region);
}

/**
 * Prints a small line naming the account and date at the foot of every page, so a PDF that
 * leaves the group still says whose account exported it. Empty stamps are skipped.
 */
export async function stampPages(out: PDFDocument, stamp: string | undefined): Promise<void> {
  const text = (stamp ?? '').trim();
  if (!text) return;
  const font = await out.embedFont(StandardFonts.Helvetica);
  for (const page of out.getPages()) {
    const { width } = page.getSize();
    const size = Math.max(4.5, Math.min(7, width / 110));
    page.drawText(text, { x: 4, y: 3, size, font, color: rgb(0.45, 0.45, 0.45), opacity: 0.85, maxWidth: width - 8 });
  }
}

function pageBox(page: PDFPage): PageBox {
  const media = page.getMediaBox();
  return { x: media.x, y: media.y, width: media.width, height: media.height, rotation: normaliseRotation(page.getRotation().angle) };
}

export async function exportQuestions(questions: Question[], load: LoadPdf, title: string, stamp?: string): Promise<ExportResult> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('IB Question Filter');
  const sources = new Map<string, Promise<PDFDocument>>();
  for (const question of questions) {
    const source = await openSource(load, question.document.paperKey, sources);
    for (const slice of question.questionSlices) {
      const page = source.getPage(slice.page);
      const box = pageBox(page);
      const shown: Rect = displayedRect(box, { ...slice, left: null, right: null });
      const region = userRect(box, shown);
      const embedded = await embedRegion(out, page, region);
      const width = shown.right - shown.left;
      const height = shown.top - shown.bottom;
      const target = out.addPage([width, height]);
      const p = placement(box, region, 0, 0, 1);
      if (embedded) target.drawPage(embedded, { x: p.x, y: p.y, xScale: 1, yScale: 1, rotate: degrees(p.rotate) });
    }
  }
  await stampPages(out, stamp);
  return { bytes: await out.save(), pages: out.getPageCount(), exported: questions.length, skipped: [] };
}

export async function exportMarkscheme(questions: Question[], load: LoadPdf, title: string, stamp?: string): Promise<ExportResult> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('IB Question Filter');
  const sources = new Map<string, Promise<PDFDocument>>();
  const skipped: ExportResult['skipped'] = [];
  let current: PDFPage | null = null;
  let cursor = OUTPUT_PAGE_HEIGHT - OUTPUT_MARGIN;
  let exported = 0;
  const contentWidth = OUTPUT_PAGE_WIDTH - 2 * OUTPUT_MARGIN;
  const contentHeight = OUTPUT_PAGE_HEIGHT - 2 * OUTPUT_MARGIN;

  for (const question of questions) {
    if (!question.answerSlices || !question.document.markschemeKey) {
      skipped.push({ question, reason: question.answerSkipReason ?? 'No answer slice is available for this question.' });
      continue;
    }
    const source = await openSource(load, question.document.markschemeKey, sources);
    const seen = new Set<string>();
    for (const slice of question.answerSlices) {
      const identity = [slice.page, slice.lower.toFixed(1), slice.upper.toFixed(1), (slice.left ?? 0).toFixed(1), (slice.right ?? 0).toFixed(1)].join(':');
      if (seen.has(identity)) continue;
      seen.add(identity);
      const page = source.getPage(slice.page);
      const box = pageBox(page);
      const shown = displayedRect(box, slice);
      const width = shown.right - shown.left;
      const height = shown.top - shown.bottom;
      const maxScale = width <= SMALL_SLICE_WIDTH && height <= SMALL_SLICE_HEIGHT ? 2.25 : 1;
      const scale = Math.min(maxScale, contentWidth / width, contentHeight / height);
      const displayHeight = height * scale;
      if (!current || cursor - displayHeight < OUTPUT_MARGIN) {
        current = out.addPage([OUTPUT_PAGE_WIDTH, OUTPUT_PAGE_HEIGHT]);
        cursor = OUTPUT_PAGE_HEIGHT - OUTPUT_MARGIN;
      }
      const region = userRect(box, shown);
      const embedded = await embedRegion(out, page, region);
      const y = cursor - displayHeight;
      const p = placement(box, region, OUTPUT_MARGIN, y, scale);
      if (embedded) current.drawPage(embedded, { x: p.x, y: p.y, xScale: scale, yScale: scale, rotate: degrees(p.rotate) });
      cursor = y - OUTPUT_GAP;
    }
    exported += 1;
  }

  if (skipped.length) {
    const font = await out.embedFont(StandardFonts.Helvetica);
    const bold = await out.embedFont(StandardFonts.HelveticaBold);
    const lines = skipped.map(({ question, reason }) => `${question.document.name} ${question.label}: ${reason}`);
    for (let start = 0; start < lines.length; start += 34) {
      const page = out.addPage([612, 792]);
      let y = 736;
      if (start === 0) {
        page.drawText('Needs manual markscheme review', { x: 72, y, size: 16, font: bold, color: rgb(0, 0, 0) });
        y -= 36;
      }
      for (const line of lines.slice(start, start + 34)) {
        page.drawText(clip(line, font, 10, 468), { x: 72, y, size: 10, font, color: rgb(0, 0, 0) });
        y -= 18;
      }
    }
  }
  await stampPages(out, stamp);
  return { bytes: await out.save(), pages: out.getPageCount(), exported, skipped };
}

function clip(text: string, font: { widthOfTextAtSize(t: string, s: number): number }, size: number, maxWidth: number): string {
  const safe = text.replace(/[^\x20-\x7E]/g, '?');
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let end = safe.length;
  while (end > 1 && font.widthOfTextAtSize(`${safe.slice(0, end)}...`, size) > maxWidth) end -= 1;
  return `${safe.slice(0, end)}...`;
}
