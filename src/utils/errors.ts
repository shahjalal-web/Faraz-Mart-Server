interface MongoDuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(error: unknown): error is MongoDuplicateKeyError {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/** Thrown from route helpers/hooks to short-circuit with a specific status + message. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Turns a Mongoose/MongoDB error into a message safe to show an admin. */
export function errorMessage(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? "value";
    return `That ${field} is already in use.`;
  }
  if (error instanceof Error && error.name === "ValidationError") {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** Status code that goes with errorMessage(): explicit for HttpError, 400 for validation/duplicates, else 500. */
export function errorStatus(error: unknown): number {
  if (error instanceof HttpError) return error.status;
  if (isDuplicateKeyError(error)) return 409;
  if (error instanceof Error && error.name === "ValidationError") return 400;
  return 500;
}
