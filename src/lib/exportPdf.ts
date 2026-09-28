import { PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb, type PDFPage } from 'pdf-lib';
import type { Question, Slice } from './catalog';
import { displayedRect, normaliseRotation, placement, userRect, type PageBox, type Rect } from './geometry';
import type { ContentBox, HasContent } from './sliceContent';
import { questionTitle } from './catalog';

/**
 * Builds the two exports the desktop app produces, entirely in the browser:
 *  - questions: one page per question slice, cropped to the slice (Scripts/export_questions.py);
 *  - markscheme: the selected questions' answer slices only, stacked on landscape pages with the
 *    desktop app's scaling rules (Scripts/export_markschemes.py). Questions without an answer
 *    slice are listed on a closing review page instead of being dropped silently. A source page
 *    without a content stream is an invalid export source and fails closed.
 * Pages are embedded as vector content, never rasterised. When a `hasContent` check is given,
 * short slices holding only white space or a running header are left out, so they do not export
 * as empty pages; a question always keeps at least one slice.
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

async function contentSlices<T extends Question['questionSlices'][number]>(slices: T[], key: string, hasContent?: HasContent): Promise<T[]> {
  if (!hasContent) return slices;
  const kept: T[] = [];
  for (const slice of slices) if (await hasContent(key, slice)) kept.push(slice);
  return kept.length ? kept : slices.slice(0, 1);
}

export async function exportQuestions(questions: Question[], load: LoadPdf, title: string, stamp?: string, hasContent?: HasContent): Promise<ExportResult> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setCreator('IB Question Filter');
  const sources = new Map<string, Promise<PDFDocument>>();
  for (const question of questions) {
    const source = await openSource(load, question.document.paperKey, sources);
    for (const slice of await contentSlices(question.questionSlices, question.document.paperKey, hasContent)) {
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

export async function exportMarkscheme(questions: Question[], load: LoadPdf, title: string, stamp?: string, hasContent?: HasContent): Promise<ExportResult> {
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
    for (const slice of await contentSlices(question.answerSlices, question.document.markschemeKey, hasContent)) {
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
  const safe = text.replace(/[^\x20-\x7E\u00A0-\u00FF\u2013\u2014\u2019\u201C\u201D]/g, '?');
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let end = safe.length;
  while (end > 1 && font.widthOfTextAtSize(`${safe.slice(0, end)}...`, size) > maxWidth) end -= 1;
  return `${safe.slice(0, end)}...`;
}

/* ------------------------------------------------------------------------------------------------
 * Clean layout (the default since 2026-09-28; the original layout above is kept unchanged and is one
 * checkbox away). Each question slice is trimmed to its content, so the hatched answer margin,
 * barcode, running header and continuation notes are dropped, and questions are stacked on uniform
 * A4 pages under a label. Every page carries the website's header, a page-numbered footer with the
 * account stamp, and a faint diagonal watermark.
 * ---------------------------------------------------------------------------------------------- */

const A4_W = 595.28;
const A4_H = 841.89;
const CLEAN_MARGIN_X = 42;
const CLEAN_TOP = A4_H - 58; // below the header rule
const CLEAN_BOTTOM = 46; // above the footer
const LABEL_SIZE = 8.5;
const QUESTION_GAP = 16;
const SLICE_GAP = 4;
export const SITE_NAME = 'Little Red Bank';
const MOTTO = 'OMNIBUS PATEAT AEQUA VIA AD SCIENTIAM!';
const RED = rgb(0.839, 0.325, 0.263); // #d65343, the site's accent
const GOLD = rgb(0.784, 0.643, 0.353); // #c8a45a
const INK = rgb(0.086, 0.098, 0.114);

export interface CleanOptions {
  subject: string;
  /** Admin format: no watermark and no sharing stamp (labels and page numbers stay). */
  admin?: boolean;
  /** Printed as a small clickable link in the footer of watermarked exports. */
  siteUrl?: string;
  stamp?: string;
  exportedAt?: Date;
  contentBox?: ContentBox;
}

export async function exportQuestionsClean(questions: Question[], load: LoadPdf, title: string, options: CleanOptions): Promise<ExportResult> {
  const out = await PDFDocument.create();
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const sources = new Map<string, Promise<PDFDocument>>();
  const contentWidth = A4_W - 2 * CLEAN_MARGIN_X;
  const contentHeight = CLEAN_TOP - CLEAN_BOTTOM;
  let page: PDFPage | null = null;
  let cursor = CLEAN_TOP;
  const newPage = () => {
    page = out.addPage([A4_W, A4_H]);
    cursor = CLEAN_TOP;
    return page;
  };

  for (const question of questions) {
    const key = question.document.paperKey;
    const source = await openSource(load, key, sources);
    const boxes: Slice[] = [];
    for (const slice of question.questionSlices) {
      const trimmed = options.contentBox ? await options.contentBox(key, slice) : slice;
      if (trimmed) boxes.push(trimmed);
    }
    if (!boxes.length) boxes.push(question.questionSlices[0]); // never drop a question
    let first = true;
    for (const slice of boxes) {
      const src = source.getPage(slice.page);
      const box = pageBox(src);
      const shown = displayedRect(box, slice);
      const width = shown.right - shown.left;
      const height = shown.top - shown.bottom;
      const labelSpace = first ? LABEL_SIZE + 8 : 0;
      const scale = Math.min(1, contentWidth / width, (contentHeight - labelSpace) / height);
      const need = height * scale + labelSpace;
      const gap = page && cursor < CLEAN_TOP ? (first ? QUESTION_GAP : SLICE_GAP) : 0;
      if (!page || cursor - gap - need < CLEAN_BOTTOM) newPage();
      else cursor -= gap;
      const target = page as unknown as PDFPage;
      if (first) {
        if (cursor < CLEAN_TOP) {
          target.drawLine({ start: { x: CLEAN_MARGIN_X, y: cursor + QUESTION_GAP / 2 }, end: { x: A4_W - CLEAN_MARGIN_X, y: cursor + QUESTION_GAP / 2 }, thickness: 0.4, color: GOLD, opacity: 0.6 });
        }
        cursor -= LABEL_SIZE;
        target.drawText(clip(questionTitle(question), bold, LABEL_SIZE, contentWidth), { x: CLEAN_MARGIN_X, y: cursor, size: LABEL_SIZE, font: bold, color: RED });
        cursor -= 8;
      }
      const region = userRect(box, shown);
      const embedded = await embedRegion(out, src, region);
      const y = cursor - height * scale;
      const p = placement(box, region, CLEAN_MARGIN_X, y, scale);
      target.drawPage(embedded, { x: p.x, y: p.y, xScale: scale, yScale: scale, rotate: degrees(p.rotate) });
      cursor = y;
      first = false;
    }
  }
  await decoratePages(out, { title, subject: options.subject, stamp: options.stamp, exportedAt: options.exportedAt, admin: options.admin, siteUrl: options.siteUrl, font, bold });
  return { bytes: await out.save(), pages: out.getPageCount(), exported: questions.length, skipped: [] };
}

/** Re-opens an export produced by exportMarkscheme and adds the clean-layout header, footer and watermark. */
export async function decorateExport(bytes: Uint8Array, title: string, options: CleanOptions): Promise<Uint8Array> {
  const out = await PDFDocument.load(bytes);
  const font = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  await decoratePages(out, { title, subject: options.subject, stamp: options.stamp, exportedAt: options.exportedAt, admin: options.admin, siteUrl: options.siteUrl, font, bold });
  return out.save();
}

async function decoratePages(out: PDFDocument, o: { title: string; subject: string; stamp?: string; exportedAt?: Date; admin?: boolean; siteUrl?: string; font: Awaited<ReturnType<PDFDocument['embedFont']>>; bold: Awaited<ReturnType<PDFDocument['embedFont']>> }) {
  const date = (o.exportedAt ?? new Date()).toISOString().slice(0, 10);
  out.setTitle(o.title);
  out.setAuthor(SITE_NAME);
  out.setCreator(SITE_NAME);
  out.setProducer(`${SITE_NAME} (pdf-lib)`);
  out.setSubject(`${o.subject} questions exported from ${SITE_NAME} on ${date}`);
  out.setKeywords([SITE_NAME, o.subject, 'IB', 'exported']);
  const pages = out.getPages();
  const grey = rgb(0.42, 0.42, 0.4);
  const stamp = o.admin ? '' : (o.stamp ?? '').trim();
  pages.forEach((page, i) => {
    const { width, height } = page.getSize();
    // Diagonal wordmark watermark in the site's colours: LITTLE and BANK in gold, RED in red.
    const parts: [string, ReturnType<typeof rgb>][] = [['LITTLE ', GOLD], ['RED ', RED], ['BANK', GOLD]];
    const wmSize = Math.min(width, height) / 8.5;
    if (!o.admin) {
    const total = parts.reduce((n, [t]) => n + o.bold.widthOfTextAtSize(t, wmSize), 0);
    const angle = Math.atan2(height, width) * 0.85;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    let wx = width / 2 - (cos * total) / 2 + (sin * wmSize) / 3;
    let wy = height / 2 - (sin * total) / 2 - (cos * wmSize) / 3;
    for (const [t, color] of parts) {
      page.drawText(t, { x: wx, y: wy, size: wmSize, font: o.bold, color, opacity: 0.11, rotate: degrees((angle * 180) / Math.PI) });
      const adv = o.bold.widthOfTextAtSize(t, wmSize);
      wx += cos * adv; wy += sin * adv;
    }
    }
    // Header: wordmark left, subject and title right, gold rule.
    let hx = 24;
    for (const [t, color] of [['LITTLE ', INK], ['RED ', RED], ['BANK', INK]] as [string, ReturnType<typeof rgb>][]) {
      page.drawText(t, { x: hx, y: height - 22, size: 9.5, font: o.bold, color });
      hx += o.bold.widthOfTextAtSize(t, 9.5);
    }
    const right = clip(`${o.subject} · ${o.title}`, o.font, 8, width / 3);
    page.drawText(right, { x: width - 24 - o.font.widthOfTextAtSize(right, 8), y: height - 22, size: 8, font: o.font, color: grey });
    const motto = o.font.widthOfTextAtSize(MOTTO, 6.2);
    if (motto < width / 3 - 20) page.drawText(MOTTO, { x: width / 2 - motto / 2, y: height - 21.5, size: 6.2, font: o.font, color: GOLD });
    page.drawLine({ start: { x: 24, y: height - 28 }, end: { x: width - 24, y: height - 28 }, thickness: 0.8, color: GOLD });
    // Footer: gold rule, stamp left, site link centre (not in admin format), page number right.
    page.drawLine({ start: { x: 24, y: 26 }, end: { x: width - 24, y: 26 }, thickness: 0.8, color: GOLD });
    const left = clip(stamp || (o.admin ? `${SITE_NAME} · ${date}` : `Exported from ${SITE_NAME} · ${date}`), o.font, 7, width / 2 - 90);
    page.drawText(left, { x: 24, y: 14, size: 7, font: o.font, color: grey });
    if (!o.admin && o.siteUrl) {
      const label = o.siteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const lw = o.font.widthOfTextAtSize(label, 7);
      const lx = Math.max(width / 2 - lw / 2, 24 + o.font.widthOfTextAtSize(left, 7) + 12);
      page.drawText(label, { x: lx, y: 14, size: 7, font: o.font, color: RED });
      page.drawLine({ start: { x: lx, y: 12.6 }, end: { x: lx + lw, y: 12.6 }, thickness: 0.4, color: RED });
      addLink(out, page, [lx - 1, 10, lx + lw + 1, 22], o.siteUrl);
    }
    const num = `Page ${i + 1} of ${pages.length}`;
    page.drawText(num, { x: width - 24 - o.font.widthOfTextAtSize(num, 7.5), y: 14, size: 7.5, font: o.bold, color: RED });
  });
}

/** Adds a clickable URI link annotation over a rectangle [x0, y0, x1, y1] (no visible border). */
function addLink(doc: PDFDocument, page: PDFPage, rect: [number, number, number, number], url: string) {
  const annot = doc.context.obj({
    Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0],
    A: { Type: 'Action', S: 'URI', URI: PDFString.of(url) },
  });
  const ref = doc.context.register(annot);
  const existing = page.node.lookup(PDFName.of('Annots'));
  if (existing && 'push' in existing) (existing as unknown as { push(v: unknown): void }).push(ref);
  else page.node.set(PDFName.of('Annots'), doc.context.obj([ref]));
}
