import { KnowledgeAccessError } from "./errors.js";
import type { ResolvedStoreOptions, StoreOptions } from "./types.js";

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_READ_FILES = 20;
const DEFAULT_MAX_LIST_FILES = 1000;
const DEFAULT_MAX_LIST_DIRECTORIES = 1000;
const DEFAULT_MAX_SEARCH_FILES = 5000;
const DEFAULT_MAX_SEARCH_RESULTS = 100;
const DEFAULT_MAX_SEARCH_WORKSPACES = 100;

export const MAX_QUERY_LENGTH = 256;

export function resolveStoreOptions(options: StoreOptions): ResolvedStoreOptions {
  return {
    maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
    maxReadFiles: options.maxReadFiles ?? DEFAULT_MAX_READ_FILES,
    maxListFiles: options.maxListFiles ?? DEFAULT_MAX_LIST_FILES,
    maxListDirectories: options.maxListDirectories ?? DEFAULT_MAX_LIST_DIRECTORIES,
    maxSearchFiles: options.maxSearchFiles ?? DEFAULT_MAX_SEARCH_FILES,
    maxSearchResults: options.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS,
    maxSearchWorkspaces: options.maxSearchWorkspaces ?? DEFAULT_MAX_SEARCH_WORKSPACES,
  };
}

export function assertTextSize(content: string, maxFileBytes: number): void {
  if (Buffer.byteLength(content, "utf8") > maxFileBytes) {
    throw new KnowledgeAccessError("file_too_large", `Content exceeds the ${maxFileBytes} byte limit.`);
  }
}

export function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isInteger(value)) {
    throw new KnowledgeAccessError("invalid_number", "Numeric limits must be integers.");
  }
  return Math.min(Math.max(value, min), max);
}
