import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { KnowledgeStore } from "../filesystem.js";
import { toToolResult, withToolErrorHandling } from "./result.js";

export function registerWorkspaceTools(server: McpServer, store: KnowledgeStore): void {
  server.registerTool(
    "list_workspaces",
    {
      title: "List workspaces",
      description: "List root-level workspace directories under the configured knowledge root.",
      inputSchema: z.object({}),
    },
    async () => withToolErrorHandling(async () => toToolResult({ workspaces: await store.listWorkspaces() })),
  );

  server.registerTool(
    "create_workspace",
    {
      title: "Create workspace",
      description: "Create a root-level workspace directory under the configured knowledge root.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => withToolErrorHandling(async () => toToolResult(await store.createWorkspace(name))),
  );

  server.registerTool(
    "list_files",
    {
      title: "List files",
      description: "List regular files inside a workspace.",
      inputSchema: z.object({
        workspace: z.string().min(1),
        recursive: z.boolean().optional(),
        max_files: z.number().int().min(1).max(1000).optional(),
      }),
    },
    async ({ workspace, recursive, max_files }) =>
      withToolErrorHandling(async () =>
        toToolResult(await store.listFiles(workspace, { recursive, maxFiles: max_files })),
      ),
  );

  server.registerTool(
    "delete_workspace",
    {
      title: "Delete workspace",
      description: "Permanently delete a workspace and all its contents.",
      inputSchema: z.object({
        name: z.string().min(1),
      }),
    },
    async ({ name }) => withToolErrorHandling(async () => toToolResult(await store.deleteWorkspace(name))),
  );

  server.registerTool(
    "rename_workspace",
    {
      title: "Rename workspace",
      description: "Rename a workspace. Fails if the new name is already taken.",
      inputSchema: z.object({
        name: z.string().min(1),
        new_name: z.string().min(1),
      }),
    },
    async ({ name, new_name }) =>
      withToolErrorHandling(async () => toToolResult(await store.renameWorkspace(name, new_name))),
  );
}
