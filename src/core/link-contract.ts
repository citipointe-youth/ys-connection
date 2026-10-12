import { z } from 'zod';

// Step 0 of the YS Connection <-> Elvanto Sync Console link (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md).
// Shapes only: no routes, no services. Fixtures: src/tests/fixtures/elvanto-link/ (11.1 keeps a byte copy).
// A shape change bumps LINK_CONTRACT_VERSION, the fixtures and the manifest, and is copied to 11.1 in the same session.
// (v1 was amended in place on 2026-10-12, operator decisions 9-13, before any release: no bump for that.)
export const LINK_CONTRACT_VERSION = 1;
// UX batch 2026-10-12 (T1): optional additions only, so the version stays 1 and an older peer still parses (row objects
// strip unknown keys). Each side sends its LINK_REV in the claim (missing = 1); the app shows "Console out of date" when
// the console's rev is lower, the console sends grade 6 only when the app's rev is >= 2.
export const LINK_REV = 2;

export const ACTION_TYPES = ['checkIn', 'checkOut', 'submitReport', 'editReport', 'completeStep', 'firstTimerCheckIn'] as const;
export const STATUSES = ['pending', 'claimed', 'sent', 'refused', 'unclear', 'shadowed', 'cancelled'] as const;
export const OUTCOMES = ['sent', 'already', 'refused', 'unclear', 'retry', 'shadowed', 'resolved'] as const;
// locked = the app queues it; the console claims it and answers refused 'locked' (no writer yet, or 11.1's 423). off = the app refuses it.
export const CAPABILITIES = ['live', 'shadow', 'locked', 'off'] as const;
export const PUSH_KINDS = ['roster', 'services', 'groups', 'flows'] as const;
export const RETRY_REASONS = ['console-busy', 'awaiting-approval', 'console-cannot-read'] as const;
// Spec 5.4: every stable code, incl. the non-refusals (already, console-busy, awaiting-approval) the app shows as status.
export const REASONS = ['locked', 'no-room', 'person-unknown', 'report-exists', 'report-not-found', 'report-changed',
  'member-left', 'not-in-group', 'multi-service', 'unkept-notes', 'service-not-offered', 'note-too-long',
  'did-not-meet-conflict', 'step-moved', 'assignee-needed', 'ambiguous-first-timer', 'too-old', 'not-landed',
  'console-cannot-read', 'unknown', 'lease-lost', 'note-unreadable', 'already', 'console-busy', 'awaiting-approval'] as const;
// Spec 3.1 (+ the two existing transient 503 codes from error.middleware.ts).
export const SYNC_ERROR_CODES = ['UNAUTHORIZED', 'LINK_OFF', 'LINK_CONTRACT_MISMATCH', 'VALIDATION_ERROR',
  'SERVICE_UNAVAILABLE', 'REQUEST_TIMEOUT'] as const;

const Uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, 'lower-case uuid');
const Ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Iso = z.string().datetime();
const Name = z.string().trim().min(1).max(60);
const Text = (max: number) => z.string().max(max);
const Grade = z.number().int().min(6).max(12).nullable(); // T2: grade 6 since LINK_REV 2
const LinkRev = z.number().int().min(1).optional();
const Gender = z.enum(['male', 'female']);
// A literal: the /sync handler checks the version BEFORE parsing, so a mismatch is 409 LINK_CONTRACT_MISMATCH, not 400.
const Version = z.literal(LINK_CONTRACT_VERSION);

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
} satisfies Record<(typeof ACTION_TYPES)[number], z.ZodTypeAny>;

// ---- POST /sync/claim (spec 3.2)
const Cap = z.enum(CAPABILITIES);
export const ClaimRequest = z.object({
  contractVersion: Version, consoleId: Uuid, consoleLabel: Text(60), consoleVersion: Text(60),
  inWindow: z.boolean(), pollSeconds: z.number().int().min(10).max(3600),
  capabilities: z.object({ checkIn: Cap, checkOut: Cap, submitReport: Cap, editReport: Cap, completeStep: Cap, firstTimerCheckIn: Cap }).strict(),
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
export const ClaimResponse = z.object({ contractVersion: Version, serverTime: Iso, rows: z.array(ClaimRow).max(20), linkRev: LinkRev });

// ---- POST /sync/result (spec 3.3)
const Key = z.string().min(1).max(200);
const Detail = z.string().max(300).optional(); // the console's PII-free sentence
export const ResultItem = z.discriminatedUnion('outcome', [
  z.object({ id: Uuid, outcome: z.literal('sent'), sentLogKey: Key, reportId: Uuid.optional(), personId: Uuid.optional() }),
  z.object({ id: Uuid, outcome: z.literal('already') }),
  z.object({ id: Uuid, outcome: z.literal('refused'), reason: z.enum(REASONS), detail: Detail }),
  z.object({ id: Uuid, outcome: z.literal('unclear'), sentLogKey: Key, detail: Detail }),
  z.object({ id: Uuid, outcome: z.literal('retry'), retrySeconds: z.number().int().min(60).max(3600), reason: z.enum(RETRY_REASONS) }),
  z.object({ id: Uuid, outcome: z.literal('shadowed'), sentLogKey: Key }),
  z.object({ id: Uuid, outcome: z.literal('resolved'), landed: z.boolean() }),
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
  checkedIn: z.array(z.object({ personId: Uuid, roomId: Uuid, firstName: Text(60).optional(), lastName: Text(60).optional() })) });
const LastReport = z.object({ reportId: Uuid, date: Ymd, time: Text(10), didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
  guests: z.number().int().min(0).max(999), serviceTimeId: Uuid.nullable(), editable: z.boolean(),
  blocked: z.enum(['multi-service', 'unkept-notes', 'member-left']).nullable() });
const GroupRow = z.object({ groupId: Uuid, name: Text(120), meets: Text(40),
  members: z.array(z.object({ personId: Uuid, name: Text(120), leader: z.boolean() })).max(300),
  thisWeek: z.enum(['reported', 'did-not-meet', 'none', 'later', 'unreadable']),
  lastReport: LastReport.nullable(),
  history: z.array(LastReport).max(8).optional() }); // T8: newest first, 8 weeks back
const FlowRow = z.object({ rowId: Uuid, flowId: Uuid, flowName: Text(120), stepId: Uuid, stepName: Text(120),
  stepOrder: z.number().int().min(0), personId: Uuid.nullable(), name: Text(120), due: Ymd.nullable(), assignedTo: Text(120),
  // T4: the person's own grade/gender, and their mobile as bare digits (else the parent's, mobileIsParent true).
  grade: Grade.optional(), gender: Gender.nullable().optional(), mobile: z.string().regex(/^\d{6,15}$/).nullable().optional(),
  mobileIsParent: z.boolean().optional() });
const push = <T extends z.ZodTypeAny>(row: T) =>
  z.object({ contractVersion: Version, consoleId: Uuid, takenAt: Iso, rows: z.array(row).max(5000) });
export const PUSH_SCHEMAS = { roster: push(RosterRow), services: push(ServiceRow), groups: push(GroupRow), flows: push(FlowRow) } satisfies Record<(typeof PUSH_KINDS)[number], z.ZodTypeAny>;
export const PushResponse = z.object({ applied: z.boolean(), rows: z.number().int().min(0).optional(),
  matched: z.object({ auto: z.number().int().min(0), ambiguous: z.number().int().min(0) }).optional() });

// ---- Error bodies (spec 3.1); extra fields (expected, details) pass through.
export const ErrorBody = z.object({ code: z.enum(SYNC_ERROR_CODES), message: z.string() }).passthrough();
