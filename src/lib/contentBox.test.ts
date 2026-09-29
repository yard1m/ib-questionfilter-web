import { describe, expect, it } from 'vitest';
import { contentBox, isContinuationNote, textLines, type GrayRaster } from './contentBox';

const PAGE = { width: 595, height: 842 };
/** A white page raster at 1 px/pt with black rectangles given in displayed points (origin bottom-left). */
function raster(rects: [number, number, number, number][]): GrayRaster {
  const data = new Uint8Array(PAGE.width * PAGE.height).fill(255);
  for (const [x0, y0, x1, y1] of rects) {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[(PAGE.height - 1 - y) * PAGE.width + x] = 0;
  }
  return { width: PAGE.width, height: PAGE.height, scale: 1, data };
}
const whole = { page: 0, lower: 0, upper: 842, left: null, right: null };

describe('clean-layout content box', () => {
  it('recognises continuation notes', () => {
    expect(isContinuationNote('(This question continues on the following page)')).toBe(true);
    expect(isContinuationNote('(Question 1 continued)')).toBe(true);
    expect(isContinuationNote('(a) State why the temperature')).toBe(false);
    for (const note of ['(Option A continues on the following page)', '(Option B continues on page 23)', '(Option A, question 5 continued)',
      '(Option D continued)', '(Question 13c continued)', '(Question continued)', 'Do not write solutions on this page', 'End of Option B',
      'Option C — Energy', '(continued...)']) expect(isContinuationNote(note), note).toBe(true);
    for (const text of ['Which option continues the reaction?', 'D. continued heating', 'Option A is correct because']) expect(isContinuationNote(text), text).toBe(false);
  });

  it('trims the hatched margin, header band, barcode and trailing blank space', () => {
    const r = raster([
      [575, 0, 595, 842], // hatched answer margin down the right edge
      [280, 800, 320, 810], // running header "– 3 –"
      [100, 500, 480, 700], // question content
      [250, 60, 340, 75], // barcode: short, narrow, no text
    ]);
    const box = contentBox(whole, PAGE, r, [])!;
    expect(box.left).toBeGreaterThanOrEqual(90);
    expect(box.right).toBeLessThanOrEqual(490);
    expect(box.lower).toBeGreaterThan(480);
    expect(box.upper).toBeLessThan(720);
  });

  it('drops a barcode printed right under an answer box, closer than the band gap', () => {
    // Answer box outline ending at y=82, barcode 4pt below it (Maths paper 1 layout).
    const r = raster([[100, 700, 480, 720], [60, 82, 535, 84], [60, 82, 62, 690], [533, 82, 535, 690], [60, 688, 535, 690], [250, 66, 340, 78]]);
    const box = contentBox(whole, PAGE, r, [{ x: 100, y: 705, width: 300, height: 10, text: 'Find P(B).' }])!;
    expect(box.lower).toBeGreaterThan(76);
    expect(box.lower).toBeLessThan(82);
  });

  it('keeps an answer box bottom edge printed below the page-foot cut', () => {
    const r = raster([[100, 600, 480, 700], [60, 72, 535, 74], [60, 72, 62, 590], [533, 72, 535, 590]]);
    const box = contentBox({ page: 0, lower: 81.4, upper: 842, left: null, right: null }, PAGE, r, [])!;
    expect(box.lower).toBeLessThan(72);
  });

  it('returns null for a page holding only answer lines and furniture, and drops Section B boilerplate', () => {
    const r = raster([[100, 300, 480, 302], [100, 330, 480, 332], [280, 800, 300, 808]]);
    const lines = [{ x: 100, y: 300, width: 380, height: 3, text: '. . . . . . . . . . . .' }, { x: 100, y: 330, width: 380, height: 3, text: '..........' }];
    expect(contentBox(whole, PAGE, r, lines)).toBeNull();
    for (const t of ['Section B', 'Do not write solutions on this page. Answer all questions in the answer booklet provided. Please start each question on a new page.'])
      expect(isContinuationNote(t), t).toBe(true);
  });

  it('keeps the padding clear of a continuation note printed just under an answer box', () => {
    const r = raster([[100, 500, 480, 700], [60, 84, 535, 86], [60, 68, 330, 79]]);
    const note = [{ x: 60, y: 68, width: 270, height: 0, text: '(This question continues on the following page)' }];
    expect(contentBox(whole, PAGE, r, note)!.lower).toBeGreaterThanOrEqual(79); // note ink ends at 79
  });

  it('drops a trailing continuation note and returns null for a notice-only slice', () => {
    const r = raster([[100, 500, 480, 700], [60, 440, 330, 452]]);
    const note = [{ x: 60, y: 441, width: 270, height: 10, text: '(This question continues on the following page)' }];
    expect(contentBox(whole, PAGE, r, note)!.lower).toBeGreaterThan(480);
    const blank = raster([[200, 400, 400, 460]]);
    const notice = [{ x: 210, y: 440, width: 60, height: 9, text: 'Please' }, { x: 272, y: 440, width: 40, height: 9, text: 'do not' },
      { x: 314, y: 440, width: 80, height: 9, text: 'write on this page.' }, { x: 220, y: 420, width: 170, height: 9, text: 'Answers written on this page' },
      { x: 250, y: 408, width: 110, height: 9, text: 'will not be marked.' }];
    expect(contentBox(whole, PAGE, blank, notice)).toBeNull();
  });
});

describe('textLines', () => {
  it('joins split text items on one baseline so split notes are recognised', () => {
    const box = (text: string, x: number, y: number) => ({ text, x, y, width: 40, height: 10 });
    const lines = textLines([box('on the following page)', 200, 100), box('(Option A continues', 80, 101), box('(b) Explain', 80, 300)]);
    expect(lines.map((l) => l.text)).toEqual(['(b) Explain', '(Option A continues on the following page)']);
    expect(isContinuationNote(lines[1].text)).toBe(true);
  });
});

describe('bleed pages (2019-2020 papers, 642 x 889 pt)', () => {
  it('shifts the side margin and bands inward so the strip, crop marks and barcode drop out', () => {
    const W = 642, H = 889;
    const data = new Uint8Array(W * H).fill(255);
    const ink = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[(H - 1 - y) * W + x] = 0;
    };
    ink(100, 500, 540, 700); // question
    ink(600, 90, 618, 800); // hatched strip, right of A4 content
    ink(40, 70, 42, 90); ink(600, 70, 602, 90); // crop marks
    ink(290, 90, 360, 112); // barcode, 23.5 pt higher than on A4
    const box = contentBox({ page: 0, lower: 0, upper: H, left: null, right: null }, { width: W, height: H },
      { width: W, height: H, scale: 1, data }, [{ x: 100, y: 690, width: 200, height: 10, text: 'Find x.' }])!;
    expect(box.right).toBeLessThan(560);
    expect(box.lower).toBeGreaterThan(480);
  });
});

describe('landscape markscheme pages (842 x 595 pt)', () => {
  it('are not mistaken for bleed pages, so table text near the side margin is kept', () => {
    const W = 842, H = 595;
    const data = new Uint8Array(W * H).fill(255);
    for (let y = 300; y < 400; y += 1) for (let x = 45; x < 800; x += 1) data[(H - 1 - y) * W + x] = 0;
    const box = contentBox({ page: 0, lower: 0, upper: H, left: null, right: null }, { width: W, height: H },
      { width: W, height: H, scale: 1, data }, [{ x: 45, y: 390, width: 300, height: 10, text: 'fullerene: each carbon is bonded to 3 C' }])!;
    expect(box.left).toBeLessThan(46);
    expect(box.right).toBeGreaterThan(799);
  });
});

