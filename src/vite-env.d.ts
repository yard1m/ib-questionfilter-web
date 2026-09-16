/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_CORPUS_BUCKET?: string;
  readonly VITE_CORPUS_PREFIX?: string;
  readonly VITE_USERNAME_DOMAIN?: string;
  readonly VITE_LOCAL_CORPUS?: string;
}
