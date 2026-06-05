import type { Stats } from "node:fs";

import type { FileEntry } from "./types.js";

export function toFileEntry(filePath: string, fileStat: Stats): FileEntry {
  return {
    path: filePath,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
  };
}
