/**
 * Build-time configuration. Every value here is public by design: the Supabase URL and the
 * publishable key identify the project, and the corpus prefix only locates objects that the
 * private bucket's row-level security serves to allowlisted members alone.
 */
export interface AppConfig {
  supabaseUrl: string;
  supabaseKey: string;
  bucket: string;
  corpusPrefix: string;
  usernameDomain: string;
  /** Development only: read the corpus from the local checkout instead of Supabase. */
  localCorpus: boolean;
}

export type ConfigResult = { ok: true; config: AppConfig } | { ok: false; missing: string[] };

type Env = Record<string, string | boolean | undefined>;

export function readConfig(env: Env, localCorpus = false): ConfigResult {
  const text = (name: string) => (typeof env[name] === 'string' ? (env[name] as string).trim() : '');
  const useLocalCorpus = localCorpus && env.DEV === true;
  const config: AppConfig = {
    supabaseUrl: text('VITE_SUPABASE_URL').replace(/\/+$/, ''),
    supabaseKey: text('VITE_SUPABASE_PUBLISHABLE_KEY'),
    bucket: text('VITE_CORPUS_BUCKET') || 'corpus',
    corpusPrefix: text('VITE_CORPUS_PREFIX'),
    usernameDomain: text('VITE_USERNAME_DOMAIN') || 'users.ibquestionbank.invalid',
    localCorpus: useLocalCorpus,
  };
  if (useLocalCorpus) return { ok: true, config };
  const missing: string[] = [];
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl)) missing.push('VITE_SUPABASE_URL');
  if (!config.supabaseKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!/^[a-z0-9][a-z0-9-]{5,62}$/.test(config.corpusPrefix)) missing.push('VITE_CORPUS_PREFIX');
  if (/^sb_secret_/i.test(config.supabaseKey) || /service_role/i.test(decodeJwtRole(config.supabaseKey))) {
    missing.push('VITE_SUPABASE_PUBLISHABLE_KEY (a secret key must never be used in the browser)');
  }
  return missing.length ? { ok: false, missing } : { ok: true, config };
}

function decodeJwtRole(key: string): string {
  const parts = key.split('.');
  if (parts.length !== 3) return '';
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    return String(JSON.parse(json).role ?? '');
  } catch {
    return '';
  }
}
