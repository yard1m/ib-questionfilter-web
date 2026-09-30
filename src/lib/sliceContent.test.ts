import { afterEach, describe, expect, it, vi } from 'vitest';
import { PDFDocument, PDFDict, PDFName, StandardFonts } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { createCanvas } from '@napi-rs/canvas';
import { resolve } from 'node:path';
import { parseCatalog } from './catalog';
import { exportMarkscheme, exportQuestions } from './exportPdf';
import { fixtureCatalog } from './fixtures';
import { isEmptySlice, isPageFurniture, pdfContentCheck } from './sliceContent';

afterEach(() => vi.unstubAllGlobals());

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const header = { page: 5, lower: 778.44, upper: 841.89, left: null, right: null };

describe('empty slice detection', () => {
  it('treats running headers and page numbers as furniture', () => {
    for (const text of ['m00/0/abcde/xyz/eng/tz0/xx', '– 5 –', 'n00/0/abcd/xy1/eng/tz9/xx', '12', 'Turn over', '2218 – 6517']) {
      expect(isPageFurniture(text)).toBe(true);
    }
    expect(isPageFurniture('The diagram shows a mass on a spring.')).toBe(false);
  });

  it('flags a header-only strip and a white-space strip but keeps real content', () => {
    expect(isEmptySlice(header, [{ x: 60, y: 800, text: 'm00/0/abcde/xyz/eng/tz0/xx' }, { x: 290, y: 800, text: '– 5 –' }])).toBe(true);
    expect(isEmptySlice({ page: 3, lower: 752, upper: 762, left: 60, right: 130 }, [])).toBe(true);
    expect(isEmptySlice(header, [{ x: 60, y: 790, text: '(c) Explain why the speed decreases.' }])).toBe(false);
  });

  it('never drops a tall slice, even without text (diagram-only regions)', () => {
    expect(isEmptySlice({ page: 1, lower: 300, upper: 600, left: null, right: null }, [])).toBe(false);
  });
});

describe('question export with a content check', () => {
  it('leaves out empty slices but always keeps one slice per question', async () => {
    const paper = await PDFDocument.create();
    const font = await paper.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 2; i += 1) paper.addPage([595, 842]).drawText('Synthetic page', { x: 60, y: 780, size: 12, font });
    const bytes = await paper.save();
    const catalog = parseCatalog(fixtureCatalog());
    const chosen = catalog.questions.filter((q) => q.subject === 'physics');
    const load = async () => bytes;
    const all = await exportQuestions(chosen, load, 'All');
    const none = await exportQuestions(chosen, load, 'None', undefined, async () => false);
    expect(all.pages).toBe(4);
    expect(none.pages).toBe(chosen.length);
    expect(none.exported).toBe(chosen.length);
  });
});

describe('PDF content-check export path', () => {
  it('exports a short diagram-only answer but excludes a furniture-only strip', async () => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    vi.stubGlobal('document', { createElement: () => createCanvas(1, 1) });
    const source = await PDFDocument.create();
    const font = await source.embedFont(StandardFonts.Helvetica);
    const page = source.addPage([595, 842]);
    page.drawText('Answer text', { x: 100, y: 600, size: 12, font });
    page.drawRectangle({ x: 100, y: 310, width: 45, height: 20 });
    page.drawText('12', { x: 280, y: 800, size: 12, font });
    const bytes = await source.save();
    const check = pdfContentCheck(async () => bytes.slice(), (data) => getDocument({ data, standardFontDataUrl: `${resolve('node_modules/pdfjs-dist/standard_fonts')}/` }));
    const question = parseCatalog(fixtureCatalog()).questions.find((q) => q.subject === 'chemistry')!;
    const diagram = { page: 0, lower: 300, upper: 350, left: null, right: null };
    const slices = [{ ...diagram, lower: 570, upper: 650 }, diagram, { ...header, page: 0 }];
    const checked: number[] = [];
    try {
      const output = await exportMarkscheme([{ ...question, answerSlices: slices }], async () => bytes.slice(), 'Diagram regression', undefined, check.hasContent,
        async (key, slice) => { checked.push(slice.lower); return check.contentBox(key, slice); });
      expect(checked).toEqual([570, 300]);
      const exported = await PDFDocument.load(output.bytes);
      const objects = exported.getPage(0).node.Resources()!.lookup(PDFName.of('XObject'), PDFDict);
      expect(objects.keys()).toHaveLength(2); // both text and the diagram were actually embedded
    } finally {
      await check.close();
    }
  });
});

describe('PDF content-check lifecycle', () => {
  it('does not open or render a PDF whose bytes arrive after close', async () => {
    const bytes = deferred<Uint8Array>();
    const open = vi.fn(() => ({ promise: Promise.resolve({} as PDFDocumentProxy), destroy: vi.fn(async () => {}) }));
    const check = pdfContentCheck(() => bytes.promise, open);
    const work = check.contentBox('late', { ...header, page: 0 });
    await check.close();
    bytes.resolve(new Uint8Array());
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(open).not.toHaveBeenCalled();
  });

  it('destroys a pending document once and never accesses its pages after close', async () => {
    const document = deferred<PDFDocumentProxy>();
    const getPage = vi.fn();
    const destroy = vi.fn(async () => {});
    const open = vi.fn(() => ({ promise: document.promise, destroy }));
    const check = pdfContentCheck(async () => new Uint8Array(), open);
    const work = check.contentBox('late-document', { ...header, page: 0 });
    await new Promise((done) => setTimeout(done, 0));
    await check.close();
    document.resolve({ getPage } as unknown as PDFDocumentProxy);
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(open).toHaveBeenCalledTimes(1); // text/raster share the pending open
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(getPage).not.toHaveBeenCalled();
  });

  it('propagates the builder signal so late content work cannot render after cancellation', async () => {
    const source = await PDFDocument.create();
    source.addPage().drawRectangle({ x: 100, y: 100, width: 20, height: 20 });
    const bytes = await source.save();
    const delayed = deferred<Uint8Array>();
    const started = deferred<void>();
    const open = vi.fn(() => ({ promise: Promise.resolve({} as PDFDocumentProxy), destroy: vi.fn(async () => {}) }));
    const check = pdfContentCheck(() => { started.resolve(); return delayed.promise; }, open);
    const controller = new AbortController();
    const question = parseCatalog(fixtureCatalog()).questions.find((q) => q.subject === 'chemistry')!;
    const work = exportMarkscheme([{ ...question, answerSlices: [{ ...header, page: 0 }] }], async () => bytes, 'Cancelled', undefined, check.hasContent, check.contentBox, controller.signal);
    const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await started.promise;
    controller.abort();
    await rejected;
    delayed.resolve(new Uint8Array());
    await new Promise((done) => setTimeout(done, 0));
    expect(open).not.toHaveBeenCalled();
    await check.close();
  });

  it('cleans up a late page without starting text extraction or rendering after close', async () => {
    const page = deferred<Awaited<ReturnType<PDFDocumentProxy['getPage']>>>();
    const render = vi.fn();
    const getTextContent = vi.fn();
    const cleanup = vi.fn();
    const destroy = vi.fn(async () => {});
    const doc = { getPage: () => page.promise } as unknown as PDFDocumentProxy;
    const check = pdfContentCheck(async () => new Uint8Array(), () => ({ promise: Promise.resolve(doc), destroy }));
    const work = check.contentBox('late-page', { ...header, page: 0 });
    await new Promise((done) => setTimeout(done, 0));
    await check.close();
    page.resolve({ render, getTextContent, cleanup } as unknown as Awaited<ReturnType<PDFDocumentProxy['getPage']>>);
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
    expect(render).not.toHaveBeenCalled();
    expect(getTextContent).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalled();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
