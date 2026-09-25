import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { parseCatalog } from './catalog';
import { exportQuestions } from './exportPdf';
import { fixtureCatalog } from './fixtures';
import { isEmptySlice, isPageFurniture } from './sliceContent';

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
