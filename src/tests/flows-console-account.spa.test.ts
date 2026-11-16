// 16 Nov 2026: "You" reads Console account, Only mine, the not-in-Elvanto list, the category step, and the contract fields.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';
import { PAYLOAD_SCHEMAS } from '../core/link-contract';

const NAMES = ['_lkWho', '_lkNotInElv', '_lkNotInElvHtml', '_lkAdmins', '_lkFlowVisible', '_lkFqHit', '_lkFqGet', '_lkFfGet', '_lkFlowShown', '_lkFlowBucket', '_lkMinePick', '_lkCatStep', '_lkCatHtml', '_lkFfHtml'];
const PRELUDE = `
  var STORE = { yap_leader_id: 'L1' }, SS = {}, ROLE = 'admin';
  var localStorage = { getItem: (k) => (STORE[k] == null ? null : STORE[k]), setItem: (k, v) => { STORE[k] = String(v); } };
  var sessionStorage = { getItem: (k) => (SS[k] == null ? null : SS[k]), setItem: (k, v) => { SS[k] = String(v); } };
  var S = { get user() { return { role: ROLE }; } };
  var LINK = { flows: [], fSteps: [], fLeaders: [] };
  const LK_FF = [['jg', 'Junior Guys', 'boy'], ['jf', 'Junior Girls', 'girl'], ['sg', 'Senior Guys', 'boy'], ['sf', 'Senior Girls', 'girl']];
  function _lkBoss() { return true; } function gradeBands() { return { junior: [7, 8, 9], senior: [10, 11, 12] }; }
  function _lkHubOwned() { return false; } function _lkToday() { return '2026-11-16'; } function _lkFlowsDraw() {}
  function esc(v) { return String(v == null ? '' : v); } function _lkIamPick() {}
`;
const f = loadFns(NAMES, PRELUDE, [...NAMES, 'LINK']);
const row = (o: any) => ({ rowId: 'r', name: 'Amy Sample', grade: 8, gender: 'male', stepName: 'Step 1', personId: 'p', ...o });

describe('flows: Console account label, Only mine, not-in-Elvanto list', () => {
  it('Elvanto\'s "You" reads Console account; real names are untouched', () => {
    expect(f._lkWho(row({ assignedTo: 'You' }))).toBe('Console account');
    expect(f._lkWho(row({ assignedTo: ' you ' }))).toBe('Console account');
    expect(f._lkWho(row({ assignedLeaderName: 'Cody Sample', assignedTo: 'You' }))).toBe('Cody Sample');
    expect(f._lkWho(row({ assignedTo: 'Gina Example' }))).toBe('Gina Example');
  });
  it('searching "console" finds a "You" row', () => {
    expect(f._lkFqHit(row({ assignedTo: 'You' }), 'console')).toBe(true);
    expect(f._lkFqHit(row({ assignedTo: 'You' }), 'you')).toBe(false);
  });
  it('Only mine keeps rows whose current leader is "I am"', () => {
    f.LINK.flows = [row({ rowId: 'a', currentLeaderId: 'L1' }), row({ rowId: 'b', currentLeaderId: 'L2' }), row({ rowId: 'c', currentLeaderId: null })];
    f.LINK.fm = true;
    expect(f._lkFlowVisible().map((r: any) => r.rowId)).toEqual(['a']);
    f.LINK.fm = false;
    expect(f._lkFlowVisible()).toHaveLength(3);
  });
  it('lists rows assigned to a leader Elvanto cannot give them to', () => {
    f.LINK.fLeaders = [{ id: 'L1', personId: 'e1' }, { id: 'L2', personId: null }];
    f.LINK.fSteps = [];
    const rows = [row({ rowId: 'ok', assignedLeaderId: 'L1' }), row({ rowId: 'bad', assignedLeaderId: 'L2', assignedLeaderName: 'Gina Example' }), row({ rowId: 'none' })];
    expect(f._lkNotInElv(rows[0])).toBe(false);
    expect(f._lkNotInElv(rows[1])).toBe(true);
    expect(f._lkNotInElvHtml(rows)).toContain('1 assigned in YS');
    expect(f._lkNotInElvHtml([rows[0]])).toBe('');
  });
});

describe('category step', () => {
  it('only the category step gets the guided sheet', () => {
    expect(f._lkCatStep(row({ stepName: 'Step 3 - ASSIGN A CATEGORY' }))).toBe(true);
    expect(f._lkCatStep(row({ stepName: 'Step 1 - Welcome' }))).toBe(false);
  });
  it('shows the three meanings; inactive adds the date (prefilled) and a required comment', () => {
    const h = f._lkCatHtml({});
    expect(h).toContain('Church member'); expect(h).toContain('Visitor'); expect(h).toContain('Inactive'); expect(h).not.toContain('lk-in-cmt');
    const i = f._lkCatHtml({ cat: 'inactive', inDate: '2026-11-16' });
    expect(i).toContain('value="2026-11-16"'); expect(i).toContain('lk-in-cmt'); expect(i).toContain('Reason is set to Other');
  });
});

describe('completeStep contract: category fields', () => {
  const base = { rowId: '9e000000-0000-4000-8000-000000000001', flowId: '9e000000-0000-4000-8000-000000000002', stepId: '9e000000-0000-4000-8000-000000000003', personId: null, notePrivate: false };
  const S = PAYLOAD_SCHEMAS.completeStep;
  it('accepts none, member/visitor alone, and inactive with date + comment', () => {
    expect(S.safeParse(base).success).toBe(true);
    expect(S.safeParse({ ...base, category: 'member' }).success).toBe(true);
    expect(S.safeParse({ ...base, category: 'inactive', inactiveOn: '2026-11-16', reasonComment: 'No replies' }).success).toBe(true);
  });
  it('refuses inactive without both, others with them, and unknown categories', () => {
    expect(S.safeParse({ ...base, category: 'inactive' }).success).toBe(false);
    expect(S.safeParse({ ...base, category: 'inactive', inactiveOn: '2026-11-16' }).success).toBe(false);
    expect(S.safeParse({ ...base, category: 'visitor', inactiveOn: '2026-11-16', reasonComment: 'x' }).success).toBe(false);
    expect(S.safeParse({ ...base, category: 'gone' }).success).toBe(false);
  });
});
