import { describe, expect, it } from 'vitest';
import { dailyCounts, describeDevice, exportDetail, onlineNow, subjectCounts, summarizeByUser, toCsv, fetchActivityPage, fetchActivitySummary, fetchAllActivity, type ActivityRow } from './activity';

const now = new Date('2026-09-29T20:00:00Z');
const row = (username: string, kind: ActivityRow['kind'], at: string, extra: Partial<ActivityRow> = {}): ActivityRow => ({
  at, user_id: username, username, kind, subject: 'physics', items: 1, detail: null, user_agent: null, network: null, ...extra,
});

describe('admin activity helpers', () => {
  it('names devices from user agents', () => {
    expect(describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')).toBe('Safari on Mac');
    expect(describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/130.0 Mobile Safari/604.1')).toBe('Chrome on iPhone');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('Edge on Windows');
    expect(describeDevice(null)).toBe('Unknown device');
  });

  it('finds who is online and summarises each user', () => {
    const rows = [
      row('ali', 'visit', '2026-09-29T19:58:00Z', { user_agent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36', network: 'a' }),
      row('ali', 'export', '2026-09-29T19:50:00Z', { items: 12, network: 'b' }),
      row('ali', 'sign_in', '2026-09-28T10:00:00Z'),
      row('doruk', 'preview', '2026-09-29T12:00:00Z'),
    ];
    expect(onlineNow(rows, now)).toEqual(['ali']);
    const [ali, doruk] = summarizeByUser(rows, now);
    expect(ali).toMatchObject({ username: 'ali', online: true, signIns: 1, daysActive: 2, exportedQuestions: 12, exports: 1, networks: 2, devices: ['Chrome on Windows'] });
    expect(doruk).toMatchObject({ username: 'doruk', online: false, previews: 1 });
  });

  it('counts per day and per subject, and writes quoted CSV', () => {
    const rows = [row('a', 'export', '2026-09-29T08:00:00Z', { items: 5 }), row('b', 'preview', '2026-09-28T08:00:00Z', { subject: 'chemistry' })];
    expect(dailyCounts(rows, 2, now)).toEqual([
      { day: '2026-09-28', users: 1, exports: 0, previews: 1, visits: 0 },
      { day: '2026-09-29', users: 1, exports: 1, previews: 0, visits: 0 },
    ]);
    expect(subjectCounts(rows)[0]).toEqual({ subject: 'physics', exports: 1, previews: 0, questions: 5 });
    const csv = toCsv([row('a', 'export', '2026-09-29T08:00:00Z', { detail: 'Paper 1, "TZ2"' })]);
    expect(csv.split('\n')[1]).toBe('2026-09-29T08:00:00Z,a,Export,physics,1,"Paper 1, ""TZ2""",Unknown device,');
  });

  it('summarises exported papers', () => {
    expect(exportDetail(['P1 TZ1 May 2024', 'P1 TZ1 May 2024', 'P2 Nov 2023'])).toBe('P1 TZ1 May 2024 ×2; P2 Nov 2023');
  });

  it('uses uncapped server aggregates rather than the loaded feed', async () => {
    const client = { rpc: async (name: string) => {
      expect(name).toBe('admin_activity_summary');
      return { data: { totals: { users: 3, exports: 5100, questions: 10200 },
        users: [{ username: 'early', userAgents: ['Chrome/130.0 Macintosh', 'Chrome/130.0 Macintosh'] }], days: [], subjects: [] }, error: null };
    } };
    const summary = await fetchActivitySummary(client, { since: 'start', until_at: 'end' });
    expect(summary.totals.exports).toBe(5100);
    expect(summary.users[0].devices).toEqual(['Chrome on Mac']);
  });

  it('paginates a stable snapshot and passes filters and same-time tie cursor', async () => {
    const calls: Record<string, unknown>[] = [];
    const client = { rpc: async (name: string, args: Record<string, unknown>) => {
      expect(name).toBe('admin_activity_page'); calls.push(args);
      return { data: { rows: [row('a', 'export', now.toISOString())], next: calls.length === 1 ? { at: now.toISOString(), key: 'activity-42' } : null }, error: null };
    } };
    const filter = { user_name: 'a', event_kind: 'export', search_text: 'physics' };
    const rows = await fetchAllActivity(client, { since: 'start', until_at: 'end' }, filter);
    expect(rows).toHaveLength(2);
    expect(calls[1]).toMatchObject({ since: 'start', until_at: 'end', ...filter, before_at: now.toISOString(), before_key: 'activity-42' });
    expect(calls[0].max_rows).toBeUndefined();
  });

  it('fails closed on revoked dashboard access, never fabricating empty totals', async () => {
    const client = { rpc: async () => ({ data: null, error: { message: 'admins_only' } }) };
    await expect(fetchActivitySummary(client, { since: 'start', until_at: 'end' })).rejects.toThrow('admins_only');
    await expect(fetchActivityPage(client, { since: 'start', until_at: 'end' })).rejects.toThrow('admins_only');
  });
});
