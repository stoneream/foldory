import type { FileHandle } from "node:fs/promises";

import { KnowledgeAccessError } from "./errors.js";
import type { SearchMatch } from "./types.js";

const READ_CHUNK_BYTES = 64 * 1024;

export async function readFileHandleWithLimit(
  fileHandle: FileHandle,
  maxBytes: number,
  filePath: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  let position = 0;

  while (totalBytes <= maxBytes) {
    const bytesToRead = Math.min(READ_CHUNK_BYTES, Math.max(1, maxBytes + 1 - totalBytes));
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, position);

    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes);
    }

    totalBytes += bytesRead;
    position += bytesRead;
    chunks.push(buffer.subarray(0, bytesRead));

    if (totalBytes > maxBytes) {
      throw new KnowledgeAccessError("file_too_large", `File exceeds the ${maxBytes} byte limit: ${filePath}`);
    }
  }

  throw new KnowledgeAccessError("file_too_large", `File exceeds the ${maxBytes} byte limit: ${filePath}`);
}

export function decodeText(content: Buffer, filePath: string): string {
  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throw new KnowledgeAccessError("binary_file", `File is not valid UTF-8 text: ${filePath}`);
  }

  let controlCharacters = 0;
  for (const character of decoded) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint < 32 && character !== "\n" && character !== "\r" && character !== "\t" && character !== "\f") {
      controlCharacters += 1;
    }
  }

  if (decoded.length > 0 && controlCharacters / decoded.length > 0.05) {
    throw new KnowledgeAccessError("binary_file", `File appears to be binary: ${filePath}`);
  }

  return decoded;
}

export function findMatches(
  content: string,
  query: string,
  caseSensitive: boolean,
): Array<Pick<SearchMatch, "line" | "column" | "preview">> {
  const needle = caseSensitive ? query : query.toLowerCase();
  const lines = content.split(/\r\n|\n|\r/u);
  const matches: Array<Pick<SearchMatch, "line" | "column" | "preview">> = [];

  for (const [index, line] of lines.entries()) {
    const haystack = caseSensitive ? line : line.toLowerCase();
    const matchIndex = haystack.indexOf(needle);
    if (matchIndex === -1) {
      continue;
    }

    matches.push({
      line: index + 1,
      column: matchIndex + 1,
      preview: clipPreview(line, matchIndex, query.length),
    });
  }

  return matches;
}

function clipPreview(line: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - 80);
  const end = Math.min(line.length, matchIndex + matchLength + 160);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";
  return `${prefix}${line.slice(start, end)}${suffix}`;
}
