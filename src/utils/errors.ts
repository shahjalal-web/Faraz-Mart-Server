interface MongoDuplicateKeyError {
  code: number;
  keyPattern?: Record<string, unknown>;
}

function isDuplicateKeyError(error: unknown): error is MongoDuplicateKeyError {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === 11000;
}

/** Turns a Mongoose/MongoDB error into a message safe to show an admin. */
export function errorMessage(error: unknown): string {
  if (isDuplicateKeyError(error)) {
    const field = Object.keys(error.keyPattern ?? {})[0] ?? "value";
    return `That ${field} is already in use.`;
  }
  if (error instanceof Error && error.name === "ValidationError") {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}
