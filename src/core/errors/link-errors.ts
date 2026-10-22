// Elvanto link errors (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §3; contract §3.1 / §4.1).
// `extra` keys are spread into the JSON body by sendError, after code/message.
import { AppError } from './app-error';
import { LINK_CONTRACT_VERSION } from '../link-contract';

export class LinkUnavailable extends AppError {
  constructor() { super('LINK_UNAVAILABLE', 'Do this in Elvanto for now.', 409); }
}

/** Rev 6 (R1/R4): a DO NOT CONTACT flow person can only be removed from the step. */
export class LinkDnc extends AppError {
  constructor() { super('LINK_DNC', 'Do not contact: this person can only be removed from the step.', 409); }
}
/** Rev 6 (review C1): the New People consent step moves on through New youth & consent only. */
export class ConsentCheckFirst extends AppError {
  constructor() { super('CONSENT_CHECK_FIRST', 'Do the consent check first (New youth & consent).', 409); }
}
/** Y2a: no New People flow known (blank or unmatched peopleFlowPrefix): no step 0 can be told from the consent step (fail closed). */
export class ConsentFlowUnknown extends AppError {
  constructor() { super('CONSENT_FLOW_UNKNOWN', "Can't check consent. This year's New People flow wasn't found. Ask your admin.", 409); }
}
/** Rev 6 (R4): a Complete and a Remove for the same flow row cannot both be open. */
export class LinkBusyRow extends AppError {
  constructor() { super('LINK_BUSY_ROW', 'Something is already waiting to be sent for this person. Wait for it, or cancel it.', 409); }
}

export class LinkIdReused extends AppError {
  constructor() { super('LINK_ID_REUSED', 'This action id was already used for a different action.', 409); }
}

export class LinkEditInElvanto extends AppError {
  constructor(reason: string) {
    super('LINK_EDIT_IN_ELVANTO', 'Edit this report in Elvanto.', 409, { reason });
  }
}

export class LinkOpenDuplicate extends AppError {
  constructor(existingId: string) {
    super('LINK_DUPLICATE', 'This is already waiting to be sent.', 409, { existingId });
  }
}

/** Not an AppError: the repo found the id already stored (insert … on conflict (id) do nothing). The service re-reads
 *  the row and runs the replay / id-reuse check (APP-72). */
export class LinkIdExists extends Error {
  constructor(public readonly id: string) { super('link_outbox: id already stored'); this.name = 'LinkIdExists'; }
}

/** B4 / T-24: the opposite check row is still with the console (claimed or unclear). */
export class LinkStillSending extends AppError {
  constructor() { super('LINK_STILL_SENDING', 'Still sending, try again in a minute.', 409); }
}

/** B8 / T-39: the tap is older than the 3-day cut-off (APP-16). /link/batch only. */
export class LinkTooOld extends AppError {
  constructor() { super('LINK_TOO_OLD', 'Too late to send. Do it in Elvanto.', 409, { reason: 'too-old' }); }
}

/** B8 / T-39: someone else changed this person's check state after this tap. App-only reason `stale`. */
export class LinkStale extends AppError {
  constructor() { super('LINK_STALE', 'Someone else changed this after your tap. Reload.', 409, { reason: 'stale' }); }
}

/** X19 (T4): a Save / Text / consent Save against a plan older than 2 hours. */
export class IntakeStale extends AppError {
  constructor() { super('INTAKE_STALE', 'This plan is over 2 hours old. Refresh first.', 409); }
}

export class LinkNotYours extends AppError {
  constructor() { super('LINK_NOT_YOURS', 'Only the leader who sent this can undo it.', 403); }
}

// Messages for the /sync errors match src/tests/fixtures/elvanto-link/errors.json.
export class LinkOff extends AppError {
  constructor() { super('LINK_OFF', 'The YS link is off.', 503); }
}

export class LinkContractMismatch extends AppError {
  constructor() {
    super('LINK_CONTRACT_MISMATCH', 'Contract version mismatch.', 409, { expected: LINK_CONTRACT_VERSION });
  }
}

// Every /sync body or :kind error. Optional Zod-style `details`, like the generic VALIDATION_ERROR body.
export class SyncValidation extends AppError {
  constructor(details?: unknown[]) {
    super('VALIDATION_ERROR', 'Validation failed', 400, details ? { details } : undefined);
  }
}
