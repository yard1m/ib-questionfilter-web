import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Slice } from './catalog';
import { displayedRect, displayedSize, normaliseRotation, type PageBox } from './geometry';

GlobalWorkerOptions.workerSrc = workerUrl;

const assets = `${import.meta.env.BASE_URL}pdfjs/`;

/** Opens a PDF for rendering. pdf.js takes ownership of the buffer, so it gets a copy. */
export function openForRendering(bytes: Uint8Array): { promise: Promise<PDFDocumentProxy>; destroy: () => Promise<void> } {
  const task = getDocument({
    data: bytes.slice(),
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
