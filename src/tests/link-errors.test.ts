import { describe, it, expect } from 'vitest';
import type { Response } from 'express';
import { AppError, ConflictError } from '../core/errors/app-error';
import {
  LinkUnavailable, LinkIdReused, LinkEditInElvanto, LinkOpenDuplicate, LinkTooLate, LinkNotYours, LinkOff,
  LinkContractMismatch, SyncValidation,
} from '../core/errors/link-errors';
import { sendError } from '../api/middleware/error.middleware';
import { ErrorBody } from '../core/link-contract';
import type { ActionType, Capabilities } from '../core/link-types';

function fakeRes() {
  const out: { status?: number; body?: unknown } = {};
  const res = {
    status(s: number) { out.status = s; return res; },
    json(b: unknown) { out.body = b; return res; },
  };
  return { res: res as unknown as Response, out };
}

describe('link errors: status, code, message', () => {
  const cases: [AppError, number, string, string | null][] = [
    [new LinkUnavailable(), 409, 'LINK_UNAVAILABLE', 'Do this in Elvanto for now.'],
    [new LinkIdReused(), 409, 'LINK_ID_REUSED', null],
    [new LinkEditInElvanto('member-left'), 409, 'LINK_EDIT_IN_ELVANTO', null],
    [new LinkOpenDuplicate('x'), 409, 'LINK_DUPLICATE', null],
    [new LinkTooLate(), 409, 'LINK_TOO_LATE', null],
    [new LinkNotYours(), 403, 'LINK_NOT_YOURS', 'Only the leader who sent this can undo it.'],
    [new LinkOff(), 503, 'LINK_OFF', null],
    [new LinkContractMismatch(), 409, 'LINK_CONTRACT_MISMATCH', null],
    [new SyncValidation(), 400, 'VALIDATION_ERROR', null],
  ];
  for (const [err, status, code, message] of cases) {
    it(code, () => {
      expect(err).toBeInstanceOf(AppError);
      expect(err.statusCode).toBe(status);
      expect(err.code).toBe(code);
      expect(err.message.length).toBeGreaterThan(0);
      if (message) expect(err.message).toBe(message);
    });
  }
  it('extras', () => {
    expect(new LinkEditInElvanto('member-left').extra).toEqual({ reason: 'member-left' });
    expect(new LinkOpenDuplicate('x').extra).toEqual({ existingId: 'x' });
    expect(new LinkContractMismatch().extra).toEqual({ expected: 1 });
  });
});

describe('sendError with extra', () => {
  it('spreads extra into the body', () => {
    const { res, out } = fakeRes();
    const err = new LinkOpenDuplicate('x');
    sendError(res, err);
    expect(out.status).toBe(409);
    expect(out.body).toEqual({ code: 'LINK_DUPLICATE', message: err.message, existingId: 'x' });
  });
  it('extra cannot overwrite code or message', () => {
    const { res, out } = fakeRes();
    sendError(res, new AppError('A', 'm', 400, { code: 'B', message: 'n', other: 1 }));
    expect(out.body).toEqual({ code: 'A', message: 'm', other: 1 });
  });
  it('a plain AppError body is unchanged (no new keys)', () => {
    const { res, out } = fakeRes();
    sendError(res, new ConflictError('nope'));
    expect(out.body).toEqual({ code: 'CONFLICT', message: 'nope' });
    expect(Object.keys(out.body as object)).toEqual(['code', 'message']);
  });
  it('LinkContractMismatch and SyncValidation bodies parse with ErrorBody', () => {
    for (const err of [new LinkContractMismatch(), new SyncValidation(), new LinkOff()]) {
      const { res, out } = fakeRes();
      sendError(res, err);
      expect(ErrorBody.safeParse(out.body).success).toBe(true);
    }
    const { res, out } = fakeRes();
    sendError(res, new LinkContractMismatch());
    expect((out.body as { expected: number }).expected).toBe(1);
  });
});

describe('link types (compile-only)', () => {
  it('compiles', () => {
    const t: ActionType = 'checkIn';
    const c: Capabilities = {
      checkIn: 'live', checkOut: 'shadow', submitReport: 'locked', editReport: 'off', completeStep: 'live',
      firstTimerCheckIn: 'live',
    };
    expect(t).toBe('checkIn');
    expect(Object.keys(c)).toHaveLength(6);
  });
});
