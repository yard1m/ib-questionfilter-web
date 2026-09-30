/**
 * Pure helpers for the admin dashboard. Rows come from the admin-only `admin_activity` database
 * function: every visit heartbeat, sign-in, preview and export, newest first.
 */

export type ActivityKind = 'visit' | 'sign_in' | 'preview' | 'export' | 'markscheme';

export interface ActivityRow {
  event_key?: string;
  at: string;
  user_id: string;
  username: string;
  kind: ActivityKind;
  subject: string | null;
  items: number;
  detail: string | null;
  user_agent: string | null;
  network: string | null;
}

export interface ActivitySnapshot { since: string; until_at: string }
export interface ActivityCursor { at: string; key: string }
export interface ActivityFilters { user_name?: string | null; event_kind?: string | null; search_text?: string | null }
export interface ActivityPage { rows: ActivityRow[]; next: ActivityCursor | null }
export interface ActivitySummary {
  totals: { users: number; signIns: number; exports: number; questions: number; markschemes: number; previews: number };
  users: UserSummary[];
  days: { day: string; users: number; exports: number; previews: number; visits: number }[];
  subjects: { subject: string; exports: number; previews: number; questions: number }[];
}
interface ActivityRpc {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

export async function fetchActivitySummary(client: ActivityRpc, snapshot: ActivitySnapshot): Promise<ActivitySummary> {
  const { data, error } = await client.rpc('admin_activity_summary', { ...snapshot });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Missing activity summary');
  const summary = data as Omit<ActivitySummary, 'users'> & { users: (Omit<UserSummary, 'devices'> & { userAgents: string[] })[] };
  return { ...summary, users: summary.users.map(({ userAgents, ...user }) => ({
    ...user, devices: [...new Set(userAgents.map(describeDevice).filter((d) => d !== 'Unknown device'))],
  })) };
}

export async function fetchActivityPage(client: ActivityRpc, snapshot: ActivitySnapshot, filters: ActivityFilters = {}, cursor: ActivityCursor | null = null): Promise<ActivityPage> {
  const { data, error } = await client.rpc('admin_activity_page', {
    ...snapshot, ...filters, page_size: 200, before_at: cursor?.at ?? null, before_key: cursor?.key ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Missing activity page');
  return data as ActivityPage;
}

/** CSV export walks every filtered page, independent of the currently displayed page. */
export async function fetchAllActivity(client: ActivityRpc, snapshot: ActivitySnapshot, filters: ActivityFilters = {}): Promise<ActivityRow[]> {
  const rows: ActivityRow[] = [];
  const seen = new Set<string>();
  let cursor: ActivityCursor | null = null;
  do {
    const page = await fetchActivityPage(client, snapshot, filters, cursor);
    rows.push(...page.rows);
    cursor = page.next;
    if (cursor) {
      const key = `${cursor.at}/${cursor.key}`;
      if (seen.has(key)) throw new Error('Repeated activity cursor');
      seen.add(key);
    }
  } while (cursor);
  return rows;
}

export interface UserSummary {
  username: string;
  lastSeen: string;
  online: boolean;
  signIns: number;
  daysActive: number;
  previews: number;
  exportedQuestions: number;
  exports: number;
  markschemes: number;
  devices: string[];
  networks: number;
}

export const ONLINE_WINDOW_MS = 6 * 60_000; // heartbeat every 5 minutes, plus slack

export const KIND_LABELS: Record<ActivityKind, string> = {
  visit: 'Visit',
  sign_in: 'Sign-in',
  preview: 'Preview',
  export: 'Export',
  markscheme: 'Markscheme',
};

/** "Chrome on Mac", "Safari on iPhone", … from a user-agent string. */
export function describeDevice(ua: string | null | undefined): string {
  if (!ua) return 'Unknown device';
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'Chromebook'
      : /Linux/.test(ua) ? 'Linux' : 'other';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${browser} on ${os}`;
}

/** Usernames with any event inside the online window. */
export function onlineNow(rows: ActivityRow[], now: Date = new Date()): string[] {
  const cutoff = now.getTime() - ONLINE_WINDOW_MS;
  const names = new Set<string>();
  for (const r of rows) if (new Date(r.at).getTime() >= cutoff) names.add(r.username);
  return [...names].sort();
}

/** One summary per user, most recently seen first. */
export function summarizeByUser(rows: ActivityRow[], now: Date = new Date()): UserSummary[] {
  const online = new Set(onlineNow(rows, now));
  const byUser = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const list = byUser.get(r.username);
    if (list) list.push(r); else byUser.set(r.username, [r]);
  }
  const out: UserSummary[] = [];
  for (const [username, list] of byUser) {
    const sum = (kind: ActivityKind, field: 'items' | 'count') => list.filter((r) => r.kind === kind)
      .reduce((n, r) => n + (field === 'items' ? r.items : 1), 0);
    out.push({
      username,
      lastSeen: list.reduce((a, r) => (r.at > a ? r.at : a), list[0].at),
      online: online.has(username),
      signIns: sum('sign_in', 'count'),
      daysActive: new Set(list.map((r) => r.at.slice(0, 10))).size,
      previews: sum('preview', 'count'),
      exportedQuestions: sum('export', 'items'),
      exports: sum('export', 'count'),
      markschemes: sum('markscheme', 'count'),
      devices: [...new Set(list.map((r) => describeDevice(r.user_agent)).filter((d) => d !== 'Unknown device'))],
      networks: new Set(list.map((r) => r.network).filter(Boolean)).size,
    });
  }
  return out.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
}

/** Event counts per day (YYYY-MM-DD, oldest first) for the last `days` days, all kinds split out. */
export function dailyCounts(rows: ActivityRow[], days: number, now: Date = new Date()): { day: string; users: number; exports: number; previews: number; visits: number }[] {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const list = rows.filter((r) => r.at.slice(0, 10) === day);
    out.push({
      day,
      users: new Set(list.map((r) => r.username)).size,
      exports: list.filter((r) => r.kind === 'export' || r.kind === 'markscheme').length,
      previews: list.filter((r) => r.kind === 'preview').length,
      visits: list.filter((r) => r.kind === 'visit' || r.kind === 'sign_in').length,
    });
  }
  return out;
}

/** Counts of export/preview activity per subject, largest first. */
export function subjectCounts(rows: ActivityRow[]): { subject: string; exports: number; previews: number; questions: number }[] {
  const map = new Map<string, { exports: number; previews: number; questions: number }>();
  for (const r of rows) {
    if (!r.subject || (r.kind !== 'export' && r.kind !== 'preview' && r.kind !== 'markscheme')) continue;
    const e = map.get(r.subject) ?? { exports: 0, previews: 0, questions: 0 };
    if (r.kind === 'preview') e.previews += 1; else { e.exports += 1; if (r.kind === 'export') e.questions += r.items; }
    map.set(r.subject, e);
  }
  return [...map].map(([subject, v]) => ({ subject, ...v })).sort((a, b) => b.exports + b.previews - a.exports - a.previews);
}

/** CSV of activity rows (RFC 4180 quoting). */
export function toCsv(rows: ActivityRow[]): string {
  const quote = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['time', 'user', 'event', 'subject', 'items', 'detail', 'device', 'network'];
  const lines = rows.map((r) => [r.at, r.username, KIND_LABELS[r.kind] ?? r.kind, r.subject, r.items, r.detail, describeDevice(r.user_agent), r.network].map(quote).join(','));
  return [header.join(','), ...lines].join('\n');
}

/** Short summary of an export for the activity detail: which papers the questions came from. */
export function exportDetail(documents: string[]): string {
  const counts = new Map<string, number>();
  for (const d of documents) counts.set(d, (counts.get(d) ?? 0) + 1);
  return [...counts].map(([d, n]) => (n > 1 ? `${d} ×${n}` : d)).join('; ').slice(0, 500);
}
