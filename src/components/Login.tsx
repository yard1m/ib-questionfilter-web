import { useState, type FormEvent } from 'react';
import type { DesignMode } from '../lib/design';
import { DesignToggle } from './DesignToggle';

export function Login({
  designMode,
  onDesignModeChange,
  onSignIn,
}: {
  designMode: DesignMode;
  onDesignModeChange: (mode: DesignMode) => void;
  onSignIn: (username: string, password: string) => Promise<string | null>;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const message = await onSignIn(username, password);
    setBusy(false);
    if (message) {
      setError(message);
      setPassword('');
    }
  }

  return (
    <main className="login">
      <div className="login-frame">
        <div className="login-head">
          <div className="archive-wordmark" aria-hidden="true">LITTLE <strong>RED</strong> BANK</div>
          <DesignToggle mode={designMode} onChange={onDesignModeChange} />
        </div>
        <div className="archive-attribution" aria-label="Site attribution">
          <div className="archive-motto">OMNIBUS PATEAT AEQUA VIA AD SCIENTIAM!</div>
          <div className="archive-credit">Built By yard1m_42</div>
        </div>
        <form className="panel login-card" onSubmit={submit} aria-labelledby="login-title">
          <h1 id="login-title">IB Question Filter</h1>
          <p className="muted">Private question bank. Sign in with the account you were given.</p>
          <label className="field">
            <span>Username</span>
            <input
              name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
              value={username} onChange={(e) => setUsername(e.target.value)} required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              name="password" type="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)} required
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn wide" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          <p className="muted small">There is no public sign-up. Ask the owner for an account.</p>
          <p className="muted small">
            Accounts are personal. Each one works on one device at a time, exported PDFs show the account
            name, and sign-ins (time, browser and a scrambled network code), previews and exports are
            recorded for the owner.
          </p>
        </form>
      </div>
    </main>
  );
}
