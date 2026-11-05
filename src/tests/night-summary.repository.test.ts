import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InMemoryLinkRepository } from '../repositories/in-memory/link.repository';
import { InMemoryNightSummaryRepository } from '../repositories/in-memory/night-summary.repository';
import { InMemoryLinkIntakeRepository } from '../repositories/in-memory/link-intake.repository';
import { InMemoryUnsentRepository } from '../repositories/in-memory/unsent.repository';
import { newRow } from './helpers/link-repo-suite';
import type { LinkLogRow } from '../core/link-types';

const OUTBOX_KEYS = ['attempts', 'createdAt', 'inWindow', 'reason', 'resultAt', 'serviceDate', 'status', 'type'];
const TAP_KEYS = ['at', 'deviceId', 'event', 'outcome'];

const seed = async (link: InMemoryLinkRepository, serviceDate: string, status = 'pending') => {
  const row = newRow({ serviceDate, leaderName: 'Sample Dummyton', note: 'secret note' });
  await link.insertAction(row);
  if (status !== 'pending') link._backdate('link_outbox', row.id, 'status', status);
  return row.id;
};
const tap = (at: string, over: Partial<LinkLogRow> = {}): LinkLogRow => ({ id: randomUUID(), at, userId: randomUUID(),
  login: 'sample.login', deviceId: 'dev-1', deviceLabel: 'Sample phone', event: 'checkIn', leaderId: null, leaderName: 'Sample Dummyton',
  prevLeaderId: null, prevLeaderName: null, targetKind: 'person', targetId: randomUUID(), targetName: 'Codeman Sample',
  outboxId: null, outcome: 'saved', ...over });

describe('night-summary repository (twin)', () => {
  it('twin outbox: window on service_date plus open rows of any date, each once, flagged', async () => {
    const link = new InMemoryLinkRepository(); const repo = new InMemoryNightSummaryRepository(link, new InMemoryLinkIntakeRepository(), new InMemoryUnsentRepository());
    await seed(link, '2026-11-05', 'sent');          // in window, closed
    await seed(link, '2026-11-06', 'pending');       // in window, open: once, not twice
    await seed(link, '2026-11-07', 'claimed');       // in window (to inclusive)
    await seed(link, '2026-10-01', 'unclear');       // old but open
    await seed(link, '2026-10-02', 'sent');          // old and closed: absent
    await seed(link, '2026-11-08', 'refused');       // after window and closed: absent
    await seed(link, '2026-11-09', 'pending');       // after window but open
    const rows = await repo.outbox('2026-11-05', '2026-11-07');
    expect(rows).toHaveLength(5);
    expect(rows.filter((r) => r.inWindow).map((r) => r.serviceDate).sort()).toEqual(['2026-11-05', '2026-11-06', '2026-11-07']);
    expect(rows.filter((r) => !r.inWindow).map((r) => r.serviceDate).sort()).toEqual(['2026-10-01', '2026-11-09']);
    expect(rows.filter((r) => !r.inWindow).every((r) => ['pending', 'claimed', 'unclear'].includes(r.status))).toBe(true);
  });

  it('twin rows carry exactly the allow-listed keys', async () => {
    const link = new InMemoryLinkRepository(); const repo = new InMemoryNightSummaryRepository(link, new InMemoryLinkIntakeRepository(), new InMemoryUnsentRepository());
    await seed(link, '2026-11-05');
    const [r] = await repo.outbox('2026-11-05', '2026-11-05');
    expect(Object.keys(r!).sort()).toEqual(OUTBOX_KEYS);
    expect(JSON.stringify(r)).not.toMatch(/Sample Dummyton|secret note|payload/);
    expect(r).toMatchObject({ type: 'checkIn', status: 'pending', reason: null, resultAt: null, attempts: 0, inWindow: true });
  });

  it('twin taps: from inclusive, to exclusive, at most limit; keys exactly at, event, outcome, deviceId', async () => {
    const link = new InMemoryLinkRepository(); const repo = new InMemoryNightSummaryRepository(link, new InMemoryLinkIntakeRepository(), new InMemoryUnsentRepository());
    await link.addLog([tap('2026-11-05T09:59:59.000Z'), tap('2026-11-05T10:00:00.000Z'), tap('2026-11-05T11:00:00.000Z'),
      tap('2026-11-05T12:00:00.000Z'), tap('2026-11-05T13:00:00.000Z', { event: 'undo', outcome: 'refused:X', deviceId: null })]);
    const all = await repo.taps('2026-11-05T10:00:00.000Z', '2026-11-05T13:00:00.000Z', 10);
    expect(all.map((t) => t.at).sort()).toEqual(['2026-11-05T10:00:00.000Z', '2026-11-05T11:00:00.000Z', '2026-11-05T12:00:00.000Z']);
    for (const t of all) expect(Object.keys(t).sort()).toEqual(TAP_KEYS);
    expect(JSON.stringify(all)).not.toMatch(/sample\.login|Codeman|Sample phone|Sample Dummyton/);
    expect((await repo.taps('2026-11-05T10:00:00.000Z', '2026-11-05T14:00:00.000Z', 2)).map((t) => t.at))
      .toEqual(['2026-11-05T13:00:00.000Z', '2026-11-05T12:00:00.000Z']);
    const [last] = await repo.taps('2026-11-05T13:00:00.000Z', '2026-11-05T14:00:00.000Z', 5);
    expect(last).toEqual({ at: '2026-11-05T13:00:00.000Z', event: 'undo', outcome: 'refused:X', deviceId: null });
  });
});

describe('night-summary repository (supabase source)', () => {
  const src = readFileSync(join(__dirname, '..', 'repositories', 'supabase', 'supabase.night-summary.ts'), 'utf8');
  it('supabase source names its columns', () => {
    expect(src).not.toMatch(/select\s+\*/i);
    for (const c of ['login', 'leader_name', 'target_name', 'device_label', 'prev_leader_name', 'payload', 'dedupe_key', 'lease_owner', 'note', 'detail']) {
      expect(src, c).not.toMatch(new RegExp(String.raw`\b${c}\b`));
    }
    expect(src).toMatch(/select type, status, reason, service_date, created_at, result_at, attempts\s+from/);
    expect(src).toMatch(/select at, event, outcome, device_id\s+from/);
  });
});
