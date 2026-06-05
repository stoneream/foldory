#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { KnowledgeStore } from "./filesystem.js";
import { registerKnowledgeTools } from "./tools/index.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("foldory")
    .usage("Usage: $0 [--root] <knowledge-directory>")
    .option("root", {
      type: "string",
      describe: "Knowledge root directory (can also be set via FOLDORY_ROOT env var)",
    })
    .version(VERSION)
    .strict()
    .parseAsync();

  const positional = argv._.length > 0 ? String(argv._[0]) : undefined;
  const root = argv.root ?? positional ?? process.env.FOLDORY_ROOT;

  if (!root) {
    throw new Error("Knowledge root is required. Pass --root <directory> or set FOLDORY_ROOT.");
  }

  const store = await KnowledgeStore.create(expandHome(root));

  const server = new McpServer({
    name: "foldory",
    version: VERSION,
  });

  registerKnowledgeTools(server, store);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return process.env.HOME ?? inputPath;
  }
  if (inputPath.startsWith("~/")) {
    return path.join(process.env.HOME ?? "~", inputPath.slice(2));
  }
  return inputPath;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`foldory: ${message}\n`);
  process.exit(1);
});
