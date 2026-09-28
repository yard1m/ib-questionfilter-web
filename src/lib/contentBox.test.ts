import { describe, expect, it } from 'vitest';
import { contentBox, isContinuationNote, type GrayRaster } from './contentBox';

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
