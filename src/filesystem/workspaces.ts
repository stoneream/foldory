import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { KnowledgeAccessError, toKnowledgeError } from "./errors.js";
import { toFileEntry } from "./file-entry.js";
import { clampInteger } from "./options.js";
import { assertWithin, isWithin } from "./path-safety.js";
import { resolveWorkspace } from "./resolution.js";
import type {
  FileEntry,
  ListFilesOptions,
  ListFilesResult,
  ResolvedStoreOptions,
  WorkspaceEntry,
} from "./types.js";

export async function listWorkspaces(rootPath: string): Promise<WorkspaceEntry[]> {
  let entries;
  try {
    entries = await readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    throw toKnowledgeError(error, "root_read_failed", "Could not list the knowledge root directory.");
  }

  const workspaces: WorkspaceEntry[] = [];

  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") {
      continue;
    }

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      workspaces.push({ name: entry.name });
    }
  }

  return workspaces.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listFiles(
  rootPath: string,
  workspaceName: string,
  options: ListFilesOptions,
  storeOptions: ResolvedStoreOptions,
): Promise<ListFilesResult> {
  const workspace = await resolveWorkspace(rootPath, workspaceName);
  const recursive = options.recursive ?? true;
  const maxFiles = clampInteger(options.maxFiles ?? storeOptions.maxListFiles, 1, storeOptions.maxListFiles);
  const files: FileEntry[] = [];
  const skipped = {
    inaccessible: 0,
    unsafeSymlink: 0,
    nonRegular: 0,
  };
  const visitedDirectories = new Set<string>();
  let truncated = false;
  let directoriesVisited = 0;

  const visit = async (directoryPath: string, displayPrefix: string): Promise<void> => {
    if (truncated) {
      return;
    }

    let realDirectoryPath: string;
    try {
      realDirectoryPath = await realpath(directoryPath);
      assertWithin(realDirectoryPath, rootPath, "root");
      assertWithin(realDirectoryPath, workspace.realPath, "workspace");
    } catch (error) {
      if (error instanceof KnowledgeAccessError && error.code === "path_escape") {
        skipped.unsafeSymlink += 1;
      } else {
        skipped.inaccessible += 1;
      }
      return;
    }

    if (visitedDirectories.has(realDirectoryPath)) {
      return;
    }
    visitedDirectories.add(realDirectoryPath);

    directoriesVisited += 1;
    if (directoriesVisited > storeOptions.maxListDirectories) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(realDirectoryPath, { withFileTypes: true });
    } catch {
      skipped.inaccessible += 1;
      return;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (truncated) {
        return;
      }

      const childPath = path.join(realDirectoryPath, entry.name);
      const displayPath = displayPrefix ? `${displayPrefix}/${entry.name}` : entry.name;

      try {
        if (entry.isSymbolicLink()) {
          const realFilePath = await realpath(childPath);
          if (!isWithin(realFilePath, rootPath) || !isWithin(realFilePath, workspace.realPath)) {
            skipped.unsafeSymlink += 1;
            continue;
          }

          const fileStat = await stat(realFilePath);
          if (fileStat.isFile()) {
            files.push(toFileEntry(displayPath, fileStat));
          } else {
            skipped.nonRegular += 1;
            continue;
          }
        } else if (entry.isDirectory()) {
          if (recursive) {
            await visit(childPath, displayPath);
          }
          continue;
        } else if (entry.isFile()) {
          files.push(toFileEntry(displayPath, await stat(childPath)));
        } else {
          skipped.nonRegular += 1;
        }

        if (files.length >= maxFiles) {
          truncated = true;
        }
      } catch {
        skipped.inaccessible += 1;
      }
    }
  };

  await visit(workspace.realPath, "");

  return {
    workspace: workspace.name,
    files,
    truncated,
    skipped,
  };
}
