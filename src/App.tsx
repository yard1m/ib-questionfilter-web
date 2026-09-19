import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import type { AppConfig } from './config';
import { LoginInputError, loginEmail, signInErrorMessage } from './lib/auth';
import type { Catalog } from './lib/catalog';
import { AccessDeniedError, PdfMemoryCache, supabaseSource, type CorpusSource } from './lib/source';
import { readDesignMode, saveDesignMode, type DesignMode } from './lib/design';
import { Login } from './components/Login';
import { QuestionBrowser } from './components/QuestionBrowser';
import { AdminPanel } from './components/AdminPanel';
import { ChangePassword } from './components/ChangePassword';

type CatalogState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; catalog: Catalog }
  | { status: 'denied' }
  | { status: 'error' };

type AccessState = 'checking' | 'ok' | 'replaced' | 'suspended' | 'expired' | 'not_member';

function toAccessState(value: string): AccessState {
  return (['ok', 'replaced', 'suspended', 'expired', 'not_member'] as const).find((s) => s === value) ?? 'ok';
}

const ACCESS_TITLES: Record<Exclude<AccessState, 'ok' | 'checking'>, string> = {
  replaced: 'Signed in on another device',
  suspended: 'Access paused',
  expired: 'Access period ended',
  not_member: 'Access not enabled',
};

const ACCESS_MESSAGES: Record<Exclude<AccessState, 'ok' | 'checking'>, string> = {
  replaced: 'Each account works on one device at a time, and this one was just signed in somewhere else. Sign in again to use it here; the other device will be signed out.',
  suspended: 'The owner has paused this account. Ask them if you think this is a mistake.',
  expired: 'This account was set up for a limited period, which has now ended. Ask the owner to extend it.',
  not_member: 'This account signed in successfully but has not been added to the question bank.',
};

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
  const [designMode, setDesignMode] = useState<DesignMode>(() => readDesignMode());
  // One device per account: 'ok' lets the catalog load; anything else shows why it cannot.
  const [access, setAccess] = useState<AccessState>(config.localCorpus ? 'ok' : 'checking');
  const justSignedIn = useRef(false);

  useEffect(() => {
    document.documentElement.dataset.design = designMode;
    saveDesignMode(designMode);
  }, [designMode]);

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

  // Checks, and when this is a fresh sign-in claims, the account's single active session.
  useEffect(() => {
    if (config.localCorpus) return;
    if (!client || !userId) {
      setAccess('checking');
      return;
    }
    let active = true;
    const check = async (allowClaim: boolean) => {
      const { data, error } = await client.rpc('session_status');
      if (!active) return;
      if (error) {
        setAccess('ok'); // storage row-level security still enforces access if the check itself fails
        return;
      }
      let state = String(data);
      if (allowClaim && (state === 'unclaimed' || (state === 'replaced' && justSignedIn.current))) {
        justSignedIn.current = false;
        const claim = await client.rpc('claim_session');
        if (!active) return;
        state = claim.error ? state : (claim.data === 'ok' ? 'ok' : String(claim.data));
      }
      setAccess(toAccessState(state));
    };
    void check(true);
    const timer = window.setInterval(() => { void check(false); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void check(false); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [client, userId, config.localCorpus]);

  useEffect(() => {
    if (access !== 'ok' && !config.localCorpus) {
      cache.clear();
      if (access !== 'checking') setCatalogState({ status: 'idle' });
    }
  }, [access, cache, config.localCorpus]);

  useEffect(() => {
    if (!source || access !== 'ok') return;
    let active = true;
    setCatalogState({ status: 'loading' });
    source.loadCatalog()
      .then((catalog) => { if (active) setCatalogState({ status: 'ready', catalog }); })
      .catch((error) => { if (active) setCatalogState({ status: error instanceof AccessDeniedError ? 'denied' : 'error' }); });
    return () => { active = false; };
    // Reload only when the signed-in user (or the source) changes, not on token refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, config.localCorpus, access]);

  const signIn = useCallback(async (username: string, password: string) => {
    if (!client) return 'Sign-in is not available.';
    let email: string;
    try {
      email = loginEmail(username, config.usernameDomain);
    } catch (error) {
      return error instanceof LoginInputError ? error.message : 'Incorrect username or password.';
    }
    justSignedIn.current = true;
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) justSignedIn.current = false;
    return error ? signInErrorMessage(error) : null;
  }, [client, config.usernameDomain]);

  const signOut = useCallback(async () => {
    cache.clear();
    setCatalogState({ status: 'idle' });
    if (client) await client.auth.signOut();
  }, [client, cache]);

  const logActivity = useCallback((kind: 'preview' | 'export' | 'markscheme', subject: string, items: number) => {
    if (!client || config.localCorpus) return;
    void client.rpc('log_activity', { kind, subject, items });
  }, [client, config.localCorpus]);

  const loadPdf = useCallback((key: string) => {
    if (!source) return Promise.reject(new Error('Not signed in'));
    return source.loadPdf(key);
  }, [source]);

  if (!authReady) return <Centered><p className="muted" role="status">Loading…</p></Centered>;
  if (!config.localCorpus && !session) {
    return <Login designMode={designMode} onDesignModeChange={setDesignMode} onSignIn={signIn} />;
  }

  if (!config.localCorpus && access !== 'ok' && access !== 'checking') {
    return (
      <Centered>
        <h1>{ACCESS_TITLES[access]}</h1>
        <p>{ACCESS_MESSAGES[access]}</p>
        <button type="button" className="btn wide" onClick={signOut}>{access === 'replaced' ? 'Sign in again' : 'Sign out'}</button>
      </Centered>
    );
  }

  const account = config.localCorpus ? 'Local corpus (development)' : (session?.user.email ?? '').replace(`@${config.usernameDomain}`, '');

  switch (catalogState.status) {
    case 'ready':
      return (
        <>
          <QuestionBrowser
            catalog={catalogState.catalog}
            loadPdf={loadPdf}
            account={account}
            onSignOut={signOut}
            designMode={designMode}
            onDesignModeChange={setDesignMode}
            stamp={config.localCorpus ? undefined : `Exported for ${account} · ${new Date().toISOString().slice(0, 10)} · personal account, do not share`}
            onActivity={logActivity}
            accountTools={client && !config.localCorpus ? (
              <>
                <AdminPanel client={client} catalog={catalogState.catalog} />
                <ChangePassword client={client} />
              </>
            ) : undefined}
          />
        </>
      );
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
