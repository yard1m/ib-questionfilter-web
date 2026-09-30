import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Catalog } from '../lib/catalog';
import {
  KIND_LABELS, describeDevice, toCsv, fetchActivitySummary, fetchActivityPage, fetchAllActivity,
  type ActivityKind, type ActivityRow, type ActivitySummary, type ActivityCursor, type ActivitySnapshot,
} from '../lib/activity';
import { describeLastSeen } from '../lib/admin';
import { AdminPanel } from './AdminPanel';

const RANGES = [
  { id: '1', label: 'Last 24 hours', days: 1 },
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
];

function time(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/**
 * Full-page admin dashboard, opened in its own window (`?admin=1`). Reads the admin-only
 * `admin_activity` feed (the database refuses non-admins) and embeds the account management panel.
 */
export function AdminDashboard({ client, account, catalog, onSignOut }: {
  client: SupabaseClient;
  account: string;
  catalog: Catalog | null;
  onSignOut: () => void;
}) {
  const [rangeId, setRangeId] = useState('7');
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [auto, setAuto] = useState(true);
  const [userFilter, setUserFilter] = useState('');
  const [kindFilter, setKindFilter] = useState<'' | ActivityKind | 'no_visits'>('no_visits');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<ActivitySummary | null>(null);
  const [cursor, setCursor] = useState<ActivityCursor | null>(null);
  const [snapshot, setSnapshot] = useState<ActivitySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [csvBusy, setCsvBusy] = useState(false);
  const generation = useRef(0);
  const pageBusy = useRef(false);
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1];
  const filters = useMemo(() => ({ user_name: userFilter || null, event_kind: kindFilter || null, search_text: search.trim() || null }), [userFilter, kindFilter, search]);

  const showError = (err: unknown) => setError(err instanceof Error && /admins_only/.test(err.message) ? 'Admins only.' : 'Could not load activity. Try again.');

  const load = useCallback(async () => {
    const version = ++generation.current;
    const end = new Date();
    const window = { since: new Date(end.getTime() - range.days * 86_400_000).toISOString(), until_at: end.toISOString() };
    setBusy(true); setRows([]); setCursor(null); setSummary(null); setSnapshot(null);
    try {
      const [totals, page] = await Promise.all([fetchActivitySummary(client, window), fetchActivityPage(client, window, filters)]);
      if (generation.current !== version) return;
      setSummary(totals); setRows(page.rows); setCursor(page.next); setSnapshot(window);
      setError(null); setLoadedAt(end);
    } catch (err) { if (generation.current === version) showError(err); }
    finally { if (generation.current === version) setBusy(false); }
  }, [client, range.days, filters]);

  useEffect(() => { void load(); return () => { generation.current += 1; }; }, [load]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [auto, load]);
  useEffect(() => { document.title = 'Admin · Little Red Bank'; }, []);

  const users = summary?.users ?? [];
  const online = users.filter((u) => u.online).map((u) => u.username).sort();
  const days = useMemo(() => {
    const end = loadedAt ?? new Date();
    return Array.from({ length: Math.min(range.days, 30) }, (_, i) => {
      const day = new Date(end.getTime() - (Math.min(range.days, 30) - 1 - i) * 86_400_000).toISOString().slice(0, 10);
      return summary?.days.find((d) => d.day === day) ?? { day, users: 0, exports: 0, previews: 0, visits: 0 };
    });
  }, [summary, range.days, loadedAt]);
  const subjects = summary?.subjects ?? [];
  const subjectName = (id: string | null) => catalog?.subjects.find((s) => s.id === id)?.name
    ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
  const totals = summary?.totals ?? { users: 0, signIns: 0, exports: 0, questions: 0, markschemes: 0, previews: 0 };
  const feed = rows;

  const peak = Math.max(1, ...days.map((d) => d.visits + d.previews + d.exports));

  async function loadMore() {
    if (!snapshot || !cursor || busy || pageBusy.current) return;
    const version = generation.current;
    pageBusy.current = true; setBusy(true);
    try {
      const page = await fetchActivityPage(client, snapshot, filters, cursor);
      if (generation.current !== version) return;
      setRows((previous) => [...previous, ...page.rows]); setCursor(page.next); setError(null);
    } catch (err) { if (generation.current === version) showError(err); }
    finally { pageBusy.current = false; if (generation.current === version) setBusy(false); }
  }

  async function downloadCsv() {
    if (!snapshot || csvBusy) return;
    setCsvBusy(true);
    try {
      const all = await fetchAllActivity(client, snapshot, filters);
      const url = URL.createObjectURL(new Blob([toCsv(all)], { type: 'text/csv' }));
      const a = document.createElement('a');
      a.href = url; a.download = `activity-${snapshot.until_at.slice(0, 10)}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { showError(err); }
    finally { setCsvBusy(false); }
  }

  return (
    <main className="admin-dashboard">
      <header className="dash-head">
        <div>
          <h1>Admin dashboard</h1>
          <p className="muted small">
            Signed in as {account}
            {loadedAt && <> · updated {loadedAt.toLocaleTimeString()}</>}
          </p>
        </div>
        <div className="dash-controls">
          <label className="field inline">
            <span className="small muted">Period</span>
            <select value={rangeId} onChange={(e) => setRangeId(e.target.value)}>
              {RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label className="check inline"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /><span>Auto-refresh</span></label>
          <button type="button" className="btn secondary" disabled={busy} onClick={() => void load()}>Refresh</button>
          <a className="btn secondary" href={window.location.pathname}>Question bank</a>
          <button type="button" className="btn secondary" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {busy && <p role="status">Loading activity...</p>}

      <section className="dash-cards" aria-label="Summary">
        <div className="panel dash-card">
          <span className="small muted">Online now</span>
          <strong>{online.length}</strong>
          <span className="small">{online.length ? online.join(', ') : 'nobody'}</span>
        </div>
        <div className="panel dash-card"><span className="small muted">Active users</span><strong>{totals.users}</strong><span className="small muted">{range.label.toLowerCase()}</span></div>
        <div className="panel dash-card"><span className="small muted">Sign-ins</span><strong>{totals.signIns}</strong></div>
        <div className="panel dash-card"><span className="small muted">Exports</span><strong>{totals.exports}</strong><span className="small muted">{totals.questions} questions · {totals.markschemes} markschemes</span></div>
        <div className="panel dash-card"><span className="small muted">Previews</span><strong>{totals.previews}</strong></div>
      </section>

      {range.days > 1 && (
        <section className="panel" aria-label="Daily activity">
          <h2>Daily activity</h2>
          <div className="dash-bars" role="img" aria-label="Events per day">
            {days.map((d) => (
              <div key={d.day} className="dash-bar" title={`${d.day}: ${d.users} users, ${d.visits} visits, ${d.previews} previews, ${d.exports} exports`}>
                <div className="dash-bar-stack" style={{ height: `${((d.visits + d.previews + d.exports) / peak) * 100}%` }}>
                  <span className="seg exports" style={{ flexGrow: d.exports }} />
                  <span className="seg previews" style={{ flexGrow: d.previews }} />
                  <span className="seg visits" style={{ flexGrow: d.visits }} />
                </div>
                <span className="dash-bar-label">{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
          <p className="small muted dash-legend"><span className="key exports" /> exports <span className="key previews" /> previews <span className="key visits" /> visits and sign-ins</p>
        </section>
      )}

      <section className="panel" aria-label="People">
        <h2>People</h2>
        {users.length === 0 ? <p className="muted">No activity in this period.</p> : (
          <div className="table-wrap">
            <table className="dash-table">
              <thead><tr><th>User</th><th>Last seen</th><th>Sign-ins</th><th>Days active</th><th>Previews</th><th>Exports</th><th>Questions exported</th><th>Devices</th><th>Networks</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.username} className={userFilter === u.username ? 'selected' : ''}>
                    <td>
                      <button type="button" className="linkish" onClick={() => setUserFilter(userFilter === u.username ? '' : u.username)}>
                        {u.online && <span className="dot online" aria-label="online" />}{u.username}
                      </button>
                    </td>
                    <td title={u.lastSeen}>{u.online ? 'online now' : describeLastSeen(u.lastSeen)} · {time(u.lastSeen)}</td>
                    <td>{u.signIns}</td><td>{u.daysActive}</td><td>{u.previews}</td>
                    <td>{u.exports}{u.markschemes ? ` (+${u.markschemes} MS)` : ''}</td><td>{u.exportedQuestions}</td>
                    <td className="small">{u.devices.join(', ') || '—'}</td>
                    <td className={u.networks >= 3 ? 'warn' : ''}>{u.networks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted">Click a name to filter the activity log. Three or more networks in one period is highlighted: the account may be shared.</p>
      </section>

      {subjects.length > 0 && (
        <section className="panel" aria-label="Subjects">
          <h2>Subjects</h2>
          <table className="dash-table narrow">
            <thead><tr><th>Subject</th><th>Exports</th><th>Questions exported</th><th>Previews</th></tr></thead>
            <tbody>{subjects.map((s) => <tr key={s.subject}><td>{subjectName(s.subject)}</td><td>{s.exports}</td><td>{s.questions}</td><td>{s.previews}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      <section className="panel" aria-label="Activity log">
        <div className="dash-feed-head">
          <h2>Activity log</h2>
          <div className="dash-controls">
            <select aria-label="User" value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
              <option value="">Everyone</option>
              {users.map((u) => <option key={u.username} value={u.username}>{u.username}</option>)}
            </select>
            <select aria-label="Event" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
              <option value="no_visits">All but visits</option>
              <option value="">Everything</option>
              {(Object.keys(KIND_LABELS) as ActivityKind[]).map((k) => <option key={k} value={k}>{KIND_LABELS[k]}s</option>)}
            </select>
            <input type="search" placeholder="Search papers, devices…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search activity" />
            <button type="button" className="btn secondary" onClick={() => void downloadCsv()} disabled={!snapshot || csvBusy || busy}>{csvBusy ? 'Preparing CSV...' : 'Download CSV'}</button>
          </div>
        </div>
        {feed.length === 0 ? <p className="muted">Nothing matches.</p> : (
          <div className="table-wrap">
            <table className="dash-table">
              <thead><tr><th>Time</th><th>User</th><th>Event</th><th>Subject</th><th>Details</th><th>Device</th></tr></thead>
              <tbody>
                {feed.map((r, i) => (
                  <tr key={r.event_key ?? `${r.at}-${i}`}>
                    <td className="nowrap" title={r.at}>{time(r.at)}</td>
                    <td>{r.username}</td>
                    <td><span className={`tag kind-${r.kind}`}>{KIND_LABELS[r.kind] ?? r.kind}</span></td>
                    <td>{r.kind === 'visit' || r.kind === 'sign_in' ? '' : subjectName(r.subject)}</td>
                    <td className="small">{r.kind === 'export' || r.kind === 'markscheme' ? `${r.items} question${r.items === 1 ? '' : 's'}: ` : ''}{r.detail && r.detail !== 'session claimed' ? r.detail : ''}</td>
                    <td className="small">{describeDevice(r.user_agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {cursor && <button type="button" className="btn secondary" disabled={busy} onClick={() => void loadMore()}>Show more</button>}
        <p className="small muted">Activity is recorded from 29 September 2026; sign-ins before that come from the session log. Visits are a heartbeat every five minutes while the site is open.</p>
      </section>

      <AdminPanel client={client} catalog={catalog ?? undefined} embedded />
    </main>
  );
}
