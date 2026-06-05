import type { Stats } from "node:fs";
import path from "node:path";

import { KnowledgeAccessError } from "./errors.js";

export function normalizeWorkspaceName(workspaceName: string): string {
  if (!workspaceName || workspaceName === "." || workspaceName === "..") {
    throw new KnowledgeAccessError("invalid_workspace", "Workspace name must be a root-level directory name.");
  }
  assertRelativePathText(workspaceName, "workspace");

  if (workspaceName.includes("/") || workspaceName.includes("\\")) {
    throw new KnowledgeAccessError("invalid_workspace", "Workspace name cannot contain path separators.");
  }

  return workspaceName;
}

export function normalizeFilePath(filePath: string): string {
  if (!filePath) {
    throw new KnowledgeAccessError("invalid_path", "File path is required.");
  }
  assertRelativePathText(filePath, "file path");

  const normalizedPath = path.normalize(filePath);
  if (normalizedPath === "." || normalizedPath.startsWith("..") || path.isAbsolute(normalizedPath)) {
    throw new KnowledgeAccessError("invalid_path", `File path must stay inside the workspace: ${filePath}`);
  }

  const parts = normalizedPath.split(path.sep);
  if (parts.includes("..")) {
    throw new KnowledgeAccessError("invalid_path", `File path must not contain '..': ${filePath}`);
  }

  return normalizedPath;
}

export function assertWithin(targetPath: string, basePath: string, label: string): void {
  if (!isWithin(targetPath, basePath)) {
    throw new KnowledgeAccessError("path_escape", `Resolved path is outside the configured ${label}.`);
  }
}

export function isWithin(targetPath: string, basePath: string): boolean {
  const relativePath = path.relative(basePath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

export function assertSameFile(expected: Stats, actual: Stats, normalizedPath: string): void {
  if (expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new KnowledgeAccessError("write_conflict", `File identity changed during operation: ${normalizedPath}`);
  }
}

function assertRelativePathText(value: string, label: string): void {
  if (value.includes("\0")) {
    throw new KnowledgeAccessError("invalid_path", `${label} cannot contain null bytes.`);
  }
  if (path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\")) {
    throw new KnowledgeAccessError("invalid_path", `${label} must be a relative path.`);
  }
  if (value.includes("\\")) {
    throw new KnowledgeAccessError("invalid_path", `${label} must use '/' as the path separator.`);
  }
}
