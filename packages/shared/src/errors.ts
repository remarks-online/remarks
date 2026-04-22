export class RemarksError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
    // Whether `message` is safe to surface to API clients. Controls whether
    // the error handler returns this message or a generic fallback.
    public readonly exposed: boolean,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

export class ValidationError extends RemarksError {
  constructor(
    message: string,
    public readonly issues?: unknown
  ) {
    super(message, "VALIDATION_ERROR", 400, true);
  }
}

export class UnauthorizedError extends RemarksError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401, true);
  }
}

export class ForbiddenError extends RemarksError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403, true);
  }
}

export class NotFoundError extends RemarksError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404, true);
  }
}

export class ConflictError extends RemarksError {
  constructor(message: string) {
    super(message, "CONFLICT", 409, true);
  }
}

export class RateLimitError extends RemarksError {
  constructor(message = "Rate limit exceeded") {
    super(message, "RATE_LIMIT", 429, true);
  }
}

export class InternalError extends RemarksError {
  constructor(message: string, cause?: unknown) {
    super(message, "INTERNAL_ERROR", 500, false, { cause });
  }
}
