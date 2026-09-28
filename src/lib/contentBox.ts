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
const INK = 190; // luminance below this counts as content
const PAD = 6;
const BAND_GAP = 9; // points of blank space that separate two bands

const NOTE_PATTERNS = [
  /^\(?this question continues on the following page\)?\.?$/i,
  /^\(?question \d+ continued\)?\.?$/i,
  /^\(?this question continues on page \d+\)?\.?$/i,
  /^\(?continued\s*(\.{2,}|…)?\)?$/i, // markscheme "(continued…)" notes
];

// The boxed notice printed on intentionally blank pages, often split across several text items.
const BLANK_PAGE_NOTICE = /^please do not write on this page\.?( answers written on this page will not be marked\.?)?$|^answers written on this page will not be marked\.?$/i;

export function isContinuationNote(text: string): boolean {
  const t = text.trim();
  return NOTE_PATTERNS.some((p) => p.test(t));
}

/** Returns the content box of a slice, or null when nothing but furniture and blank space is left. */
export function contentBox(slice: Slice, page: PageSize, raster: GrayRaster, text: TextBox[]): Slice | null {
  const left = Math.max(slice.left ?? 0, SIDE_MARGIN);
  const right = Math.min(slice.right ?? page.width, page.width - SIDE_MARGIN);
  const bottom = Math.max(slice.lower, FOOTER_BAND);
  const top = Math.min(slice.upper, page.height - HEADER_BAND);
  if (right - left < 20 || top - bottom < 4) return null;

  // Pixel masks for furniture text: page numbers, paper codes, continuation notes.
  const masked = text.filter((t) => isPageFurniture(t.text) || isContinuationNote(t.text));
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
    const ra = Math.max(r0, toRow(t.y + t.height + 3)), rb = Math.min(r1, toRow(t.y - 3));
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
    if (!items.length) return heightPt < 22 && widthPt < page.width * 0.4; // barcode or stray mark
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

  return {
    page: slice.page,
    left: Math.max(left, minX / s - PAD),
    right: Math.min(right, maxX / s + PAD),
    lower: Math.max(bottom, page.height - maxY / s - PAD),
    upper: Math.min(top, page.height - minY / s + PAD),
  };
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
