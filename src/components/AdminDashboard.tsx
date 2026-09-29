import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Catalog } from '../lib/catalog';
import {
  KIND_LABELS, dailyCounts, describeDevice, onlineNow, subjectCounts, summarizeByUser, toCsv,
  type ActivityKind, type ActivityRow,
} from '../lib/activity';
import { describeLastSeen } from '../lib/admin';
import { AdminPanel } from './AdminPanel';

const RANGES = [
  { id: '1', label: 'Last 24 hours', days: 1 },
  { id: '7', label: 'Last 7 days', days: 7 },
  { id: '30', label: 'Last 30 days', days: 30 },
  { id: '90', label: 'Last 90 days', days: 90 },
];

const FEED_PAGE = 200;

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
  const [shown, setShown] = useState(FEED_PAGE);
  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[1];

  const load = useCallback(async () => {
    const since = new Date(Date.now() - range.days * 86_400_000).toISOString();
    const { data, error: err } = await client.rpc('admin_activity', { since, max_rows: 5000 });
    if (err) { setError(/admins_only/.test(err.message) ? 'Admins only.' : 'Could not load activity. Try again.'); return; }
    setError(null);
    setRows((data ?? []) as ActivityRow[]);
    setLoadedAt(new Date());
  }, [client, range.days]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!auto) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [auto, load]);
  useEffect(() => { document.title = 'Admin · Little Red Bank'; }, []);

  const now = loadedAt ?? new Date();
  const online = useMemo(() => onlineNow(rows, now), [rows, now]);
  const users = useMemo(() => summarizeByUser(rows, now), [rows, now]);
  const days = useMemo(() => dailyCounts(rows, Math.min(range.days === 1 ? 1 : range.days, 30), now), [rows, range.days, now]);
  const subjects = useMemo(() => subjectCounts(rows), [rows]);
  const subjectName = (id: string | null) => catalog?.subjects.find((s) => s.id === id)?.name
    ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : '');
  const totals = useMemo(() => ({
    users: new Set(rows.map((r) => r.username)).size,
    signIns: rows.filter((r) => r.kind === 'sign_in').length,
    exports: rows.filter((r) => r.kind === 'export').length,
    questions: rows.filter((r) => r.kind === 'export').reduce((n, r) => n + r.items, 0),
    markschemes: rows.filter((r) => r.kind === 'markscheme').length,
    previews: rows.filter((r) => r.kind === 'preview').length,
  }), [rows]);

  const feed = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => (!userFilter || r.username === userFilter)
      && (kindFilter === '' || (kindFilter === 'no_visits' ? r.kind !== 'visit' : r.kind === kindFilter))
      && (!q || [r.username, r.subject, r.detail, describeDevice(r.user_agent)].some((v) => v?.toLowerCase().includes(q))));
  }, [rows, userFilter, kindFilter, search]);
  useEffect(() => { setShown(FEED_PAGE); }, [userFilter, kindFilter, search, rangeId]);

  const peak = Math.max(1, ...days.map((d) => d.visits + d.previews + d.exports));

  function downloadCsv() {
    const blob = new Blob([toCsv(feed)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
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
          <button type="button" className="btn secondary" onClick={() => void load()}>Refresh</button>
          <a className="btn secondary" href={window.location.pathname}>Question bank</a>
          <button type="button" className="btn secondary" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

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
            <button type="button" className="btn secondary" onClick={downloadCsv} disabled={!feed.length}>Download CSV</button>
          </div>
        </div>
        {feed.length === 0 ? <p className="muted">Nothing matches.</p> : (
          <div className="table-wrap">
            <table className="dash-table">
              <thead><tr><th>Time</th><th>User</th><th>Event</th><th>Subject</th><th>Details</th><th>Device</th></tr></thead>
              <tbody>
                {feed.slice(0, shown).map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
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
        {feed.length > shown && <button type="button" className="btn secondary" onClick={() => setShown((n) => n + FEED_PAGE)}>Show more ({feed.length - shown} left)</button>}
        <p className="small muted">Activity is recorded from 29 September 2026; sign-ins before that come from the session log. Visits are a heartbeat every five minutes while the site is open.</p>
      </section>

      <AdminPanel client={client} catalog={catalog ?? undefined} embedded />
    </main>
  );
}
