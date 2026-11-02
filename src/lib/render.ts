// The legacy build: the modern one calls Map.prototype.getOrInsertComputed, which only the newest
// browsers have. Elsewhere every page failed to render, so previews broke and clean exports
// silently fell back to untrimmed crops (headers, barcodes, the hatched margin, blank space).
import { GlobalWorkerOptions, PDFWorker, getDocument, type PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { Slice } from './catalog';
import { displayedRect, displayedSize, normaliseRotation, type PageBox } from './geometry';

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

/**
 * Opens a PDF for rendering. pdf.js takes ownership of the buffer, so it gets a copy. Without a
 * `worker`, pdf.js starts a worker thread for this document alone.
 */
export function openForRendering(bytes: Uint8Array, worker?: PDFWorker): { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } {
  const task = getDocument({
    data: bytes.slice(),
    worker,
    enableXfa: false,
    standardFontDataUrl: `${assets}standard_fonts/`,
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${assets}wasm/`,
    iccUrl: `${assets}iccs/`,
    verbosity: 0,
  });
  return { promise: task.promise, destroy: () => task.destroy() };
}

/**
 * A few shared pdf.js worker threads for an export, used in turn: papers are parsed and rendered in
 * parallel without starting (and loading the worker script into) one thread per paper.
 */
export function renderWorkers(size: number): { open: (bytes: Uint8Array) => ReturnType<typeof openForRendering>; destroy: () => void } {
  const workers = Array.from({ length: Math.max(1, size) }, () => new PDFWorker({ verbosity: 0 }));
  let next = 0;
  return {
    open: (bytes) => openForRendering(bytes, workers[next++ % workers.length]),
    destroy: () => { for (const worker of workers) worker.destroy(); },
  };
}

/**
 * Renders one slice to a canvas at the given CSS width. The slice is in displayed page
 * coordinates (origin bottom-left), which is also how pdf.js lays out a rotated page.
 */
export async function renderSlice(doc: PDFDocumentProxy, slice: Slice, cssWidth: number, pixelRatio: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(slice.page + 1);
  const [x0, y0, x1, y1] = page.view;
  const box: PageBox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rotation: normaliseRotation(page.rotate) };
  const size = displayedSize(box);
  const rect = displayedRect(box, slice);
  const scale = (cssWidth / (rect.right - rect.left)) * pixelRatio;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((rect.right - rect.left) * scale));
  canvas.height = Math.max(1, Math.round((rect.top - rect.bottom) * scale));
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${Math.round(canvas.height / pixelRatio)}px`;
  // Shift the page so the slice's top-left corner lands at the canvas origin.
  const transform = [1, 0, 0, 1, -rect.left * scale, -(size.height - rect.top) * scale];
  await page.render({ canvas, viewport, transform, annotationMode: 0 }).promise;
  page.cleanup();
  return canvas;
}
