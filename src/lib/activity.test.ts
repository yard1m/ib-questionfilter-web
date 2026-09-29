import { describe, expect, it } from 'vitest';
import { dailyCounts, describeDevice, exportDetail, onlineNow, subjectCounts, summarizeByUser, toCsv, type ActivityRow } from './activity';

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
});
