// Shared ILinkRepository suite (spec 2026-10-12-elvanto-link-app-design.md §4.2). Runs on the memory repo always and on
// SupabaseLinkRepository only against a scratch database (LINK_TEST_DATABASE_URL). Time-based cases age rows with
// `backdate` so the Supabase run uses the real DB clock.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ILinkRepository, LinkRosterPushRow } from '../../repositories/interfaces/link.repository';
import type { ActionType, Capabilities, ClaimArgs, ResultItem, NewOutboxRow, LinkLogRow, LinkServiceRow, LinkGroupRow, LinkFlowRow } from '../../core/link-types';
import { LinkIdExists, LinkOpenDuplicate } from '../../core/errors/link-errors';
import { ResultResponse } from '../../core/link-contract';

export type LinkTable = 'link_outbox' | 'link_roster' | 'link_log';
export interface LinkRepoHarness {
  repo: ILinkRepository;
  backdate(table: LinkTable, id: string, column: string, iso: string): Promise<void>;
  /** The stored note, decrypted (the repo itself never returns it outside a claim). */
  peekNote(id: string): Promise<string | null>;
  cleanup(): Promise<void>;
}
/** `decrypt` sees the plaintext note and may throw to make it unreadable. */
export type MakeLinkRepo = (opts?: { decrypt?: (note: string, id: string) => string }) => Promise<LinkRepoHarness>;

const DAY = 86_400_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();
const ALL_LIVE: Capabilities = { checkIn: 'live', checkOut: 'live', submitReport: 'live', editReport: 'live',
  completeStep: 'live', firstTimerCheckIn: 'live' };

export function newRow(over: Partial<NewOutboxRow> = {}): NewOutboxRow {
  const id = over.id ?? randomUUID();
  const personId = over.personId === undefined ? randomUUID() : over.personId;
  return { id, type: 'checkIn', payload: { serviceTimeId: randomUUID(), serviceId: randomUUID(), personId },
    note: null, dedupeKey: `key:${id}`, serviceDate: '2026-10-16', studentId: null, personId,
    createdBy: randomUUID(), leaderId: null, leaderName: 'Leader One', ...over };
}
export function claimArgs(over: Partial<ClaimArgs> = {}, consoleId = randomUUID()): ClaimArgs {
  return { console: { consoleId, label: 'Desk', contractVersion: 1, consoleVersion: '1.0.0', inWindow: true,
    pollSeconds: 60, capabilities: { ...ALL_LIVE } }, max: 20, leaseSeconds: 180, cutoffDays: 3,
    leaseLostMs: 3_600_000, ...over };
}
function logRow(over: Partial<LinkLogRow> = {}): LinkLogRow {
  return { id: randomUUID(), at: new Date().toISOString(), userId: randomUUID(), login: 'grade9g', deviceId: 'dev-1',
    deviceLabel: 'iPhone · Safari', event: 'checkIn', leaderId: null, leaderName: null, prevLeaderId: null,
    prevLeaderName: null, targetKind: 'person', targetId: randomUUID(), targetName: 'Alex Sample', outboxId: null,
    outcome: 'saved', ...over };
}
const roster = (personId: string, firstName = 'Alex'): LinkRosterPushRow =>
  ({ personId, firstName, lastName: 'Sample', gender: 'male', grade: 9, kind: 'student' });

export function describeLinkRepo(name: string, make: MakeLinkRepo) {
  describe(`ILinkRepository (${name})`, () => {
    let h: LinkRepoHarness;
    let repo: ILinkRepository;
    const harnesses: LinkRepoHarness[] = [];
    const extra = async (opts: Parameters<MakeLinkRepo>[0]) => { const x = await make(opts); harnesses.push(x); return x; };
    beforeEach(async () => { h = await make(); repo = h.repo; });
    afterEach(async () => { await h.cleanup(); while (harnesses.length) await harnesses.pop()!.cleanup(); });

    describe('insertAction / getAction', () => {
      it('returns the row pending with attempts 0', async () => {
        const n = newRow({ note: 'secret' });
        const r = await repo.insertAction(n);
        expect(r).toMatchObject({ id: n.id, type: 'checkIn', status: 'pending', attempts: 0, reason: null, detail: null,
          retryAt: null, leaseOwner: null, leaseUntil: null, resultAt: null, sentLogKey: null, reportId: null,
          serviceDate: '2026-10-16', dedupeKey: n.dedupeKey, createdBy: n.createdBy, leaderName: 'Leader One' });
        expect(r.payload).toEqual(n.payload);
        expect(typeof r.createdAt).toBe('string');
        const g = await repo.getAction(n.id);
        expect(g).toMatchObject({ id: n.id, status: 'pending', note: null });
        expect(await repo.getAction(randomUUID())).toBeNull();
      });
      it('a second open row with the same key throws LinkOpenDuplicate(existingId); free again after cancel', async () => {
        const a = await repo.insertAction(newRow({ dedupeKey: 'same' }));
        const err = await repo.insertAction(newRow({ dedupeKey: 'same' })).catch((e) => e);
        expect(err).toBeInstanceOf(LinkOpenDuplicate);
        expect(err.extra).toEqual({ existingId: a.id });
        expect(await repo.cancelPending(a.id)).toBe(true);
        const b = await repo.insertAction(newRow({ dedupeKey: 'same' }));
        expect(b.status).toBe('pending');
      });
      it('A8 / APP-72: the same id twice throws LinkIdExists (insert on conflict (id) do nothing, nothing changed)', async () => {
        const n = newRow();
        await repo.insertAction(n);
        const err = await repo.insertAction({ ...n, leaderName: 'Someone Else' }).catch((e) => e);
        expect(err).toBeInstanceOf(LinkIdExists);
        expect(await repo.getAction(n.id)).toMatchObject({ id: n.id, leaderName: 'Leader One' });
      });
    });

    describe('listActions', () => {
      it('filters by every field, newest first, note always null', async () => {
        const user = randomUUID(); const st = randomUUID(); const grp = randomUUID(); const person = randomUUID();
        const a = await repo.insertAction(newRow({ createdBy: user, note: 'n', serviceDate: '2026-10-10', personId: person,
          payload: { serviceTimeId: st, serviceId: randomUUID(), personId: person } }));
        const b = await repo.insertAction(newRow({ type: 'submitReport', serviceDate: '2026-10-16', personId: null,
          payload: { groupId: grp, date: '2026-10-16', didNotMeet: true, attendees: [], guests: 0, notesPrivate: false, serviceTimeId: null } }));
        const c = await repo.insertAction(newRow({ createdBy: user, serviceDate: '2026-10-20' }));
        await h.backdate('link_outbox', a.id, 'created_at', ago(3000));
        await h.backdate('link_outbox', b.id, 'created_at', ago(2000));
        await h.backdate('link_outbox', c.id, 'created_at', ago(1000));
        await repo.cancelPending(c.id);
        const ids = (rs: { id: string }[]) => rs.map((r) => r.id);
        const mine = [a.id, b.id, c.id];
        const only = async (f: Parameters<ILinkRepository['listActions']>[0]) => ids(await repo.listActions(f)).filter((i) => mine.includes(i));
        expect(await only({ ids: mine })).toEqual([c.id, b.id, a.id]);
        expect(await only({ ids: [a.id, c.id] })).toEqual([c.id, a.id]);
        expect(await only({ createdBy: user })).toEqual([c.id, a.id]);
        expect(await only({ ids: mine, serviceDateFrom: '2026-10-11', serviceDateTo: '2026-10-16' })).toEqual([b.id]);
        expect(await only({ ids: mine, serviceDateFrom: '2026-10-16' })).toEqual([c.id, b.id]);
        expect(await only({ ids: mine, types: ['submitReport'] })).toEqual([b.id]);
        expect(await only({ ids: mine, statuses: ['cancelled'] })).toEqual([c.id]);
        expect(await only({ ids: mine, personId: person })).toEqual([a.id]);
        expect(await only({ ids: mine, serviceTimeId: st })).toEqual([a.id]);
        expect(await only({ ids: mine, groupId: grp })).toEqual([b.id]);
        for (const r of await repo.listActions({ ids: mine })) expect(r.note).toBeNull();
      });
      it('hasNote says whether a note is stored, without returning it (getAction + listActions)', async () => {
        const a = await repo.insertAction(newRow({ note: 'private words' }));
        const b = await repo.insertAction(newRow({ note: null }));
        const list = await repo.listActions({ ids: [a.id, b.id] });
        expect(list.find((r) => r.id === a.id)).toMatchObject({ hasNote: true, note: null });
        expect(list.find((r) => r.id === b.id)).toMatchObject({ hasNote: false, note: null });
        expect(await repo.getAction(a.id)).toMatchObject({ hasNote: true, note: null });
        expect(await repo.getAction(b.id)).toMatchObject({ hasNote: false, note: null });
      });
    });

    describe('cancelPending', () => {
      it('true only from pending', async () => {
        const a = await repo.insertAction(newRow());
        expect(await repo.cancelPending(a.id)).toBe(true);
        expect((await repo.getAction(a.id))!.status).toBe('cancelled');
        expect(await repo.cancelPending(a.id)).toBe(false);
        const b = await repo.insertAction(newRow());
        await repo.claim(claimArgs());
        expect(await repo.cancelPending(b.id)).toBe(false);
        expect((await repo.getAction(b.id))!.status).toBe('claimed');
        expect(await repo.cancelPending(randomUUID())).toBe(false);
      });
    });

    describe('claim', () => {
      it('upserts the console row', async () => {
        const args = claimArgs({ max: 0 });
        await repo.claim(args);
        const c = (await repo.listConsoles()).find((x) => x.consoleId === args.console.consoleId)!;
        expect(c).toMatchObject({ label: 'Desk', contractVersion: 1, consoleVersion: '1.0.0', inWindow: true,
          pollSeconds: 60, capabilities: ALL_LIVE });
        expect(Date.now() - Date.parse(c.lastSeenAt)).toBeLessThan(60_000);
        await repo.claim({ ...args, console: { ...args.console, label: 'Desk 2', pollSeconds: 900 } });
        const all = (await repo.listConsoles()).filter((x) => x.consoleId === args.console.consoleId);
        expect(all).toHaveLength(1);
        expect(all[0]).toMatchObject({ label: 'Desk 2', pollSeconds: 900 });
      });
      it('leases oldest first, at most max; sets claimed, owner, lease, attempts + 1; returns the note', async () => {
        const rows = [];
        for (let i = 0; i < 3; i++) rows.push(await repo.insertAction(newRow({ note: `note ${i}` })));
        for (let i = 0; i < 3; i++) await h.backdate('link_outbox', rows[i]!.id, 'created_at', ago((10 - i) * 60_000));
        const args = claimArgs({ max: 2 });
        const got = await repo.claim(args);
        expect(got.map((g) => g.row.id)).toEqual([rows[0]!.id, rows[1]!.id]);
        for (const [i, g] of got.entries()) {
          expect(g).toMatchObject({ reclaimed: false, noteUnreadable: false });
          expect(g.row).toMatchObject({ status: 'claimed', leaseOwner: args.console.consoleId, attempts: 1, note: `note ${i}` });
          expect(Date.parse(g.row.leaseUntil!)).toBeGreaterThan(Date.now() + 120_000);
          expect(await repo.getAction(g.row.id)).toMatchObject({ status: 'claimed', attempts: 1, note: null });
        }
        expect((await repo.getAction(rows[2]!.id))!.status).toBe('pending');
      });
      it('skips a type whose capability is off', async () => {
        const a = await repo.insertAction(newRow());
        const b = await repo.insertAction(newRow({ type: 'checkOut', payload: { serviceTimeId: randomUUID(), personId: randomUUID() } }));
        const args = claimArgs();
        args.console.capabilities.checkIn = 'off';
        args.console.capabilities.checkOut = 'locked';
        const got = (await repo.claim(args)).map((g) => g.row.id);
        expect(got).toContain(b.id);
        expect(got).not.toContain(a.id);
      });
      it('max 0 leases nothing but still upserts and sweeps', async () => {
        const old = await repo.insertAction(newRow());
        await h.backdate('link_outbox', old.id, 'created_at', ago(4 * DAY));
        const fresh = await repo.insertAction(newRow());
        const args = claimArgs({ max: 0 });
        expect(await repo.claim(args)).toEqual([]);
        expect((await repo.listConsoles()).some((c) => c.consoleId === args.console.consoleId)).toBe(true);
        expect(await repo.getAction(old.id)).toMatchObject({ status: 'refused', reason: 'too-old' });
        expect((await repo.getAction(fresh.id))!.status).toBe('pending');
      });
      it('skips a pending row whose retryAt is in the future, takes one in the past', async () => {
        const later = await repo.insertAction(newRow());
        const due = await repo.insertAction(newRow());
        await h.backdate('link_outbox', later.id, 'retry_at', ahead(10 * 60_000));
        await h.backdate('link_outbox', due.id, 'retry_at', ago(60_000));
        const got = (await repo.claim(claimArgs())).map((g) => g.row.id);
        expect(got).toContain(due.id);
        expect(got).not.toContain(later.id);
      });
      it('B4 / APP-3 C: a checkOut is not leased while an older checkIn for the same person and service is pending or claimed', async () => {
        const st = randomUUID(), person = randomUUID();
        const inRow = (over: Partial<NewOutboxRow> = {}) => newRow({ type: 'checkIn', personId: person,
          payload: { serviceTimeId: st, serviceId: randomUUID(), personId: person }, ...over });
        const outRow = (over: Partial<NewOutboxRow> = {}) => newRow({ type: 'checkOut', personId: person,
          payload: { serviceTimeId: st, personId: person }, ...over });
        const i1 = await repo.insertAction(inRow());
        const o1 = await repo.insertAction(outRow());
        await h.backdate('link_outbox', i1.id, 'created_at', ago(120_000));
        await h.backdate('link_outbox', o1.id, 'created_at', ago(60_000));
        const c1 = claimArgs();
        const first = (await repo.claim(c1)).map((g) => g.row.id);
        expect(first).toContain(i1.id);
        expect(first).not.toContain(o1.id); // the check-in is pending in the same pick
        expect((await repo.claim(claimArgs())).map((g) => g.row.id)).not.toContain(o1.id); // console 2: check-in claimed
        // another service or another person does not block
        const other = await repo.insertAction(newRow({ type: 'checkOut', personId: person,
          payload: { serviceTimeId: randomUUID(), personId: person } }));
        expect((await repo.claim(claimArgs())).map((g) => g.row.id)).toContain(other.id);
        // once the check-in is final the check-out goes
        await repo.applyResults(c1.console.consoleId, [{ id: i1.id, outcome: 'sent', sentLogKey: 'k' }], new Date());
        expect((await repo.claim(claimArgs())).map((g) => g.row.id)).toContain(o1.id);
      });
      it('re-leases a claimed row with an ended lease only to the same console', async () => {
        const a = await repo.insertAction(newRow({ note: 'again' }));
        const mine = claimArgs();
        await repo.claim(mine);
        await h.backdate('link_outbox', a.id, 'lease_until', ago(60_000));
        expect((await repo.claim(claimArgs())).map((g) => g.row.id)).not.toContain(a.id);
        const again = (await repo.claim(mine)).find((g) => g.row.id === a.id)!;
        expect(again).toMatchObject({ reclaimed: true, noteUnreadable: false });
        expect(again.row).toMatchObject({ status: 'claimed', attempts: 2, note: 'again', leaseOwner: mine.console.consoleId });
        // a live lease is not re-leased, even by its owner
        expect((await repo.claim(mine)).map((g) => g.row.id)).not.toContain(a.id);
      });
    });

    describe('sweep', () => {
      it('pending 3+ days → refused too-old; claimed lease ended over leaseLostMs ago → unclear lease-lost', async () => {
        const old = await repo.insertAction(newRow());
        const young = await repo.insertAction(newRow());
        await h.backdate('link_outbox', old.id, 'created_at', ago(3 * DAY + 60_000));
        await h.backdate('link_outbox', young.id, 'created_at', ago(2 * DAY));
        const lost = await repo.insertAction(newRow());
        const late = await repo.insertAction(newRow());
        const owner = claimArgs();
        await repo.claim({ ...owner, max: 20 });
        await h.backdate('link_outbox', lost.id, 'lease_until', ago(3_600_000 + 60_000));
        await h.backdate('link_outbox', late.id, 'lease_until', ago(30 * 60_000));
        await repo.claim(claimArgs({ max: 0 }));
        expect(await repo.getAction(old.id)).toMatchObject({ status: 'refused', reason: 'too-old' });
        expect(await repo.getAction(lost.id)).toMatchObject({ status: 'unclear', reason: 'lease-lost' });
        expect((await repo.getAction(late.id))!.status).toBe('claimed');
        expect((await repo.getAction(young.id))!.status).toBe('claimed');
      });
      it('B1 / X6: the sweep skips the claiming console\'s own rows; that console reclaims them, another marks them lost', async () => {
        const a = await repo.insertAction(newRow());
        const b = await repo.insertAction(newRow());
        const A = claimArgs();
        await repo.claim(A);
        for (const id of [a.id, b.id]) await h.backdate('link_outbox', id, 'lease_until', ago(2 * 3_600_000));
        const got = (await repo.claim({ ...A, max: 1 })).find((g) => g.row.id === a.id)!;
        expect(got).toMatchObject({ reclaimed: true });
        expect(got.row).toMatchObject({ status: 'claimed', leaseOwner: A.console.consoleId });
        expect((await repo.getAction(b.id))!.status).toBe('claimed'); // not swept by its own console
        await repo.claim(claimArgs({ max: 0 })); // console B
        expect(await repo.getAction(b.id)).toMatchObject({ status: 'unclear', reason: 'lease-lost' });
        expect((await repo.getAction(a.id))!.status).toBe('claimed'); // A's fresh lease is live
      });
    });

    describe('purge', () => {
      it('roster: inactive 90+ days with match none/ignored deleted, auto kept', async () => {
        const [p1, p2, p3, p4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const t1 = ago(60_000);
        await repo.replaceMirror('roster', [roster(p1), roster(p2), roster(p3), roster(p4)], { takenAt: t1, consoleId: randomUUID() });
        await repo.setMatches([{ personId: p2, studentId: null, match: 'ignored' }, { personId: p3, studentId: randomUUID(), match: 'auto' }]);
        await repo.replaceMirror('roster', [roster(p4)], { takenAt: ago(1000), consoleId: randomUUID() });
        for (const p of [p1, p2, p3]) await h.backdate('link_roster', p, 'updated_at', ago(91 * DAY));
        await repo.claim(claimArgs({ max: 0 }));
        const left = (await repo.roster()).map((r) => r.personId);
        expect(left).not.toContain(p1);
        expect(left).not.toContain(p2);
        expect(left).toContain(p3);
        expect(left).toContain(p4);
      });
      it('notes nulled on final rows older than 30 days; log rows older than 400 days deleted', async () => {
        const old = await repo.insertAction(newRow({ note: 'old note' }));
        await repo.cancelPending(old.id);
        await h.backdate('link_outbox', old.id, 'created_at', ago(31 * DAY));
        const fresh = await repo.insertAction(newRow({ note: 'fresh note' }));
        await repo.cancelPending(fresh.id);
        const lOld = logRow(); const lNew = logRow();
        await repo.addLog([lOld, lNew]);
        await h.backdate('link_log', lOld.id, 'at', ago(401 * DAY));
        await repo.claim(claimArgs({ max: 0 }));
        expect(await h.peekNote(old.id)).toBeNull();
        expect(await h.peekNote(fresh.id)).toBe('fresh note');
        const logs = (await repo.listLog({ from: ago(500 * DAY), to: ahead(DAY), limit: 2000 })).map((l) => l.id);
        expect(logs).toContain(lNew.id);
        expect(logs).not.toContain(lOld.id);
      });
    });

    describe('note unreadable', () => {
      it('the leased row is refused note-unreadable; the others are fine', async () => {
        const x = await extra({ decrypt: (note) => { if (note === 'bad') throw new Error('no key'); return note; } });
        const good = await x.repo.insertAction(newRow({ note: 'good' }));
        const bad = await x.repo.insertAction(newRow({ note: 'bad' }));
        const none = await x.repo.insertAction(newRow());
        const got = await x.repo.claim(claimArgs());
        const by = (id: string) => got.find((g) => g.row.id === id)!;
        expect(by(good.id)).toMatchObject({ noteUnreadable: false, row: { note: 'good', status: 'claimed' } });
        expect(by(none.id)).toMatchObject({ noteUnreadable: false, row: { note: null, status: 'claimed' } });
        expect(by(bad.id)).toMatchObject({ noteUnreadable: true, row: { note: null, status: 'refused', reason: 'note-unreadable' } });
        expect(await x.repo.getAction(bad.id)).toMatchObject({ status: 'refused', reason: 'note-unreadable' });
      });
    });

    describe('replaceMirror', () => {
      it('a stale takenAt is not applied', async () => {
        const c = randomUUID(); const p = randomUUID();
        expect(await repo.replaceMirror('roster', [roster(p)], { takenAt: '2026-10-16T08:30:00.000Z', consoleId: c }))
          .toEqual({ applied: true, rows: 1 });
        for (const t of ['2026-10-16T08:30:00.000Z', '2026-10-16T08:00:00.000Z']) {
          expect((await repo.replaceMirror('roster', [roster(randomUUID())], { takenAt: t, consoleId: c })).applied).toBe(false);
        }
        expect((await repo.roster()).map((r) => r.personId)).toEqual([p]);
      });
      it('roster upserts by personId, keeps studentId/match, deactivates missing people', async () => {
        const [p1, p2] = [randomUUID(), randomUUID()]; const sid = randomUUID(); const c = randomUUID();
        await repo.replaceMirror('roster', [roster(p1), roster(p2, 'Jamie')], { takenAt: '2026-10-16T08:00:00.000Z', consoleId: c });
        await repo.setMatches([{ personId: p1, studentId: sid, match: 'manual' }]);
        const before = (await repo.roster()).find((r) => r.personId === p2)!;
        expect(before).toMatchObject({ active: true, studentId: null, match: 'none', firstName: 'Jamie', gender: 'male', grade: 9, kind: 'student' });
        await h.backdate('link_roster', p2, 'updated_at', ago(DAY));
        const r = await repo.replaceMirror('roster', [{ ...roster(p1, 'Alexander'), grade: 10 }],
          { takenAt: '2026-10-16T09:00:00.000Z', consoleId: c });
        expect(r).toEqual({ applied: true, rows: 1 });
        const after = await repo.roster();
        expect(after.find((x) => x.personId === p1)).toMatchObject({ firstName: 'Alexander', grade: 10, studentId: sid, match: 'manual', active: true });
        const gone = after.find((x) => x.personId === p2)!;
        expect(gone.active).toBe(false);
        expect(Date.now() - Date.parse(gone.updatedAt)).toBeLessThan(60_000);
        await repo.replaceMirror('roster', [roster(p1), roster(p2, 'Jamie')], { takenAt: '2026-10-16T10:00:00.000Z', consoleId: c });
        expect((await repo.roster()).find((x) => x.personId === p2)!.active).toBe(true);
      });
      it('services, groups and flows replace fully; mirrorState shows each kind', async () => {
        const c = randomUUID();
        const svc = (id: string): LinkServiceRow => ({ serviceTimeId: id, serviceId: randomUUID(), name: 'Friday Night',
          startsAt: '2026-10-16T08:30:00.000Z', ymd: '2026-10-16', rooms: [{ id: randomUUID(), name: 'Main' }],
          checkedIn: [{ personId: randomUUID(), roomId: randomUUID() }] });
        const grp = (id: string): LinkGroupRow => ({ groupId: id, name: 'Year 9 Girls', grade: 9, gender: 'female',
          meets: 'Monday', members: [{ personId: randomUUID(), name: 'Alex Sample', leader: false }], thisWeek: 'none',
          lastReport: { reportId: randomUUID(), date: '2026-10-12', time: '18:30', didNotMeet: false, attendees: [],
            guests: 0, serviceTimeId: null, editable: true, blocked: null } });
        const flow = (id: string): LinkFlowRow => ({ rowId: id, flowId: randomUUID(), flowName: 'New people', stepId: randomUUID(),
          stepName: 'Call', stepOrder: 1, personId: randomUUID(), name: 'Alex Sample', due: '2026-10-20', assignedTo: 'Sam' });
        const [s1, s2, g1, g2, f1, f2] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
        const s1Row = svc(s1); const g1Row = grp(g1); const f1Row = { ...flow(f1), due: null, personId: null };
        await repo.replaceMirror('services', [s1Row], { takenAt: '2026-10-16T08:00:00.000Z', consoleId: c });
        await repo.replaceMirror('groups', [g1Row], { takenAt: '2026-10-16T08:00:00.000Z', consoleId: c });
        await repo.replaceMirror('flows', [f1Row], { takenAt: '2026-10-16T08:00:00.000Z', consoleId: c });
        expect(await repo.services()).toEqual([s1Row]);
        expect(await repo.groups()).toEqual([g1Row]);
        expect(await repo.flows()).toEqual([f1Row]);
        await repo.replaceMirror('services', [svc(s2)], { takenAt: '2026-10-16T09:00:00.000Z', consoleId: c });
        await repo.replaceMirror('groups', [{ ...grp(g2), grade: null, gender: null, lastReport: null }], { takenAt: '2026-10-16T09:00:00.000Z', consoleId: c });
        await repo.replaceMirror('flows', [flow(f2)], { takenAt: '2026-10-16T09:00:00.000Z', consoleId: c });
        expect((await repo.services()).map((s) => s.serviceTimeId)).toEqual([s2]);
        expect(await repo.groups()).toEqual([expect.objectContaining({ groupId: g2, grade: null, gender: null, lastReport: null })]);
        expect((await repo.flows()).map((f) => f.rowId)).toEqual([f2]);
        const st = await repo.mirrorState();
        for (const kind of ['services', 'groups', 'flows'] as const) {
          const s = st.find((x) => x.kind === kind)!;
          expect(s).toMatchObject({ consoleId: c, rowCount: 1 });
          expect(Date.parse(s.takenAt)).toBe(Date.parse('2026-10-16T09:00:00.000Z'));
          expect(typeof s.appliedAt).toBe('string');
        }
        expect(st.find((x) => x.kind === 'roster')).toBeUndefined();
        // B18 / X10: rows: [] is a full replace that means "none now"
        expect(await repo.replaceMirror('flows', [], { takenAt: '2026-10-16T10:00:00.000Z', consoleId: c })).toEqual({ applied: true, rows: 0 });
        expect(await repo.flows()).toEqual([]);
        expect((await repo.mirrorState()).find((x) => x.kind === 'flows')).toMatchObject({ rowCount: 0 });
      });
    });

    describe('applyResults', () => {
      const FIX = join(__dirname, '..', 'fixtures', 'elvanto-link');
      const fx = (f: string) => JSON.parse(readFileSync(join(FIX, f), 'utf8'));
      const req = fx('result-request.json') as { consoleId: string; results: ResultItem[] };
      const TYPES: Record<string, ActionType> = { '1': 'checkIn', '3': 'submitReport', '4': 'editReport', '5': 'completeStep',
        '6': 'firstTimerCheckIn', '7': 'checkIn', '8': 'checkIn', '9': 'checkIn', a: 'checkIn' };
      const fid = (n: string) => `0a000000-0000-4000-8000-00000000000${n}`;
      /** Inserts the fixture rows, leases them to the fixture console, and resolves row a to sent (so its repeat is final). */
      async function seed() {
        for (const [n, type] of Object.entries(TYPES)) await repo.insertAction(newRow({ id: fid(n), type }));
        await repo.claim(claimArgs({}, req.consoleId as ReturnType<typeof randomUUID>));
        await repo.applyResults(req.consoleId, [{ id: fid('a'), outcome: 'unclear', sentLogKey: 'k:a' }], new Date());
        expect(await repo.applyResults(randomUUID(), [{ id: fid('a'), outcome: 'resolved', landed: true }], new Date()))
          .toEqual({ applied: [fid('a')], ignored: [] });
      }

      it('replays result-request.json: the reply parses and each row follows §3.3', async () => {
        await seed();
        const now = new Date();
        const reply = await repo.applyResults(req.consoleId, req.results, now);
        expect(ResultResponse.parse(reply)).toEqual(fx('result-response.json'));
        const get = async (n: string) => (await repo.getAction(fid(n)))!;
        expect(await get('1')).toMatchObject({ status: 'sent', reason: null,
          sentLogKey: 'checkIn:service:57000000-0000-4000-8000-000000000001:9e000000-0000-4000-8000-000000000001' });
        expect(await get('3')).toMatchObject({ status: 'sent', reportId: '7e000000-0000-4000-8000-000000000003' });
        expect(await get('6')).toMatchObject({ status: 'sent', personId: '9e000000-0000-4000-8000-000000000005' });
        expect(await get('7')).toMatchObject({ status: 'sent', reason: 'already' });
        expect(await get('4')).toMatchObject({ status: 'refused', reason: 'report-changed', detail: 'This report changed in Elvanto.' });
        expect(await get('8')).toMatchObject({ status: 'unclear', detail: 'Elvanto may not have saved this.',
          sentLogKey: 'checkIn:service:57000000-0000-4000-8000-000000000001:9e000000-0000-4000-8000-000000000003' });
        expect(await get('5')).toMatchObject({ status: 'shadowed', sentLogKey: 'complete:ys:f7000000-0000-4000-8000-000000000001' });
        expect(await get('a')).toMatchObject({ status: 'sent', sentLogKey: 'k:a' });
        for (const n of ['1', '3', '6', '7', '4', '8', '5']) expect((await get(n)).resultAt).not.toBeNull();
        const retry = await get('9');
        expect(retry).toMatchObject({ status: 'pending', reason: 'awaiting-approval', leaseOwner: null, leaseUntil: null });
        expect(Math.abs(Date.parse(retry.retryAt!) - (now.getTime() + 300_000))).toBeLessThan(1000);
      });

      it('a repeat of the same final results is all already-final with no change', async () => {
        await seed();
        await repo.applyResults(req.consoleId, req.results, new Date());
        const final = req.results.filter((r) => r.outcome !== 'retry');
        const before = await repo.listActions({ ids: final.map((r) => r.id) });
        const again = await repo.applyResults(req.consoleId, final, new Date(Date.now() + 5000));
        expect(again).toEqual({ applied: [], ignored: final.map((r) => ({ id: r.id, why: 'already-final' })) });
        expect(await repo.listActions({ ids: final.map((r) => r.id) })).toEqual(before);
        // the retried row is pending again: nobody holds its lease
        expect((await repo.applyResults(req.consoleId, req.results.filter((r) => r.outcome === 'retry'), new Date())).ignored)
          .toEqual([{ id: fid('9'), why: 'not-leased' }]);
      });

      it('another console is not-leased; unknown id is unknown-id; a new outcome on a final row is bad-transition', async () => {
        const a = await repo.insertAction(newRow());
        const owner = claimArgs();
        await repo.claim(owner);
        const before = await repo.getAction(a.id);
        const unknown = randomUUID();
        const r = await repo.applyResults(randomUUID(), [{ id: a.id, outcome: 'sent', sentLogKey: 'k' },
          { id: unknown, outcome: 'already' }], new Date());
        expect(r).toEqual({ applied: [], ignored: [{ id: a.id, why: 'not-leased' }, { id: unknown, why: 'unknown-id' }] });
        expect(await repo.getAction(a.id)).toEqual(before);
        // the owner's result still counts after its lease ended
        await h.backdate('link_outbox', a.id, 'lease_until', ago(60_000));
        expect(await repo.applyResults(owner.console.consoleId, [{ id: a.id, outcome: 'refused', reason: 'no-room' }], new Date()))
          .toEqual({ applied: [a.id], ignored: [] });
        expect(await repo.applyResults(owner.console.consoleId, [{ id: a.id, outcome: 'already' }], new Date()))
          .toEqual({ applied: [], ignored: [{ id: a.id, why: 'bad-transition' }] });
        expect(await repo.getAction(a.id)).toMatchObject({ status: 'refused', reason: 'no-room' });
      });

      it('resolved on an unclear row works from a second console (landed and not landed)', async () => {
        const x = await repo.insertAction(newRow());
        const y = await repo.insertAction(newRow());
        const owner = claimArgs();
        await repo.claim(owner);
        await repo.applyResults(owner.console.consoleId, [{ id: x.id, outcome: 'unclear', sentLogKey: 'k:x' },
          { id: y.id, outcome: 'unclear', sentLogKey: 'k:y' }], new Date());
        expect(await repo.applyResults(randomUUID(), [{ id: x.id, outcome: 'resolved', landed: true },
          { id: y.id, outcome: 'resolved', landed: false }], new Date())).toEqual({ applied: [x.id, y.id], ignored: [] });
        expect(await repo.getAction(x.id)).toMatchObject({ status: 'sent', sentLogKey: 'k:x' });
        expect(await repo.getAction(y.id)).toMatchObject({ status: 'refused', reason: 'not-landed' });
      });

      it('writes only the result columns: the stored note and attempts are kept', async () => {
        const a = await repo.insertAction(newRow({ note: 'keep me' }));
        const owner = claimArgs();
        await repo.claim(owner);
        await repo.applyResults(owner.console.consoleId, [{ id: a.id, outcome: 'sent', sentLogKey: 'k' }], new Date());
        expect(await h.peekNote(a.id)).toBe('keep me');
        expect(await repo.getAction(a.id)).toMatchObject({ status: 'sent', attempts: 1, leaseOwner: owner.console.consoleId });
      });
    });

    describe('setMatches / log', () => {
      it('setMatches writes studentId and match', async () => {
        const p = randomUUID(); const sid = randomUUID();
        await repo.replaceMirror('roster', [roster(p)], { takenAt: ago(1000), consoleId: randomUUID() });
        await repo.setMatches([{ personId: p, studentId: sid, match: 'auto' }]);
        expect((await repo.roster())[0]).toMatchObject({ studentId: sid, match: 'auto' });
        await repo.setMatches([{ personId: p, studentId: null, match: 'none' }]);
        expect((await repo.roster())[0]).toMatchObject({ studentId: null, match: 'none' });
      });
      it('addLog / listLog filter by range, user, event; newest first; limit', async () => {
        const u = randomUUID();
        const a = logRow({ userId: u, at: '2026-10-16T08:00:00.000Z', event: 'identity', leaderId: randomUUID(),
          leaderName: 'Sam', prevLeaderId: randomUUID(), prevLeaderName: 'Cody', targetKind: null, targetId: null,
          targetName: null, outcome: 'logged' });
        const b = logRow({ userId: u, at: '2026-10-16T09:00:00.000Z', outboxId: randomUUID() });
        const c = logRow({ at: '2026-10-16T10:00:00.000Z', deviceId: null, deviceLabel: null });
        const d = logRow({ at: '2026-10-18T10:00:00.000Z' });
        await repo.addLog([a, b, c, d]);
        await repo.addLog([]);
        await repo.addLog([{ ...a, outcome: 'again' }]); // A8 / APP-71: on conflict (id) do nothing
        const range = { from: '2026-10-16T00:00:00.000Z', to: '2026-10-17T00:00:00.000Z', limit: 2000 };
        const all = await repo.listLog(range);
        expect(all.map((l) => l.id)).toEqual([c.id, b.id, a.id]);
        expect(all[2]).toEqual(a);
        expect((await repo.listLog({ ...range, userId: u })).map((l) => l.id)).toEqual([b.id, a.id]);
        expect((await repo.listLog({ ...range, event: 'identity' })).map((l) => l.id)).toEqual([a.id]);
        expect((await repo.listLog({ ...range, limit: 1 })).map((l) => l.id)).toEqual([c.id]);
      });
    });
  });
}
