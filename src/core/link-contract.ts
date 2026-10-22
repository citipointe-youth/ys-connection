import { z } from 'zod';

// Step 0 of the YS Connection <-> Elvanto Sync Console link (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md).
// Shapes only: no routes, no services. Fixtures: src/tests/fixtures/elvanto-link/ (11.1 keeps a byte copy).
// A shape change bumps LINK_CONTRACT_VERSION, the fixtures and the manifest, and is copied to 11.1 in the same session.
// (v1 was amended in place on 2026-10-12, operator decisions 9-13, before any release: no bump for that.)
export const LINK_CONTRACT_VERSION = 1;
// Each side sends its LINK_REV in the claim. Revs 2-13 (2026-10-12 to 2026-10-20) each added optional fields only; their
// history is in docs/HISTORY.md and the 2026-10-11 contract spec. X-1 (review 2026-10-19): both sides run 12 and the app
// refuses a claim from a console below MIN_CONSOLE_REV with 409 LINK_CONTRACT_MISMATCH, so no field is gated on a rev any
// more. Rev 12 (C01): a claim also re-hands this console's OWN still-leased rows (reclaimed: true), so a claim reply the
// console lost (its 15 s timeout while the app committed the lease) never strands rows for the 600 s lease.
// Rev 13 (Service Visits): a flows row may carry serviceVisits; MIN_CONSOLE_REV stays 12 so a rev-12 console still works.
// Rev 14 (multi-location): claim reply may carry site
// Rev 15 (L7, 2026-10-21): the recheck type: the admin asks the console to re-run an unclear save's own read/confirm check
// (read only, never a write). Optional capability: an older console never lists it, so it is never leased one.
// Rev 15 (round 2026-10-21 L2, multi-name forms): an unlinked consent row may carry formName and linkedIds; a consentLink
// ADDS its person to the form (null unlinks them all). MIN_CONSOLE_REV stays 12.
// A future rev: bump LINK_REV here and in 11.1; raise MIN_CONSOLE_REV only once every console runs it.
// Rev 16 (Connection Audit, 2026-10-22): push kind `audit` (Connection Audit sources). MIN_CONSOLE_REV stays 12: an
// older console simply never pushes it.
// Rev 17 (console module alignment, 2026-10-22): claim reply may carry modules (this app's resolved module switches, values only).
// MIN_CONSOLE_REV stays 12: an older console strips the key; a rev-17 console against a rev-16 app sees no key = modules unknown.
// Rev 18 (bus consent, 2026-10-22): type busConsentCheck (empty payload: "read the bus consent forms now") and push kind
// busConsentForms. MIN_CONSOLE_REV stays 12: an older console never lists the type, so it is never leased one.
export const LINK_REV = 18;
export const MIN_CONSOLE_REV = 12;
/** C-1 (F-37): the `detail` stored on a sent removeFromFlowStep row whose Elvanto note was not saved. */
export const NOTE_FAILED_DETAIL = 'Removed; the note was not saved.';

export const ACTION_TYPES = ['checkIn', 'checkOut', 'submitReport', 'editReport', 'completeStep', 'firstTimerCheckIn',
  'addGroupMember', 'removeGroupMember', 'intakeAnswer', 'intakeSave', 'consentSave', 'intakeText',
  'removeFromFlowStep', 'consentLookup', 'consentFix', 'consentLink', 'recheck', 'busConsentCheck'] as const;
/** Rev 15 (L7): the unclear saves the console can re-check (read only). Not the intake chains, lookups or console-local links. */
export const RECHECK_TYPES = ['checkIn', 'checkOut', 'submitReport', 'editReport', 'completeStep', 'firstTimerCheckIn',
  'addGroupMember', 'removeGroupMember', 'removeFromFlowStep', 'consentFix'] as const;
/** The Consents screen's lookups: rev 6 forms + mismatches, L6 unlinked (0031), rev 8 other (0033). */
export const CONSENT_LOOKUP_KINDS = ['forms', 'mismatches', 'unlinked', 'other'] as const;
export type ConsentLookupKind = (typeof CONSENT_LOOKUP_KINDS)[number];
/** Rev 6: the Consents screen's two types (admin only, module intakeAdmin; never leased while it is off). */
export const CONSENT_TYPES = ['consentLookup', 'consentFix', 'consentLink'] as const;
/** Rev 6 (R1): the profile consent flag. contact = the "contact with my child" opt-out; all = TOTAL non-consent date. */
export const CONSENT_FLAGS = ['ok', 'contact', 'all', 'unknown'] as const;
export const isDnc = (c: string | null | undefined) => c === 'contact' || c === 'all';
/** Resilience H3: a known DNC is sticky. Only a readable flag ('ok', 'contact', 'all') replaces it; an 'unknown' or a
 *  missing flag (read blip, older console) keeps the last known DNC, so the phones never reappear on a blip. */
export const stickyConsent = <C extends string>(old: C | null | undefined, next: C | null | undefined): C | null =>
  (next == null || next === 'unknown') && isDnc(old) ? (old as C) : (next ?? null);
/** X19: the four intake types (24 h expiry, admin only, module intakeAdmin). */
export const INTAKE_TYPES = ['intakeAnswer', 'intakeSave', 'consentSave', 'intakeText'] as const;
// PY-P3: 'shadowed' (the retired practice mode) is gone from the contract; the DB CHECK (0017) still allows it for old rows.
export const STATUSES = ['pending', 'claimed', 'sent', 'refused', 'unclear', 'cancelled'] as const;
export const OUTCOMES = ['sent', 'already', 'refused', 'unclear', 'retry', 'resolved', 'planned'] as const; // X19: planned = an intakeAnswer applied, nothing sent
// off (or not listed) = the app refuses new rows of that type and never leases them. X-2: no 'locked' capability any more;
// the refused reason 'locked' (Elvanto's 423) stays.
export const CAPABILITIES = ['live', 'off'] as const;
export const PUSH_KINDS = ['roster', 'services', 'groups', 'flows', 'intakePlan', 'consentPlan', 'consentLookup', 'progress', 'audit', 'busConsentForms'] as const;
/** The four mirror kinds (link_mirror_state); intakePlan / consentPlan are stored per (mode, date) instead (X19). */
export const MIRROR_KINDS = ['roster', 'services', 'groups', 'flows'] as const;
export const INTAKE_MODES = ['off', 'on'] as const; // X19 (R3): a plain switch, no shadow
export const RETRY_REASONS = ['console-busy', 'awaiting-approval', 'console-cannot-read'] as const;
// Spec 5.4: every stable code, incl. the non-refusals (already, console-busy, awaiting-approval) the app shows as status.
export const REASONS = ['locked', 'no-room', 'person-unknown', 'report-exists', 'report-not-found', 'report-changed',
  'member-left', 'not-in-group', 'multi-service', 'unkept-notes', 'service-not-offered', 'note-too-long',
  'did-not-meet-conflict', 'step-moved', 'assignee-needed', 'ambiguous-first-timer', 'too-old', 'not-landed',
  'console-cannot-read', 'unknown', 'lease-lost', 'note-unreadable', 'already', 'console-busy', 'awaiting-approval',
  'group-unknown', 'leader-member', // X18 (T6): the group is gone in Elvanto; a leader is removed in Elvanto only
  'needs-you', 'plan-changed', 'saved-before', 'chain-not-done', 'bad-answer', // X19 (T4): intake chains
  'form-unknown'] as const; // rev 6: consentFix's form is not that person's newest approved consent form
// Spec 3.1 (+ the two existing transient 503 codes from error.middleware.ts).
export const SYNC_ERROR_CODES = ['UNAUTHORIZED', 'LINK_OFF', 'LINK_CONTRACT_MISMATCH', 'VALIDATION_ERROR',
  'SERVICE_UNAVAILABLE', 'REQUEST_TIMEOUT'] as const;

export const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'lower-case uuid');
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Iso = z.string().datetime();
const Name = z.string().trim().min(1).max(60);
const Text = (max: number) => z.string().max(max);
// Push tolerance: a value over the limit is cut, not a reason to refuse the whole push (optional, additive fields only).
const Cut = (max: number) => z.string().transform((s) => s.slice(0, max));
const Grade = z.number().int().min(6).max(12).nullable(); // T2: grade 6 since LINK_REV 2
const LinkRev = z.number().int().min(1).optional();
const Gender = z.enum(['male', 'female']);
// A literal: the /sync handler checks the version BEFORE parsing, so a mismatch is 409 LINK_CONTRACT_MISMATCH, not 400.
const Version = z.literal(LINK_CONTRACT_VERSION);

// ---- X19 (T4) building blocks.
const StepKey = z.string().min(1).max(400);         // the console's step key, verbatim (its act caps at 400)
const Word = z.string().regex(/^[a-zA-Z]{1,30}$/);  // an action name
export const FIX_KEYS = ['first', 'last', 'birthday', 'mobile', 'parentName', 'parentPhone'] as const; // console FIX_KEYS minus suburb
const FixKey = z.enum(FIX_KEYS);
const Role = z.enum(['student', 'parent', 'pair', 'consent']);
/** The submission ref the app puts on the student form's host answer (Crockford base32: no I, L, O, U). */
export const APP_REF_RE = /^YS-[0-9A-HJKMNP-TV-Z]{6}$/;
/** X19: the encrypted note of an intakeAnswer row (the PII inputs only); at most 1,900 characters as JSON. */
export const IntakeNote = z.object({
  fixes: z.record(Uuid, z.record(FixKey, z.string().max(80))),
  keeps: z.record(Uuid, z.object({ parentName: z.string().max(200).optional(), parentPhone: z.string().max(200).optional() }).strict()),
}).strict();

// ---- Payloads (spec 5.1). Strict: an outbox payload holds ids and small values only.
// serviceTimeId: the service the report links to, chosen in the app (spec 5.5); null = did not meet or no service.
const reportFields = { groupId: Uuid, date: Ymd, didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
  guests: z.number().int().min(0).max(99), notesPrivate: z.boolean(), serviceTimeId: Uuid.nullable() };
const didNotMeetIsEmpty = (p: { didNotMeet: boolean; attendees: string[]; serviceTimeId: string | null }) =>
  !p.didNotMeet || (p.attendees.length === 0 && p.serviceTimeId === null);
const DID_NOT_MEET = 'didNotMeet means no attendees and no service';
export const PAYLOAD_SCHEMAS = {
  checkIn: z.object({ serviceTimeId: Uuid, serviceId: Uuid, personId: Uuid }).strict(),
  checkOut: z.object({ serviceTimeId: Uuid, personId: Uuid }).strict(),
  submitReport: z.object(reportFields).strict().refine(didNotMeetIsEmpty, DID_NOT_MEET),
  editReport: z.object({ ...reportFields, reportId: Uuid,
    base: z.object({ date: Ymd, didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300), guests: z.number().int().min(0).max(999),
      serviceTimeId: Uuid.nullable() }).strict(),
  }).strict().refine(didNotMeetIsEmpty, DID_NOT_MEET),
  completeStep: z.object({ rowId: Uuid, flowId: Uuid, stepId: Uuid, personId: Uuid.nullable(), notePrivate: z.boolean(),
    notReceived: z.literal(true).optional(), // rev 9 (R4): set by the server, never trusted from the phone
    assignTo: Uuid.optional() }).strict(), // r21 L6b (T4, no rev): the Elvanto person who gets the next step; an older console ignores it
  firstTimerCheckIn: z.object({ serviceTimeId: Uuid, serviceId: Uuid, firstName: Name, lastName: Name, grade: Grade, gender: Gender }).strict(),
  // X18 (T6): one Elvanto lifegroup membership change. The console answers `already` when Elvanto is already that way.
  addGroupMember: z.object({ groupId: Uuid, personId: Uuid }).strict(),
  removeGroupMember: z.object({ groupId: Uuid, personId: Uuid }).strict(),
  // X19 (T4): ids and choices only; the PII inputs (fixes, keeps) travel in the encrypted note (IntakeNote).
  intakeAnswer: z.object({ date: Ymd, family: z.array(Uuid).min(1).max(2),
    choices: z.record(Uuid, z.union([z.enum(['same', 'new']), Uuid])).refine((r) => Object.keys(r).length <= 2, 'at most 2 choices'),
    pairs: z.record(Uuid, z.union([Uuid, z.literal('none')])).refine((r) => Object.keys(r).length <= 1, 'at most 1 pair'),
    undo: z.boolean() }).strict(),
  intakeSave: z.object({ date: Ymd, row: Uuid, confirmed: z.array(StepKey).min(1).max(20), one: z.boolean() }).strict()
    .refine((p) => !p.one || p.confirmed.length === 1, 'one: exactly one key'),
  consentSave: z.object({ date: Ymd, row: Uuid, confirmed: z.array(StepKey).min(1).max(4) }).strict(),
  intakeText: z.object({ date: Ymd, row: Uuid,
    key: StepKey.refine((k) => k.startsWith('complete:parent:'), 'the parent text step') }).strict(),
  // Rev 6 (R4): admin/director; the optional note (encrypted outbox note) goes to the person's Elvanto notes.
  removeFromFlowStep: z.object({ rowId: Uuid, flowId: Uuid, stepId: Uuid, personId: Uuid.nullable() }).strict(),
  // Rev 6 (R2 b/c): a read request; ref = the row's own id (each request its own dedupe key). The search text is the note.
  consentLookup: z.object({ kind: z.enum(CONSENT_LOOKUP_KINDS), page: z.number().int().min(1).max(1000), ref: Uuid,
    since: Iso.optional() }).strict(), // ux18 P4 (LINK_REV 11, optional): only rows NEW since this time; the app sends it only to a console at link_rev >= 11 (console-since-spec.md)
  // Rev 6 (R2 c): make the profile's consent fields match this (newest approved) consent form. The form always wins.
  consentFix: z.object({ personId: Uuid, subId: Uuid }).strict(),
  // Run 2026-10-15b (L6), console-local (no Elvanto write): link an unlinked consent form to a person (personId), or undo it (null).
  // Rev 15 (L2): a link ADDS that person (a form may name several children); null unlinks every person.
  consentLink: z.object({ subId: Uuid, personId: Uuid.nullable() }).strict(),
  // Rev 15 (L7): re-check one unclear row (ref) by its own type, payload and sent-log key; the claim's note is the ref row's.
  // The console answers already (saved), refused not-landed (not saved) or refused another reason (still unclear), and
  // `resolved` on the ref row itself when it knows.
  recheck: z.object({ ref: Uuid, type: z.enum(RECHECK_TYPES), payload: z.record(z.unknown()), sentLogKey: StepKey.nullable() }).strict(),
  busConsentCheck: z.object({}).strict(), // rev 18: read the bus consent forms now (no input)
} satisfies Record<(typeof ACTION_TYPES)[number], z.ZodTypeAny>;

// ---- POST /sync/claim (spec 3.2)
const Cap = z.enum(CAPABILITIES);
export const ClaimRequest = z.object({
  contractVersion: Version, consoleId: Uuid, consoleLabel: Text(60), consoleVersion: Text(60),
  inWindow: z.boolean(), pollSeconds: z.number().int().min(10).max(3600),
  // X18: the two member types are optional (a console before LINK_REV 3 sends neither); missing = the console cannot do it.
  capabilities: z.object({ checkIn: Cap, checkOut: Cap, submitReport: Cap, editReport: Cap, completeStep: Cap, firstTimerCheckIn: Cap,
    addGroupMember: Cap.optional(), removeGroupMember: Cap.optional(),
    // X19: the intake types, sent only when the app's linkRev >= 4 (an older app 400s on unknown keys).
    intakeAnswer: Cap.optional(), intakeSave: Cap.optional(), consentSave: Cap.optional(), intakeText: Cap.optional(),
    // Rev 6: sent only when the app's linkRev >= 6.
    removeFromFlowStep: Cap.optional(), consentLookup: Cap.optional(), consentFix: Cap.optional(), consentLink: Cap.optional(),
    recheck: Cap.optional(), busConsentCheck: Cap.optional() }).strict(), // rev 15 (L7); rev 18
  max: z.number().int().min(0).max(20).default(3),
  leaseSeconds: z.number().int().min(30).max(600).default(180),
  linkRev: LinkRev,
});
export const ClaimRow = z.object({
  id: Uuid, type: z.enum(ACTION_TYPES), attempts: z.number().int().min(1), reclaimed: z.boolean(),
  createdAt: Iso, serviceDate: Ymd, by: z.object({ login: z.string(), leaderName: z.string() }),
  payload: z.record(z.unknown()), // parse with PAYLOAD_SCHEMAS[type]
  note: z.string().max(1900).nullable(), // decrypted for the leased row only
});
/** X19: the intake hint, only to a console that sent linkRev >= 4. mode off = push nothing; hurry = claim again in 10 s. */
export const IntakeHint = z.object({ mode: z.enum(INTAKE_MODES), hurry: z.boolean(),
  refresh: z.array(z.object({ mode: z.enum(['intake', 'consent']), date: Ymd })).max(4) });
export const ClaimResponse = z.object({ contractVersion: Version, serverTime: Iso, rows: z.array(ClaimRow).max(20), linkRev: LinkRev,
  intake: IntakeHint.optional(), progress: z.literal(true).optional(), // S5: this app takes POST /sync/push/progress
  consentLink: z.literal(true).optional(), // L6 review: this app takes the consentLink capability key
  // Rev 14 (multisite X1): this app's location facts; the console warns (never refuses) when its own differ.
  site: z.object({ timeZone: z.string(), serviceDay: z.number().int().min(0).max(6), consentCutoff: z.string().regex(/^\d{2}:\d{2}$/), peopleFlowPrefix: z.string(), consentFlowPrefix: z.string() }).optional(),
  // Rev 17: this app's resolved module switches (values only), so the console can mute settings the app does not use.
  modules: z.object({ checkin: z.enum(['off', 'admin', 'on']), lifegroupReport: z.enum(['off', 'admin', 'on']), flows: z.enum(['off', 'admin', 'on']),
    newYouthForms: z.enum(['off', 'admin', 'on']), intakeAdmin: z.enum(['off', 'on']), lifegroups: z.boolean(), connectionAudit: z.boolean() }).optional() });

// ---- POST /sync/result (spec 3.3)
const Detail = z.string().max(300).optional(); // the console's PII-free sentence
// X19: per chain step (intake types). Both optional, so an older app strips them (z.object default).
export const ResultStep = z.object({ key: StepKey, action: Word, role: Role,
  outcome: z.enum(['confirmed', 'already', 'not-sent', 'unconfirmed', 'locked']), at: Iso.nullable() });
export const ResultStop = z.object({ code: z.enum(['finished', 'sms', 'needs-you', 'not-confirmed', 'stuck', 'locked', 'stalled', 'gone', 'busy']),
  text: Cut(200) });
const chain = { steps: z.array(ResultStep).max(20).optional(), stop: ResultStop.optional() };
// X19: an intake row's sent-log key is the console's step key (up to 400); the other types stay within 200 in practice.
const LogKey = StepKey;
export const ResultItem = z.discriminatedUnion('outcome', [
  z.object({ id: Uuid, outcome: z.literal('sent'), sentLogKey: LogKey, reportId: Uuid.optional(), personId: Uuid.optional(),
    note: z.enum(['sent', 'failed']).optional(), ...chain }), // note: rev 7 (C-1, F-37)
  z.object({ id: Uuid, outcome: z.literal('already'), ...chain }),
  z.object({ id: Uuid, outcome: z.literal('refused'), reason: z.enum(REASONS), detail: Detail, ...chain }),
  z.object({ id: Uuid, outcome: z.literal('unclear'), sentLogKey: LogKey, detail: Detail, ...chain }),
  z.object({ id: Uuid, outcome: z.literal('retry'), retrySeconds: z.number().int().min(60).max(3600), reason: z.enum(RETRY_REASONS) }),
  z.object({ id: Uuid, outcome: z.literal('resolved'), landed: z.boolean() }),
  z.object({ id: Uuid, outcome: z.literal('planned') }), // X19: an intakeAnswer applied and that date re-pushed; nothing sent
]);
export const ResultRequest = z.object({ contractVersion: Version, consoleId: Uuid, results: z.array(ResultItem).min(1).max(20) });
export const ResultResponse = z.object({
  applied: z.array(Uuid),
  ignored: z.array(z.object({ id: Uuid, why: z.enum(['unknown-id', 'not-leased', 'already-final', 'bad-transition']) })),
});

// ---- POST /sync/push/:kind (spec 3.4). One bad row rejects the whole push.
const Consent = z.enum(CONSENT_FLAGS);
const RosterRow = z.object({ personId: Uuid, firstName: Name, lastName: z.string().trim().max(60), gender: Gender.nullable(), grade: Grade,
  kind: z.enum(['student', 'leader', 'other']), consent: Consent.optional() }); // rev 6 (R1); missing = unknown
const ServiceRow = z.object({ serviceTimeId: Uuid, serviceId: Uuid, name: Text(120), startsAt: Iso, ymd: Ymd,
  rooms: z.array(z.object({ id: Uuid, name: Text(120) })),
  // T3: the names, so a checked-in person with no roster row still shows by name.
  checkedIn: z.array(z.object({ personId: Uuid, roomId: Uuid, firstName: Cut(60).optional(), lastName: Cut(60).optional() })) });
const LastReport = z.object({ reportId: Uuid, date: Ymd, time: Text(10), didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
  guests: z.number().int().min(0).max(999), serviceTimeId: Uuid.nullable(), editable: z.boolean(),
  blocked: z.enum(['multi-service', 'unkept-notes', 'member-left']).nullable() });
const GroupRow = z.object({ groupId: Uuid, name: Text(120), meets: Text(40),
  members: z.array(z.object({ personId: Uuid, name: Text(120), leader: z.boolean() })).max(300),
  thisWeek: z.enum(['reported', 'did-not-meet', 'none', 'later', 'unreadable']),
  lastReport: LastReport.nullable(),
  history: z.array(LastReport).transform((h) => h.slice(0, 8)).optional() }); // T8: newest first; more than 8 keeps the newest 8
const FlowRow = z.object({ rowId: Uuid, flowId: Uuid, flowName: Text(120), stepId: Uuid, stepName: Text(120),
  stepOrder: z.number().int().min(0), personId: Uuid.nullable(), name: Text(120), due: Ymd.nullable(), assignedTo: Text(120),
  // T4: the person's own grade/gender, and their mobile as bare digits (else the parent's, mobileIsParent true).
  grade: Grade.optional(), gender: Gender.nullable().optional(), mobile: z.string().regex(/^\d{6,15}$/).nullable().optional(),
  mobileIsParent: z.boolean().optional(), consent: Consent.optional(), // rev 6 (R1)
  textedOn: Ymd.nullable().optional(), // rev 10 (R8): New People step 0 only
  serviceVisits: z.number().int().min(0).max(999).nullable().optional() }); // rev 13: distinct service days this term since the student form (form day counts), null = unknown
// T12 (rev 5): one step of a pushed flow, empty or not.
export const FlowStep = z.object({ flowId: Uuid, flowName: Text(120), stepId: Uuid, stepName: Text(120), stepOrder: z.number().int().min(0) });
const push = <T extends z.ZodTypeAny>(row: T) =>
  z.object({ contractVersion: Version, consoleId: Uuid, takenAt: Iso, rows: z.array(row).max(5000) });
// ---- X19 (T4): intakePlan / consentPlan, one (mode, date) per push, a full replace of that date. The console builds the
// rows by whitelist; every object here is strict, so an unknown key (an address, an email, a suburb) rejects the push.
const Hold = z.object({ role: Role, text: Cut(200) }).strict();
const Step = z.object({ key: StepKey, action: Word, role: Role, text: Cut(120), state: z.enum(['todo', 'wait', 'done']),
  alone: z.boolean(), locked: z.boolean(),
  sms: z.object({ name: Cut(120), last3: z.string().regex(/^\d{0,3}$/) }).strict().nullable(),
  alts: z.array(z.object({ key: StepKey, created: z.record(Uuid, Uuid) }).strict()).max(7) }).strict();
const Extra = Step.extend({ field: z.enum(['grade', 'mobile', 'first', 'last']), value: Cut(40) }).strict();
// The form as submitted (the parent form: first/last/mobile/gender only). Never suburb, address or email.
const FormValues = z.object({ first: Cut(80), last: Cut(80), mobile: Cut(80), gender: Cut(80), birthday: Cut(80).optional(),
  parentName: Cut(80).optional(), parentPhone: Cut(80).optional(), school: Cut(80).optional(), grade: Cut(80).optional() }).strict();
const FixMap = z.record(FixKey, Cut(80));
const Form = z.object({ subId: Uuid, status: z.enum(['pending', 'approved']), when: Cut(40), values: FormValues,
  edits: FixMap, caps: FixMap, editable: z.array(FixKey).max(6),
  issues: z.array(z.object({ key: FixKey, msg: Cut(80), suggest: Cut(80), advisory: z.boolean(),
    keep: z.object({ field: z.enum(['parentName', 'parentPhone']), value: Cut(200) }).strict().nullable() }).strict()).max(20) }).strict();
// Spec: a Suburb entry names the field only; its values stay blank (a suburb is an address part, never pushed).
const Diff = z.object({ label: Cut(40), a: Cut(80), b: Cut(80) }).strict()
  .refine((d) => d.label !== 'Suburb' || (d.a === '' && d.b === ''), 'a Suburb entry has blank values');
const VerdictWord = z.enum(['same', 'new', 'unsure', 'different']);
const Choice = z.union([Uuid, z.enum(['same', 'new'])]);
const Verdict = z.object({ role: Role, subId: Uuid, verdict: VerdictWord, chosen: Choice.nullable(), options: z.array(Choice).max(7),
  linked: z.object({ id: Uuid.optional(), name: Cut(120), age: z.number().int().min(0).max(130).nullable(), archived: z.boolean() }).strict().nullable(),
  candidates: z.array(z.object({ id: Uuid, name: Cut(120), age: z.number().int().min(0).max(130).nullable(), archived: z.boolean(),
    verdict: VerdictWord, diff: z.array(Diff).max(5) }).strict()).max(5),
  diff: z.array(Diff).max(5) }).strict();
const Profile = z.object({ id: Uuid, name: Cut(120), archived: z.boolean() }).strict();
const Advice = z.object({ form: Cut(20), profile: Cut(20), state: Cut(20) }).strict();
const Links = z.array(z.tuple([Cut(40), z.string().regex(/^https:\/\//).max(300)])).max(4);
const PlanStatus = z.enum(['needs-you', 'ready', 'done']);
export const IntakeRow = z.object({ key: Uuid, status: PlanStatus, title: Cut(120), holds: z.array(Hold).max(10), fromApp: z.boolean(),
  siblings: z.array(Cut(60)).max(6),
  match: z.object({ kind: z.enum(['exact', 'near', 'manual', 'app']).nullable(), parentSub: Uuid.nullable(),
    options: z.array(z.object({ subId: Uuid, name: Cut(120), when: Cut(40) }).strict()).max(10) }).strict(),
  forms: z.object({ student: Form.nullable(), parent: Form.nullable() }).strict(),
  verdicts: z.array(Verdict).max(2),
  profiles: z.object({ student: Profile.nullable(), parent: Profile.nullable() }).strict(),
  grade: Advice.nullable(), gender: Advice.nullable(),
  age: Advice.extend({ birthday: Cut(20).nullable() }).strict().nullable(),
  steps: z.array(Step).max(15), extras: z.array(Extra).max(6),
  kept: z.array(z.enum(['parentName', 'parentPhone'])).max(2),
  dropped: z.array(z.object({ role: Role, key: FixKey }).strict()).max(14),
  links: Links }).strict();
export const ConsentRow = z.object({ key: Uuid, status: PlanStatus, title: Cut(120), holds: z.array(Hold).max(10),
  outcome: z.enum(['Contact allowed', 'No contact', 'No reply: assume consent', '']),
  consent: z.object({ ymd: Ymd.nullable(), contact: z.boolean(), total: Cut(40) }).strict().nullable(),
  consentNote: Cut(40), textedOn: Ymd.nullable(),
  profiles: z.object({ student: Profile.nullable() }).strict(),
  steps: z.array(Step).max(4), links: Links }).strict();
const intakeEnvelope = { contractVersion: Version, consoleId: Uuid, takenAt: Iso, date: Ymd, cut: z.boolean() };
const uniqueKeys = (p: { rows: { key: string }[] }) => new Set(p.rows.map((r) => r.key)).size === p.rows.length;
const UNIQUE = 'row keys must be unique within a push';
export const IntakePush = z.object({ ...intakeEnvelope,
  inputs: z.object({ from: z.enum(['console', 'app']), at: Iso }).strict().nullable(), rows: z.array(IntakeRow).max(100) })
  .refine(uniqueKeys, UNIQUE);
export const ConsentPush = z.object({ ...intakeEnvelope, rows: z.array(ConsentRow).max(100) }).refine(uniqueKeys, UNIQUE);

// ---- Rev 6 (R2 b/c): the answer to one consentLookup row (requestId = its outbox id); one page (25 rows by default).
const Dmy40 = Cut(40);
const OptOuts = z.array(Cut(80)).max(10);
export const ConsentFormRow = z.object({ subId: Uuid, personId: Uuid.nullable(), name: Cut(120), submitted: Ymd.nullable(),
  status: z.enum(['approved', 'pending']), consentDate: Dmy40, contactOptOut: z.boolean(), total: Dmy40, otherOptOuts: OptOuts }).strict();
const ConsentSide = z.object({ consentDate: Dmy40, total: Dmy40, optOuts: OptOuts }).strict();
export const CONSENT_DIFFS = ['consent date', 'TOTAL non-consent date', 'opt-outs'] as const;
export const ConsentMismatchRow = z.object({ subId: Uuid, personId: Uuid, name: Cut(120), submitted: Ymd.nullable(),
  diffs: z.array(z.enum(CONSENT_DIFFS)).min(1).max(3), form: ConsentSide, profile: ConsentSide,
  linked: z.boolean().optional() }).strict(); // linked: rev 7 (C-1, F-36)
// Run 2026-10-15b (L6): a consent form with no person in Elvanto, or one the console linked (linked = that person).
export const ConsentUnlinkedRow = ConsentFormRow.omit({ personId: true }).extend({ names: z.array(Cut(80)).max(4),
  linked: z.object({ personId: Uuid, name: Cut(120) }).strict().nullable(),
  // Rev 15 (L2): formName = the form's own first + last name fields ("Jamie, Riley & Morgan Sample"); linkedIds = every linked
  // person when the console linked 2+ (linked then names the first and linked.name lists them all).
  formName: Cut(120).optional(), linkedIds: z.array(Uuid).min(2).max(10).optional() }).strict();
// Rev 8 (Consents Other): a step-0 student in no pushed consent week. date = the earliest sign a parent was texted (Parent Consent
// step 1 Complete): a confirmed console send ('console text') or a parent note naming the student ('parent note'); null = none, and
// why says so. The row itself is never an input to a consent save or check; R8 (rev 10): the same date reaches the app as the
// step-0 flow row's `textedOn`, which the consent Friday counts from.
export const ConsentOtherRow = z.object({ personId: Uuid, rowId: Uuid, name: Cut(120), date: Ymd.nullable(),
  source: z.enum(['console text', 'parent note']).nullable(), why: Cut(120), link: z.string().regex(/^https:\/\/\S+$/).max(300).nullable() }).strict()
  .refine((r) => (r.date === null) === (r.source === null), 'a date needs its source');
const lookupEnvelope = { contractVersion: Version, consoleId: Uuid, takenAt: Iso, requestId: Uuid,
  page: z.number().int().min(1).max(1000), pageSize: z.number().int().min(1).max(100), total: z.number().int().min(0).nullable() };
export const ConsentLookupPush = z.discriminatedUnion('kind', [
  z.object({ ...lookupEnvelope, kind: z.literal('forms'), rows: z.array(ConsentFormRow).max(100) }).strict(),
  z.object({ ...lookupEnvelope, kind: z.literal('mismatches'), rows: z.array(ConsentMismatchRow).max(100) }).strict(),
  z.object({ ...lookupEnvelope, kind: z.literal('unlinked'), rows: z.array(ConsentUnlinkedRow).max(100) }).strict(),
  z.object({ ...lookupEnvelope, kind: z.literal('other'), rows: z.array(ConsentOtherRow).max(100) }).strict(),
]);

// ---- S5 (run 2026-10-15b): progress of one long console job. key: flows (the flows read), lookup:<consentLookup row id>,
// intake:<mode>:<date> (an intake / consent push). done/total null = not known (the app shows a sliding bar). Never a name.
export const PROGRESS_KEY = /^(flows|lookup:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|intake:(intake|consent):\d{4}-\d{2}-\d{2})$/;
export const ProgressPush = z.object({ contractVersion: Version, consoleId: Uuid, takenAt: Iso, key: z.string().regex(PROGRESS_KEY),
  done: z.number().int().min(0).max(100000).nullable(), total: z.number().int().min(1).max(100000).nullable(), stage: Cut(60) }).strict();

// ---- Rev 16 (Connection Audit, spec ys-connection/2026-10-22-connection-audit §3): one Elvanto source per body, as a
// cell table. The console only splits the CSV and keeps the allowed columns; YS parses the cells (audit-parse.ts).
export const AUDIT_SOURCES = ['service', 'group', 'team', 'connect', 'decision'] as const;
export const AUDIT_FAIL = ['read', 'timeout', 'budget', 'empty'] as const;
/** The only form columns that leave the PC (connect + decision). 11.1 keeps a byte copy: audit-form-headers.json.
 *  No phone column: the follow-up phone comes from the service list only (bug 5). `What grade are you in?` is the
 *  Decision form's grade question (Brisbane - Youth - Decision Form, operator sample 2026-10-22). */
export const AUDIT_FORM_HEADERS = ['First Name', 'Last Name', 'Preferred Name', 'Date Submitted', 'Submitted', 'Grade',
  'School Grade', 'Year', 'Gender', 'What grade are you in?'] as const;
const AuditCell = Cut(200);                  // an over-long cell is cut, not refused (push tolerance)
const AuditHeader = z.string().max(120);     // may be empty (Elvanto group/matrix exports)
const FormHeader = z.enum(AUDIT_FORM_HEADERS); // an unexpected form column (prayer, health text) refuses the push
const auditBase = { contractVersion: Version, consoleId: Uuid, takenAt: Iso, exportedAt: Iso };
const auditOk = <S extends (typeof AUDIT_SOURCES)[number], H extends z.ZodType<string>>(source: S, maxRows: number, header: H) =>
  z.object({ ...auditBase, source: z.literal(source), status: z.literal('ok'),
    headers: z.array(header).min(1).max(400), rows: z.array(z.array(AuditCell).max(400)).max(maxRows) }).strict();
export const AuditPush = z.union([
  auditOk('service', 3000, AuditHeader), auditOk('group', 8000, AuditHeader), auditOk('team', 1500, AuditHeader),
  auditOk('connect', 3000, FormHeader), auditOk('decision', 3000, FormHeader),
  z.object({ ...auditBase, source: z.enum(AUDIT_SOURCES), status: z.literal('failed'), reason: z.enum(AUDIT_FAIL) }).strict(),
]).superRefine((b, ctx) => { // every row has exactly headers.length cells
  if (b.status === 'ok') b.rows.forEach((r, i) => {
    if (r.length !== b.headers.length) ctx.addIssue({ code: 'custom', path: ['rows', i], message: 'row length != headers length' });
  });
});
export type AuditPushBody = z.infer<typeof AuditPush>;
export const AuditPushResponse = z.object({ applied: z.boolean(), source: z.enum(AUDIT_SOURCES),
  status: z.enum(['stored', 'stale', 'shape', 'failed-recorded']) }).strict();

// ---- Rev 18 (bus consent, spec 2026-10-22 §5.2/§7): one row per child of an Elvanto bus consent submission. PII-allowlisted:
// exactly these fields leave the console PC. Over-long text is cut (push tolerance); anything else unknown refuses the push.
export const BusConsentFormRow = z.object({
  submissionId: Uuid, childIndex: z.number().int().min(0).max(9), submittedAt: Iso,
  first: Name, last: Name,
  grade: Grade, gender: Gender.nullable(), mobile: Cut(20), school: Cut(80),
  address: z.object({ line1: Cut(120), line2: Cut(120), postcode: Cut(10), city: Cut(60), state: Cut(20) }).strict(),
  parentName: Cut(120), parentPhone: Cut(20), pickup: z.boolean().nullable(), pickupBy: Cut(120),
}).strict();
export const BusConsentFormsPush = z.object({ contractVersion: Version, consoleId: Uuid, takenAt: Iso, checkedAt: Iso,
  rows: z.array(BusConsentFormRow).max(2000) }).strict();
export type BusConsentFormsPushBody = z.infer<typeof BusConsentFormsPush>;
export const BusConsentFormsResponse = z.object({ applied: z.boolean(), rows: z.number().int().min(0),
  new: z.number().int().min(0), unmatched: z.number().int().min(0) }).strict();

export const PUSH_SCHEMAS = { roster: push(RosterRow), services: push(ServiceRow), groups: push(GroupRow),
  flows: push(FlowRow).extend({ steps: z.array(FlowStep).max(2000).optional() }), // T12: optional (rev 5)
  intakePlan: IntakePush, consentPlan: ConsentPush, consentLookup: ConsentLookupPush, progress: ProgressPush, audit: AuditPush, busConsentForms: BusConsentFormsPush } satisfies Record<(typeof PUSH_KINDS)[number], z.ZodTypeAny>;
export const PushResponse = z.object({ applied: z.boolean(), rows: z.number().int().min(0).optional(),
  matched: z.object({ auto: z.number().int().min(0), ambiguous: z.number().int().min(0) }).optional() });

// ---- POST /sync/leaders (T8, rev 5): the envelope only; the reply is every active app leader's full name.
export const LeadersRequest = z.object({ contractVersion: Version, consoleId: Uuid });
export const LeadersResponse = z.object({ contractVersion: Version, names: z.array(z.string().max(200)).max(2000) });

// Part 2 reconciliation (spec 2026-10-17 s5.8). Additive; no contract version bump (an older console never calls it).
export const ReconcileLatestRequest = z.object({ contractVersion: Version, consoleId: Uuid });
const CheckState = z.union([z.object({ count: z.number().int().min(0), noId: z.number().int().min(0).optional() }).strict(),
  z.object({ error: z.literal(true) }).strict()]);
export const ReconcileLatestResponse = z.object({
  contractVersion: Version,
  run: z.object({ ranAt: z.string(), ok: z.boolean(),
    checks: z.object({ checkins: CheckState, unmatched: CheckState, lifegroups: CheckState, members: CheckState }) }).nullable(),
  entries: z.array(z.object({ tier: z.enum(['now', 'later']), code: z.string().max(80), line1: z.string().max(300),
    count: z.number().int().min(0), counted: z.boolean(), lastSeen: z.string() })).max(200),
});

// ---- Error bodies (spec 3.1); extra fields (expected, details) pass through.
export const ErrorBody = z.object({ code: z.enum(SYNC_ERROR_CODES), message: z.string() }).passthrough();
