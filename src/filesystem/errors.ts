export class KnowledgeAccessError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeAccessError";
  }
}

export function toKnowledgeError(error: unknown, code: string, message: string): KnowledgeAccessError {
  if (error instanceof KnowledgeAccessError) {
    return error;
  }

  return new KnowledgeAccessError(code, message);
}

export function isNodeErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
