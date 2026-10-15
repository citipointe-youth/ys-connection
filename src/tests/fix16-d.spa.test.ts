// Fix round 16 Oct 2026, lane D (Link core + door + New person): run from the REAL page source.
import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

describe('F-02(a) door: a double tap checks in one person and keeps the row in place', () => {
  const prelude = `
    const LK_DOOR_HOLD_MS = 600;
    let LINK = { svc: 'S', people: { S: { people: [
      { personId: 'tom', name: 'Tom LEstrange', checkedIn: false },
      { personId: 'ree', name: 'Ree LEstrange', checkedIn: false }] } }, q: { search: 'lestrange' }, refusals: {} };
    let Q = [];
    const pushed = [];
    function _lkSvc() { return { serviceTimeId: 'S', serviceId: 'SV' }; }
    function _lkQGet() { return Q.slice(); }
    function _lkQSet(q) { Q = q.slice(); }
    function _lkQueuedIdx(q, svc, pid) { return q.findIndex((it) => it.payload && it.payload.personId === pid); }
    function _lkTakeBack() { return false; }
    function _lkRefreshView() {}
    function _lkPush(it) { pushed.push(it); Q.push(it); }
    function _lkTapToast() {}
    function getMyLeaderId() { return null; }
    function _lkUuid() { return 'id' + pushed.length; }
    function _lkMerge(people, q) { return people.map((p) => q.some((it) => it.payload.personId === p.personId) ? Object.assign({}, p, { checkedIn: true, queued: true }) : p); }
    function _lkFilter(l) { return l; }
    function setT(ms) { LINK.doorAt = Date.now() - ms; }
    function state() { return { pushed, Q }; }`;
  const f = loadFns(['_lkDoorBusy', '_lkCheck', '_lkLists'], prelude, ['_lkCheck', '_lkLists', 'setT', 'state']);

  it('a second tap within 600 ms is a no-op (no undo, no second row queued)', () => {
    f._lkCheck('tom', 'checkIn');
    f._lkCheck('tom', 'checkIn'); // would take the queued item back
    f._lkCheck('ree', 'checkIn'); // the row that slid under the finger
    expect(f.state().pushed.length).toBe(1);
    expect(f.state().Q.map((x: any) => x.payload.personId)).toEqual(['tom']);
  });
  it('the tapped row stays in the match list for 600 ms, then moves to Checked in', () => {
    expect(f._lkLists().due.map((p: any) => p.personId)).toEqual(['tom', 'ree']);
    f.setT(700);
    const l = f._lkLists();
    expect(l.due.map((p: any) => p.personId)).toEqual(['ree']);
    expect(l.done.map((p: any) => p.personId)).toEqual(['tom']);
  });
  it('after 600 ms a tap works again', () => {
    f._lkCheck('ree', 'checkIn');
    expect(f.state().pushed.length).toBe(2);
  });
});
