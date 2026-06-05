import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { KnowledgeAccessError } from "../filesystem.js";

type ToolErrorContent = {
  code: string;
  message: string;
};

export function toToolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

export async function withToolErrorHandling(handler: () => Promise<CallToolResult>): Promise<CallToolResult> {
  try {
    return await handler();
  } catch (error) {
    return toToolError(error);
  }
}

function toToolError(error: unknown): CallToolResult {
  const data = normalizeToolError(error);

  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(data, null, 2),
      },
    ],
    structuredContent: data,
  };
}

function normalizeToolError(error: unknown): ToolErrorContent {
  if (error instanceof KnowledgeAccessError) {
    return {
      code: error.code,
      message: safeKnowledgeAccessMessage(error.code),
    };
  }

  if (isNodeError(error)) {
    switch (error.code) {
      case "ENOENT":
        return {
          code: "not_found",
          message: "Requested workspace or file was not found.",
        };
      case "EACCES":
      case "EPERM":
        return {
          code: "access_denied",
          message: "Requested workspace or file is not accessible.",
        };
      case "ENOTDIR":
        return {
          code: "invalid_path",
          message: "Path must resolve through existing directories inside the workspace.",
        };
      case "EISDIR":
        return {
          code: "non_regular_file",
          message: "Path is not a regular file.",
        };
      default:
        break;
    }
  }

  return {
    code: "internal_error",
    message: "Unexpected internal error.",
  };
}

function safeKnowledgeAccessMessage(code: string): string {
  switch (code) {
    case "missing_root":
      return "Knowledge root is required.";
    case "invalid_root":
      return "Knowledge root must be a directory.";
    case "invalid_workspace":
      return "Workspace must be a root-level directory name.";
    case "workspace_not_found":
      return "Workspace was not found.";
    case "workspace_conflict":
      return "Workspace path already exists and is not a directory.";
    case "workspace_create_failed":
      return "Workspace could not be created.";
    case "invalid_path":
      return "Path must be a relative file path inside the workspace.";
    case "path_escape":
      return "Resolved path is outside the configured root or workspace.";
    case "non_regular_file":
      return "Path is not a regular file.";
    case "invalid_parent":
      return "Parent directory must already exist inside the workspace.";
    case "file_not_found":
      return "File was not found.";
    case "file_open_failed":
      return "File could not be opened.";
    case "file_stat_failed":
      return "File could not be inspected.";
    case "write_conflict":
      return "File changed while preparing the write.";
    case "empty_file_list":
      return "At least one file path is required.";
    case "too_many_files":
      return "Too many files were requested.";
    case "file_too_large":
      return "File content exceeds the configured size limit.";
    case "binary_file":
      return "File is not valid UTF-8 text.";
    case "empty_query":
      return "Search query is required.";
    case "query_too_long":
      return "Search query is too long.";
    case "root_read_failed":
      return "Knowledge root directory could not be read.";
    default:
      return "Request could not be completed.";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}
