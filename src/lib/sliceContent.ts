import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { Slice } from './catalog';
import type { LoadPdf } from './exportPdf';
import { contentBox as findContentBox, type GrayRaster, type TextBox } from './contentBox';

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

/** Text-only emptiness candidate. Confirm with raster content before discarding a short slice. */
export function isEmptySlice(slice: Slice, items: TextPoint[]): boolean {
  if (slice.upper - slice.lower > MAX_EMPTY_SLICE_HEIGHT) return false;
  const left = slice.left ?? -Infinity;
  const right = slice.right ?? Infinity;
  return !items.some((item) => item.y >= slice.lower - 2 && item.y <= slice.upper + 2
    && item.x >= left - 2 && item.x <= right + 2 && !isPageFurniture(item.text));
}

export type HasContent = (key: string, slice: Slice, signal?: AbortSignal) => Promise<boolean>;
/** Resolves a slice to its content box (clean layout), or null when it holds only furniture. */
export type ContentBox = (key: string, slice: Slice, signal?: AbortSignal) => Promise<Slice | null>;

const RASTER_SCALE = 1.5;

/** A slice to check ahead of the export loop, see `prefetch`. */
export interface PlannedSlice {
  key: string;
  slice: Slice;
}

const sliceId = (key: string, s: Slice) => `${key}#${s.page}:${s.lower}:${s.upper}:${s.left ?? ''}:${s.right ?? ''}`;

/**
 * Builds a content check backed by pdf.js text extraction. Call `close` when the export ends.
 * If text cannot be read, the slice is kept: a stray header page is better than a lost question.
 * Results are cached per slice, so `prefetch` can work out a whole export's boxes ahead of (and in
 * parallel with) the builders, which then only read the cache.
 */
export function pdfContentCheck(load: LoadPdf, open: (bytes: Uint8Array) => { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> }, signal?: AbortSignal) {
  type PdfTask = ReturnType<typeof open>;
  const docs = new Map<string, Promise<PDFDocumentProxy>>();
  const tasks = new Set<PdfTask>();
  const taskFor = new Map<string, PdfTask>();
  const destruction = new Map<PdfTask, Promise<void>>();
  const renders = new Set<RenderTask>();
  const signals = new Map<AbortSignal, () => void>();
  let closed = false;
  let closeReason: unknown;
  let closing: Promise<void> | undefined;
  const pages = new Map<string, Promise<TextBox[]>>();
  const rasters = new Map<string, Promise<{ raster: GrayRaster; width: number; height: number }>>();
  const boxes = new Map<string, Promise<Slice | null>>();
  const guard = () => { if (closed) throw closeReason; };
  const destroy = (task: PdfTask) => {
    let work = destruction.get(task);
    if (!work) {
      work = Promise.resolve().then(() => task.destroy()).catch(() => undefined);
      destruction.set(task, work);
    }
    return work;
  };
  const close = (reason: unknown = new DOMException('PDF content check is closed', 'AbortError')): Promise<void> => {
    if (closing) return closing;
    closed = true; // close the registration lane before any pending load can resume
    closeReason = reason;
    for (const [signal, abort] of signals) signal.removeEventListener('abort', abort);
    signals.clear();
    for (const render of renders) render.cancel();
    docs.clear();
    taskFor.clear();
    pages.clear();
    rasters.clear();
    boxes.clear();
    closing = Promise.all([...tasks].map(destroy)).then(() => { tasks.clear(); });
    return closing;
  };
  const watch = (signal?: AbortSignal) => {
    if (signal?.aborted) void close(signal.reason);
    guard();
    if (signal && !signals.has(signal)) {
      const abort = () => { void close(signal.reason); };
      signals.set(signal, abort);
      signal.addEventListener('abort', abort, { once: true });
    }
  };
  const docFor = async (key: string) => {
    guard();
    let doc = docs.get(key);
    if (!doc) {
      doc = (async () => {
        const bytes = await load(key);
        guard(); // do not open a late download after close/cancellation
        const task = open(bytes);
        void task.promise.catch(() => undefined);
        tasks.add(task);
        taskFor.set(key, task);
        // An opener may synchronously trigger cancellation before returning its task.
        if (closed) { await destroy(task); guard(); }
        const document = await task.promise;
        guard();
        return document;
      })();
      docs.set(key, doc);
    }
    const document = await doc;
    guard();
    return document;
  };
  const text = (key: string, index: number) => {
    const id = `${key}#${index}`;
    let found = pages.get(id);
    if (!found) {
      found = (async () => {
        const doc = await docFor(key);
        guard();
        const page = await doc.getPage(index + 1);
        try {
          guard();
          const viewport = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          guard();
          return content.items.flatMap((item) => {
            if (!('str' in item) || !item.str.trim()) return [];
            const [x, y] = viewport.convertToViewportPoint(item.transform[4], item.transform[5]);
            return [{ x, y: viewport.height - y, text: item.str, width: item.width, height: item.height || Math.abs(item.transform[3]) }];
          });
        } finally {
          page.cleanup();
        }
      })();
      pages.set(id, found);
    }
    return found;
  };
  const hasContent: HasContent = async (key, slice, signal) => {
    watch(signal);
    if (slice.upper - slice.lower > MAX_EMPTY_SLICE_HEIGHT) return true;
    try {
      const t = await text(key, slice.page);
      guard();
      if (!isEmptySlice(slice, t)) return true;
      // A short diagram has no extractable text. Only the furniture-masked raster can prove
      // that this candidate is genuinely empty; use the same crop logic as the clean exporter.
      const box = await boxOf(key, slice);
      guard();
      return box !== null;
    } catch {
      guard(); // cancellation/closure is not an unreadable-page fallback
      return true;
    }
  };
  // Rasterises a page to grey levels once; used only by the clean export layout.
  const raster = (key: string, index: number) => {
    const id = `${key}#${index}`;
    let found = rasters.get(id);
    if (!found) {
      found = (async () => {
        const doc = await docFor(key);
        guard();
        const page = await doc.getPage(index + 1);
        let render: RenderTask | undefined;
        try {
          guard();
          const viewport = page.getViewport({ scale: RASTER_SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          render = page.render({ canvas, viewport, annotationMode: 0 });
          renders.add(render);
          if (closed) render.cancel();
          await render.promise;
          guard();
          const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
          const data = new Uint8Array(canvas.width * canvas.height);
          for (let i = 0, j = 0; i < data.length; i += 1, j += 4) data[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
          return { raster: { width: canvas.width, height: canvas.height, scale: RASTER_SCALE, data }, width: viewport.width / RASTER_SCALE, height: viewport.height / RASTER_SCALE };
        } finally {
          if (render) renders.delete(render);
          page.cleanup();
        }
      })();
      rasters.set(id, found);
    }
    return found;
  };
  const boxOf = (key: string, slice: Slice) => {
    const id = sliceId(key, slice);
    let found = boxes.get(id);
    if (!found) {
      found = (async () => {
        const [r, t] = await Promise.all([raster(key, slice.page), text(key, slice.page)]);
        guard();
        return findContentBox(slice, { width: r.width, height: r.height }, r.raster, t);
      })();
      void found.catch(() => undefined);
      boxes.set(id, found);
    }
    return found;
  };
  const contentBox: ContentBox = async (key, slice, signal) => {
    watch(signal);
    try {
      const box = await boxOf(key, slice);
      guard();
      return box;
    } catch {
      guard();
      return slice; // unreadable page: keep the original crop rather than lose the question
    }
  };
  /**
   * Works out the checks for every planned slice, `concurrency` pages at a time in plan order, so the
   * builders find the answers ready instead of waiting on one page at a time. Each page's raster
   * is dropped once its slices are done, and each PDF is closed once its pages are done, so memory
   * stays flat however large the export. `boxes` resolves content boxes (clean layout); otherwise
   * only the emptiness checks for short slices are run. Never rejects: errors surface (or fall back)
   * when the builders ask for the same slice.
   */
  const prefetch = async (items: PlannedSlice[], options: { concurrency: number; boxes: boolean }) => {
    const groups = new Map<string, PlannedSlice[]>();
    const remaining = new Map<string, number>();
    for (const item of items) {
      if (!options.boxes && item.slice.upper - item.slice.lower > MAX_EMPTY_SLICE_HEIGHT) continue;
      const id = `${item.key}#${item.slice.page}`;
      if (!groups.has(id)) {
        groups.set(id, []);
        remaining.set(item.key, (remaining.get(item.key) ?? 0) + 1);
      }
      groups.get(id)!.push(item);
    }
    const queue = [...groups.entries()];
    const worker = async () => {
      for (let next = queue.shift(); next && !closed; next = queue.shift()) {
        const [id, group] = next;
        await Promise.all(group.map(({ key, slice }) => (options.boxes ? boxOf(key, slice) : hasContent(key, slice)).catch(() => undefined)));
        rasters.delete(id);
        const key = group[0].key;
        const left = (remaining.get(key) ?? 1) - 1;
        remaining.set(key, left);
        if (left === 0 && !closed) release(key);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, options.concurrency) }, worker));
  };
  // Closes a finished PDF. A later request for it (a slice outside the plan) simply reopens it.
  const release = (key: string) => {
    const task = taskFor.get(key);
    docs.delete(key);
    taskFor.delete(key);
    if (task) void destroy(task);
  };
  watch(signal);
  return { hasContent, contentBox, prefetch, close };
}
