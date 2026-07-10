export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message, 404);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message, 403);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super('UNAUTHORIZED', message, 401);
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Bad request') {
    super('BAD_REQUEST', message, 400);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Conflict') {
    super('CONFLICT', message, 409);
  }
}

export class MustChangePasswordError extends AppError {
  constructor(message = 'Password must be changed before continuing') {
    super('MUST_CHANGE_PASSWORD', message, 403);
  }
}

// A ministryConfig.modules.* flag is off for this deployment. 404-shaped (not
// 403) since a disabled module's routes should read as "doesn't exist here",
// not "you're not allowed" — matching design doc 03 §4's toggle semantics.
export class ModuleDisabledError extends AppError {
  constructor(module: string) {
    super('MODULE_DISABLED', `${module} is disabled for this deployment`, 404);
  }
}
