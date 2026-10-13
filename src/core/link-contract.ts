import { z } from 'zod';

// Step 0 of the YS Connection <-> Elvanto Sync Console link (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md).
// Shapes only: no routes, no services. Fixtures: src/tests/fixtures/elvanto-link/ (11.1 keeps a byte copy).
// A shape change bumps LINK_CONTRACT_VERSION, the fixtures and the manifest, and is copied to 11.1 in the same session.
// (v1 was amended in place on 2026-10-12, operator decisions 9-13, before any release: no bump for that.)
export const LINK_CONTRACT_VERSION = 1;
// UX batch 2026-10-12 (T1): optional additions only, so the version stays 1 and an older peer still parses (row objects
// strip unknown keys). Each side sends its LINK_REV in the claim (missing = 1); the app shows "Console out of date" when
// the console's rev is lower, the console sends grade 6 only when the app's rev is >= 2.
// UX batch 2026-10-13 (T6, contract X18): addGroupMember / removeGroupMember, again optional only (rev 3). An older
// console does not list them in its capabilities: the app never leases them to it and refuses new ones (LINK_UNAVAILABLE).
// UX batch 2026-10-13 (T4, contract X19): youth intake + consents (intakeAnswer / intakeSave / consentSave / intakeText,
// pushes intakePlan / consentPlan, outcome `planned`, result steps/stop), optional only (rev 4). The console sends the four
// capability keys and claims these types only when the app's reply linkRev >= 4; the app offers Intake only when the
// latest console's link_rev >= 4.
export const LINK_REV = 4;

export const ACTION_TYPES = ['checkIn', 'checkOut', 'submitReport', 'editReport', 'completeStep', 'firstTimerCheckIn',
  'addGroupMember', 'removeGroupMember', 'intakeAnswer', 'intakeSave', 'consentSave', 'intakeText'] as const;
/** X19: the four intake types (24 h expiry, admin only, module intakeAdmin). */
export const INTAKE_TYPES = ['intakeAnswer', 'intakeSave', 'consentSave', 'intakeText'] as const;
export const STATUSES = ['pending', 'claimed', 'sent', 'refused', 'unclear', 'shadowed', 'cancelled'] as const;
export const OUTCOMES = ['sent', 'already', 'refused', 'unclear', 'retry', 'shadowed', 'resolved', 'planned'] as const; // X19: planned = an intakeAnswer applied, nothing sent
// locked = the app queues it; the console claims it and answers refused 'locked' (no writer yet, or 11.1's 423). off = the app refuses it.
export const CAPABILITIES = ['live', 'shadow', 'locked', 'off'] as const;
export const PUSH_KINDS = ['roster', 'services', 'groups', 'flows', 'intakePlan', 'consentPlan'] as const;
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
  'needs-you', 'plan-changed', 'saved-before', 'chain-not-done', 'bad-answer'] as const; // X19 (T4): intake chains
// Spec 3.1 (+ the two existing transient 503 codes from error.middleware.ts).
export const SYNC_ERROR_CODES = ['UNAUTHORIZED', 'LINK_OFF', 'LINK_CONTRACT_MISMATCH', 'VALIDATION_ERROR',
  'SERVICE_UNAVAILABLE', 'REQUEST_TIMEOUT'] as const;

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'lower-case uuid');
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
  completeStep: z.object({ rowId: Uuid, flowId: Uuid, stepId: Uuid, personId: Uuid.nullable(), notePrivate: z.boolean() }).strict(),
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
    intakeAnswer: Cap.optional(), intakeSave: Cap.optional(), consentSave: Cap.optional(), intakeText: Cap.optional() }).strict(),
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
  intake: IntakeHint.optional() });

// ---- POST /sync/result (spec 3.3)
const Detail = z.string().max(300).optional(); // the console's PII-free sentence
// X19: per chain step (intake types). Both optional, so an older app strips them (z.object default).
export const ResultStep = z.object({ key: StepKey, action: Word, role: Role,
  outcome: z.enum(['confirmed', 'already', 'not-sent', 'unconfirmed', 'locked', 'shadowed']), at: Iso.nullable() });
export const ResultStop = z.object({ code: z.enum(['finished', 'sms', 'needs-you', 'not-confirmed', 'stuck', 'locked', 'stalled', 'gone', 'busy']),
  text: Cut(200) });
const chain = { steps: z.array(ResultStep).max(20).optional(), stop: ResultStop.optional() };
// X19: an intake row's sent-log key is the console's step key (up to 400); the other types stay within 200 in practice.
const LogKey = StepKey;
export const ResultItem = z.discriminatedUnion('outcome', [
  z.object({ id: Uuid, outcome: z.literal('sent'), sentLogKey: LogKey, reportId: Uuid.optional(), personId: Uuid.optional(), ...chain }),
  z.object({ id: Uuid, outcome: z.literal('already'), ...chain }),
  z.object({ id: Uuid, outcome: z.literal('refused'), reason: z.enum(REASONS), detail: Detail, ...chain }),
  z.object({ id: Uuid, outcome: z.literal('unclear'), sentLogKey: LogKey, detail: Detail, ...chain }),
  z.object({ id: Uuid, outcome: z.literal('retry'), retrySeconds: z.number().int().min(60).max(3600), reason: z.enum(RETRY_REASONS) }),
  z.object({ id: Uuid, outcome: z.literal('shadowed'), sentLogKey: LogKey, ...chain }),
  z.object({ id: Uuid, outcome: z.literal('resolved'), landed: z.boolean() }),
  z.object({ id: Uuid, outcome: z.literal('planned') }), // X19: an intakeAnswer applied and that date re-pushed; nothing sent
]);
export const ResultRequest = z.object({ contractVersion: Version, consoleId: Uuid, results: z.array(ResultItem).min(1).max(20) });
export const ResultResponse = z.object({
  applied: z.array(Uuid),
  ignored: z.array(z.object({ id: Uuid, why: z.enum(['unknown-id', 'not-leased', 'already-final', 'bad-transition']) })),
});

// ---- POST /sync/push/:kind (spec 3.4). One bad row rejects the whole push.
const RosterRow = z.object({ personId: Uuid, firstName: Name, lastName: z.string().trim().max(60), gender: Gender.nullable(), grade: Grade,
  kind: z.enum(['student', 'leader', 'other']) });
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
  mobileIsParent: z.boolean().optional() });
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

export const PUSH_SCHEMAS = { roster: push(RosterRow), services: push(ServiceRow), groups: push(GroupRow), flows: push(FlowRow),
  intakePlan: IntakePush, consentPlan: ConsentPush } satisfies Record<(typeof PUSH_KINDS)[number], z.ZodTypeAny>;
export const PushResponse = z.object({ applied: z.boolean(), rows: z.number().int().min(0).optional(),
  matched: z.object({ auto: z.number().int().min(0), ambiguous: z.number().int().min(0) }).optional() });

// ---- Error bodies (spec 3.1); extra fields (expected, details) pass through.
export const ErrorBody = z.object({ code: z.enum(SYNC_ERROR_CODES), message: z.string() }).passthrough();
