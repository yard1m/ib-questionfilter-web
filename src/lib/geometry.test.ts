import { describe, expect, it } from 'vitest';
import { displayedRect, displayedSize, normaliseRotation, placement, transformPoint, userRect, type PageBox } from './geometry';

const portrait: PageBox = { x: 0, y: 0, width: 595, height: 842, rotation: 0 };

/** pypdf transfer_rotation_to_content, reimplemented to cross-check userRect. */
function toDisplayed(box: PageBox, ux: number, uy: number) {
  const { x: x0, y: y0, width: w, height: h } = box;
  switch (box.rotation) {
    case 0: return { x: ux - x0, y: uy - y0 };
    case 90: return { x: uy - y0, y: w + x0 - ux };
    case 180: return { x: w + x0 - ux, y: h + y0 - uy };
    case 270: return { x: h + y0 - uy, y: ux - x0 };
  }
}

describe('geometry', () => {
  it('normalises rotations', () => {
    expect(normaliseRotation(0)).toBe(0);
    expect(normaliseRotation(90)).toBe(90);
    expect(normaliseRotation(-90)).toBe(270);
    expect(normaliseRotation(450)).toBe(90);
  });

  it('swaps the displayed size for quarter turns', () => {
    expect(displayedSize(portrait)).toEqual({ width: 595, height: 842 });
    expect(displayedSize({ ...portrait, rotation: 90 })).toEqual({ width: 842, height: 595 });
  });

  it('uses the full width for question slices and clamps to the page', () => {
    expect(displayedRect(portrait, { page: 0, lower: 100, upper: 900, left: null, right: null }))
      .toEqual({ left: 0, bottom: 100, right: 595, top: 842 });
  });

  it('maps displayed rectangles back to user space for every rotation', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const box: PageBox = { x: 10, y: 20, width: 595, height: 842, rotation };
      const size = displayedSize(box);
      const rect = { left: 50, bottom: 60, right: Math.min(400, size.width - 1), top: Math.min(300, size.height - 1) };
      const user = userRect(box, rect);
      const corners = [
        toDisplayed(box, user.left, user.bottom),
        toDisplayed(box, user.right, user.top),
        toDisplayed(box, user.left, user.top),
        toDisplayed(box, user.right, user.bottom),
      ];
      const xs = corners.map((c) => c.x);
      const ys = corners.map((c) => c.y);
      expect(Math.min(...xs)).toBeCloseTo(rect.left);
      expect(Math.max(...xs)).toBeCloseTo(rect.right);
      expect(Math.min(...ys)).toBeCloseTo(rect.bottom);
      expect(Math.max(...ys)).toBeCloseTo(rect.top);
    }
  });

  it('places rotated regions upright inside their target box', () => {
    for (const rotation of [0, 90, 180, 270] as const) {
      const box: PageBox = { x: 0, y: 0, width: 595, height: 842, rotation };
      const display = { left: 40, bottom: 100, right: 540, top: 260 };
      const region = userRect(box, display);
      const scale = 1.5;
      const target = { x: 32, y: 200 };
      const p = placement(box, region, target.x, target.y, scale);
      // The embedded form's local box runs from (0,0) to the region's user-space size.
      const w = region.right - region.left;
      const h = region.top - region.bottom;
      const pts = [[0, 0], [w, 0], [0, h], [w, h]].map(([u, v]) => transformPoint(u, v, p, scale));
      const xs = pts.map((q) => q.x);
      const ys = pts.map((q) => q.y);
      const displayWidth = (display.right - display.left) * scale;
      const displayHeight = (display.top - display.bottom) * scale;
      expect(Math.min(...xs)).toBeCloseTo(target.x);
      expect(Math.max(...xs)).toBeCloseTo(target.x + displayWidth);
      expect(Math.min(...ys)).toBeCloseTo(target.y);
      expect(Math.max(...ys)).toBeCloseTo(target.y + displayHeight);
      // The displayed top-left of the slice must land at the target's top-left.
      const userTopLeft = (() => {
        const { x: x0, y: y0, width: W, height: H } = box;
        switch (rotation) {
          case 0: return [display.left + x0, display.top + y0];
          case 90: return [W + x0 - display.top, y0 + display.left];
          case 180: return [W + x0 - display.left, H + y0 - display.top];
          case 270: return [x0 + display.top, H + y0 - display.left];
        }
      })();
      const drawn = transformPoint(userTopLeft[0] - region.left, userTopLeft[1] - region.bottom, p, scale);
      expect(drawn.x).toBeCloseTo(target.x);
      expect(drawn.y).toBeCloseTo(target.y + displayHeight);
    }
  });
});
