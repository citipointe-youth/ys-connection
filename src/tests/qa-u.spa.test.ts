import { describe, it, expect } from 'vitest';
import { loadFns } from './helpers/extract-fn';

// QA 2026-11-02 lane U: the "I am" pick belongs to one login (item 10).
describe('"I am" survives the same login, not a different one', () => {
  const mk = (store: Record<string, string>) =>
    loadFns(['setMyLeaderId', '_iamNewLogin'], `
      const store = ${JSON.stringify(store)};
      const localStorage = { getItem(k) { return k in store ? store[k] : null; }, setItem(k, v) { store[k] = String(v); }, removeItem(k) { delete store[k]; } };
      const S = { user: { id: 'u1', role: 'quad' } };
      function _vgSnap() {} function _linkOn() { return false; }
      const LINK = { iamPick: 'x', ldrs: [1] };`, ['setMyLeaderId', '_iamNewLogin', 'store', 'LINK']);
  it('the same login signing in again keeps its pick', () => {
    const f = mk({});
    f.setMyLeaderId('L1');
    f._iamNewLogin('u1');
    expect(f.store.yap_leader_id).toBe('L1');
  });
  it('a different login starts with no pick and no skip clock, and no cached name lists', () => {
    const f = mk({});
    f.setMyLeaderId('L1');
    f.store.yap_iam_skip = '123';
    f._iamNewLogin('u2');
    expect(f.store.yap_leader_id).toBeUndefined();
    expect(f.store.yap_iam_skip).toBeUndefined();
    expect(f.LINK.iamPick).toBeUndefined();
    f.setMyLeaderId('L2'); // u1 is still S.user here, so the stamp is u1 again
    expect(f.store.yap_iam_login).toBe('u1');
  });
  it('a pick made before logins were recorded is kept and given to the next login', () => {
    const f = mk({ yap_leader_id: 'L9' });
    f._iamNewLogin('u1');
    expect(f.store.yap_leader_id).toBe('L9');
    expect(f.store.yap_iam_login).toBe('u1');
  });
});
