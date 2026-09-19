import { useEffect, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { callMembers, clearOneTimeSlot, isAdminVisible, setOneTimeSlot, type MemberRow, type OneTimeSlot } from '../lib/admin';

/**
 * Admin-only friends'-accounts panel. It stays hidden (renders nothing) unless
 * the `members` function answers `list` with 200 -- anonymous callers get 401
 * and non-admin members get 403, both of which keep the panel hidden.
 *
 * The generated password is shown exactly once with a copy button; dismissing
 * or adding another friend clears it from state (it is never stored anywhere).
 */
export function AdminPanel({ client }: { client: SupabaseClient }) {
  const [status, setStatus] = useState<number | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [username, setUsername] = useState('');
  const [note, setNote] = useState('');
  const [slot, setSlot] = useState<OneTimeSlot>(clearOneTimeSlot());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await callMembers(client, 'list');
    if (result.ok) {
      setStatus(200);
      setMembers(result.data.members ?? []);
    } else {
      setStatus(result.status);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function addFriend(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    // Showing a new password replaces the previous one: it was shown once.
    setSlot(clearOneTimeSlot());
    const result = await callMembers(client, 'add', { username, note: note || undefined });
    setBusy(false);
    if (result.ok) {
      setSlot(setOneTimeSlot(
        result.data.username ?? username.trim().toLowerCase(),
        result.data.password ?? null,
      ));
      setUsername('');
      setNote('');
      await refresh();
    } else {
      setMessage(result.error);
    }
  }

  async function resetPassword(userId: string) {
    setMessage(null);
    setSlot(clearOneTimeSlot());
    const result = await callMembers(client, 'reset', { user_id: userId });
    if (result.ok && result.data.password) {
      const member = members.find((m) => m.user_id === userId);
      setSlot(setOneTimeSlot(member?.username ?? null, result.data.password));
    } else if (!result.ok) {
      setMessage(result.error);
    }
  }

  async function removeAccess(userId: string) {
    setMessage(null);
    const result = await callMembers(client, 'remove', { user_id: userId });
    if (result.ok) await refresh();
    else setMessage(result.error);
  }

  function dismissPassword() {
    // The password was shown once; dismissing clears it for good.
    setSlot(clearOneTimeSlot());
  }

  if (!isAdminVisible(status)) return null;

  return (
    <section className="panel admin" aria-label="Friend accounts">
      <h2>Friend accounts</h2>
      <form onSubmit={addFriend} aria-label="Add friend">
        <label className="field">
          <span>Username</span>
          <input
            name="friend-username" autoComplete="off" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} required
          />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input
            name="friend-note" autoComplete="off" value={note}
            onChange={(e) => setNote(e.target.value)} maxLength={200}
          />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add friend'}</button>
      </form>

      {slot.password && (
        <div className="status ok" role="status">
          <p>
            Password for <strong>{slot.username}</strong> (shown once — copy it now):
          </p>
          <p><code>{slot.password}</code></p>
          <button
            type="button" className="btn secondary"
            onClick={() => { void navigator.clipboard?.writeText(slot.password ?? ''); }}
          >
            Copy password
          </button>
          <button type="button" className="link" onClick={dismissPassword}>Dismiss</button>
        </div>
      )}

      {message && <p className="error" role="alert">{message}</p>}

      <table>
        <thead>
          <tr><th>Username</th><th>Note</th><th>Last sign-in</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {members.map((member) => (
            <tr key={member.user_id}>
              <td>{member.username}</td>
              <td>{member.note ?? ''}</td>
              <td>{member.last_sign_in_at ?? 'never'}</td>
              <td>
                <button type="button" className="btn secondary" onClick={() => { void resetPassword(member.user_id); }}>
                  Reset password
                </button>
                <button type="button" className="btn secondary" onClick={() => { void removeAccess(member.user_id); }}>
                  Remove access
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
