export type ErrorCode =
  | "CAPABILITY_UNAVAILABLE"
  | "FILE_INVALID"
  | "PROCESSING_FAILED"
  | "STORAGE_FAILED"
  | "UNKNOWN";

export type SerializedAppError = {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    options?: {
      readonly cause?: unknown;
      readonly details?: Readonly<Record<string, unknown>>;
    },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.details = options?.details;
  }

  toJSON(): SerializedAppError {
    return {
      code: this.code,
      message: this.message,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

export function normalizeError(error: unknown, fallback = "Something went wrong."): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof Error) {
    return new AppError("UNKNOWN", error.message || fallback, { cause: error });
  }
  return new AppError("UNKNOWN", fallback, { details: { received: String(error) } });
}
