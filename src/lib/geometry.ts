import type { Slice } from './catalog';

/**
 * Slice coordinates are in the page's displayed orientation (after /Rotate), with the origin at the
 * bottom-left, matching the desktop exporters (pdfminer layout; pypdf transfer_rotation_to_content).
 * Question slices span the full displayed width; answer slices may narrow it with left/right.
 */
export interface PageBox {
  /** Unrotated MediaBox origin and size in PDF user space. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Page /Rotate, normalised to 0, 90, 180 or 270 (clockwise). */
  rotation: 0 | 90 | 180 | 270;
}

export interface Rect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export function normaliseRotation(value: number): PageBox['rotation'] {
  const r = (((Math.round(value / 90) * 90) % 360) + 360) % 360;
  return r as PageBox['rotation'];
}

export function displayedSize(box: PageBox): { width: number; height: number } {
  return box.rotation % 180 === 0 ? { width: box.width, height: box.height } : { width: box.height, height: box.width };
}

/** The slice as a rectangle in displayed coordinates, clamped to the displayed page. */
export function displayedRect(box: PageBox, slice: Slice): Rect {
  const size = displayedSize(box);
  const left = Math.max(0, slice.left ?? 0);
  const right = Math.min(size.width, slice.right ?? size.width);
  const bottom = Math.max(0, slice.lower);
  const top = Math.min(size.height, slice.upper);
  if (right <= left || top <= bottom) throw new Error('Slice lies outside its page');
  return { left, bottom, right, top };
}

/**
 * Maps a displayed rectangle back to unrotated user space. For a clockwise /Rotate 90 page of
 * MediaBox width W, displayed (x', y') = (y - y0, W + x0 - x), as in pypdf's rotation transfer.
 */
export function userRect(box: PageBox, rect: Rect): Rect {
  const { x: x0, y: y0, width: w, height: h } = box;
  switch (box.rotation) {
    case 0:
      return { left: x0 + rect.left, bottom: y0 + rect.bottom, right: x0 + rect.right, top: y0 + rect.top };
    case 90:
      return { left: x0 + w - rect.top, bottom: y0 + rect.left, right: x0 + w - rect.bottom, top: y0 + rect.right };
    case 180:
      return { left: x0 + w - rect.right, bottom: y0 + h - rect.top, right: x0 + w - rect.left, top: y0 + h - rect.bottom };
    case 270:
      return { left: x0 + rect.bottom, bottom: y0 + h - rect.right, right: x0 + rect.top, top: y0 + h - rect.left };
  }
}

/**
 * Where to draw an embedded user-space region so that it appears upright (as displayed) with its
 * lower-left corner at (x, y) and scale s. pdf-lib applies translate, then rotate (counter-clockwise
 * degrees), then scale.
 */
export function placement(box: PageBox, region: Rect, x: number, y: number, scale: number) {
  const w = (region.right - region.left) * scale;
  const h = (region.top - region.bottom) * scale;
  switch (box.rotation) {
    case 0:
      return { x, y, rotate: 0 };
    case 90:
      return { x, y: y + w, rotate: -90 };
    case 180:
      return { x: x + w, y: y + h, rotate: -180 };
    case 270:
      return { x: x + h, y, rotate: -270 };
  }
}

/** Applies translate(x, y) · rotate(deg) · scale(s) to a point, for tests and assertions. */
export function transformPoint(px: number, py: number, p: { x: number; y: number; rotate: number }, scale: number) {
  const rad = (p.rotate * Math.PI) / 180;
  const sx = px * scale;
  const sy = py * scale;
  return {
    x: p.x + sx * Math.cos(rad) - sy * Math.sin(rad),
    y: p.y + sx * Math.sin(rad) + sy * Math.cos(rad),
  };
}
