import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Browser client for the admin-only `members` Edge Function. The browser never
 * holds the service key: it sends the signed-in user's JWT (via
 * `supabase.functions.invoke`) and the function decides with `admin_is_admin`.
 * Generated passwords travel back once and are never logged or stored.
 */

export type MembersAction = 'list' | 'add' | 'reset' | 'remove';

export interface MemberRow {
  user_id: string;
  note: string | null;
  created_at: string;
  username: string;
  last_sign_in_at: string | null;
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
    const status = typeof (error as { status?: unknown }).status === 'number'
      ? (error as { status: number }).status
      : 500;
    const message = typeof (error as { message?: unknown }).message === 'string'
      ? (error as { message: string }).message
      : null;
    return { ok: false, status, error: membersErrorMessage(status, message) };
  }
  return { ok: true, status: 200, data: (data ?? {}) as MembersSuccess['data'] };
}
