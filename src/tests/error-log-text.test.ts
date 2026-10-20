// Error-log rework Part 1 (2026-10-17): the fixed two-line texts. Rules, not lists: every refusal reason and every
// action type is covered, nothing tells "the developer", no placeholder survives.
import { describe, it, expect } from 'vitest';
import { TEXT, CLIENT, textFor, ERROR_TIERS } from '../services/error-log-text';
import { ACTION_TYPES, REASONS } from '../core/link-contract';
import { loadIndexHtml, extractFn } from './helpers/extract-fn';

const NON_REFUSALS = new Set(['already', 'console-busy', 'awaiting-approval']);

describe('error-log-text', () => {
  it('every entry has a valid tier and two short non-empty lines; no "developer"', () => {
    for (const [code, [tier, l1, l2]] of Object.entries(TEXT)) {
      expect(ERROR_TIERS, code).toContain(tier);
      for (const s of typeof l1 === 'string' ? [l1, l2] : [...l1, l2]) {
        expect(s.length, code).toBeGreaterThan(0);
        expect(s.length, code).toBeLessThanOrEqual(140);
        expect(s, code).not.toMatch(/developer|owner/i);
      }
    }
  });

  it('every console refusal reason has its own text (no fallback for a known reason)', () => {
    for (const r of REASONS) if (!NON_REFUSALS.has(r)) expect(TEXT[r], r).toBeDefined();
  });

  it('labels: every action type has a label; unknown types and batch kinds read "Elvanto link action"', () => {
    for (const t of ACTION_TYPES) expect(textFor('link', 'unclear', t, null).line1).not.toMatch(/Elvanto link action|\{|undefined/);
    expect(textFor('link', 'unclear', 'unknown', null).line1).toBe('Elvanto link action sent but Elvanto never confirmed it');
    expect(textFor('server', 'INTERNAL', 'POST /link/batch cancel', 500).line1)
      .toBe('An Elvanto link action from a phone crashed on the server and was not queued');
    expect(textFor('server', 'INTERNAL', 'POST /link/batch intakeAnswer', 500).line1)
      .toBe('An intake answer from a phone crashed on the server and was not queued');
    expect(textFor('server', 'INTERNAL', 'POST /link/batch checkIn', 500).line1)
      .toBe('A check-in from a phone crashed on the server and was not queued');
  });

  it('{type} is capitalised at the start of line 1 and lower-case inside it', () => {
    expect(textFor('link', 'unclear', 'consentSave', null).line1).toBe('Consent save sent but Elvanto never confirmed it');
    expect(textFor('link', 'unknown', 'checkIn', null).line1).toBe('The console refused check-in for an unknown reason');
  });

  it('incident 18 Oct: no-room reads as a human, counted line (41 refusals fold into one entry)', () => {
    expect(textFor('link', 'no-room', 'checkIn', null, 1)).toMatchObject({ line1: '1 check-in refused: no room found', counted: true });
    expect(textFor('link', 'no-room', 'checkIn', null, 41).line1).toBe('41 check-ins refused: no room found');
    expect(textFor('link', 'no-room', 'checkIn', null, 41).line2).toMatch(/not read/);
  });
  it('counted entries pick singular / plural and set counted; others do not', () => {
    expect(textFor('link', 'pending-24h', 'checkIn', null, 1)).toMatchObject({ line1: '1 check-in action has waited over 24 hours', counted: true });
    expect(textFor('link', 'pending-24h', 'checkIn', null, 3).line1).toBe('3 check-in actions have waited over 24 hours');
    expect(textFor('reconcile', 'recon-unmatched', '', null, 96).line1).toBe('96 roster students have no student record in YS');
    expect(textFor('reconcile', 'recon-unmatched', '', null, 1).line1).toBe('1 roster student has no student record in YS');
    expect(textFor('server', 'SERVICE_UNAVAILABLE', 'GET /x', 503, 40).counted).toBe(false);
  });

  it('tiers: consent raise, too-old on consentLookup is FYI, recon tiers', () => {
    expect(textFor('link', 'locked', 'checkIn', null).tier).toBe('later');
    expect(textFor('link', 'locked', 'consentSave', null).tier).toBe('now');
    expect(textFor('link', 'too-old', 'consentFix', null).tier).toBe('now');
    expect(textFor('link', 'too-old', 'consentLookup', null).tier).toBe('fyi');
    expect(textFor('link', 'report-exists', 'consentLink', null).tier).toBe('fyi'); // raise only lifts "later"
    expect(textFor('reconcile', 'recon-checkins', '', null, 2).tier).toBe('now');
    expect(textFor('reconcile', 'recon-lifegroup-noid', '', null, 2).tier).toBe('later');
    expect(textFor('server', 'SETUP_INCOMPLETE', 'POST /auth/login', 503).tier).toBe('now');
  });

  it('client rows: JS crash, network, 401/403, other 4xx, client copy of a server code', () => {
    expect(textFor('client', 'JS_TypeError', 'line 12:3', null)).toMatchObject({ tier: 'later', line1: 'A screen crashed in a browser (line 12:3)' });
    expect(textFor('client', 'NETWORK', 'page', null).tier).toBe('fyi');
    expect(textFor('client', 'HTTP_401', 'page', 401).line1).toBe('A login had expired');
    expect(textFor('client', 'VALIDATION_ERROR', 'POST /students', 400)).toMatchObject({ tier: 'fyi', line1: 'A phone request was refused (POST /students)' });
    expect(textFor('client', 'INTERNAL_ERROR', 'GET /students', 500)).toMatchObject({ tier: 'fyi', line1: 'A screen failed with a server error (GET /students)' });
  });

  it('fallbacks name the code and say where to add it', () => {
    expect(textFor('server', 'WEIRD', 'GET /x', 502)).toMatchObject({ tier: 'later', line1: 'An error with no description yet (WEIRD)',
      line2: 'The app has no words for this error yet. Tell the person who set up the console.' });
    expect(textFor('link', 'brand-new', 'checkIn', null)).toMatchObject({ tier: 'later', line1: 'The console refused check-in (brand-new)' });
  });

  it('inherited property names are not codes; unknown route reads "an Elvanto link action"', () => {
    for (const c of ['constructor', 'toString', '__proto__']) for (const cat of ['server', 'link', 'client'])
      expect(textFor(cat, c, 'x', null).line1, c).toMatch(/\(.*\)|^A /);
    for (const r of ['constructor', 'toString', 'POST /link/batch constructor']) expect(textFor('link', 'unclear', r, null).line1, r).toBe('Elvanto link action sent but Elvanto never confirmed it');
    expect(textFor('link', 'brand-new', 'unknown', null).line1).toBe('The console refused an Elvanto link action (brand-new)');
    expect(textFor('link', 'unknown', 'unknown', null).line1).toBe('The console refused an Elvanto link action for an unknown reason');
  });

  it('no placeholder survives in any rendered text', () => {
    for (const code of Object.keys(TEXT)) for (const cat of ['server', 'link', 'reconcile']) {
      const t = textFor(cat, code, 'checkIn', 500, 2);
      expect(t.line1 + t.line2, code).not.toMatch(/\{\w+\}/);
    }
  });

  // Y6a (SPEC Y6, preflight P9): the error log says what to do in real menu paths; no file names; engineer steps say who.
  describe('Y6a: real menu paths, no file names', () => {
    const all = { ...TEXT, ...CLIENT };
    const strs = (e: (typeof TEXT)[string]) => [...(typeof e[1] === 'string' ? [e[1]] : e[1]), e[2]];
    const lines = [...Object.values(all).flatMap(strs),
      textFor('server', 'WEIRD', 'GET /x', 502).line2, textFor('link', 'brand-new', 'checkIn', null).line2];
    const html = loadIndexHtml();
    const grab = (src: string, re: RegExp) => [...src.matchAll(re)].map((m) => m[1]!.trim());
    const nav = grab(extractFn(html, '_navItemsBase') + extractFn(html, '_navSlots'), /label:'([^']+)'/g);
    const adminTabs = grab(/const ADMIN_TABS = (.*);/.exec(html)![1]!, /\['\w+','([^']+)'\]/g);
    const more = grab(extractFn(html, 'moreItems'), /label:'([^']+)'/g);
    const cards = grab(html, /_setupCard\('\w+', '([^']+)'/g);
    const linkStatus = extractFn(html, '_lkAdmStatusHtml');
    const linkSecs = grab(linkStatus + extractFn(html, '_lkAdmMatchHtml'), /lk-sec">([^<$]+)/g);
    const PATHS = [...adminTabs.map((t) => `Admin > ${t}`), ...linkSecs.map((t) => `Admin > Elvanto link > ${t}`),
      ...cards.map((t) => `Admin > Youth Setup > ${t}`), ...more.map((t) => `More > ${t}`)].sort((a, b) => b.length - a.length);

    it('the label arrays are the SPA nav: Admin and More are nav slots; Youth Setup and Elvanto link are Admin tabs', () => {
      expect(nav).toEqual(expect.arrayContaining(['Admin', 'More']));
      expect(adminTabs).toEqual(expect.arrayContaining(['Youth Setup', 'Elvanto link', 'Unsent new people']));
      for (const p of ['More > New youth & consent', 'Admin > Elvanto link > Matching', 'Admin > Unsent new people',
        'Admin > Youth Setup > Elvanto for this location']) {
        expect(PATHS, p).toContain(p);
        expect(lines.some((l) => l.includes(p)), p).toBe(true);
      }
    });

    it('every menu path named is a real one (each segment is a label of the menu before it)', () => {
      for (const l of lines) {
        let rest = l;
        for (const p of PATHS) rest = rest.split(p).join('#');
        expect(rest, l).not.toContain('>');
      }
    });

    // Places named without ">": the console is named only by SPEC C5's own words; no retired place names survive.
    it('console places use SPEC C5 names; no retired place names', () => {
      for (const l of lines) {
        expect(l).not.toMatch(/Interact|YS link card|Intakes|Roster/);
        expect(l.split('Advanced › Setup › YS link').join('#'), l).not.toContain('›');
      }
      expect(extractFn(html, '_ikListPage')).toContain('>Refresh</button>');
    });

    it('no entry names a file', () => {
      for (const l of lines) expect(l).not.toMatch(/\.(ts|js|log|html)\b/);
    });

    it('ELVANTO_FORM_CHANGED and UNCLEAR_FIX read as in SPEC Y6', () => {
      expect(TEXT.ELVANTO_FORM_CHANGED![2]).toBe('Run Check forms in Admin > Youth Setup > Elvanto for this location, then resend from Admin > Unsent new people.');
      expect(extractFn(html, '_setupElvCardHtml')).toContain("s.busy ? 'Checking…' : 'Check forms'");
      const fix = textFor('link', 'unclear', 'checkIn', null).line2;
      expect(fix).toBe('Check it in Elvanto, then tap Landed or Not landed in Admin > Elvanto link, or use Unclear saves on the Services, Lifegroups or Flows page.');
      expect(textFor('link', 'lease-lost', 'checkIn', null).line2).toBe(fix);
      expect(linkStatus).toContain(',true)">Landed</button>');
      expect(linkStatus).toContain(',false)">Not landed</button>');
    });

    it('engineer-only steps end "Tell the person who set up the console."', () => {
      const ENGINEER = /Vercel|Supabase|Google Cloud|console's log|mapping|bug/;
      const l2 = [...Object.values(all).map((e) => e[2]), lines[lines.length - 2]!, lines[lines.length - 1]!];
      for (const l of l2) if (ENGINEER.test(l)) expect(l, l).toMatch(/ Tell the person who set up the console\.$/);
      for (const c of ['INTERNAL_ERROR', 'INTERNAL', 'LINK_OFF', 'PUSH_OFF', 'SETUP_INCOMPLETE', 'note-unreadable', 'recon-failed',
        'console-cannot-read', 'unknown', 'bad-answer', 'JS', 'HTTP_403', 'NETWORK']) expect(all[c]![2], c).toMatch(/ Tell the person who set up the console\.$/);
    });
  });
});
