import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readConfig } from './config';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
// Vite replaces this expression with false in production, so the local corpus route and marker are
// absent from the published bundle.
const localCorpus = import.meta.env.DEV && import.meta.env.VITE_LOCAL_CORPUS === '1';
const result = readConfig(import.meta.env, localCorpus);

async function start() {
  if (!result.ok) {
    root.render(
      <main className="login">
        <div className="panel login-card">
          <h1>IB Question Filter</h1>
          <p>This site is not configured. Missing: {result.missing.join(', ')}.</p>
        </div>
      </main>,
    );
    return;
  }
  // The local corpus source exists only in development builds.
  const localSourceFactory = import.meta.env.DEV && result.config.localCorpus
    ? (await import('./lib/localSource')).localSource
    : undefined;
  root.render(
    <StrictMode>
      <App config={result.config} localSourceFactory={localSourceFactory} />
    </StrictMode>,
  );
}

void start();
