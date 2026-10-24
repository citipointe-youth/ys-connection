// Error-log rework Part 1 (2026-10-17). The fixed two-line text for every Error log code, computed at READ time from the
// stored code (so a wording change applies to old rows). Line 1 = what happened; line 2 = what to fix and where.
// Never a name or value: placeholders are only {type} (action label), {a_type} (label with a/an), {route}, {n}, {code}.
import { ACTION_TYPES, RECHECK_TYPES } from '../core/link-contract';

export const ERROR_TIERS = ['now', 'later', 'fyi'] as const;
export type ErrorTier = (typeof ERROR_TIERS)[number];
export const TIER_RANK: Record<ErrorTier, number> = { now: 0, later: 1, fyi: 2 };
/** A line 1 that carries the count is [singular, plural]. */
type Line1 = string | readonly [string, string];
type Entry = readonly [ErrorTier, Line1, string];
export interface ErrorText { tier: ErrorTier; line1: string; line2: string; counted: boolean }

const LABELS: Record<(typeof ACTION_TYPES)[number], string> = {
  checkIn: 'Check-in', checkOut: 'Check-out', firstTimerCheckIn: 'First-timer check-in', submitReport: 'Lifegroup report',
  editReport: 'Report edit', addGroupMember: 'Add to group', removeGroupMember: 'Remove from group', completeStep: 'Flow step',
  removeFromFlowStep: 'Flow step removal', intakeAnswer: 'Intake answer', intakeSave: 'Intake save', intakeText: 'Intake text',
  consentSave: 'Consent save', consentLookup: 'Consent lookup', consentFix: 'Consent fix', consentLink: 'Consent link', recheck: 'Re-check', busConsentCheck: 'Bus consent check',
  doorSearch: 'Door Elvanto search',
};
// Spec 2026-10-22 §6.1: the audit source codes as the screens name them (a stored row never carries display text).
const AUDIT_ROUTE_NAMES: Record<string, string> = { service: 'Youth service', group: 'Lifegroups', team: 'Student team',
  connect: 'Connect forms', decision: 'Decision forms' };
const CONSENT_RAISE = new Set(['consentSave', 'consentFix', 'consentLink']);
const LEADER_TOLD = 'Nothing to do; the leader was told to';
const UNCLEAR_FIX = "Check it in Elvanto, then tap Landed or Not landed in Admin > Elvanto link, or on the console's Services, Lifegroups or Flows page.";
// L7 (2026-10-21): only where Check again is there: a RECHECK_TYPES row while the newest console lists recheck live.
const RECHECK_FIX = 'Tap Check again in Admin > Elvanto link. Or check it in Elvanto, then tap Landed or Not landed there.';
// Y6a: steps only the person who built the setup can do end with this.
const TELL = ' Tell the person who set up the console.';

export const TEXT: Record<string, Entry> = {
  // 6.1 Server and New person forms
  INTERNAL_ERROR: ['later', 'A screen failed with a server error ({route})', `The stack is in Vercel runtime logs at that time.${TELL}`],
  INTERNAL: ['later', '{a_type} from a phone crashed on the server and was not queued', `The leader was told to do it in Elvanto. The bug is under "batch item failed" in Vercel logs.${TELL}`],
  SERVICE_UNAVAILABLE: ['fyi', 'The database was busy for a moment', `Nothing to do; phones retry. If it happens most days, the Supabase pooler needs a look.${TELL}`],
  REQUEST_TIMEOUT: ['fyi', 'A screen took over 20 seconds to load ({route})', `Nothing to do if rare. If it repeats, that route's queries need speeding up.${TELL}`],
  LINK_OFF: ['now', 'The Elvanto link is off: no sync token in Vercel', `Set LINK_SYNC_TOKEN (32+ characters) in Vercel, redeploy, and save it in the console.${TELL}`],
  ROUTING_FAILED: ['later', 'Bus route planning failed at Google', `Replan the run later. GOOGLE_MAPS_API_KEY or its quota in Google Cloud needs a look.${TELL}`],
  PUSH_FAILED: ['fyi', 'Some phone alerts for a notice failed', 'Nothing to do; the notice is in the app.'],
  PUSH_OFF: ['later', 'Notice alerts are not set up', `Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Vercel and redeploy.${TELL}`],
  SETUP_INCOMPLETE: ['now', 'Logins are failing: SESSION_SECRET is not set', `Set SESSION_SECRET in Vercel and redeploy.${TELL}`],
  ELVANTO_UNREACHABLE: ['now', 'Elvanto was unreachable, so a new person was not sent', 'Resend from Admin > Unsent new people.'],
  ELVANTO_FORM_CHANGED: ['now', 'An Elvanto form changed, so a new person was not sent', 'Run Check forms in Admin > Youth Setup > Elvanto for this location, then resend from Admin > Unsent new people.'],
  STUDENT_FORM_UNCONFIRMED: ['now', "A student form was sent but Elvanto didn't confirm it", "Search Elvanto for the person. Resend from Admin > Unsent new people only if they're missing."],
  PARENT_FORM_UNCONFIRMED: ['now', "A parent form was sent but Elvanto didn't confirm it", "Search Elvanto for the parent. Resend from Admin > Unsent new people only if they're missing."],
  STUDENT_FORM_FAILED: ['now', 'Elvanto rejected a student form', 'Open Admin > Unsent new people, fix the details and resend.'],
  PARENT_FORM_FAILED: ['now', 'Elvanto rejected a parent form', 'Open Admin > Unsent new people, fix the details and resend.'],
  BUS_CONSENT_FORM_UNCONFIRMED: ['now', 'A bus consent form may not have reached Elvanto', 'Check the bus consent form submissions in Elvanto, then resend or delete it in Admin > Unsent new people.'],
  BUS_CONSENT_FORM_FAILED: ['now', 'Elvanto refused a bus consent form', 'Run Check forms in Admin > Youth Setup > Elvanto for this location, then resend from Admin > Unsent new people.'],
  CONSENT_ADDRESS_UNMATCHED: ['fyi', 'A consent form address was not found on Google', 'Nothing to do; the leader picked the address by hand.'],
  UNSENT_SAVE_FAILED: ['now', 'A failed new-person send could not be saved, so they may be lost', `Re-enter them from the welcome-desk form. FIELD_ENCRYPTION_KEY in Vercel needs checking.${TELL}`],
  NY_REQ_FAILED: ['fyi', 'The new-person double-tap guard was skipped (database blip)', 'Nothing to do; the send went ahead. If it repeats, check Admin > Unsent new people for a duplicate.'],
  // 6.2 Elvanto link sweeps/results and reconcile
  // D1 (2026-10-24): unclear and lease-lost are live counts per type (setCount), so they carry {n}.
  unclear: ['now', ['{type} sent but Elvanto never confirmed it', '{n} {type} actions sent but Elvanto never confirmed them'], UNCLEAR_FIX],
  'lease-lost': ['now', ['{type}: the console stopped mid-send, result unknown', '{n} {type} actions: the console stopped mid-send, results unknown'], UNCLEAR_FIX],
  'too-old': ['later', '{type} expired before the console sent it', 'The leader was told to do it in Elvanto. Check the console was running then (Advanced › Setup › YS link in the console).'],
  'note-unreadable': ['later', 'A queued note could not be decrypted', `FIELD_ENCRYPTION_KEY and FIELD_ENCRYPTION_KEY_PREV in Vercel must match the key it was saved with.${TELL}`],
  'intake-unreadable': ['later', 'A saved intake plan could not be decrypted', `Press Refresh in More > New youth & consent. If it stays, the Vercel encryption keys need checking.${TELL}`],
  'pending-24h': ['now', ['1 {type} action has waited over 24 hours', '{n} {type} actions have waited over 24 hours'], 'Start the console on the PC and check Advanced › Setup › YS link in the console shows a recent "Checked YS Connection" time.'],
  'recon-checkins': ['now', ['1 app check-in is missing from Elvanto attendance', '{n} app check-ins are missing from Elvanto attendance'], 'Tap Who?, then Send again on each row. If it still shows after the next import, tick them in Elvanto.'],
  'recon-unmatched': ['later', ['1 roster student has no student record in YS', '{n} roster students have no student record in YS'], 'Tap Who?; fix the name in Elvanto or match them in Admin > Elvanto link > Matching. New youth clear after the next import.'],
  'recon-lifegroups': ['now', ["1 lifegroup report from the app doesn't match Elvanto", "{n} lifegroup reports from the app don't match Elvanto"], "Tap Who?, then Send again on each row. If it still shows after the next import, fix that report in Elvanto."],
  'recon-lifegroup-noid': ['later', ['1 lifegroup has no Elvanto group id', '{n} lifegroups have no Elvanto group id'], 'Tap Who?; make the console push that group (YS link groups) so its name matches, then re-import groups.'],
  'recon-members': ['now', ["1 group member change from the app isn't in Elvanto", "{n} group member changes from the app aren't in Elvanto"], 'Tap Who?, then Send again on each row. If it still shows after the next import, change the group in Elvanto.'],
  'recon-failed': ['later', 'The {route} check failed to run', `The error is under "reconcile" in Vercel logs at that time.${TELL}`],
  // 6.3 Link refusal reasons (code = reason, route = action type)
  locked: ['later', "{type} isn't switched on in the console", "Turn that type on in the console's Advanced › Setup › YS link, or in Admin > Youth Setup > Modules & Import."],
  // Incident 18 Oct: 41 refusals were one cause (rooms not read yet, normal before a service's first check-in); counted, so they fold into one line.
  'no-room': ['later', ['1 {type} refused: no room found', '{n} {type}s refused: no room found'],
    "Many at once: rooms not read yet; re-tap later. One: their Demographics match no room."],
  'person-unknown': ['later', '{type} was for someone no longer in Elvanto', 'Nothing to fix if they were archived; the next roster push drops them.'],
  'group-unknown': ['later', '{type} was for a group no longer in Elvanto', 'Nothing to fix if the group was closed; the next groups push drops it.'],
  'form-unknown': ['later', 'A consent fix pointed at the wrong form', "Check that person's newest approved consent form in Elvanto."],
  'console-cannot-read': ['later', "The console couldn't read the Elvanto page for {type}", `Run that action again in the console to see which Elvanto page it could not read.${TELL}`],
  unknown: ['later', 'The console refused {type} for an unknown reason', `The console's log on the PC at that time has the reason.${TELL}`],
  // 2026-10-24: a consentFix refused `unknown` whose detail names a missing profile field (sync.service result(), derived; not a REASON).
  'fix-no-date': ['fyi', ["A consent fix needs a consent date field this Elvanto profile doesn't have", "{n} consent fixes need a consent date field their Elvanto profiles don't have"],
    'Move them to New People in Elvanto (the console does this itself when the consent date field is missing), or add the field.'],
  'fix-no-total': ['fyi', ["A consent fix needs a TOTAL non-consent date field this Elvanto profile doesn't have", "{n} consent fixes need a TOTAL non-consent date field their Elvanto profiles don't have"],
    'Add the TOTAL non-consent date field to the profile in Elvanto; moving them to New People does not help.'],
  'fix-no-field': ['fyi', ["A consent fix needs a field this Elvanto profile doesn't have", "{n} consent fixes need a field their Elvanto profiles don't have"],
    'Move them to New People in Elvanto (the console does this itself when the consent date field is missing), or add the field.'],
  'not-landed': ['now', "{type} didn't save in Elvanto", 'Do it in Elvanto by hand; the leader was told to as well.'],
  'report-exists': ['fyi', 'A report for that date already existed', `${LEADER_TOLD} edit it.`],
  'report-not-found': ['fyi', 'A report edit found the report gone', `${LEADER_TOLD} reload.`],
  'report-changed': ['fyi', 'A report changed in Elvanto before the edit', `${LEADER_TOLD} reload.`],
  'member-left': ['fyi', 'A report ticked someone no longer in the group', `${LEADER_TOLD} reload.`],
  'not-in-group': ['fyi', 'A report ticked someone not in the group', `${LEADER_TOLD} reload.`],
  'multi-service': ['fyi', 'A report edit needed Elvanto (several services)', `${LEADER_TOLD} edit it in Elvanto.`],
  'unkept-notes': ['fyi', 'A report edit would have lost notes', `${LEADER_TOLD} edit it in Elvanto.`],
  'note-too-long': ['fyi', 'A report note was too long for Elvanto', `${LEADER_TOLD} edit it in Elvanto.`],
  'service-not-offered': ['fyi', 'Elvanto had no service for that report date', `${LEADER_TOLD} pick another.`],
  'did-not-meet-conflict': ['fyi', 'A report was ticked and marked "did not meet"', `${LEADER_TOLD} fix it.`],
  'step-moved': ['fyi', 'A flow step changed in Elvanto first', `${LEADER_TOLD} reload and try again.`],
  'assignee-needed': ['fyi', 'A flow step needed someone for the next step', `${LEADER_TOLD} pick who gets it and Complete again.`],
  'ambiguous-first-timer': ['fyi', 'Two new people had the same name', `${LEADER_TOLD} use the kiosk.`],
  'leader-member': ['fyi', 'The app tried to remove a leader from a group', 'Nothing to do; leaders are removed in Elvanto.'],
  'needs-you': ['later', 'An intake step is waiting for you', 'Open More > New youth & consent for that date and finish it.'],
  'plan-changed': ['fyi', 'An intake plan changed before it was saved', 'Nothing to do; the next refresh redoes it.'],
  'saved-before': ['fyi', 'An intake answer was already saved', 'Nothing to do.'],
  'chain-not-done': ['fyi', 'An intake step ran before the one before it finished', 'Nothing to do; the chain retries.'],
  'bad-answer': ['fyi', "An intake answer didn't fit the Elvanto field", `Nothing to do if rare. If it repeats, the console's answer mapping needs fixing.${TELL}`],
  // 6.4 Connection Audit (spec 2026-10-22 §7; category audit, setCount). Route = the source code, shown by its screen name.
  'audit-source-failed': ['now', "Connection Audit: {route} didn't update",
    "The audit is using the last copy that worked. Tap Who? for details. If it happens again next Friday, check the console's Friday log."],
  'audit-feed-stale': ['now', "Connection Audit hasn't updated for over a week",
    "On the console PC, check Friday's run finished and the console is up to date (link rev 16 or later)."],
  'audit-rows-skipped': ['later', ['Connection Audit: 1 entry from {route} was left out', 'Connection Audit: {n} entries from {route} were left out'],
    'Tap Who? to see which and why. Fix them in Elvanto; this clears after the next Friday update.'],
};

// 6.5 App (client) rows and the two fallbacks.
export const CLIENT: Record<string, Entry> = {
  NETWORK: ['fyi', 'Phones lost signal while loading', `Nothing to do unless everyone hits it at once; then Vercel may be down.${TELL}`],
  JS: ['later', 'A screen crashed in a browser ({route})', `The app has a bug at that line.${TELL}`],
  HTTP_401: ['fyi', 'A login had expired', 'Nothing to do.'],
  HTTP_403: ['fyi', "Someone tried something their role can't do", `Nothing to do, unless a role should have access.${TELL}`],
  OTHER: ['fyi', 'A phone request was refused ({route})', 'Nothing to do if rare.'],
};
const FALLBACK_SERVER: Entry = ['later', 'An error with no description yet ({code})', `The app has no words for this error yet.${TELL}`];
const FALLBACK_LINK: Entry = ['later', 'The console refused {type} ({code})', `Admin > Elvanto link shows the console's own words.${TELL}`];

const lc = (s: string) => s.toLowerCase().replace('elvanto link action', 'Elvanto link action'); // proper noun mid-sentence
const own = <T>(o: Record<string, T>, k: string): T | undefined => (Object.hasOwn(o, k) ? o[k] : undefined); // codes can be untrusted
function label(route: string): string {
  const t = route.startsWith('POST /link/batch ') ? route.slice('POST /link/batch '.length) : route;
  return own(LABELS as Record<string, string>, t) ?? 'Elvanto link action';
}

/** The tier and two lines for one stored row. Pure; never throws. `recheckLive` = the newest console lists recheck live. */
export function textFor(category: string, code: string, route: string, status: number | null, count = 1, recheckLive = false): ErrorText {
  let e: Entry;
  if (category === 'client') {
    if (code.startsWith('JS_')) e = CLIENT.JS!;
    else if (own(CLIENT, code)) e = CLIENT[code]!;
    else if (own(TEXT, code)) e = ['fyi', TEXT[code]![1], TEXT[code]![2]]; // a client copy of a server code: the server row acts
    else e = CLIENT.OTHER!;
  } else e = own(TEXT, code) ?? (category === 'link' ? FALLBACK_LINK : FALLBACK_SERVER);
  let tier = e[0];
  if (category === 'link' && code === 'too-old' && route === 'consentLookup') tier = 'fyi';
  if (category === 'link' && tier === 'later' && CONSENT_RAISE.has(route)) tier = 'now';
  const raw = e[1];
  const counted = typeof raw !== 'string';
  const l1 = typeof raw === 'string' ? raw : count === 1 ? raw[0] : raw[1];
  const type = label(route);
  const aType = (/^[AEIOU]/.test(type) ? 'An ' : 'A ') + type;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string, off: number) =>
    k === 'type' ? (off ? (type === 'Elvanto link action' && s.slice(0, off).endsWith('refused ') ? 'an ' : '') + lc(type) : type)
      : k === 'a_type' ? (off ? lc(aType) : aType.replace(/ (\S)/, (_x, c: string) => ' ' + (type === 'Elvanto link action' ? c : c.toLowerCase())))
        : k === 'route' ? (category === 'audit' ? own(AUDIT_ROUTE_NAMES, route) ?? route : route) : k === 'n' ? String(count) : k === 'code' ? code : m);
  const fix = e[2] === UNCLEAR_FIX && recheckLive && (RECHECK_TYPES as readonly string[]).includes(route) ? RECHECK_FIX : e[2];
  return { tier, line1: fill(l1), line2: fill(fix), counted };
}
