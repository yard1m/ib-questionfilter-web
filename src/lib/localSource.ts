import { parseCatalog } from './catalog';
import type { CorpusSource, PdfMemoryCache } from './source';

/**
 * Development only (VITE_LOCAL_CORPUS=1 with `vite --mode local-corpus`): reads the corpus from
 * the private checkout through the dev server's loopback middleware. Production builds never
 * include this module, and the bundle verifier fails if its route appears in dist/.
 */
export function localSource(cache: PdfMemoryCache): CorpusSource {
  const base = '/__local-corpus/';
  return {
    async loadCatalog() {
      const response = await fetch(`${base}catalog.json`);
      if (!response.ok) throw new Error('Local catalog is missing; run Scripts/build_web_corpus.py first');
      return parseCatalog(await response.json());
    },
    loadPdf(key: string) {
      return cache.get(key, async () => {
        const response = await fetch(`${base}object/${encodeURIComponent(key)}`);
        if (!response.ok) throw new Error(`Local corpus object missing: ${key}`);
        return new Uint8Array(await response.arrayBuffer());
      });
    },
  };
}
