// Round 2026-10-30 (LINK_REV 21, ruling Q4): the step sheet's Assigned to picker lists only leaders Elvanto offers for the
// next step, when the console sent the step's offered. Missing or empty offered = unknown = today's list.
import { describe, it, expect, beforeEach } from 'vitest';
import { loadFns } from './helpers/extract-fn';

const NAMES = ['_lkFlowRow', '_lkPickList', '_lkPicked', '_lkOffers', '_lkFits', '_lkStepSend'];
const PRELUDE = `
  var LINK = { flows: [], fSteps: [], fLeaders: [], fres: {}, fs: null }, PUSHED = [], ASSIGNED = [];
  function _lkBoss() { return true; } function getMyLeaderId() { return 'L9'; } function _lkIamPick() {} function _lkUuid() { return 'u'; }
  function closeModal() {} function toast() {} function _lkPush(it) { PUSHED.push(it); }
  function _lkAssignSave(r, l) { ASSIGNED.push(l); return Promise.resolve(); }
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'LINK', 'PUSHED', 'ASSIGNED']);
const L = f.LINK;
const P = (n: number) => `9e000000-0000-4000-8000-0000000000${n}`;
const LDRS = [
  { id: 'L1', name: 'Cody', personId: P(70), gender: 'male', grades: [8] },
  { id: 'L2', name: 'Carl', personId: P(71), gender: 'male', grades: [8] },
  { id: 'L3', name: 'Una', personId: null, gender: 'male', grades: [8] },
];
const ROW = { rowId: 'r1', flowId: 'F1', stepId: 'S1', personId: P(10), grade: 8, gender: 'male', currentLeaderId: null as string | null };
const steps = (offered?: string[]) => [{ flowId: 'F1', stepId: 'S1', ...(offered ? { offered } : {}) }];
const ids = () => f._lkPickList(L.flows[0]).map((l: any) => l.id);

describe('r30: the Assigned to picker follows the step\'s offered (rev 21)', () => {
  beforeEach(() => { L.fLeaders = LDRS; L.flows = [{ ...ROW }]; L.fs = null; f.PUSHED.length = 0; f.ASSIGNED.length = 0; });
  it('known offered: only offered leaders (case-blind); unknown or empty: every fitting leader', () => {
    L.fSteps = steps([P(71).toUpperCase()]);
    expect(ids()).toEqual(['L2']);
    for (const o of [undefined, []]) { L.fSteps = steps(o); expect(ids()).toEqual(['L1', 'L2', 'L3']); }
  });
  it('the current leader stays listed when not offered, and Complete then sends no assignTo (Elvanto picks)', () => {
    L.flows = [{ ...ROW, currentLeaderId: 'L1' }];
    L.fSteps = steps([P(71)]);
    expect(ids()).toEqual(['L1', 'L2']);
    L.fs = { rowId: 'r1', note: '', priv: false, pick: 'L1' };
    f._lkStepSend();
    expect('assignTo' in f.PUSHED[0].payload).toBe(false);
    expect(f.ASSIGNED).toEqual([]); // the current pick is never unassigned
  });
  it('an offered pick is sent as assignTo', () => {
    L.fSteps = steps([P(71)]);
    L.flows = [{ ...ROW, currentLeaderId: 'L2' }];
    L.fs = { rowId: 'r1', note: '', priv: false, pick: 'L2' };
    f._lkStepSend();
    expect(f.PUSHED[0].payload.assignTo).toBe(P(71));
  });
});
