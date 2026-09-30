import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { contentBox, type TextBox } from './contentBox';
import { decorateExport, exportMarkscheme } from './exportPdf';
import { parseCatalog, type Slice } from './catalog';
import { fixtureCatalog } from './fixtures';

// Opt-in private sources only. Extract one page in memory; never copy corpus PDFs into web/.
const root = process.env.IB_EXPORT_PDF_ROOT;
const python = process.env.IB_EXPORT_PDF_PYTHON ?? 'python3';
const reviewDir = root && process.env.IB_EXPORT_REVIEW === '1' ? resolve(root, '.ibqf-work/export-review-task2') : undefined;
const inspect = `
import base64, json, sys, pypdfium2 as p
d = p.PdfDocument(sys.stdin.buffer.read())
pg = d[0]
w, h = pg.get_size()
x0, y0, x1, y1 = pg.get_bbox()
rotation = pg.get_rotation()
def point(x, y):
    x, y = x-x0, y-y0
    W, H = x1-x0, y1-y0
    return {0: (x,y), 90: (y,W-x), 180: (W-x,H-y), 270: (H-y,x)}[rotation]
tp = pg.get_textpage()
text = []
for i in range(tp.count_rects()):
    l,b,r,t = tp.get_rect(i)
    value = tp.get_text_bounded(l,b,r,t).strip()
    corners = [point(x,y) for x,y in ((l,b),(l,t),(r,b),(r,t))]
    xs,ys = zip(*corners)
    if value: text.append(dict(text=value,x=min(xs),y=min(ys),width=max(xs)-min(xs),height=max(ys)-min(ys)))
im = pg.render(scale=1.5).to_pil().convert('L')
if len(sys.argv) > 1: im.save(sys.argv[1])
print(json.dumps(dict(width=w,height=h,rotation=rotation,pixelsWidth=im.width,pixelsHeight=im.height,text=text,data=base64.b64encode(im.tobytes()).decode())))
d.close()
`;

function rendered(bytes: Uint8Array, name?: string) {
  if (reviewDir) mkdirSync(reviewDir, { recursive: true });
  const args = name && reviewDir ? [resolve(reviewDir, `${name}.png`)] : [];
  const result = JSON.parse(execFileSync(python, ['-c', inspect, ...args], { input: bytes, maxBuffer: 12 * 1024 * 1024 }).toString()) as {
    width: number; height: number; rotation: number; pixelsWidth: number; pixelsHeight: number; text: TextBox[]; data: string;
  };
  return { ...result, raster: { width: result.pixelsWidth, height: result.pixelsHeight, scale: 1.5, data: new Uint8Array(Buffer.from(result.data, 'base64')) } };
}

async function fixture(questionId: string, index: number) {
  const manifest = JSON.parse(readFileSync(resolve(root!, '.web-corpus/upload-manifest.json'), 'utf8')) as {
    catalogKey: string; objects: { key: string; file: string }[];
  };
  const localPath = (key: string) => {
    const item = manifest.objects.find((o) => o.key === key);
    if (!item) throw new Error(`Private fixture object missing: ${key}`);
    const path = resolve(root!, item.file);
    const rel = relative(resolve(root!), path);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('../')) throw new Error('Fixture path escapes opt-in private root');
    return path;
  };
  const catalog = parseCatalog(JSON.parse(readFileSync(localPath(manifest.catalogKey), 'utf8')));
  const question = catalog.questions.find((q) => q.id === questionId);
  if (!question?.document.markschemeKey) throw new Error(`Private fixture question missing: ${questionId}`);
  const slice = question.answerSlices?.find((s) => s.page === index);
  if (!slice) throw new Error(`Private fixture page missing: ${questionId} page ${index}`);
  const original = await PDFDocument.load(readFileSync(localPath(question.document.markschemeKey)));
  const small = await PDFDocument.create();
  const [page] = await small.copyPages(original, [index]);
  small.addPage(page);
  return { bytes: await small.save(), slice: { ...slice, page: 0 } };
}

describe.skipIf(!root)('private real-PDF crop regressions (IB_EXPORT_PDF_ROOT)', () => {
  it('retains the Nov2025 Q1 final marking line in a clean, upright export', async () => {
    const { bytes, slice } = await fixture('chemistry-paper-2-tz1-sl-2025-november::Q1', 4);
    const source = rendered(bytes, 'nov2025-q1-source-page5');
    const box = contentBox(slice, source, source.raster, source.text)!;
    const line = source.text.find((t) => t.text.includes('London dispersion forces'))!;
    expect(line).toBeDefined();
    expect(box.lower).toBeLessThanOrEqual(line.y);
    expect(box.upper).toBeLessThan(520); // source header stays outside
    expect(box.lower).toBeGreaterThanOrEqual(slice.lower);
    probe('nov2025-q1', source, slice, box, line);
    await reviewExport(bytes, { ...slice, lower: 50 }, 'nov2025-q1-before-footer-floor');
    await checkExport(bytes, box, 'London dispersion forces', 'nov2025-q1-after-clean');
  });

  it('restores all of Any one of on the rotated May2019 Q22 page in both layouts', async () => {
    const { bytes, slice } = await fixture('chemistry-paper-3-tz2-hl-may2019::Q22', 30);
    const source = rendered(bytes, 'may2019-q22-source-page31');
    const line = source.text.find((t) => t.text.includes('Any one of:'))!;
    expect(line).toBeDefined();
    expect(slice.upper).toBeGreaterThanOrEqual(line.y + line.height);
    expect(source.width).toBeGreaterThan(source.height);
    const clean = contentBox(slice, source, source.raster, source.text)!;
    expect(clean.upper).toBeGreaterThanOrEqual(line.y + line.height);
    probe('may2019-q22', source, slice, clean, line);
    await reviewExport(bytes, { ...slice, upper: 482.84 }, 'may2019-q22-before-original');
    await checkExport(bytes, slice, 'Any one of:', 'may2019-q22-after-original');
    await checkExport(bytes, clean, 'Any one of:', 'may2019-q22-after-clean');
  });
});

function probe(name: string, source: { width: number; height: number; rotation: number }, catalog: Slice, clean: Slice, line: TextBox) {
  if (reviewDir) writeFileSync(resolve(reviewDir, `${name}-probe.json`), JSON.stringify({
    displayedPage: { width: source.width, height: source.height, rotation: source.rotation }, catalogCrop: catalog, cleanCrop: clean, markingLine: line,
  }, null, 2));
}

type Crop = { page: number; lower: number; upper: number; left: number | null; right: number | null };

async function reviewExport(bytes: Uint8Array, slice: Crop, name: string) {
  const question = parseCatalog(fixtureCatalog()).questions.find((q) => q.subject === 'chemistry')!;
  const output = await exportMarkscheme([{ ...question, answerSlices: [slice] }], async () => bytes, 'Crop regression');
  if (reviewDir) {
    writeFileSync(resolve(reviewDir, `${name}.pdf`), output.bytes);
    rendered(output.bytes, name);
    if (name.endsWith('clean')) {
      const decorated = await decorateExport(output.bytes, 'Crop regression', { subject: 'Chemistry', admin: true });
      writeFileSync(resolve(reviewDir, `${name}-decorated.pdf`), decorated);
      rendered(decorated, `${name}-decorated`);
    }
  }
  return output.bytes;
}

async function checkExport(bytes: Uint8Array, slice: Crop, phrase: string, name: string) {
  const result = rendered(await reviewExport(bytes, slice, name));
  const line = result.text.find((t) => t.text.includes(phrase))!;
  expect(line).toBeDefined();
  expect(line.width).toBeGreaterThan(line.height); // displayed text is upright, not quarter-turned
  for (const furniture of result.text.filter((t) => /8825|M19\/4\/CHEMI/.test(t.text))) {
    let ink = 0;
    const { scale, width, height, data } = result.raster;
    for (let y = Math.max(0, Math.floor((result.height - furniture.y - furniture.height) * scale)); y < Math.min(height, (result.height - furniture.y) * scale); y += 1) {
      for (let x = Math.max(0, Math.floor(furniture.x * scale)); x < Math.min(width, (furniture.x + furniture.width) * scale); x += 1) {
        if (data[y * width + x] < 190) ink += 1;
      }
    }
    expect(ink).toBe(0); // PDF text extraction includes clipped content; displayed ink must not.
  }
  // Embedded text extraction alone includes clipped glyphs: require ink throughout its last line.
  const row = Math.round((result.height - line.y - line.height / 2) * result.raster.scale);
  const start = Math.round(line.x * result.raster.scale);
  const end = Math.round((line.x + line.width) * result.raster.scale);
  const pixels = result.raster.data.subarray(row * result.raster.width + start, row * result.raster.width + end);
  expect([...pixels].filter((v) => v < 190).length).toBeGreaterThan(10);
}
