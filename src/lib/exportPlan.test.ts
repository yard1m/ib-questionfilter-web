import { describe, expect, it } from 'vitest';
import { PDFDocument, PDFName, PDFRawStream, StandardFonts } from 'pdf-lib';
import { parseCatalog, type Question } from './catalog';
import { exportMarkscheme, exportQuestions } from './exportPdf';
import { pagePlan, subsetPdf } from './exportPlan';
import { slicePages } from './slicePages';
import { fixtureCatalog } from './fixtures';

/** A PDF whose pages have distinct sizes, so a copy's page order can be checked. */
async function sizedPdf(count: number) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < count; i += 1) doc.addPage([500 + i * 10, 800]).drawText(`Synthetic page ${i + 1}`, { x: 40, y: 700, size: 12, font });
  return doc.save();
}

function forms(bytes: Uint8Array) {
  return PDFDocument.load(bytes).then((doc) => [...doc.context.enumerateIndirectObjects()]
    .map(([, obj]) => obj)
    .filter((obj): obj is PDFRawStream => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')));
}

describe('export page plan', () => {
  const catalog = parseCatalog(fixtureCatalog());

  it('asks each paper for just the pages used, in the order the builders need them', () => {
    const chosen = catalog.questions.filter((q) => q.subject === 'physics');
    const plan = pagePlan(chosen, true);
    expect(plan.files.map((f) => [f.key, f.pages])).toEqual([
      ['test/papers/physics-p1-hl-2024.pdf', [0, 1]],
      ['test/markschemes/physics-p1-hl-2024.pdf', [0]],
      ['test/papers/physics-p2-sl-2019.pdf', [0]],
    ]);
    expect(plan.slices).toHaveLength(chosen.reduce((n, q) => n + q.questionSlices.length + (q.answerSlices?.length ?? 0), 0));
    expect(pagePlan(chosen, false).files.every((f) => f.key.includes('/papers/'))).toBe(true);
  });

  it('renumbers slices within the smaller PDF and leaves everything else alone', () => {
    const base = catalog.questions.find((q) => q.id === 'chemistry-p2-hl-2021::Q1')!;
    const question: Question = {
      ...base,
      questionSlices: [{ ...base.questionSlices[0], page: 7 }, { ...base.questionSlices[0], page: 3 }],
      answerSlices: [{ ...base.answerSlices![0], page: 5 }],
    };
    const plan = pagePlan([question], true);
    expect(plan.files.map((f) => f.pages)).toEqual([[3, 7], [5]]);
    const [planned] = plan.questions;
    expect(planned.questionSlices.map((s) => s.page)).toEqual([1, 0]);
    expect(planned.answerSlices!.map((s) => s.page)).toEqual([0]);
    expect(planned.document.paperKey).toBe(plan.files[0].subsetKey);
    expect(planned.document.markschemeKey).toBe(plan.files[1].subsetKey);
    expect({ ...planned, document: question.document, questionSlices: question.questionSlices, answerSlices: question.answerSlices }).toEqual(question);
  });

  it('copies the chosen pages in order when cutting a paper locally', async () => {
    const subset = await PDFDocument.load(await subsetPdf(await sizedPdf(5), [1, 3, 4]));
    expect(subset.getPages().map((p) => p.getWidth())).toEqual([510, 530, 540]);
  });

  it('exports the same pages from the smaller PDFs as from whole papers', async () => {
    const files: Record<string, Uint8Array> = {};
    for (const q of catalog.questions) {
      files[q.document.paperKey] = await sizedPdf(2);
      if (q.document.markschemeKey) files[q.document.markschemeKey] = await sizedPdf(1);
    }
    const plan = pagePlan(catalog.questions, true);
    const subsets: Record<string, Uint8Array> = {};
    for (const file of plan.files) subsets[file.subsetKey] = await subsetPdf(files[file.key], file.pages);
    const sizes = async (bytes: Uint8Array) => (await PDFDocument.load(bytes)).getPages().map((p) => [Math.round(p.getWidth()), Math.round(p.getHeight())]);
    const whole = await exportQuestions(catalog.questions, async (key) => files[key], 'Whole');
    const cut = await exportQuestions(plan.questions, async (key) => subsets[key], 'Cut');
    expect(await sizes(cut.bytes)).toEqual(await sizes(whole.bytes));
    const wholeAnswers = await exportMarkscheme(catalog.questions, async (key) => files[key], 'Whole');
    const cutAnswers = await exportMarkscheme(plan.questions, async (key) => subsets[key], 'Cut');
    expect(cutAnswers.exported).toBe(wholeAnswers.exported);
    expect(await sizes(cutAnswers.bytes)).toEqual(await sizes(wholeAnswers.bytes));
  });
});

describe('region embedding', () => {
  it('stores each source page once however many slices show it', async () => {
    const catalog = parseCatalog(fixtureCatalog());
    const paper = await sizedPdf(2);
    const chosen = catalog.questions.filter((q) => q.subject === 'physics');
    // Q2 and Q1 both show page 0 of the 2024 paper; Q1 also shows page 1; the 2019 paper adds one.
    const result = await exportQuestions([...chosen, ...chosen], async () => paper, 'Twice');
    const all = await forms(result.bytes);
    const wrappers = all.filter((f) => f.contents.length < 20);
    expect(all.length - wrappers.length).toBe(3);
    expect(wrappers).toHaveLength(8);
  });
});

describe('preview pages', () => {
  const slices = [{ page: 7, lower: 100, upper: 400, left: null, right: null }, { page: 3, lower: 500, upper: 800, left: null, right: null }];

  it('fetches only the pages the slices use and renumbers them', async () => {
    const asked: number[][] = [];
    const result = await slicePages('paper', slices, async () => { throw new Error('whole paper not needed'); }, async (_key, pages) => { asked.push(pages); return new Uint8Array([1]); });
    expect(asked).toEqual([[3, 7]]);
    expect(result.slices.map((s) => s.page)).toEqual([1, 0]);
  });

  it('falls back to the whole paper with the slices unchanged', async () => {
    const whole = new Uint8Array([2]);
    const result = await slicePages('paper', slices, async () => whole, async () => { throw new Error('no pages function'); });
    expect(result).toEqual({ bytes: whole, slices });
    expect((await slicePages('paper', slices, async () => whole)).slices).toBe(slices);
  });
});
