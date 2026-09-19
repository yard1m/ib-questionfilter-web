import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Catalog } from '../lib/catalog';
import {
  callMembers, clearOneTimeSlot, daysSince, describeLastSeen, isAdminVisible, memberStatus, setOneTimeSlot,
  type AuditEntry, type MemberRow, type OneTimeSlot,
} from '../lib/admin';

/**
 * Admin-only panel. It renders nothing unless the `members` function answers `list` with 200;
 * anonymous callers get 401 and non-admin members 403, which keep it hidden.
 *
 * Generated passwords are shown exactly once with a copy button; dismissing or generating
 * another clears the previous one from state (they are never stored anywhere).
 */
export function AdminPanel({ client, catalog }: { client: SupabaseClient; catalog?: Catalog }) {
  const [status, setStatus] = useState<number | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [username, setUsername] = useState('');
  const [note, setNote] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [slot, setSlot] = useState<OneTimeSlot>(clearOneTimeSlot());
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const result = await callMembers(client, 'list');
    if (!result.ok) {
      setStatus(result.status);
      return;
    }
    setStatus(200);
    setMembers(result.data.members ?? []);
    const audit = await callMembers(client, 'audit');
    if (audit.ok) setEntries(audit.data.entries ?? []);
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function run(action: Parameters<typeof callMembers>[1], body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setMessage(null);
    const result = await callMembers(client, action, body);
    if (!result.ok) setMessage(result.error);
    await refresh();
  }

  async function addFriend(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setSlot(clearOneTimeSlot());
    const result = await callMembers(client, 'add', {
      username, note: note || undefined, expires_on: expiresOn || undefined,
    });
    setBusy(false);
    if (result.ok) {
      setSlot(setOneTimeSlot(result.data.username ?? username.trim().toLowerCase(), result.data.password ?? null));
      setUsername('');
      setNote('');
      setExpiresOn('');
      await refresh();
    } else {
      setMessage(result.error);
    }
  }

  async function resetPassword(member: MemberRow) {
    if (!window.confirm(`Reset the password for ${member.username}? Their current password stops working.`)) return;
    setMessage(null);
    setSlot(clearOneTimeSlot());
    const result = await callMembers(client, 'reset', { user_id: member.user_id });
    if (result.ok && result.data.password) setSlot(setOneTimeSlot(member.username, result.data.password));
    else if (!result.ok) setMessage(result.error);
    await refresh();
  }

  function changeExpiry(member: MemberRow) {
    const current = member.expires_at ? member.expires_at.slice(0, 10) : '';
    const answer = window.prompt(`Access end date for ${member.username} (YYYY-MM-DD). Leave empty for no end date.`, current);
    if (answer === null) return;
    void run('set_expiry', { user_id: member.user_id, expires_on: answer.trim() || null });
  }

  const corpus = useMemo(() => {
    if (!catalog) return null;
    const bySubject = catalog.subjects.map((subject) => {
      const rows = catalog.questions.filter((q) => q.subject === subject.id);
      const years = [...new Set(rows.map((q) => q.document.year))].sort();
      return { name: subject.name, count: rows.length, years: years.length ? `${years[0]}–${years[years.length - 1]}` : '—' };
    });
    return { generatedAt: catalog.generatedAt, total: catalog.questions.length, bySubject };
  }, [catalog]);

  if (!isAdminVisible(status)) return null;

  const flagged = members.filter((m) => m.possible_sharing).length;

  return (
    <section className="panel admin" aria-label="Friend accounts">
      <h2>Friend accounts</h2>
      <p className="muted small">
        Each account works on one device at a time: signing in elsewhere signs the other device out.
        Exported PDFs carry the account name. {flagged > 0 && <strong>{flagged} account{flagged === 1 ? '' : 's'} flagged for possible sharing.</strong>}
      </p>

      <form onSubmit={addFriend} aria-label="Add friend">
        <label className="field">
          <span>Username</span>
          <input name="friend-username" autoComplete="off" autoCapitalize="none" spellCheck={false}
            value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label className="field">
          <span>Note (optional)</span>
          <input name="friend-note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
        </label>
        <label className="field">
          <span>Access ends (optional)</span>
          <input name="friend-expires" type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
        </label>
        <button className="btn" type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add friend'}</button>
      </form>

      {slot.password && (
        <div className="status ok" role="status">
          <p>Password for <strong>{slot.username}</strong> (shown once — copy it now):</p>
          <p><code>{slot.password}</code></p>
          <button type="button" className="btn secondary" onClick={() => { void navigator.clipboard?.writeText(slot.password ?? ''); }}>
            Copy password
          </button>
          <button type="button" className="link" onClick={() => setSlot(clearOneTimeSlot())}>Dismiss</button>
        </div>
      )}

      {message && <p className="error" role="alert">{message}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Account</th><th>Status</th><th>Last seen</th><th>Sign-ins / devices / networks (7 days)</th>
              <th>Previews / exports (30 days)</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => {
              const state = memberStatus(member);
              const idle = daysSince(member.last_seen ?? member.last_sign_in_at);
              return (
                <tr key={member.user_id} className={member.possible_sharing ? 'flagged' : undefined}>
                  <td>
                    <strong>{member.username}</strong>{member.is_admin && <span className="badge">admin</span>}
                    {member.is_self && <span className="muted small"> (you)</span>}
                    {member.note && <div className="muted small">{member.note}</div>}
                  </td>
                  <td>
                    {state}
                    {member.expires_at && state !== 'expired' && <div className="muted small">ends {member.expires_at.slice(0, 10)}</div>}
                    {member.possible_sharing && <div className="error small">possible sharing</div>}
                  </td>
                  <td className={idle === null || idle > 30 ? 'warn' : undefined}>
                    {describeLastSeen(member.last_seen ?? member.last_sign_in_at)}
                  </td>
                  <td>{member.sign_ins_7d ?? 0} / {member.devices_7d ?? 0} / {member.networks_7d ?? 0}</td>
                  <td>{member.previews_30d ?? 0} / {member.exports_30d ?? 0}</td>
                  <td className="admin-actions">
                    <button type="button" className="btn secondary" onClick={() => { void resetPassword(member); }}>Reset password</button>
                    {!member.is_self && (
                      <>
                        <button type="button" className="btn secondary"
                          onClick={() => { void run('end_sessions', { user_id: member.user_id }, `Sign ${member.username} out of every device?`); }}>
                          Sign out everywhere
                        </button>
                        {state === 'suspended' ? (
                          <button type="button" className="btn secondary" onClick={() => { void run('restore', { user_id: member.user_id }); }}>Restore</button>
                        ) : (
                          <button type="button" className="btn secondary"
                            onClick={() => { void run('suspend', { user_id: member.user_id }, `Suspend ${member.username}? They lose access until restored.`); }}>
                            Suspend
                          </button>
                        )}
                        <button type="button" className="btn secondary" onClick={() => changeExpiry(member)}>End date</button>
                        <button type="button" className="btn secondary"
                          onClick={() => { void run('set_admin', { user_id: member.user_id, make: !member.is_admin },
                            member.is_admin ? `Remove admin from ${member.username}?` : `Make ${member.username} an admin? They can manage every account.`); }}>
                          {member.is_admin ? 'Remove admin' : 'Make admin'}
                        </button>
                        <button type="button" className="btn secondary"
                          onClick={() => { void run('remove', { user_id: member.user_id }, `Remove ${member.username} permanently?`); }}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {corpus && (
        <>
          <h3>Question bank</h3>
          <p className="muted small">
            Catalog built {corpus.generatedAt ? new Date(corpus.generatedAt).toLocaleString() : 'at an unknown time'} · {corpus.total} questions
          </p>
          <ul className="small">
            {corpus.bySubject.map((s) => <li key={s.name}>{s.name}: {s.count} questions, {s.years}</li>)}
          </ul>
        </>
      )}

      <h3>Recent admin activity</h3>
      {entries.length === 0 ? <p className="muted small">Nothing recorded yet.</p> : (
        <ul className="small audit-log">
          {entries.map((entry, index) => (
            <li key={`${entry.at}-${index}`}>
              {new Date(entry.at).toLocaleString()} — <strong>{entry.actor}</strong> {entry.action.replace(/_/g, ' ')}{entry.target ? ` ${entry.target}` : ''}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
