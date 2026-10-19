// UX batch 2026-10-13 T5/T6: the lifegroup members list, run from the REAL page source (extract-and-evaluate).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn } from './helpers/extract-fn';

const prelude = `
  const LK_MEM_TYPES = ['addGroupMember', 'removeGroupMember'];
  let LINK = { gm: {}, gmOpen: {}, mres: {}, status: null };
  let Q = [];
  const S = { user: { role: 'grade' } };
  let MY = null;
  function getMyLeaderId() { return MY; }
  function _lkQGet() { return Q.slice(); }
  function icS(k) { return '<i>' + k + '</i>'; }
  function _lkLastSeen() { return ''; }
  function _lkOutsideWindow() { return false; }
  function _lkTime() { return '7:02 pm'; }
  function setState(o) { if (o.LINK) LINK = Object.assign(LINK, o.LINK); if (o.Q) Q = o.Q; if ('MY' in o) MY = o.MY; if (o.role) S.user.role = o.role; }
`;
const f = loadFns(['esc', '_lkMemberRows', '_lkYouthFilter', '_lkMemOff', '_lkStatusText', '_lkStatusHtml', '_lkStatusTone', '_lkMembersHtml'],
  prelude, ['_lkMemberRows', '_lkYouthFilter', '_lkMemOff', '_lkStatusText', '_lkMembersHtml', 'setState']);

const G = 'g1';
const M = (personId: string, name: string, o: object = {}) => ({ personId, name, leader: false, grade: 9, studentId: null, ...o });
const view = (o: object = {}) => ({ groupId: G, canEdit: true, members: [M('a', 'Amy'), M('d', 'Dana', { leader: true })], changes: [], ...o });

describe('T6 _lkMemberRows: queue > this phone\'s answers > server changes', () => {
  it('a server pending remove strikes the member; a pending add is a greyed extra row', () => {
    const rows = f._lkMemberRows(view({ changes: [
      { id: 'x1', type: 'removeGroupMember', personId: 'a', name: 'Amy', status: 'pending', reason: null },
      { id: 'x2', type: 'addGroupMember', personId: 'b', name: 'Bea', status: 'claimed', reason: null }] }), [], {}, G);
    expect(rows.map((r: any) => [r.personId, r.state])).toEqual([['a', 'removing'], ['d', 'member'], ['b', 'adding']]);
    expect(rows[2].name).toBe('Bea');
  });
  it('a refused remove leaves the member normal with the change; a refused add is not-added', () => {
    const rows = f._lkMemberRows(view({ changes: [
      { id: 'x1', type: 'removeGroupMember', personId: 'a', status: 'refused', reason: 'group-unknown' },
      { id: 'x2', type: 'addGroupMember', personId: 'b', name: 'Bea', status: 'refused', reason: 'too-old' }] }), [], {}, G);
    expect(rows.map((r: any) => [r.personId, r.state, r.change?.status ?? null])).toEqual(
      [['a', 'member', 'refused'], ['d', 'member', null], ['b', 'not-added', 'refused']]);
  });
  it('the newest server change per person wins (server lists newest first)', () => {
    const rows = f._lkMemberRows(view({ changes: [
      { id: 'new', type: 'addGroupMember', personId: 'a', status: 'sent', reason: null },
      { id: 'old', type: 'removeGroupMember', personId: 'a', status: 'refused', reason: 'unknown' }] }), [], {}, G);
    expect(rows[0]).toMatchObject({ state: 'member', change: { id: 'new' } });
  });
  it('a queued item beats everything; a cancelled answer clears the server change; other groups are ignored', () => {
    const v = view({ changes: [{ id: 'x2', type: 'addGroupMember', personId: 'b', name: 'Bea', status: 'pending', reason: null }] });
    const q = [{ kind: 'action', id: 'q1', type: 'removeGroupMember', payload: { groupId: G, personId: 'a' } },
      { kind: 'action', id: 'q2', type: 'addGroupMember', payload: { groupId: 'other', personId: 'z' }, _n: 'Zed' }];
    const mres = { r1: { id: 'r1', type: 'removeGroupMember', groupId: G, personId: 'b', status: 'cancelled', at: 1 } };
    const rows = f._lkMemberRows(v, q, mres, G);
    expect(rows.map((r: any) => [r.personId, r.state])).toEqual([['a', 'removing'], ['d', 'member']]);
    expect(rows[0].change).toMatchObject({ status: 'queued' });
  });
});

describe('T6 _lkYouthFilter', () => {
  const rows = [{ personId: 'a', name: 'Amy Adams', grade: 9 }, { personId: 'b', name: 'Bea Bell', grade: 10 },
    { personId: 'c', name: 'Cal Adams', grade: null }];
  it('name words in any order, case-insensitive; excluded people never listed', () => {
    expect(f._lkYouthFilter(rows, 'adams amy', '', {}).map((r: any) => r.personId)).toEqual(['a']);
    expect(f._lkYouthFilter(rows, 'ADAMS', '', { a: true }).map((r: any) => r.personId)).toEqual(['c']);
  });
  it('grade filter: a grade, or none = no grade', () => {
    expect(f._lkYouthFilter(rows, '', '10', {}).map((r: any) => r.personId)).toEqual(['b']);
    expect(f._lkYouthFilter(rows, '', 'none', {}).map((r: any) => r.personId)).toEqual(['c']);
  });
});

describe('T6 _lkMemOff and status lines', () => {
  it('an unlisted type on a seen console is off; no console seen yet is not', () => {
    f.setState({ LINK: { status: { console: { lastSeenAt: 'x', capabilities: { checkIn: 'live' } } } } });
    expect(f._lkMemOff('addGroupMember')).toBe(true);
    f.setState({ LINK: { status: { console: { lastSeenAt: 'x', capabilities: { addGroupMember: 'live' } } } } });
    expect(f._lkMemOff('addGroupMember')).toBe(false);
    f.setState({ LINK: { status: { console: { lastSeenAt: null, capabilities: null } } } });
    expect(f._lkMemOff('addGroupMember')).toBe(false);
  });
  it('the two new reasons have their own words', () => {
    expect(f._lkStatusText({ status: 'refused', reason: 'group-unknown' })).toBe("This group isn't in Elvanto any more. Reload.");
    expect(f._lkStatusText({ status: 'refused', reason: 'leader-member' })).toBe('Remove a leader in Elvanto.');
  });
});

describe('T5/T6 _lkMembersHtml', () => {
  const g = { groupId: G, members: [] };
  it('closed: only the summary with the count; open: rows with names escaped', () => {
    f.setState({ LINK: { gm: { [G]: view({ members: [M('a', '<b>Amy</b>')] }) }, gmOpen: {}, mres: {}, status: null }, Q: [] });
    const closed = f._lkMembersHtml(g);
    expect(closed).toContain('Members (1)'); expect(closed).not.toContain('Amy');
    f.setState({ LINK: { gmOpen: { [G]: true } } });
    const open = f._lkMembersHtml(g);
    expect(open).toContain('&lt;b&gt;Amy&lt;/b&gt;'); expect(open).not.toContain('<b>Amy');
  });
  it('canEdit: a remove control for a non-leader member only, and Add student; not when the console lacks the type', () => {
    f.setState({ LINK: { gm: { [G]: view() }, gmOpen: { [G]: true }, status: null }, Q: [] });
    const h = f._lkMembersHtml(g);
    expect(h.match(/_lkMemRemove\(/g)).toHaveLength(1);
    expect(h).toContain('Add student');
    f.setState({ LINK: { status: { console: { lastSeenAt: 'x', capabilities: {} } } } });
    const old = f._lkMembersHtml(g);
    expect(old).not.toContain('_lkMemRemove('); expect(old).not.toContain('Add student');
  });
  it('no edit right and no "I am": asks to pick who you are; an admin is never asked', () => {
    f.setState({ LINK: { gm: { [G]: view({ canEdit: false }) }, gmOpen: { [G]: true }, status: null }, Q: [], MY: null, role: 'grade' });
    expect(f._lkMembersHtml(g)).toContain('Pick who you are');
    f.setState({ role: 'admin' });
    expect(f._lkMembersHtml(g)).not.toContain('Pick who you are');
    f.setState({ role: 'grade' });
  });
  it('a queued remove is struck through with a Keep button and "Waiting to send."', () => {
    f.setState({ LINK: { gm: { [G]: view() }, gmOpen: { [G]: true }, status: null },
      Q: [{ kind: 'action', id: 'q1', type: 'removeGroupMember', payload: { groupId: G, personId: 'a' } }] });
    const h = f._lkMembersHtml(g);
    expect(h).toContain('<s>Amy</s>'); expect(h).toContain('_lkMemKeep('); expect(h).toContain('Waiting to send.');
  });
});

describe('T5 the source keeps its rules', () => {
  const html = loadIndexHtml();
  it('a member with a studentId opens the existing profile in 2 columns', () => {
    expect(extractFn(html, '_lkMemOpen')).toContain('showStudentDetail(r.studentId, { two: true })');
    const sd = extractFn(html, 'showStudentDetail');
    expect(sd).toContain("two ? { boxClass: 'mo-two' } : undefined");
    expect(sd).toContain('<div class="sd-two"><div>');
  });
  it('remove asks first; the group page shows the members list', () => {
    expect(extractFn(html, '_lkMemRemove')).toContain('await _lkAsk(');
    expect(extractFn(html, '_lkGroupHtml')).toContain('${_lkMembersHtml(g)}');
  });
});
