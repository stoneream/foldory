import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import type { KnowledgeStore } from "../filesystem.js";
import { toToolResult, withToolErrorHandling } from "./result.js";

export function registerSearchTools(server: McpServer, store: KnowledgeStore): void {
  server.registerTool(
    "search_files",
    {
      title: "Search files",
      description:
        "Search UTF-8 text files with a plain substring query. Returns line previews, not full file contents.",
      inputSchema: z.object({
        query: z.string().min(1).max(256),
        workspace: z.string().min(1).optional(),
        case_sensitive: z.boolean().optional(),
        max_results: z.number().int().min(1).max(500).optional(),
      }),
    },
    async ({ query, workspace, case_sensitive, max_results }) =>
      withToolErrorHandling(async () =>
        toToolResult(
          await store.searchFiles({
            query,
            workspace,
            caseSensitive: case_sensitive,
            maxResults: max_results,
          }),
        ),
      ),
  );
}
