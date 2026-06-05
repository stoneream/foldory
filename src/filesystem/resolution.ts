import type { Stats } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { KnowledgeAccessError, isNodeErrorCode, toKnowledgeError } from "./errors.js";
import { assertWithin, normalizeFilePath, normalizeWorkspaceName } from "./path-safety.js";
import type { FileResolution, WorkspaceResolution, WritableFileResolution } from "./types.js";

export async function resolveWorkspace(rootPath: string, workspaceName: string): Promise<WorkspaceResolution> {
  const name = normalizeWorkspaceName(workspaceName);
  const candidate = path.join(rootPath, name);

  let workspaceLstat: Stats;
  try {
    workspaceLstat = await lstat(candidate);
  } catch (error) {
    throw toKnowledgeError(error, "workspace_not_found", `Workspace not found: ${name}`);
  }

  if (workspaceLstat.isSymbolicLink()) {
    throw new KnowledgeAccessError("invalid_workspace", `Workspace must not be a symbolic link: ${name}`);
  }
  if (!workspaceLstat.isDirectory()) {
    throw new KnowledgeAccessError("invalid_workspace", `Workspace is not a regular directory: ${name}`);
  }

  let workspaceRealPath: string;
  try {
    workspaceRealPath = await realpath(candidate);
  } catch (error) {
    throw toKnowledgeError(error, "workspace_not_found", `Workspace not found: ${name}`);
  }

  assertWithin(workspaceRealPath, rootPath, "root");

  let workspaceStat: Stats;
  try {
    workspaceStat = await stat(workspaceRealPath);
  } catch (error) {
    throw toKnowledgeError(error, "workspace_not_found", `Workspace not found: ${name}`);
  }

  if (!workspaceStat.isDirectory()) {
    throw new KnowledgeAccessError("invalid_workspace", `Workspace is not a directory: ${name}`);
  }

  return {
    name,
    realPath: workspaceRealPath,
  };
}

export async function resolveExistingFile(
  rootPath: string,
  workspaceName: string,
  filePath: string,
): Promise<FileResolution> {
  const workspace = await resolveWorkspace(rootPath, workspaceName);
  const normalizedPath = normalizeFilePath(filePath);
  const candidate = path.join(workspace.realPath, normalizedPath);

  let realFilePath: string;
  try {
    realFilePath = await realpath(candidate);
  } catch (error) {
    throw toKnowledgeError(error, "file_not_found", `File not found: ${normalizedPath}`);
  }

  assertWithin(realFilePath, rootPath, "root");
  assertWithin(realFilePath, workspace.realPath, "workspace");

  let fileStat: Stats;
  try {
    fileStat = await stat(realFilePath);
  } catch (error) {
    throw toKnowledgeError(error, "file_not_found", `File not found: ${normalizedPath}`);
  }

  if (!fileStat.isFile()) {
    throw new KnowledgeAccessError("non_regular_file", `Path is not a regular file: ${normalizedPath}`);
  }

  return {
    normalizedPath,
    realPath: realFilePath,
    workspaceRealPath: workspace.realPath,
    stat: fileStat,
  };
}

export async function resolveWritableFile(
  rootPath: string,
  workspaceName: string,
  filePath: string,
): Promise<WritableFileResolution> {
  const workspace = await resolveWorkspace(rootPath, workspaceName);
  const normalizedPath = normalizeFilePath(filePath);
  const candidate = path.join(workspace.realPath, normalizedPath);

  try {
    const existingLstat = await lstat(candidate);
    if (!existingLstat.isFile() && !existingLstat.isSymbolicLink()) {
      throw new KnowledgeAccessError("non_regular_file", `Path is not a regular file: ${normalizedPath}`);
    }

    let realFilePath: string;
    try {
      realFilePath = await realpath(candidate);
    } catch (error) {
      throw toKnowledgeError(error, "file_not_found", `File not found: ${normalizedPath}`);
    }

    assertWithin(realFilePath, rootPath, "root");
    assertWithin(realFilePath, workspace.realPath, "workspace");

    let fileStat: Stats;
    try {
      fileStat = await stat(realFilePath);
    } catch (error) {
      throw toKnowledgeError(error, "file_not_found", `File not found: ${normalizedPath}`);
    }

    if (!fileStat.isFile()) {
      throw new KnowledgeAccessError("non_regular_file", `Path is not a regular file: ${normalizedPath}`);
    }

    return {
      normalizedPath,
      writePath: realFilePath,
      workspaceRealPath: workspace.realPath,
      created: false,
      stat: fileStat,
    };
  } catch (error) {
    if (!isNodeErrorCode(error, "ENOENT")) {
      throw toKnowledgeError(error, "file_stat_failed", `Could not inspect file: ${normalizedPath}`);
    }
  }

  const parentPath = path.dirname(candidate);
  let parentRealPath: string;
  try {
    parentRealPath = await realpath(parentPath);
  } catch (error) {
    throw toKnowledgeError(
      error,
      "invalid_parent",
      `Parent directory does not exist: ${path.dirname(normalizedPath)}`,
    );
  }

  assertWithin(parentRealPath, rootPath, "root");
  assertWithin(parentRealPath, workspace.realPath, "workspace");

  let parentStat: Stats;
  try {
    parentStat = await stat(parentRealPath);
  } catch (error) {
    throw toKnowledgeError(
      error,
      "invalid_parent",
      `Parent directory does not exist: ${path.dirname(normalizedPath)}`,
    );
  }

  if (!parentStat.isDirectory()) {
    throw new KnowledgeAccessError("invalid_parent", `Parent is not a directory: ${path.dirname(normalizedPath)}`);
  }

  return {
    normalizedPath,
    writePath: path.join(parentRealPath, path.basename(normalizedPath)),
    workspaceRealPath: workspace.realPath,
    created: true,
    stat: null,
  };
}
