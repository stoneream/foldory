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
}
