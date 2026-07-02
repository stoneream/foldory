import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { KnowledgeStore } from "../filesystem.js";
import { toToolResult, withToolErrorHandling } from "./result.js";

export function registerFileTools(server: McpServer, store: KnowledgeStore): void {
  server.registerTool(
    "read_files",
    {
      title: "Read files",
      description: "Read one or more UTF-8 text files from a workspace.",
      inputSchema: z.object({
        workspace: z.string().min(1),
        paths: z.array(z.string().min(1)).min(1).max(20),
      }),
    },
    async ({ workspace, paths }) =>
      withToolErrorHandling(async () => toToolResult({ files: await store.readFiles(workspace, paths) })),
  );

  server.registerTool(
    "write_file",
    {
      title: "Write file",
      description: "Overwrite or create a UTF-8 text file inside an existing workspace.",
      inputSchema: z.object({
        workspace: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
      }),
    },
    async ({ workspace, path, content }) =>
      withToolErrorHandling(async () => toToolResult(await store.writeFile(workspace, path, content))),
  );

  server.registerTool(
    "append_file",
    {
      title: "Append file",
      description:
        "Append UTF-8 text to a file inside an existing workspace, creating the file when it does not exist.",
      inputSchema: z.object({
        workspace: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
      }),
    },
    async ({ workspace, path, content }) =>
      withToolErrorHandling(async () => toToolResult(await store.appendFile(workspace, path, content))),
  );

  server.registerTool(
    "delete_file",
    {
      title: "Delete file",
      description: "Permanently delete a file from a workspace.",
      inputSchema: z.object({
        workspace: z.string().min(1),
        path: z.string().min(1),
      }),
    },
    async ({ workspace, path }) =>
      withToolErrorHandling(async () => toToolResult(await store.deleteFile(workspace, path))),
  );

  server.registerTool(
    "move_file",
    {
      title: "Move file",
      description:
        "Move or rename a file within or between workspaces. Fails if the destination file already exists.",
      inputSchema: z.object({
        workspace: z.string().min(1),
        path: z.string().min(1),
        dest_workspace: z.string().min(1),
        dest_path: z.string().min(1),
      }),
    },
    async ({ workspace, path, dest_workspace, dest_path }) =>
      withToolErrorHandling(async () =>
        toToolResult(await store.moveFile(workspace, path, dest_workspace, dest_path)),
      ),
  );
}
