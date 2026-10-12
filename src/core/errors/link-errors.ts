// Elvanto link errors (spec docs/superpowers/specs/2026-10-12-elvanto-link-app-design.md §3; contract §3.1 / §4.1).
// `extra` keys are spread into the JSON body by sendError, after code/message.
import { AppError } from './app-error';
import { LINK_CONTRACT_VERSION } from '../link-contract';

export class LinkUnavailable extends AppError {
  constructor() { super('LINK_UNAVAILABLE', 'Do this in Elvanto for now.', 409); }
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

export class LinkTooLate extends AppError {
  constructor() { super('LINK_TOO_LATE', 'Too late: this has already been picked up.', 409); }
}

/** B4 / T-24: the opposite check row is still with the console (claimed or unclear). */
export class LinkStillSending extends AppError {
  constructor() { super('LINK_STILL_SENDING', 'Still sending, try again in a minute.', 409); }
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
