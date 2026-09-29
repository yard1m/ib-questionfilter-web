import type { Slice } from './catalog';
import { isPageFurniture, type TextPoint } from './sliceContent';

/**
 * Finds the part of a slice that actually holds question content, for the clean export layout.
 * IB papers carry furniture around every question: a hatched "do not write here" strip down one
 * edge, a barcode and paper code at the foot, a running header, crop marks, and "(This question
 * continues on the following page)" notes. A slice cut by anchor positions keeps all of that plus
 * any blank space below the question. The page is rasterised, furniture is masked, and the box of
 * the remaining ink (with a little padding) is returned in displayed coordinates.
 */

export interface GrayRaster {
  width: number; // pixels
  height: number;
  scale: number; // pixels per point
  data: Uint8Array; // luminance, row 0 = top of the page
}

export interface PageSize {
  width: number; // displayed points
  height: number;
}

export interface TextBox extends TextPoint {
  width: number;
  height: number;
}

const SIDE_MARGIN = 38; // hatched answer-margin strip and crop marks sit outside this
const HEADER_BAND = 62; // running header, page number and crop marks
const FOOTER_BAND = 50; // barcode, paper code and copyright line
/**
 * Older papers (2019-2020) are printed on a larger page with bleed (642 x 889 pt instead of A4's
 * 595 x 842), with the A4 content centred on it. Every fixed band shifts inward by the bleed.
 */
function bleed(page: PageSize): { x: number; y: number } {
  const landscape = page.width > page.height; // markscheme tables are often landscape A4 (842 x 595)
  const [w, h] = landscape ? [842, 595] : [595, 842];
  return { x: Math.max(0, (page.width - w) / 2), y: Math.max(0, (page.height - h) / 2) };
}

const INK = 190; // luminance below this counts as content
const PAD = 6;
const BAND_GAP = 9; // points of blank space that separate two bands
const PAGE_FOOT_CUT = 90; // slice floors below this are the page-foot cut, not a question boundary
const BARCODE_ZONE = 95; // points above the page foot where the paper barcode is printed

const NOTE_PATTERNS = [
  /^\(?this question continues on the following page\)?\.?$/i,
  /^\(?question \d+ continued\)?\.?$/i,
  /^\(?this question continues on page \d+\)?\.?$/i,
  /^\(?continue[ds]\s*(\.{2,}|…)?\)?$/i, // markscheme "(continued…)" / "(continues…)" notes
  /^\(?(option [a-d],? )?(question \d+[a-z]*(\([a-z]+\))*,? )?continued\s*(\.{2,}|…)?\)?\.?$/i, // "(Option A, question 5 continued)", "(Question 13c continued)", "(Question continued)"
  /^\(?question continued\)?\.?$/i,
  /^\(?option [a-d] continues on (the following page|page \d+)\)?\.?$/i,
  /^do not write solutions on this page\.?$/i,
  /^end of (option [a-d]|section [a-z]|paper)\.?$/i,
  /^option [a-d]\s*[—–-]\s*[a-z ,]+$/i, // "Option C — Energy" section banners
  /^section [ab]\.?$/i,
  /^(do not write solutions on this page\.?\s*)?answer all questions in the answer booklet provided\.?( please start each question on a new page\.?)?$/i,
  /^please start each question on a new page\.?$/i,
];

// Rows of dots are printed answer lines: content only when something else is on the page.
const ANSWER_LINE = /^[.\s…]+$/;

// The boxed notice printed on intentionally blank pages, often split across several text items.
const BLANK_PAGE_NOTICE = /^please do not write on this page\.?( answers written on this page will not be marked\.?)?$|^answers written on this page will not be marked\.?$/i;

export function isContinuationNote(text: string): boolean {
  // pdf.js often splits "(" or ")" into their own items, so a joined line reads "( Question 8 continued )".
  const t = text.trim().replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\s+/g, ' ');
  return NOTE_PATTERNS.some((p) => p.test(t));
}

/** Returns the content box of a slice, or null when nothing but furniture and blank space is left. */
export function contentBox(slice: Slice, page: PageSize, raster: GrayRaster, text: TextBox[]): Slice | null {
  const left = Math.max(slice.left ?? 0, (SIDE_MARGIN + bleed(page).x));
  const right = Math.min(slice.right ?? page.width, page.width - (SIDE_MARGIN + bleed(page).x));
  const bottom = Math.max(slice.lower, (FOOTER_BAND + bleed(page).y));
  const top = Math.min(slice.upper, page.height - (HEADER_BAND + bleed(page).y));
  if (right - left < 20 || top - bottom < 4) return null;

  return trimmed(slice, page, raster, text, left, right, bottom, top);
}

function trimmed(slice: Slice, page: PageSize, raster: GrayRaster, text: TextBox[], left: number, right: number, bottom: number, top: number): Slice | null {
  // Pixel masks for furniture text: page numbers, paper codes, continuation notes.
  const masked = text.filter((t) => isPageFurniture(t.text) || isContinuationNote(t.text));
  for (const line of textLines(text)) if (line.items.length > 1 && isContinuationNote(line.text)) masked.push(...line.items);
  const s = raster.scale;
  const toCol = (x: number) => Math.min(raster.width - 1, Math.max(0, Math.round(x * s)));
  const toRow = (y: number) => Math.min(raster.height - 1, Math.max(0, Math.round((page.height - y) * s)));
  const c0 = toCol(left), c1 = toCol(right), r0 = toRow(top), r1 = toRow(bottom);
  const w = c1 - c0 + 1;
  const mask = new Uint8Array(w * (r1 - r0 + 1));
  // Blank-page notice boxes ("Please do not write on this page. Answers written on this page will
  // not be marked.") are blanked out wholesale, border included, wherever they sit in the slice.
  const noticeAnchors = text.filter((t) => /write on this page|will not be marked|answers written on this page/i.test(t.text));
  const noticeRects = noticeAnchors.length ? clusterNotice(text, noticeAnchors) : [];
  for (const [x0, y0, x1, y1] of noticeRects) {
    const a = Math.max(c0, toCol(x0)), b = Math.min(c1, toCol(x1));
    const ra = Math.max(r0, toRow(y1)), rb = Math.min(r1, toRow(y0));
    for (let row = ra; row <= rb; row += 1) mask.fill(1, (row - r0) * w + (a - c0), (row - r0) * w + (b - c0) + 1);
  }
  for (const t of masked) {
    const a = Math.max(c0, toCol(t.x - 2)), b = Math.min(c1, toCol(t.x + t.width + 2));
    const ra = Math.max(r0, toRow(t.y + Math.max(t.height, 10) + 3)), rb = Math.min(r1, toRow(t.y - 3)); // pdf.js can report ~0 height
    for (let row = ra; row <= rb; row += 1) mask.fill(1, (row - r0) * w + (a - c0), (row - r0) * w + (b - c0) + 1);
  }
  // Per-row ink extent, then bands of ink separated by blank space.
  const rowMin = new Int32Array(r1 - r0 + 1).fill(-1);
  const rowMax = new Int32Array(r1 - r0 + 1).fill(-1);
  for (let row = r0; row <= r1; row += 1) {
    const base = row * raster.width;
    const mbase = (row - r0) * w - c0;
    for (let col = c0; col <= c1; col += 1) {
      if (raster.data[base + col] >= INK || mask[mbase + col]) continue;
      if (rowMin[row - r0] < 0) rowMin[row - r0] = col;
      rowMax[row - r0] = col;
    }
  }
  // The IB barcode sits centred just above the footer, often closer than BAND_GAP to an answer box,
  // so it would merge into the box's band. Rows near the page foot whose ink lies only in the centre
  // strip and carry no text are barcode rows: blank them before banding.
  const barcodeTop = toRow((BARCODE_ZONE + bleed(page).y));
  const centre0 = toCol(page.width * 0.3), centre1 = toCol(page.width * 0.7);
  const textRows = new Set<number>();
  for (const t of text) for (let row = toRow(t.y + t.height); row <= toRow(t.y); row += 1) textRows.add(row);
  for (let row = Math.max(r0, barcodeTop); row <= r1; row += 1) {
    const i = row - r0;
    if (rowMin[i] >= centre0 && rowMax[i] <= centre1 && !textRows.has(row)) { rowMin[i] = -1; rowMax[i] = -1; }
  }
  const gapRows = Math.round(BAND_GAP * s);
  const bands: { top: number; bottom: number; minX: number; maxX: number }[] = [];
  let blank = Infinity;
  for (let i = 0; i < rowMin.length; i += 1) {
    if (rowMin[i] < 0) { blank += 1; continue; }
    const row = i + r0;
    const b = bands[bands.length - 1];
    if (b && blank < gapRows) {
      b.bottom = row; b.minX = Math.min(b.minX, rowMin[i]); b.maxX = Math.max(b.maxX, rowMax[i]);
    } else bands.push({ top: row, bottom: row, minX: rowMin[i], maxX: rowMax[i] });
    blank = 0;
  }
  // Drop leading and trailing bands that hold only furniture: a barcode (ink but no text, short
  // and narrow) or text that is all page furniture or continuation notes.
  const bandText = (b: { top: number; bottom: number }) => {
    const yTop = page.height - b.top / s + 2, yBottom = page.height - b.bottom / s - 2;
    return text.filter((t) => t.y <= yTop && t.y + t.height >= yBottom && t.x + t.width >= left && t.x <= right);
  };
  const isFurnitureBand = (b: { top: number; bottom: number; minX: number; maxX: number }) => {
    const items = bandText(b);
    const heightPt = (b.bottom - b.top) / s, widthPt = (b.maxX - b.minX) / s;
    if (!items.length) return heightPt < 3 || (heightPt < 40 && widthPt < page.width * 0.45); // thin rule, barcode or stray mark
    const line = items.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
    return isContinuationNote(line) || BLANK_PAGE_NOTICE.test(line) || items.every((t) => isPageFurniture(t.text) || isContinuationNote(t.text));
  };
  while (bands.length && isFurnitureBand(bands[bands.length - 1])) bands.pop();
  while (bands.length && isFurnitureBand(bands[0])) bands.shift();
  if (!bands.length) return null;
  const minY = bands[0].top, maxY = bands[bands.length - 1].bottom;
  const minX = Math.min(...bands.map((b) => b.minX)), maxX = Math.max(...bands.map((b) => b.maxX));
  const inkWidth = (maxX - minX) / s;
  const inkHeight = (maxY - minY) / s;
  if (inkWidth < 4 && inkHeight < 4) return null; // specks

  const kept = bands.flatMap(bandText);
  if (kept.length && kept.every((t) => ANSWER_LINE.test(t.text) || isPageFurniture(t.text) || isContinuationNote(t.text))) return null;

  let lower = Math.max(bottom, page.height - maxY / s - PAD);
  // A slice cut at the page-foot line (~81pt) can clip an answer box's closing edge or a last option
  // printed lower. When the content runs into the cut, extend down to a wide horizontal rule or to real
  // text below it, but never to barcodes, crop marks or other furniture.
  if (slice.lower < (PAGE_FOOT_CUT + bleed(page).y) && slice.lower > (FOOTER_BAND + bleed(page).y) && lower - bottom < 12) {
    const x0 = toCol(left), x1 = toCol(right), width = x1 - x0 + 1;
    for (let y = bottom - 1; y >= (FOOTER_BAND + bleed(page).y); y -= 1 / s) {
      const row = toRow(y), base = row * raster.width;
      let inked = 0;
      for (let col = x0; col <= x1; col += 1) if (raster.data[base + col] < INK) inked += 1;
      if (inked >= width * 0.5) lower = Math.min(lower, y - 2);
    }
    for (const t of text) {
      if (t.y < (FOOTER_BAND + bleed(page).y) || t.y >= bottom || t.x + t.width < left || t.x > right) continue;
      if (isPageFurniture(t.text) || isContinuationNote(t.text) || ANSWER_LINE.test(t.text)) continue;
      lower = Math.min(lower, t.y - PAD);
    }
  }

  // Padding must not reach back into masked furniture (a continuation note printed just under a box).
  let upper = Math.min(top, page.height - minY / s + PAD);
  const inkBottom = page.height - maxY / s, inkTop = page.height - minY / s;
  for (const t of masked) {
    const tTop = t.y + Math.max(t.height, 10);
    if (tTop <= inkBottom + 0.5 && tTop + 1 > lower) lower = tTop + 1;
    if (t.y - 1 >= inkTop - 0.5 && t.y - 1 < upper) upper = t.y - 1;
  }

  return {
    page: slice.page,
    left: Math.max(left, minX / s - PAD),
    right: Math.min(right, maxX / s + PAD),
    lower: Math.max((FOOTER_BAND + bleed(page).y), lower),
    upper,
  };
}

/** Groups text items that share a baseline into lines, left to right. */
export function textLines(text: TextBox[]): { text: string; items: TextBox[] }[] {
  const sorted = text.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextBox[][] = [];
  for (const t of sorted) {
    const line = lines.find((l) => Math.abs(l[0].y - t.y) < 3);
    if (line) line.push(t); else lines.push([t]);
  }
  return lines.map((items) => {
    items.sort((a, b) => a.x - b.x);
    return { text: items.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim(), items };
  });
}

/** Groups notice words near each anchor into boxes, padded to cover the printed frame around them. */
function clusterNotice(text: TextBox[], anchors: TextBox[]): [number, number, number, number][] {
  const words = /^(please|do not|do|not|write|on this page\.?|write on this page\.?|answers written on this page|will not be marked\.?|answers|written|on|this|page\.?|will|be|marked\.?)$/i;
  const rects: [number, number, number, number][] = [];
  for (const a of anchors) {
    const near = text.filter((t) => Math.abs(t.y - a.y) < 40 && t.x > a.x - 160 && t.x < a.x + a.width + 160
      && (t === a || words.test(t.text.trim()) || /write on this page|will not be marked|answers written/i.test(t.text)));
    const x0 = Math.min(...near.map((t) => t.x)), x1 = Math.max(...near.map((t) => t.x + t.width));
    const y0 = Math.min(...near.map((t) => t.y)), y1 = Math.max(...near.map((t) => t.y + t.height));
    rects.push([x0 - 30, y0 - 22, x1 + 30, y1 + 22]);
  }
  return rects;
}
