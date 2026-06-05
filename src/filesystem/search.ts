import { KnowledgeAccessError } from "./errors.js";
import { readTextFile } from "./file-io.js";
import { clampInteger, MAX_QUERY_LENGTH } from "./options.js";
import { resolveExistingFile, resolveWorkspace } from "./resolution.js";
import { findMatches } from "./text.js";
import { listFiles, listWorkspaces } from "./workspaces.js";
import type {
  FileResolution,
  ResolvedStoreOptions,
  SearchFilesOptions,
  SearchFilesResult,
  SearchMatch,
  WorkspaceResolution,
} from "./types.js";

export async function searchFiles(
  rootPath: string,
  options: SearchFilesOptions,
  storeOptions: ResolvedStoreOptions,
): Promise<SearchFilesResult> {
  const query = options.query;
  if (!query) {
    throw new KnowledgeAccessError("empty_query", "Search query is required.");
  }
  if (query.length > MAX_QUERY_LENGTH) {
    throw new KnowledgeAccessError("query_too_long", `Search query exceeds ${MAX_QUERY_LENGTH} characters.`);
  }

  const maxResults = clampInteger(options.maxResults ?? storeOptions.maxSearchResults, 1, 500);
  const workspaces = options.workspace
    ? [await resolveWorkspace(rootPath, options.workspace)]
    : await resolveAllWorkspaces(rootPath);

  const matches: SearchMatch[] = [];
  const skipped = {
    tooLarge: 0,
    binary: 0,
    inaccessible: 0,
  };
  let filesScanned = 0;
  let truncated = false;

  if (workspaces.length > storeOptions.maxSearchWorkspaces) {
    workspaces.splice(storeOptions.maxSearchWorkspaces);
    truncated = true;
  }

  let remainingSearchFiles = storeOptions.maxSearchFiles;

  for (const [workspaceIndex, workspace] of workspaces.entries()) {
    if (truncated) {
      break;
    }

    if (remainingSearchFiles <= 0) {
      truncated = true;
      break;
    }

    const listedFiles = await listFiles(
      rootPath,
      workspace.name,
      { recursive: true, maxFiles: remainingSearchFiles },
      storeOptions,
    );
    remainingSearchFiles -= listedFiles.files.length;
    if (listedFiles.truncated || (remainingSearchFiles <= 0 && workspaceIndex < workspaces.length - 1)) {
      truncated = true;
    }

    for (const file of listedFiles.files) {
      if (matches.length >= maxResults) {
        truncated = true;
        break;
      }

      let resolvedFile: FileResolution;
      try {
        resolvedFile = await resolveExistingFile(rootPath, workspace.name, file.path);
        if (resolvedFile.stat.size > storeOptions.maxFileBytes) {
          skipped.tooLarge += 1;
          continue;
        }
      } catch {
        skipped.inaccessible += 1;
        continue;
      }

      let content: string;
      try {
        content = (await readTextFile(resolvedFile, storeOptions.maxFileBytes)).content;
      } catch (error) {
        if (error instanceof KnowledgeAccessError && error.code === "binary_file") {
          skipped.binary += 1;
        } else if (error instanceof KnowledgeAccessError && error.code === "file_too_large") {
          skipped.tooLarge += 1;
        } else {
          skipped.inaccessible += 1;
        }
        continue;
      }

      filesScanned += 1;
      const fileMatches = findMatches(content, query, options.caseSensitive ?? false).map((match) => ({
        workspace: workspace.name,
        path: file.path,
        ...match,
      }));

      for (const match of fileMatches) {
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
        matches.push(match);
      }
    }
  }

  return {
    query,
    matches,
    truncated,
    filesScanned,
    skipped,
  };
}

async function resolveAllWorkspaces(rootPath: string): Promise<WorkspaceResolution[]> {
  const workspaces = await listWorkspaces(rootPath);
  const resolved: WorkspaceResolution[] = [];

  for (const workspace of workspaces) {
    resolved.push(await resolveWorkspace(rootPath, workspace.name));
  }

  return resolved;
}
