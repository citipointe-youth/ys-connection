// 2026-11-06 (Tom, LINK_REV 22; reverses the 24 Oct ruling Q3): Reassign also changes the assignee in Elvanto. The picker lists the
// CURRENT step's admins (steps[].admins, who Elvanto's Re-assign modal lists) when known, else today's list; the current leader and
// Nobody always stay. Reassign keeps the instant YS assignment and queues reassignStep only for a real leader Elvanto lists, while the
// console takes the type. Nobody stays YS-only. `offered` (the Complete modal's NEXT-step list) still gates Complete's assignTo only.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const NAMES = ['_lkFlowRow', '_lkPickList', '_lkPicked', '_lkOffers', '_lkAdmins', '_lkReassignElv', '_lkFits', '_lkReassign'];
const PRELUDE = `
  var LINK = { flows: [], fSteps: [], fLeaders: [], fres: {}, fs: null }, PUSHED = [], ASSIGNED = [], TOASTS = [], CAP = 'live';
  function _lkBoss() { return true; } function getMyLeaderId() { return null; } function _lkIamPick() {} function _lkUuid() { return 'u'; }
  function closeModal() {} function toast(t) { TOASTS.push(t); } function _lkPush(it) { PUSHED.push(it); } function _lkRefreshView() {}
  function _lkCap(t) { return t === 'reassignStep' ? CAP : 'live'; }
  function _lkAssignSave(r, l) { ASSIGNED.push(l); return Promise.resolve(); }
  function setCap(c) { CAP = c; }
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'LINK', 'PUSHED', 'ASSIGNED', 'TOASTS', 'setCap']);
const L = f.LINK;
const P = (n: number) => `9e000000-0000-4000-8000-0000000000${n}`;
const LDRS = [
  { id: 'L1', name: 'Cody', personId: P(70), gender: 'male', grades: [8] },
  { id: 'L2', name: 'Carl', personId: P(71), gender: 'male', grades: [8] },
  { id: 'L3', name: 'Una', personId: null, gender: 'male', grades: [8] },
];
const ROW = { rowId: 'r1', flowId: 'F1', stepId: 'S1', personId: P(10), grade: 8, gender: 'male', currentLeaderId: null as string | null };
const steps = (s: { admins?: string[]; offered?: string[] } = {}) => [{ flowId: 'F1', stepId: 'S1', ...s }];
const ids = () => f._lkPickList(L.flows[0]).map((l: any) => l.id);
const reassign = async (pick: string | null) => { L.fs = { rowId: 'r1', note: '', priv: false, pick }; await f._lkReassign(); };

describe('r31: Reassign changes the leader in Elvanto too (rev 22)', () => {
  beforeEach(() => {
    L.fLeaders = LDRS; L.flows = [{ ...ROW }]; L.fs = null; L.fSteps = steps();
    f.PUSHED.length = 0; f.ASSIGNED.length = 0; f.TOASTS.length = 0; f.setCap('live');
  });
  it('the picker lists the current step admins when known (case-blind); unknown or empty = today\'s list; offered no longer narrows it', () => {
    for (const s of [{}, { admins: [] }, { offered: [P(71)] }]) { L.fSteps = steps(s); expect(ids()).toEqual(['L1', 'L2', 'L3']); }
    L.fSteps = steps({ admins: [P(71).toUpperCase()], offered: [P(70)] });
    expect(ids()).toEqual(['L2']);
  });
  it('the current leader stays listed even when Elvanto does not list them for the step', () => {
    L.flows = [{ ...ROW, currentLeaderId: 'L1' }];
    L.fSteps = steps({ admins: [P(71)] });
    expect(ids()).toEqual(['L1', 'L2']);
  });
  it('Reassign to a leader Elvanto lists: saves in YS first, then queues reassignStep with their Elvanto person id', async () => {
    L.fSteps = steps({ admins: [P(71)] });
    await reassign('L2');
    expect(f.ASSIGNED.map((l: any) => l && l.id)).toEqual(['L2']);
    expect(f.PUSHED).toHaveLength(1);
    expect(f.PUSHED[0]).toMatchObject({ kind: 'action', type: 'reassignStep', note: null,
      payload: { rowId: 'r1', flowId: 'F1', stepId: 'S1', personId: P(10), assignTo: P(71) } });
    expect(f.TOASTS[0]).toBe('Assigned to Carl. Changes the leader in Elvanto too.');
  });
  it('Nobody stays YS-only: unassigned here, nothing queued', async () => {
    L.fSteps = steps({ admins: [P(71)] });
    await reassign(null);
    expect(f.ASSIGNED).toEqual([null]);
    expect(f.PUSHED).toEqual([]);
    expect(f.TOASTS[0]).toBe('Unassigned');
  });
  it('nothing queued when admins are unknown, the leader has no Elvanto person or is not listed, or the console does not take the type', async () => {
    const cases: [() => void, string][] = [
      [() => { L.fSteps = steps(); }, 'L2'],
      [() => { L.fSteps = steps({ admins: [] }); }, 'L2'],
      [() => { L.fSteps = steps(); }, 'L3'],
      [() => { L.flows = [{ ...ROW, currentLeaderId: 'L1' }]; L.fSteps = steps({ admins: [P(71)] }); }, 'L1'],
      [() => { L.fSteps = steps({ admins: [P(71)] }); f.setCap(null); }, 'L2'],
      [() => { L.fSteps = steps({ admins: [P(71)] }); f.setCap('off'); }, 'L2'],
    ];
    for (const [arrange, pick] of cases) {
      L.flows = [{ ...ROW }]; f.PUSHED.length = 0; f.TOASTS.length = 0; f.setCap('live');
      arrange();
      await reassign(pick);
      expect(f.PUSHED).toEqual([]);
      expect(f.TOASTS[0]).toMatch(/^Assigned to \w+$/);
    }
  });
  it('admins and offered are separate lists: one gates Reassign, the other Complete\'s assignTo', () => {
    L.fSteps = steps({ admins: [P(71)], offered: [P(70)] });
    expect(f._lkReassignElv(L.flows[0], LDRS[1])).toBe(true);
    expect(f._lkOffers(L.flows[0], P(71))).toBe(false);
    expect(f._lkReassignElv(L.flows[0], LDRS[0])).toBe(false);
    expect(f._lkOffers(L.flows[0], P(70))).toBe(true);
  });
});
