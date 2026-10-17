// Error-log rework Part 1 (2026-10-17). The fixed two-line text for every Error log code, computed at READ time from the
// stored code (so a wording change applies to old rows). Line 1 = what happened; line 2 = what to fix and where.
// Never a name or value: placeholders are only {type} (action label), {a_type} (label with a/an), {route}, {n}, {code}.
import { ACTION_TYPES } from '../core/link-contract';

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
  consentSave: 'Consent save', consentLookup: 'Consent lookup', consentFix: 'Consent fix', consentLink: 'Consent link',
};
const CONSENT_RAISE = new Set(['consentSave', 'consentFix', 'consentLink']);
const LEADER_TOLD = 'Nothing to do; the leader was told to';
const UNCLEAR_FIX = "Check it in Elvanto, then mark it in the console's Interact > Unclear saves.";

export const TEXT: Record<string, Entry> = {
  // 6.1 Server and New person forms
  INTERNAL_ERROR: ['later', 'A screen failed with a server error ({route})', "Find the stack in Vercel runtime logs at that time and fix that route's service."],
  INTERNAL: ['later', '{a_type} from a phone crashed on the server and was not queued', 'The leader was told to do it in Elvanto. Find "batch item failed" in Vercel logs and fix the bug.'],
  SERVICE_UNAVAILABLE: ['fyi', 'The database was busy for a moment', 'Nothing to do; phones retry. If it happens most days, check the Supabase pooler in the Supabase dashboard.'],
  REQUEST_TIMEOUT: ['fyi', 'A screen took over 20 seconds to load ({route})', "Nothing to do if rare. If it repeats, speed up that route's queries."],
  LINK_OFF: ['now', 'The Elvanto link is off: no sync token in Vercel', 'Set LINK_SYNC_TOKEN (32+ characters) in Vercel, redeploy, and save the same token in the console.'],
  ROUTING_FAILED: ['later', 'Bus route planning failed at Google', 'Check GOOGLE_MAPS_API_KEY and its quota in Google Cloud, then replan the run.'],
  PUSH_FAILED: ['fyi', 'Some phone alerts for a notice failed', 'Nothing to do; the notice is in the app.'],
  PUSH_OFF: ['later', 'Notice alerts are not set up', 'Add VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT in Vercel and redeploy.'],
  SETUP_INCOMPLETE: ['now', 'Logins are failing: SESSION_SECRET is not set', 'Set SESSION_SECRET in Vercel and redeploy.'],
  ELVANTO_UNREACHABLE: ['now', 'Elvanto was unreachable, so a new person was not sent', 'Resend from Admin > Unsent new people.'],
  ELVANTO_FORM_CHANGED: ['now', 'An Elvanto form changed, so a new person was not sent', 'Compare the form in Elvanto with the field map in new-youth.service.ts, fix it, then resend from Admin > Unsent new people.'],
  STUDENT_FORM_UNCONFIRMED: ['now', "A student form was sent but Elvanto didn't confirm it", "Search Elvanto for the person. Resend from Admin > Unsent new people only if they're missing."],
  PARENT_FORM_UNCONFIRMED: ['now', "A parent form was sent but Elvanto didn't confirm it", "Search Elvanto for the parent. Resend from Admin > Unsent new people only if they're missing."],
  STUDENT_FORM_FAILED: ['now', 'Elvanto rejected a student form', 'Open Admin > Unsent new people, fix the details and resend.'],
  PARENT_FORM_FAILED: ['now', 'Elvanto rejected a parent form', 'Open Admin > Unsent new people, fix the details and resend.'],
  UNSENT_SAVE_FAILED: ['now', 'A failed new-person send could not be saved, so they may be lost', 'Re-enter them from the welcome-desk form, and check FIELD_ENCRYPTION_KEY is set in Vercel.'],
  NY_REQ_FAILED: ['fyi', 'The new-person double-tap guard was skipped (database blip)', 'Nothing to do; the send went ahead. If it repeats, check Unsent new people for a duplicate.'],
  // 6.2 Elvanto link sweeps/results and reconcile
  unclear: ['now', '{type} sent but Elvanto never confirmed it', UNCLEAR_FIX],
  'lease-lost': ['now', '{type}: the console stopped mid-send, result unknown', UNCLEAR_FIX],
  'too-old': ['later', '{type} expired before the console sent it', 'The leader was told to do it in Elvanto. Check the console was running then (its YS link card).'],
  'note-unreadable': ['later', 'A queued note could not be decrypted', 'Check FIELD_ENCRYPTION_KEY and FIELD_ENCRYPTION_KEY_PREV in Vercel match the key it was saved with.'],
  'intake-unreadable': ['later', 'A saved intake plan could not be decrypted', 'Check FIELD_ENCRYPTION_KEY(_PREV) in Vercel, then press Refresh in Admin > Intakes.'],
  'pending-24h': ['now', ['1 {type} action has waited over 24 hours', '{n} {type} actions have waited over 24 hours'], 'Start the console on the PC and check its YS link card says Running.'],
  'recon-checkins': ['now', ['1 app check-in is missing from Elvanto attendance', '{n} app check-ins are missing from Elvanto attendance'], 'Tap Who?, then tick each person in Elvanto for that Friday.'],
  'recon-unmatched': ['later', ['1 roster student has no student record in YS', '{n} roster students have no student record in YS'], 'Tap Who?; fix the name in Elvanto or match them in Admin > Elvanto link > Roster. New youth clear after the next import.'],
  'recon-lifegroups': ['now', ["1 lifegroup report from the app doesn't match Elvanto", "{n} lifegroup reports from the app don't match Elvanto"], "Tap Who?, open that group's report in Elvanto and fix the attendance."],
  'recon-lifegroup-noid': ['later', ['1 lifegroup has no Elvanto group id', '{n} lifegroups have no Elvanto group id'], 'Tap Who?; make the console push that group (YS link groups) so its name matches, then re-import groups.'],
  'recon-members': ['now', ["1 group member change from the app isn't in Elvanto", "{n} group member changes from the app aren't in Elvanto"], 'Tap Who?, then add or remove each person in that Elvanto group.'],
  'recon-failed': ['later', 'The {route} check failed to run', 'Find "reconcile" in Vercel logs at that time and fix the error.'],
  // 6.3 Link refusal reasons (code = reason, route = action type)
  locked: ['later', "{type} isn't switched on in the console", "Turn that type on in the console's YS link card, or in Admin > Youth Setup."],
  'no-room': ['later', 'A check-in had no room in Elvanto', "Check the service's rooms and times in Elvanto check-in settings."],
  'person-unknown': ['later', '{type} was for someone no longer in Elvanto', 'Nothing to fix if they were archived; the next roster push drops them.'],
  'group-unknown': ['later', '{type} was for a group no longer in Elvanto', 'Nothing to fix if the group was closed; the next groups push drops it.'],
  'form-unknown': ['later', 'A consent fix pointed at the wrong form', "Check that person's newest approved consent form in Elvanto."],
  'console-cannot-read': ['later', "The console couldn't read the Elvanto page for {type}", "Run that action in the console's Interact screen and fix the reader it names in ys-link.js."],
  unknown: ['later', 'The console refused {type} for an unknown reason', 'Read ys-link.log on the PC at that time and add a reason for it.'],
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
  'step-moved': ['fyi', 'A flow step changed in Elvanto first', `${LEADER_TOLD} do it in Elvanto.`],
  'assignee-needed': ['fyi', 'A flow step needed an assignee in Elvanto', `${LEADER_TOLD} do it in Elvanto.`],
  'ambiguous-first-timer': ['fyi', 'Two new people had the same name', `${LEADER_TOLD} use the kiosk.`],
  'leader-member': ['fyi', 'The app tried to remove a leader from a group', 'Nothing to do; leaders are removed in Elvanto.'],
  'needs-you': ['later', 'An intake step is waiting for you', 'Open Admin > Intakes for that date and finish it.'],
  'plan-changed': ['fyi', 'An intake plan changed before it was saved', 'Nothing to do; the next refresh redoes it.'],
  'saved-before': ['fyi', 'An intake answer was already saved', 'Nothing to do.'],
  'chain-not-done': ['fyi', 'An intake step ran before the one before it finished', 'Nothing to do; the chain retries.'],
  'bad-answer': ['fyi', "An intake answer didn't fit the Elvanto field", 'Nothing to do if rare; if it repeats, fix the answer mapping in youth-plan.js.'],
};

// 6.5 App (client) rows and the two fallbacks.
const CLIENT: Record<string, Entry> = {
  NETWORK: ['fyi', 'Phones lost signal while loading', 'Nothing to do unless everyone hits it at once; then check Vercel status.'],
  JS: ['later', 'A screen crashed in a browser ({route})', 'Open public/index.html at that line, fix the error, then run check-spa-syntax.'],
  HTTP_401: ['fyi', 'A login had expired', 'Nothing to do.'],
  HTTP_403: ['fyi', "Someone tried something their role can't do", 'Nothing to do unless a role should have access; then fix access-control.ts.'],
  OTHER: ['fyi', 'A phone request was refused ({route})', 'Nothing to do if rare.'],
};
const FALLBACK_SERVER: Entry = ['later', 'An error with no description yet ({code})', 'Add {code} to TEXT in error-log-text.ts and fix its cause.'];
const FALLBACK_LINK: Entry = ['later', 'The console refused {type} ({code})', "Add {code} to TEXT in error-log-text.ts; Admin > Elvanto link shows the console's sentence."];

const lc = (s: string) => s.toLowerCase().replace('elvanto link action', 'Elvanto link action'); // proper noun mid-sentence
function label(route: string): string {
  const t = route.startsWith('POST /link/batch ') ? route.slice('POST /link/batch '.length) : route;
  return (LABELS as Record<string, string>)[t] ?? 'Elvanto link action';
}

/** The tier and two lines for one stored row. Pure; never throws. */
export function textFor(category: string, code: string, route: string, status: number | null, count = 1): ErrorText {
  let e: Entry;
  if (category === 'client') {
    if (code.startsWith('JS_')) e = CLIENT.JS!;
    else if (CLIENT[code]) e = CLIENT[code]!;
    else if (TEXT[code]) e = ['fyi', TEXT[code]![1], TEXT[code]![2]]; // a client copy of a server code: the server row acts
    else e = CLIENT.OTHER!;
  } else e = TEXT[code] ?? (category === 'link' ? FALLBACK_LINK : FALLBACK_SERVER);
  let tier = e[0];
  if (category === 'link' && code === 'too-old' && route === 'consentLookup') tier = 'fyi';
  if (category === 'link' && tier === 'later' && CONSENT_RAISE.has(route)) tier = 'now';
  const raw = e[1];
  const counted = typeof raw !== 'string';
  const l1 = typeof raw === 'string' ? raw : count === 1 ? raw[0] : raw[1];
  const type = label(route);
  const aType = (/^[AEIOU]/.test(type) ? 'An ' : 'A ') + type;
  const fill = (s: string) => s.replace(/\{(\w+)\}/g, (m, k: string, off: number) =>
    k === 'type' ? (off ? lc(type) : type)
      : k === 'a_type' ? (off ? lc(aType) : aType.replace(/ (\S)/, (_x, c: string) => ' ' + (type === 'Elvanto link action' ? c : c.toLowerCase())))
        : k === 'route' ? route : k === 'n' ? String(count) : k === 'code' ? code : m);
  return { tier, line1: fill(l1), line2: fill(e[2]), counted };
}
