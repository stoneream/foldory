#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import path from "node:path";
import process from "node:process";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { ensureDirectory, KnowledgeStore } from "./filesystem.js";
import { registerKnowledgeTools } from "./tools/index.js";

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as { version: string };

const DEFAULT_ROOT = "~/knowledge";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 7340;
const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
const ENDPOINT_PATH = "/mcp";

type ActiveRequest = {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
};

async function main(): Promise<void> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName("foldory")
    .usage("Usage: $0 [--root] [--host] [--port] [knowledge-directory]")
    .option("root", {
      type: "string",
      describe: "Knowledge root directory (default: ~/knowledge; can also be set via FOLDORY_ROOT env var)",
    })
    .option("host", {
      type: "string",
      describe: "HTTP host to bind to (127.0.0.1, localhost, or ::1; can also be set via FOLDORY_HOST)",
    })
    .option("port", {
      type: "number",
      describe: "HTTP port to bind to (can also be set via FOLDORY_PORT)",
    })
    .version(VERSION)
    .strict()
    .parseAsync();

  const positional = argv._.length > 0 ? String(argv._[0]) : undefined;
  const configuredRoot = argv.root ?? positional ?? process.env.FOLDORY_ROOT;
  const root = configuredRoot ?? DEFAULT_ROOT;
  const host = parseHost(argv.host ?? process.env.FOLDORY_HOST ?? DEFAULT_HOST);
  const port = parsePort(argv.port ?? process.env.FOLDORY_PORT ?? DEFAULT_PORT);

  const expandedRoot = expandHome(root);
  if (configuredRoot === undefined) {
    await ensureDirectory(expandedRoot);
  }

  const store = await KnowledgeStore.create(expandedRoot);
  const activeRequests = new Set<ActiveRequest>();
  const httpServer = createServer((req, res) => {
    void handleHttpRequest(req, res, store, activeRequests);
  });

  const actualPort = await listen(httpServer, host, port);
  const url = `http://${formatUrlHost(host)}:${actualPort}${ENDPOINT_PATH}`;
  process.stdout.write(`foldory: MCP HTTP server listening at ${url}\n`);

  setupShutdownHandlers(httpServer, activeRequests);
}

function createMcpServer(store: KnowledgeStore): McpServer {
  const server = new McpServer({
    name: "foldory",
    version: VERSION,
  });

  registerKnowledgeTools(server, store);
  return server;
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  store: KnowledgeStore,
  activeRequests: Set<ActiveRequest>,
): Promise<void> {
  if (!isAllowedHostHeader(req.headers.host)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  const pathname = getRequestPath(req);
  if (pathname !== ENDPOINT_PATH) {
    sendText(res, 404, "Not Found");
    return;
  }

  if (req.method !== "POST") {
    sendText(res, 405, "Method Not Allowed", { Allow: "POST" });
    return;
  }

  const mcpServer = createMcpServer(store);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const activeRequest = { server: mcpServer, transport };
  activeRequests.add(activeRequest);

  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res);
  } catch (error) {
    process.stderr.write(`foldory: ${formatError(error)}\n`);
    sendJsonRpcInternalError(res);
  } finally {
    activeRequests.delete(activeRequest);
    await Promise.allSettled([mcpServer.close(), transport.close()]);
  }
}

function listen(server: Server, host: string, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.off("error", onError);
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        resolve((address as AddressInfo).port);
        return;
      }
      reject(new Error("Unable to determine listening port."));
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function setupShutdownHandlers(server: Server, activeRequests: Set<ActiveRequest>): void {
  let shuttingDown = false;

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    void shutdownHttpServer(server, activeRequests).then(
      () => {
        process.exit(0);
      },
      (error: unknown) => {
        process.stderr.write(`foldory: failed to shut down after ${signal}: ${formatError(error)}\n`);
        process.exit(1);
      },
    );
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function shutdownHttpServer(server: Server, activeRequests: Set<ActiveRequest>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  await Promise.allSettled(
    Array.from(activeRequests, async (activeRequest) => {
      await Promise.allSettled([activeRequest.server.close(), activeRequest.transport.close()]);
    }),
  );
}

function parseHost(value: string): string {
  const host = value.trim();
  if (!ALLOWED_LOCAL_HOSTS.has(host)) {
    throw new Error("Host must be one of 127.0.0.1, localhost, or ::1.");
  }
  return host;
}

function parsePort(value: unknown): number {
  const port = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Port must be an integer between 0 and 65535.");
  }
  return port;
}

function getRequestPath(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://localhost").pathname;
}

function isAllowedHostHeader(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  const host = extractHostWithoutPort(normalized);
  return ALLOWED_LOCAL_HOSTS.has(host);
}

function extractHostWithoutPort(hostHeader: string): string {
  if (hostHeader.startsWith("[")) {
    const endBracket = hostHeader.indexOf("]");
    return endBracket === -1 ? hostHeader : hostHeader.slice(1, endBracket);
  }

  const colonIndex = hostHeader.indexOf(":");
  if (colonIndex === -1 || hostHeader.includes("::")) {
    return hostHeader;
  }
  return hostHeader.slice(0, colonIndex);
}

function formatUrlHost(host: string): string {
  return host === "::1" ? "[::1]" : host;
}

function sendText(res: ServerResponse, statusCode: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(message);
}

function sendJsonRpcInternalError(res: ServerResponse): void {
  if (res.headersSent || res.writableEnded) {
    return;
  }

  res.writeHead(500, {
    "Content-Type": "application/json",
  });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code: -32603,
        message: "Internal server error",
      },
      id: null,
    }),
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
