import type { Slice } from './catalog';

export type LoadPdf = (key: string) => Promise<Uint8Array>;
export type LoadPages = (key: string, pages: number[]) => Promise<Uint8Array>;

/**
 * For previews and practice: fetches just the pages the slices use and renumbers the slices to
 * match. Papers average about 1 MB, a question's pages a small fraction of that. Without a page
 * loader, or if it fails, the whole paper is used with the slices unchanged.
 */
export async function slicePages(key: string, slices: Slice[], loadPdf: LoadPdf, loadPages?: LoadPages): Promise<{ bytes: Uint8Array; slices: Slice[] }> {
  if (loadPages) {
    const pages = [...new Set(slices.map((s) => s.page))].sort((a, b) => a - b);
    try {
      const bytes = await loadPages(key, pages);
      return { bytes, slices: slices.map((s) => ({ ...s, page: pages.indexOf(s.page) })) };
    } catch {
      // fall back to the whole paper below
    }
  }
  return { bytes: await loadPdf(key), slices };
}
