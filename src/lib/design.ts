export type DesignMode = 'archive' | 'classic';

const STORAGE_KEY = 'ib-questionfilter-design-mode';

export function readDesignMode(): DesignMode {
  if (typeof window === 'undefined') return 'archive';
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'classic' ? 'classic' : 'archive';
  } catch {
    return 'archive';
  }
}

export function saveDesignMode(mode: DesignMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable in private browsing; the in-memory preference still works.
  }
}
