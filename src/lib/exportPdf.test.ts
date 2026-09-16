import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { parseCatalog } from './catalog';
import { exportMarkscheme, exportQuestions } from './exportPdf';
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
