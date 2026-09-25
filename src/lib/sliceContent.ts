import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Slice } from './catalog';
import type { LoadPdf } from './exportPdf';

/**
 * Detects slices that would export as an empty page. Some catalog slices cover only the
 * running header of the next page (paper code and page number, about 63 pt) or an 8-13 pt
 * strip of white space under an answer; exported on their own they look like blank pages.
 * Only short slices are ever treated as empty, so a tall diagram with no text is kept.
 */

export const MAX_EMPTY_SLICE_HEIGHT = 80;

const PAGE_FURNITURE = [
  /^[–—-]?\s*\d{1,3}\s*[–—-]?$/, // page number, "– 5 –"
  /^[MN]\d{2}\/\d\/[A-Z]+\/[A-Z0-9]+\/[A-Z]+\/[A-Z0-9]+\/[A-Z0-9]+$/i, // running paper code (session/level/subject/paper/language/zone)
  /^\d{4}\s*[–—-]\s*\d{4}$/, // 2218 – 6517
  /^\d+EP\d+$/i,
  /^turn over$/i,
  /^blank page$/i,
  /^©.*international baccalaureate.*$/i,
  /^please do not write on this page\.?$/i,
  /^answers written on this page will not be marked\.?$/i,
];

export interface TextPoint {
  x: number;
  y: number; // displayed coordinates, origin bottom-left
  text: string;
}

export function isPageFurniture(text: string): boolean {
  const trimmed = text.trim();
  return !trimmed || PAGE_FURNITURE.some((pattern) => pattern.test(trimmed));
}

/** True when a short slice holds nothing but white space or page furniture. */
export function isEmptySlice(slice: Slice, items: TextPoint[]): boolean {
  if (slice.upper - slice.lower > MAX_EMPTY_SLICE_HEIGHT) return false;
  const left = slice.left ?? -Infinity;
  const right = slice.right ?? Infinity;
  return !items.some((item) => item.y >= slice.lower - 2 && item.y <= slice.upper + 2
    && item.x >= left - 2 && item.x <= right + 2 && !isPageFurniture(item.text));
}

export type HasContent = (key: string, slice: Slice) => Promise<boolean>;

/**
 * Builds a content check backed by pdf.js text extraction. Call `close` when the export ends.
 * If text cannot be read, the slice is kept: a stray header page is better than a lost question.
 */
export function pdfContentCheck(load: LoadPdf, open: (bytes: Uint8Array) => { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> }) {
  const docs = new Map<string, { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> }>();
  const pages = new Map<string, Promise<TextPoint[]>>();
  const text = (key: string, index: number) => {
    const id = `${key}#${index}`;
    let found = pages.get(id);
    if (!found) {
      found = (async () => {
        let doc = docs.get(key);
        if (!doc) {
          doc = open(await load(key));
          docs.set(key, doc);
        }
        const page = await (await doc.promise).getPage(index + 1);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        page.cleanup();
        return content.items.flatMap((item) => {
          if (!('str' in item) || !item.str.trim()) return [];
          const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
          return [{ x, y: viewport.height - y, text: item.str }];
        });
      })();
      pages.set(id, found);
    }
    return found;
  };
  const hasContent: HasContent = async (key, slice) => {
    if (slice.upper - slice.lower > MAX_EMPTY_SLICE_HEIGHT) return true;
    try {
      return !isEmptySlice(slice, await text(key, slice.page));
    } catch {
      return true;
    }
  };
  const close = async () => {
    await Promise.all([...docs.values()].map((doc) => doc.destroy().catch(() => undefined)));
    docs.clear();
    pages.clear();
  };
  return { hasContent, close };
}
