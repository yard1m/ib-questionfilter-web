import type { SupabaseClient } from '@supabase/supabase-js';
import { CatalogError, parseCatalog, type Catalog } from './catalog';
import { parseSearchTexts, type SearchTexts } from './search';

/** Where the private corpus comes from. Production always reads the private Supabase bucket. */
export interface CorpusSource {
  loadCatalog(): Promise<Catalog>;
  loadPdf(key: string): Promise<Uint8Array>;
  /** Just the given pages (ascending) of a PDF, as a smaller PDF. Callers fall back to loadPdf. */
  loadPages?(key: string, pages: number[]): Promise<Uint8Array>;
  /** The word-search texts (search.json), downloaded on first search. */
  loadSearch?(): Promise<SearchTexts>;
}

export class AccessDeniedError extends Error {}

/**
 * Keeps recently used PDFs in memory for this tab only, so previews and exports do not download
 * the same paper twice. Nothing is written to disk or browser storage.
 */
export class PdfMemoryCache {
  private entries = new Map<string, Promise<Uint8Array>>();
  private sizes = new Map<string, number>();
  constructor(private readonly maxBytes = 160 * 1024 * 1024) {}

  get(key: string, load: () => Promise<Uint8Array>): Promise<Uint8Array> {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const pending = load().then((bytes) => {
      this.sizes.set(key, bytes.byteLength);
      this.evict();
      return bytes;
    });
    pending.catch(() => {
      this.entries.delete(key);
      this.sizes.delete(key);
    });
    this.entries.set(key, pending);
    return pending;
  }

  clear(): void {
    this.entries.clear();
    this.sizes.clear();
  }

  private evict(): void {
    let total = [...this.sizes.values()].reduce((a, b) => a + b, 0);
    for (const key of this.entries.keys()) {
      if (total <= this.maxBytes || this.entries.size <= 1) break;
      total -= this.sizes.get(key) ?? 0;
      this.entries.delete(key);
      this.sizes.delete(key);
    }
  }
}

export function supabaseSource(client: SupabaseClient, bucket: string, prefix: string, cache: PdfMemoryCache): CorpusSource {
  // The site is served from a home connection with limited upload, so a request can stall or drop.
  // Retry transient failures (never access errors) a few times with a growing pause.
  async function download(key: string): Promise<Blob> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await downloadOnce(key);
      } catch (error) {
        if (error instanceof AccessDeniedError || attempt >= 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    }
  }

  async function downloadOnce(key: string): Promise<Blob> {
    const { data, error } = await client.storage.from(bucket).download(key);
    if (error || !data) {
      // Row-level security reports objects outside a member's access as "not found".
      const status = (error as { statusCode?: string | number; status?: number } | null);
      const code = Number(status?.statusCode ?? status?.status ?? 0);
      if (code === 400 || code === 401 || code === 403 || code === 404 || /not found|unauthori[sz]ed/i.test(error?.message ?? '')) {
        throw new AccessDeniedError('This account is not allowed to open the question bank.');
      }
      throw new Error('The question bank could not be downloaded. Try again.');
    }
    return data;
  }

  return {
    async loadCatalog() {
      const blob = await download(`${prefix}/catalog.json`);
      let raw: unknown;
      try {
        raw = JSON.parse(await blob.text());
      } catch {
        throw new CatalogError('The question catalog is not valid JSON');
      }
      return parseCatalog(raw);
    },
    async loadSearch() {
      return parseSearchTexts(JSON.parse(await (await download(`${prefix}/search.json`)).text()));
    },
    loadPdf(key: string) {
      if (!key.startsWith(`${prefix}/`)) return Promise.reject(new Error('Unexpected corpus object'));
      return cache.get(key, async () => new Uint8Array(await (await download(key)).arrayBuffer()));
    },
    // The `pages` function cuts the pages out next to storage, so only they cross the home
    // connection. The response is immutable for a corpus version, so the browser caches it.
    async loadPages(key: string, pages: number[]) {
      if (!key.startsWith(`${prefix}/`)) throw new Error('Unexpected corpus object');
      for (let attempt = 1; ; attempt += 1) {
        const { data, error } = await client.functions.invoke(`pages?key=${encodeURIComponent(key)}&pages=${pages.join(',')}`, { method: 'GET' });
        if (!error && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
        const status = (error as { context?: { status?: number } } | null)?.context?.status ?? 0;
        if ((status >= 400 && status < 500) || attempt >= 3) throw error ?? new Error('Unexpected pages response');
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      }
    },
  };
}
