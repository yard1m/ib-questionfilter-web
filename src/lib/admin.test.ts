import { describe, expect, it, vi } from 'vitest';
import {
  callMembers,
  clearOneTimeSlot,
  isAdminVisible,
  membersErrorMessage,
  setOneTimeSlot,
} from './admin';

describe('isAdminVisible', () => {
  it('shows the panel only when list answers 200', () => {
    expect(isAdminVisible(200)).toBe(true);
    // Anonymous (401) and non-admin members (403) stay hidden.
    expect(isAdminVisible(401)).toBe(false);
    expect(isAdminVisible(403)).toBe(false);
    expect(isAdminVisible(500)).toBe(false);
    expect(isAdminVisible(null)).toBe(false);
    expect(isAdminVisible(undefined)).toBe(false);
  });
});

describe('membersErrorMessage', () => {
  it('maps auth and rate-limit failures without leaking detail', () => {
    expect(membersErrorMessage(401, null)).toBe('Sign in first.');
    expect(membersErrorMessage(403, null)).toBe('Admins only.');
    expect(membersErrorMessage(429, null)).toMatch(/20 new accounts per hour/);
  });
});

describe('one-time password slot', () => {
  it('shows the generated password once, then clears it', () => {
    const shown = setOneTimeSlot('dorukib2027', 'fresh-password-1');
    expect(shown.password).toBe('fresh-password-1');
    // Adding another friend replaces the previous password: it was shown once.
    const replaced = setOneTimeSlot('qwzens', 'fresh-password-2');
    expect(replaced.password).toBe('fresh-password-2');
    // Dismissing clears it for good; nothing is stored.
    expect(clearOneTimeSlot()).toEqual({ username: null, password: null });
  });
});

describe('callMembers', () => {
  function clientWith(impl: (fn: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>) {
    return {
      functions: {
        invoke: vi.fn(async (fn: string, opts: unknown) => impl(fn, opts)),
      },
    } as never;
  }

  it('invokes the members function with the action and body', async () => {
    const client = clientWith(async () => ({ data: { members: [] }, error: null }));
    const result = await callMembers(client, 'list');
    expect(result).toEqual({ ok: true, status: 200, data: { members: [] } });
  });

  it('maps function errors to statuses without leaking secrets', async () => {
    const client = clientWith(async () => ({
      data: null,
      error: { status: 403, message: 'forbidden' },
    }));
    const result = await callMembers(client, 'add', { username: 'dorukib2027' });
    expect(result).toEqual({ ok: false, status: 403, error: 'Admins only.' });
  });
});

describe('member display helpers', () => {
  const now = new Date('2026-09-19T12:00:00Z');
  it('describes last-seen times', async () => {
    const { describeLastSeen } = await import('./admin');
    expect(describeLastSeen(null, now)).toBe('never');
    expect(describeLastSeen('2026-09-19T08:00:00Z', now)).toBe('today');
    expect(describeLastSeen('2026-09-18T08:00:00Z', now)).toBe('yesterday');
    expect(describeLastSeen('2026-08-01T08:00:00Z', now)).toBe('49 days ago');
  });
  it('derives one status per account', async () => {
    const { memberStatus } = await import('./admin');
    const base = { user_id: 'u', note: null, created_at: '', username: 'a', last_sign_in_at: null };
    expect(memberStatus({ ...base }, now)).toBe('active');
    expect(memberStatus({ ...base, suspended_at: '2026-09-01T00:00:00Z' }, now)).toBe('suspended');
    expect(memberStatus({ ...base, expires_at: '2026-09-18T23:59:59Z' }, now)).toBe('expired');
    expect(memberStatus({ ...base, expires_at: '2026-12-31T23:59:59Z' }, now)).toBe('active');
  });
});
