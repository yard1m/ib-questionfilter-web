import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser client for the admin-only `members` Edge Function. The browser never
 * holds the service key: it sends the signed-in user's JWT (via
 * `supabase.functions.invoke`) and the function decides with `admin_is_admin`.
 * Generated passwords travel back once and are never logged or stored.
 */

export type MembersAction =
  | 'list' | 'add' | 'reset' | 'remove'
  | 'audit' | 'suspend' | 'restore' | 'set_expiry' | 'set_admin' | 'end_sessions';

export interface MemberRow {
  user_id: string;
  note: string | null;
  created_at: string;
  username: string;
  last_sign_in_at: string | null;
  suspended_at?: string | null;
  expires_at?: string | null;
  is_admin?: boolean;
  is_self?: boolean;
  sign_ins_7d?: number;
  devices_7d?: number;
  networks_7d?: number;
  last_seen?: string | null;
  previews_30d?: number;
  exports_30d?: number;
  possible_sharing?: boolean;
}

export interface AuditEntry {
  at: string;
  action: string;
  actor: string;
  target: string | null;
}

/** Days since a timestamp, or null when it never happened. */
export function daysSince(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** Short human wording for a last-seen time: never / today / N days ago. */
export function describeLastSeen(iso: string | null | undefined, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  if (days === null) return 'never';
  if (days <= 0) return 'today';
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/** The single status word shown for an account. */
export function memberStatus(member: MemberRow, now: Date = new Date()): 'suspended' | 'expired' | 'active' {
  if (member.suspended_at) return 'suspended';
  if (member.expires_at && new Date(member.expires_at).getTime() <= now.getTime()) return 'expired';
  return 'active';
}

export interface MembersSuccess {
  ok: true;
  status: 200;
  data: {
    members?: MemberRow[];
    user_id?: string;
    username?: string;
    /** Present exactly once on `add` and `reset`; the UI shows it once. */
    password?: string;
    removed?: boolean;
    restored?: boolean;
    entries?: AuditEntry[];
  };
}

export interface MembersFailure {
  ok: false;
  status: number;
  error: string;
}

export type MembersResult = MembersSuccess | MembersFailure;

export function isAdminVisible(status: number | null | undefined): boolean {
  return status === 200;
}

/**
 * The one-time password slot: the server returns a generated password once,
 * the UI shows it once, and any replacement or dismissal clears the previous
 * value from state (it is never stored anywhere else).
 */
export interface OneTimeSlot {
  username: string | null;
  password: string | null;
}

export function setOneTimeSlot(username: string | null, password: string | null): OneTimeSlot {
  return { username, password };
}

export function clearOneTimeSlot(): OneTimeSlot {
  return { username: null, password: null };
}

export function membersErrorMessage(status: number, error: string | null | undefined): string {
  if (status === 401) return 'Sign in first.';
  if (status === 403) return 'Admins only.';
  if (status === 429) return 'At most 20 new accounts per hour. Try again later.';
  return error || 'Something went wrong. Try again.';
}

export async function callMembers(
  client: SupabaseClient,
  action: MembersAction,
  body: Record<string, unknown> = {},
): Promise<MembersResult> {
  const { data, error } = await client.functions.invoke('members', { body: { action, ...body } });
  if (error) {
    // supabase-js reports every non-2xx reply as "Edge Function returned a non-2xx status code";
    // the function's own reason is in the response body, so read it from there.
    const context = (error as { context?: unknown }).context;
    let status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
    let reason: string | null = null;
    if (context instanceof Response) {
      status = context.status;
      try {
        const payload = await context.clone().json();
        if (payload && typeof payload.error === 'string') reason = payload.error;
      } catch {
        // not JSON; fall back to the status wording
      }
    }
    return { ok: false, status, error: reason ?? membersErrorMessage(status, null) };
  }
  return { ok: true, status: 200, data: (data ?? {}) as MembersSuccess['data'] };
}

/** The date access should end after adding `days` to the current end (or to today if none or past). */
export function extendedExpiry(currentIso: string | null | undefined, days: number, now: Date = new Date()): string {
  const current = currentIso ? new Date(currentIso) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  const next = new Date(base.getTime() + days * 86_400_000);
  return next.toISOString().slice(0, 10);
}
