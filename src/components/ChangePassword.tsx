import { useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Lets any signed-in member set their own new password with
 * `supabase.auth.updateUser({password})`, so friends replace the generated
 * one-time password and the owner never knows their final password.
 */
export function ChangePassword({ client }: { client: SupabaseClient }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (password.length < 8) {
      setMessage({ kind: 'error', text: 'Use at least 8 characters.' });
      return;
    }
    if (password !== confirm) {
      setMessage({ kind: 'error', text: 'The two passwords do not match.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await client.auth.updateUser({ password });
    setBusy(false);
    setPassword('');
    setConfirm('');
    setMessage(error
      ? { kind: 'error', text: 'Could not change the password. Try again.' }
      : { kind: 'ok', text: 'Password changed.' });
  }

  return (
    <section className="panel" aria-label="Change password">
      <h2>Change password</h2>
      <form onSubmit={submit}>
        <label className="field">
          <span>New password</span>
          <input
            name="new-password" type="password" autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required
          />
        </label>
        <label className="field">
          <span>Confirm new password</span>
          <input
            name="confirm-password" type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)} required
          />
        </label>
        {message && (
          <p className={message.kind === 'error' ? 'error' : 'status ok'} role={message.kind === 'error' ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
        <button className="btn secondary" type="submit" disabled={busy}>
          {busy ? 'Changing…' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
