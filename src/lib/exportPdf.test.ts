import { describe, expect, it, vi } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { parseCatalog } from './catalog';
import { decorateExport, exportMarkscheme, exportQuestions, exportQuestionsClean, stampPages } from './exportPdf';
import { fixtureCatalog } from './fixtures';

/** Builds synthetic PDFs: a two-page portrait paper and a markscheme whose page is rotated 90°. */
async function syntheticFiles() {
  const paper = await PDFDocument.create();
  const font = await paper.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 2; i += 1) {
    const page = paper.addPage([595, 842]);
    page.drawText(`Synthetic page ${i + 1}`, { x: 60, y: 780, size: 12, font });
  }
  const markscheme = await PDFDocument.create();
  const msFont = await markscheme.embedFont(StandardFonts.Helvetica);
  const rotated = markscheme.addPage([595, 842]);
  rotated.setRotation(degrees(90));
  rotated.drawText('Synthetic answer', { x: 100, y: 100, size: 12, font: msFont });
  const plain = await PDFDocument.create();
  const plainFont = await plain.embedFont(StandardFonts.Helvetica);
  const plainPage = plain.addPage([595, 842]);
  plainPage.drawText('Synthetic answer on a content-bearing page', { x: 60, y: 780, size: 12, font: plainFont });
  const blank = await PDFDocument.create();
  blank.addPage([595, 842]);
  return {
    'test/papers/physics-p1-hl-2024.pdf': await paper.save(),
    'test/papers/physics-p2-sl-2019.pdf': await paper.save(),
    'test/papers/chemistry-p2-hl-2021.pdf': await paper.save(),
    'test/markschemes/physics-p1-hl-2024.pdf': await markscheme.save(),
    'test/markschemes/chemistry-p2-hl-2021.pdf': await plain.save(),
    'test/markschemes/blank.pdf': await blank.save(),
  } as Record<string, Uint8Array>;
}

describe('PDF exports', () => {
  it('exports one cropped page per question slice, in the given order', async () => {
    const files = await syntheticFiles();
    const catalog = parseCatalog(fixtureCatalog());
    const load = async (key: string) => files[key];
    const chosen = catalog.questions.filter((q) => q.subject === 'physics');
    const result = await exportQuestions(chosen, load, 'Physics Filtered Questions');
    expect(result.exported).toBe(3);
    const doc = await PDFDocument.load(result.bytes);
    // Q2 has one slice, Q1 two, the 2019 paper one: four pages.
    expect(doc.getPageCount()).toBe(4);
    const sizes = doc.getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
    expect(sizes).toEqual([[595, 300], [595, 300], [595, 300], [595, 730]]);
  });

  it('stacks answer slices on landscape pages and lists missing answers for review', async () => {
    const files = await syntheticFiles();
    const catalog = parseCatalog(fixtureCatalog());
    const load = async (key: string) => files[key];
    const chosen = catalog.questions.filter((q) => q.subject === 'physics');
    const result = await exportMarkscheme(chosen, load, 'Physics Markscheme');
    expect(result.exported).toBe(2);
    expect(result.skipped.map((s) => s.question.id)).toEqual(['physics-p2-sl-2019::Q1']);
    const doc = await PDFDocument.load(result.bytes);
    const sizes = doc.getPages().map((p) => [p.getWidth(), p.getHeight()]);
    // One landscape page holds both small answers; one review page lists the missing answer.
    expect(sizes).toEqual([[842, 595], [612, 792]]);
  });

  it('never writes review pages when every answer exists', async () => {
    const files = await syntheticFiles();
    const catalog = parseCatalog(fixtureCatalog());
    const chosen = catalog.questions.filter((q) => q.subject === 'chemistry');
    const result = await exportMarkscheme(chosen, async (key) => files[key], 'Chemistry Markscheme');
    expect(result.skipped).toEqual([]);
    expect(result.pages).toBe(1);
  });

  it('fails closed when an answer points at a blank source page', async () => {
    const files = await syntheticFiles();
    const catalog = parseCatalog(fixtureCatalog());
    const original = catalog.questions.find((q) => q.id === 'chemistry-p2-hl-2021::Q1')!;
    const blankQuestion = {
      ...original,
      document: { ...original.document, markschemeKey: 'test/markschemes/blank.pdf' },
    };
    await expect(exportMarkscheme([blankQuestion], async (key) => files[key], 'Blank answer')).rejects.toThrow(/missing Contents/i);
  });
});

describe('export stamp', () => {
  it('prints the account line on every page and skips an empty stamp', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const { stampPages } = await import('./exportPdf');
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    doc.addPage([842, 595]);
    const before = await doc.save();
    await stampPages(doc, '   ');
    expect((await doc.save()).length).toBe(before.length);
    await stampPages(doc, 'Exported for friend1 · 2026-09-19');
    expect((await doc.save()).length).toBeGreaterThan(before.length);
    expect(doc.getPageCount()).toBe(2);
  });
});

describe('export cancellation', () => {
  it('rejects all builders before loading a source when already aborted', async () => {
    const questions = parseCatalog(fixtureCatalog()).questions;
    const controller = new AbortController();
    controller.abort();
    const load = async () => { throw new Error('must not load'); };
    await expect(exportQuestions(questions, load, 'Cancelled', undefined, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(exportMarkscheme(questions, load, 'Cancelled', undefined, undefined, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(exportQuestionsClean(questions, load, 'Cancelled', { subject: 'Physics', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(decorateExport(new Uint8Array(), 'Cancelled', { subject: 'Physics', signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects promptly while a source load remains pending', async () => {
    const question = parseCatalog(fixtureCatalog()).questions[0];
    const controller = new AbortController();
    const pending = exportQuestions([question], async () => new Promise<Uint8Array>(() => {}), 'Cancelled', undefined, undefined, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('stops between content checks instead of embedding or checking more slices', async () => {
    const files = await syntheticFiles();
    const chosen = parseCatalog(fixtureCatalog()).questions.filter((q) => q.subject === 'physics');
    const controller = new AbortController();
    let checks = 0;
    const hasContent = async () => { checks += 1; controller.abort(); return true; };
    await expect(exportQuestions(chosen, async (key) => files[key], 'Cancelled', undefined, hasContent, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(checks).toBe(1);
  });

  it('lets timer-based cancellation interrupt cached clean-content loops', async () => {
    const files = await syntheticFiles();
    const question = parseCatalog(fixtureCatalog()).questions.find((q) => q.subject === 'chemistry')!;
    const controller = new AbortController();
    let checks = 0;
    await expect(exportQuestionsClean([{ ...question, questionSlices: Array(100).fill(question.questionSlices[0]) }], async (key) => files[key], 'Cancelled', {
      subject: 'Chemistry', signal: controller.signal,
      contentBox: async (_key, slice) => { checks += 1; if (checks === 1) setTimeout(() => controller.abort(), 0); return slice; },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(checks).toBeLessThan(100);
  });

  it('interrupts markscheme trimming after a timer abort before checking later slices', async () => {
    const files = await syntheticFiles();
    const question = parseCatalog(fixtureCatalog()).questions.find((q) => q.subject === 'chemistry')!;
    const controller = new AbortController();
    let checks = 0;
    await expect(exportMarkscheme([{ ...question, answerSlices: Array(20).fill(question.answerSlices![0]) }], async (key) => files[key], 'Cancelled', undefined, undefined,
      async (_key, slice) => { checks += 1; if (checks === 1) setTimeout(() => controller.abort(), 0); return slice; }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(checks).toBe(1);
  });

  it('yields between stamp pages after actual drawing has started', async () => {
    const doc = await PDFDocument.create();
    const first = doc.addPage([200, 100]);
    const second = doc.addPage([200, 100]);
    const controller = new AbortController();
    const draw = first.drawText.bind(first);
    const spy = vi.spyOn(first, 'drawText').mockImplementation((...args) => {
      draw(...args);
      setTimeout(() => controller.abort(), 0);
    });
    try {
      await expect(stampPages(doc, 'Stamp', controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
      expect(first.node.Contents()).toBeDefined();
      expect(second.node.Contents()).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });

  it('honours cancellation during decoration rather than returning a finished PDF', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 30; i += 1) doc.addPage([595, 842]);
    const bytes = await doc.save();
    const controller = new AbortController();
    const work = decorateExport(bytes, 'Cancelled', { subject: 'Physics', signal: controller.signal });
    setTimeout(() => controller.abort(), 0);
    await expect(work).rejects.toMatchObject({ name: 'AbortError' });
  });
});
