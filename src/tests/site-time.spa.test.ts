// Y3b: the SPA's dates and consent words follow the location's settings (structure.timeZone, serviceDayOfWeek,
// consentCutoff). Extract-and-run: the REAL functions from public/index.html.
import { describe, it, expect } from 'vitest';
import { loadFns, loadIndexHtml, extractFn, SITE_TIME_FNS, SITE_TIME_CONSTS } from './helpers/extract-fn';
import { brisbaneToday, brisbaneHHMM, instantOf, addDays } from '../services/link-rules';

const HTML = loadIndexHtml();
const BNE = 'Australia/Brisbane', SYD = 'Australia/Sydney';
const IK_HOLD = HTML.match(/^const IK_HOLD = \{[\s\S]*?\n\};/m)![0];
const NAMES = [...SITE_TIME_FNS, 'esc', 'progBar', 'fmtDay', '_lkDay', '_lkAddDays', '_lkTime', '_lkLastFriday', '_lkStepBlock',
  '_lkConsentWait', '_lkNotReceivedText', '_lkFlowDue', '_ikHoldText', '_ikNames', '_ikNm', '_ikVal', '_ikPoss', '_ikRowsHtml',
  '_ikNrRowHtml', '_ikNrState', '_ikNrOk'];
// structure = undefined: settings not loaded yet (the defaults apply).
function spa(structure?: Record<string, unknown>) {
  (globalThis as any).__y3b = structure;
  return loadFns(NAMES, `
    const S = { get settings() { const s = globalThis.__y3b; return s ? { ministryConfig: { structure: s } } : null; } };
    const _ik = () => ({ tab: 'consent', nr: {} });
    ${SITE_TIME_CONSTS}
    ${IK_HOLD}`);
}

// Captured from public/index.html at 7c6963f (before this change), pasted verbatim.
const BEFORE = {
  lastFri: [['2026-10-10', '2026-10-09'], ['2026-10-11', '2026-10-09'], ['2026-10-12', '2026-10-09'], ['2026-10-13', '2026-10-09'],
    ['2026-10-14', '2026-10-09'], ['2026-10-15', '2026-10-09'], ['2026-10-16', '2026-10-16'], ['2026-10-17', '2026-10-16'],
    ['2026-10-18', '2026-10-16'], ['2026-10-19', '2026-10-16'], ['2026-10-20', '2026-10-16'], ['2026-10-21', '2026-10-16'],
    ['2026-10-22', '2026-10-16'], ['2026-10-23', '2026-10-23']],
  stepWait: 'Waiting for the consent reply. Complete opens after Fri 2 Jan 2099 9am.',
  stepDo: 'Do the consent check first (New youth & consent > Consents).',
  notRec: 'No consent reply by Fri 3 Jan 2020 9am. Complete marks "Consent not received" (dated today) on their Elvanto profile, then completes step 0.',
  late: 'The consent form came in after Friday 9 am, so it counts for next week.',
  wait: "Parents can still reply until Friday 9 am, so consent isn't assumed yet. Check again after 9 am.",
  empty: '<div class="lk-hint">Parents who reply show here straight away. Everyone else is added at 9am Friday.</div>',
  nrOk: '<div class="lk-d">No reply by Fri 3 Jan 2020, 9am</div><div class="rc-foot"><button type="button" class="btn btn-secondary btn-sm" onclick="_ikNrOpen(0)">Mark not received</button></div>',
  nrWait: '<div class="lk-d">Waiting (consent Fri 2 Jan 2099)</div>',
  due: '<span>Waiting (consent Fri 2 Jan 2099)</span>',
};
const WAIT = 'Waiting for replies until Friday 9 am';
function lines(f: Record<string, any>) {
  return {
    lastFri: Array.from({ length: 14 }, (_, d) => { const ymd = addDays('2026-10-10', d); return [ymd, f._lkLastFriday(ymd)]; }),
    stepWait: f._lkStepBlock({ consentStep: true, consent: null, notReceivedOk: false, consentFriday: '2099-01-02' }),
    stepDo: f._lkStepBlock({ consentStep: true, consent: null, notReceivedOk: false, consentFriday: '2020-01-03' }),
    notRec: f._lkNotReceivedText({ consentFriday: '2020-01-03' }),
    late: f._ikHoldText({ text: 'Late consent form', role: 'student' }, {}),
    wait: f._ikHoldText({ text: WAIT, role: 'student' }, {}),
    empty: f._ikRowsHtml({ rows: [] }, {}, false),
    nrOk: f._ikNrRowHtml({ rowId: 'r', consentFriday: '2020-01-03', notReceivedOk: true, flowId: 'f', stepId: 's' }, 0, false),
    nrWait: f._ikNrRowHtml({ rowId: 'r', consentFriday: '2099-01-02', notReceivedOk: false }, 0, false),
    due: f._lkFlowDue({ consentStep: true, consentFriday: '2099-01-02' }, '2026-10-20'),
  };
}

describe('Y3b SPA site time', () => {
  it('_siteDay / _siteHHMM / _siteInstant give the server helpers\' answers (Brisbane and Sydney)', () => {
    for (const tz of [BNE, SYD]) {
      const f = spa({ timeZone: tz });
      let bad = 0;
      for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3 * 3600e3 + 17 * 60e3) {
        const iso = new Date(t).toISOString();
        if (f._siteDay(t) !== brisbaneToday(new Date(t), tz) || f._siteHHMM(t) !== brisbaneHHMM(iso, tz)) bad++;
      }
      for (let ymd = '2026-01-01'; ymd < '2027-01-01'; ymd = addDays(ymd, 1)) {
        for (const hm of ['00:00', '02:00', '02:30', '03:00', '09:00', '19:30', '23:59']) if (f._siteInstant(ymd, hm) !== instantOf(ymd, hm, tz)) bad++;
      }
      expect(bad).toBe(0);
    }
    const s = spa({ timeZone: SYD });
    expect(new Date(s._siteInstant('2026-10-04', '02:30')).toISOString()).toBe('2026-10-03T16:30:00.000Z'); // the gap -> 03:30 +11:00
    expect(new Date(s._siteInstant('2026-04-05', '02:30')).toISOString()).toBe('2026-04-04T15:30:00.000Z'); // the repeat -> the first
    expect(s._siteInstant('not a day', '09:00')).toBeNaN();
  });

  it('Brisbane (saved or not loaded yet): _lkLastFriday and the consent lines are byte-identical to before', () => {
    expect(lines(spa({ timeZone: BNE, serviceDayOfWeek: 5, consentCutoff: '09:00' }))).toEqual(BEFORE);
    expect(lines(spa())).toEqual(BEFORE);
  });

  it('Brisbane: dates and times equal the old +10 code', () => {
    const f = spa({ timeZone: BNE });
    const old = (t: number) => { const d = new Date(t + 10 * 3600e3); return [d.toISOString().slice(0, 10), d.getUTCHours(), d.getUTCMinutes()] as const; };
    let bad = 0;
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 5 * 3600e3 + 7 * 60e3) {
      const [ymd, h, m] = old(t), iso = new Date(t).toISOString();
      if (f._siteDay(t) !== ymd) bad++;
      if (f._lkTime(iso) !== (h % 12 || 12) + ':' + String(m).padStart(2, '0') + (h < 12 ? ' am' : ' pm')) bad++;
      if (f.fmtDay(iso, true) !== f.fmtDay(ymd) + ', ' + (h % 12 || 12) + (m ? ':' + String(m).padStart(2, '0') : '') + (h < 12 ? 'am' : 'pm')) bad++;
    }
    expect(bad).toBe(0);
    expect(f.fmtDay('2026-09-18T09:00:00+10:00', true)).toBe('Fri 18 Sep, 9am');
  });

  it('Saturday 7:30 pm in Sydney: the night, the cut-off and the instant follow the settings', () => {
    const f = spa({ timeZone: SYD, serviceDayOfWeek: 6, consentCutoff: '19:30' });
    expect(f._lkLastFriday('2026-10-20')).toBe('2026-10-17'); // a Saturday
    expect(f._lkLastFriday('2026-10-17')).toBe('2026-10-17');
    expect(f._lkStepBlock({ consentStep: true, consent: null, consentFriday: '2099-01-03' }))
      .toBe('Waiting for the consent reply. Complete opens after Sat 3 Jan 2099 7:30pm.');
    expect(f._ikHoldText({ text: 'Late consent form' }, {})).toBe('The consent form came in after Saturday 7:30 pm, so it counts for next week.');
    expect(f._ikRowsHtml({ rows: [] }, {}, false)).toContain('Everyone else is added at 7:30pm Saturday.');
    expect(f._ikNrRowHtml({ rowId: 'r', consentFriday: '2020-01-04', notReceivedOk: true, flowId: 'f', stepId: 's' }, 0, false))
      .toContain('No reply by Sat 4 Jan 2020, 7:30pm');
    expect(f._siteInstant('2026-10-17', '19:30')).toBe(Date.parse('2026-10-17T19:30:00+11:00'));
  });

  it('the console\'s "Waiting for replies until" hint is matched by its prefix', () => {
    const f = spa({ timeZone: SYD, serviceDayOfWeek: 6, consentCutoff: '19:30' });
    const hint = "Parents can still reply until Saturday 7:30 pm, so consent isn't assumed yet. Check again after 7:30 pm.";
    expect(f._ikHoldText({ text: 'Waiting for replies until Saturday 7:30 pm' }, {})).toBe(hint);
    expect(f._ikHoldText({ text: WAIT }, {})).toBe(hint);
    expect(spa()._ikHoldText({ text: 'Waiting for replies until Saturday 7:30 pm' }, {})).toBe(BEFORE.wait);
  });

  it('rule: no fixed +10 offset left in public/index.html code', () => {
    const code = HTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/36e6/);
    expect(code).not.toContain('+10:00');
  });

  it('Youth Setup has "Time zone" (with the Australian zones) and "Consent closes at"', () => {
    const body = extractFn(HTML, '_youthSetupBody');
    expect(body).toContain('Time zone');
    expect(body).toContain("_setupSet('structure.timeZone', this.value.trim())");
    expect(body).toContain('<datalist id="setup-tz">');
    for (const z of ['Australia/Brisbane', 'Australia/Sydney', 'Australia/Melbourne', 'Australia/Adelaide', 'Australia/Darwin', 'Australia/Perth', 'Australia/Hobart']) {
      expect(body).toContain(z);
    }
    expect(body).toContain('Consent closes at');
    expect(body).toContain("_setupSet('structure.consentCutoff', this.value)");
  });
});
