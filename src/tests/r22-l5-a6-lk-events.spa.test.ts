// Round 2026-10-22 admin lane L5, A6: the Elvanto link Activity log shows words for every server event (APP-63).
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml } from './helpers/extract-fn';
import { ACTION_TYPES } from '../core/link-contract';

const html = loadIndexHtml();

describe('A6 Activity log: words for every server log event (APP-63)', () => {
  // Pinned copy of link.service LOG_EVENTS (not exported): every action type plus these four.
  const LOG_EVENTS = [...ACTION_TYPES, 'identity', 'cancel', 'undo', 'resolve'];
  const { _lkEvents } = loadFns(['_lkEvents', '_lkVerb']);
  it('every event maps to a word that is not the raw code', () => {
    const ev = _lkEvents();
    for (const e of LOG_EVENTS) {
      expect(ev[e], e).toBeTruthy();
      expect(ev[e], e).not.toBe(e);
    }
  });
  it('resolve and recheck read as the admin buttons', () => {
    expect(_lkEvents().resolve).toBe('Marked by admin');
    expect(_lkEvents().recheck).toBe('Check again');
  });
  it('the Status card keeps its six mode rows (more words do not lengthen it)', () => {
    expect(html).toMatch(/function _lkAdmStatusHtml[\s\S]*?\['checkIn', 'checkOut', 'firstTimerCheckIn', 'submitReport', 'editReport', 'completeStep'\]\.filter\(\(k\) => k in caps\)/);
  });
});
