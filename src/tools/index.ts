import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { KnowledgeStore } from "../filesystem.js";
import { registerFileTools } from "./file.js";
import { registerSearchTools } from "./search.js";
import { registerWorkspaceTools } from "./workspace.js";

export function registerKnowledgeTools(server: McpServer, store: KnowledgeStore): void {
  registerWorkspaceTools(server, store);
  registerFileTools(server, store);
  registerSearchTools(server, store);
}
