export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHENTICATED"
  | "REAUTH_REQUIRED"
  | "NOT_AUTHORIZED"
  | "NOT_FOUND"
  | "STATE_CONFLICT"
  | "SEALED_RECORD_IMMUTABLE"
  | "IDEMPOTENCY_CONFLICT"
  | "ROSTER_FROZEN"
  | "COHORT_NOT_CLOSABLE"
  | "FILE_TOO_LARGE"
  | "INVALID_OBSERVATION"
  | "INVALID_SIGNATURE"
  | "INVALID_MEDIA_HASH"
  | "COHORT_LOCKED"
  | "RATE_LIMITED"
  | "CHAIN_UNAVAILABLE"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 401,
  NOT_AUTHORIZED: 403,
  NOT_FOUND: 404,
  STATE_CONFLICT: 409,
  SEALED_RECORD_IMMUTABLE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  ROSTER_FROZEN: 409,
  COHORT_NOT_CLOSABLE: 409,
  FILE_TOO_LARGE: 413,
  INVALID_OBSERVATION: 422,
  INVALID_SIGNATURE: 422,
  INVALID_MEDIA_HASH: 422,
  COHORT_LOCKED: 423,
  RATE_LIMITED: 429,
  CHAIN_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.status = STATUS[code];
  }
  get retryable(): boolean {
    return this.status >= 500 || this.status === 429;
  }
}

export const notFound = (): ApiError => new ApiError("NOT_FOUND", "Not found");
export const forbidden = (msg = "You do not have permission for this action"): ApiError => new ApiError("NOT_AUTHORIZED", msg);
