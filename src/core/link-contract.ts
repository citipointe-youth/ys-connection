import { z } from 'zod';

// Step 0 of the YS Connection <-> Elvanto Sync Console link (spec docs/superpowers/specs/2026-10-11-elvanto-link-contract.md).
// Shapes only: no routes, no services. Fixtures: src/tests/fixtures/elvanto-link/ (11.1 keeps a byte copy).
// A shape change bumps LINK_CONTRACT_VERSION, the fixtures and the manifest, and is copied to 11.1 in the same session.
export const LINK_CONTRACT_VERSION = 1;

export const ACTION_TYPES = ['checkIn', 'checkOut', 'submitReport', 'editReport', 'completeStep', 'firstTimerCheckIn'] as const;
export const STATUSES = ['pending', 'claimed', 'sent', 'refused', 'unclear', 'shadowed', 'cancelled'] as const;
export const OUTCOMES = ['sent', 'already', 'refused', 'unclear', 'retry', 'shadowed', 'resolved'] as const;
export const CAPABILITIES = ['live', 'shadow', 'off'] as const;
export const PUSH_KINDS = ['roster', 'services', 'groups', 'flows'] as const;
export const RETRY_REASONS = ['console-busy', 'awaiting-approval', 'console-cannot-read'] as const;
// Spec 5.4: every stable code, incl. the non-refusals (already, console-busy, awaiting-approval) the app shows as status.
export const REASONS = ['locked', 'no-room', 'person-unknown', 'report-exists', 'report-not-found', 'report-changed',
  'member-left', 'not-in-group', 'multi-service', 'unkept-notes', 'service-not-offered', 'pick-service', 'note-too-long',
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
const Grade = z.number().int().min(7).max(12).nullable();
const Gender = z.enum(['male', 'female']);
// A literal: the /sync handler checks the version BEFORE parsing, so a mismatch is 409 LINK_CONTRACT_MISMATCH, not 400.
const Version = z.literal(LINK_CONTRACT_VERSION);

// ---- Payloads (spec 5.1). Strict: an outbox payload holds ids and small values only.
const reportFields = { groupId: Uuid, date: Ymd, didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
  guests: z.number().int().min(0).max(99), notesPrivate: z.boolean() };
const noAttendeesIfDidNotMeet = (p: { didNotMeet: boolean; attendees: string[] }) => !p.didNotMeet || p.attendees.length === 0;
export const PAYLOAD_SCHEMAS = {
  checkIn: z.object({ serviceTimeId: Uuid, serviceId: Uuid, personId: Uuid }).strict(),
  checkOut: z.object({ serviceTimeId: Uuid, personId: Uuid }).strict(),
  submitReport: z.object(reportFields).strict().refine(noAttendeesIfDidNotMeet, 'didNotMeet means no attendees'),
  editReport: z.object({ ...reportFields, reportId: Uuid,
    base: z.object({ date: Ymd, didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300), guests: z.number().int().min(0).max(999) }).strict(),
  }).strict().refine(noAttendeesIfDidNotMeet, 'didNotMeet means no attendees'),
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
});
export const ClaimRow = z.object({
  id: Uuid, type: z.enum(ACTION_TYPES), attempts: z.number().int().min(1), reclaimed: z.boolean(),
  createdAt: Iso, serviceDate: Ymd, by: z.object({ login: z.string(), leaderName: z.string() }),
  payload: z.record(z.unknown()), // parse with PAYLOAD_SCHEMAS[type]
  note: z.string().max(1900).nullable(), // decrypted for the leased row only
});
export const ClaimResponse = z.object({ contractVersion: Version, serverTime: Iso, rows: z.array(ClaimRow).max(20) });

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
const RosterRow = z.object({ personId: Uuid, firstName: Name, lastName: Text(60), gender: Gender.nullable(), grade: Grade,
  kind: z.enum(['student', 'leader', 'other']) });
const ServiceRow = z.object({ serviceTimeId: Uuid, serviceId: Uuid, name: Text(120), startsAt: Iso, ymd: Ymd,
  rooms: z.array(z.object({ id: Uuid, name: Text(120) })), checkedIn: z.array(z.object({ personId: Uuid, roomId: Uuid })) });
const GroupRow = z.object({ groupId: Uuid, name: Text(120), meets: Text(40),
  members: z.array(z.object({ personId: Uuid, name: Text(120), leader: z.boolean() })).max(300),
  thisWeek: z.enum(['reported', 'did-not-meet', 'none', 'later', 'unreadable']),
  lastReport: z.object({ reportId: Uuid, date: Ymd, time: Text(10), didNotMeet: z.boolean(), attendees: z.array(Uuid).max(300),
    guests: z.number().int().min(0).max(999), serviceTimeId: Uuid.nullable(), editable: z.boolean(),
    blocked: z.enum(['multi-service', 'unkept-notes', 'member-left']).nullable() }).nullable() });
const FlowRow = z.object({ rowId: Uuid, flowId: Uuid, flowName: Text(120), stepId: Uuid, stepName: Text(120),
  stepOrder: z.number().int().min(0), personId: Uuid.nullable(), name: Text(120), due: Ymd.nullable(), assignedTo: Text(120) });
const push = <T extends z.ZodTypeAny>(row: T) =>
  z.object({ contractVersion: Version, consoleId: Uuid, takenAt: Iso, rows: z.array(row).max(5000) });
export const PUSH_SCHEMAS = { roster: push(RosterRow), services: push(ServiceRow), groups: push(GroupRow), flows: push(FlowRow) } satisfies Record<(typeof PUSH_KINDS)[number], z.ZodTypeAny>;
export const PushResponse = z.object({ applied: z.boolean(), rows: z.number().int().min(0).optional(),
  matched: z.object({ auto: z.number().int().min(0), ambiguous: z.number().int().min(0) }).optional() });

// ---- Error bodies (spec 3.1); extra fields (expected, details) pass through.
export const ErrorBody = z.object({ code: z.enum(SYNC_ERROR_CODES), message: z.string() }).passthrough();
