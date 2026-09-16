import { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config';
import { LoginInputError, loginEmail, signInErrorMessage } from './lib/auth';
import type { Catalog } from './lib/catalog';
import { AccessDeniedError, PdfMemoryCache, supabaseSource, type CorpusSource } from './lib/source';
import { Login } from './components/Login';
import { QuestionBrowser } from './components/QuestionBrowser';

type CatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; catalog: Catalog }
  | { status: 'denied' }
  | { status: 'error' };

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="login"><div className="panel login-card">{children}</div></main>;
}

export function App({ config, localSourceFactory }: {
  config: AppConfig;
  localSourceFactory?: (cache: PdfMemoryCache) => CorpusSource;
}) {
  const cache = useMemo(() => new PdfMemoryCache(), []);
  const client = useMemo<SupabaseClient | null>(() => (config.localCorpus ? null : createClient(config.supabaseUrl, config.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, flowType: 'pkce' },
  })), [config]);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(config.localCorpus);
  const [catalogState, setCatalogState] = useState<CatalogState>({ status: 'idle' });

  const source = useMemo<CorpusSource | null>(() => {
    if (config.localCorpus && localSourceFactory) return localSourceFactory(cache);
    if (client && session) return supabaseSource(client, config.bucket, config.corpusPrefix, cache);
    return null;
  }, [config, client, session, cache, localSourceFactory]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      if (!next) {
        cache.clear();
        setCatalogState({ status: 'idle' });
      }
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, [client, cache]);

  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!source) return;
    let active = true;
    setCatalogState({ status: 'loading' });
    source.loadCatalog()
      .then((catalog) => { if (active) setCatalogState({ status: 'ready', catalog }); })
      .catch((error) => { if (active) setCatalogState({ status: error instanceof AccessDeniedError ? 'denied' : 'error' }); });
    return () => { active = false; };
    // Reload only when the signed-in user (or the source) changes, not on token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, config.localCorpus]);

  const signIn = useCallback(async (username: string, password: string) => {
    if (!client) return 'Sign-in is not available.';
    let email: string;
    try {
      email = loginEmail(username, config.usernameDomain);
    } catch (error) {
      return error instanceof LoginInputError ? error.message : 'Incorrect username or password.';
    }
    const { error } = await client.auth.signInWithPassword({ email, password });
    return error ? signInErrorMessage(error) : null;
  }, [client, config.usernameDomain]);

  const signOut = useCallback(async () => {
    cache.clear();
    setCatalogState({ status: 'idle' });
    if (client) await client.auth.signOut();
  }, [client, cache]);

  const loadPdf = useCallback((key: string) => {
    if (!source) return Promise.reject(new Error('Not signed in'));
    return source.loadPdf(key);
  }, [source]);

  if (!authReady) return <Centered><p className="muted" role="status">Loading…</p></Centered>;
  if (!config.localCorpus && !session) return <Login onSignIn={signIn} />;

  const account = config.localCorpus ? 'Local corpus (development)' : (session?.user.email ?? '').replace(`@${config.usernameDomain}`, '');

  switch (catalogState.status) {
    case 'ready':
      return <QuestionBrowser catalog={catalogState.catalog} loadPdf={loadPdf} account={account} onSignOut={signOut} />;
    case 'denied':
      return (
        <Centered>
          <h1>Access not enabled</h1>
          <p>This account signed in successfully but has not been added to the question bank.</p>
          <button type="button" className="btn wide" onClick={signOut}>Sign out</button>
        </Centered>
      );
    case 'error':
      return (
        <Centered>
          <h1>Could not load the question bank</h1>
          <p className="muted">Check your connection and reload the page.</p>
          <button type="button" className="btn wide" onClick={() => window.location.reload()}>Reload</button>
        </Centered>
      );
    default:
      return <Centered><p className="muted" role="status">Loading the question bank…</p></Centered>;
  }
}
