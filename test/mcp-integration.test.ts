import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

type PendingRequest = {
  resolve: (response: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

class StdioMcpClient {
  private nextId = 1;
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private readonly pending = new Map<number, PendingRequest>();

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      this.handleStdout(chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
    });
    child.on("exit", (code, signal) => {
      const error = new Error(`MCP server exited unexpectedly: code=${String(code)} signal=${String(signal)}`);
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
    });
  }

  static start(root: string): StdioMcpClient {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--root", root], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });

    return new StdioMcpClient(child);
  }

  request(method: string, params?: Record<string, unknown>): Promise<JsonRpcResponse> {
    const id = this.nextId;
    this.nextId += 1;

    const message = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    const response = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for ${method}. stderr: ${this.stderrBuffer}`));
      }, 5000);

      this.pending.set(id, { resolve, reject, timeout });
    });

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
    return response;
  }

  notify(method: string, params?: Record<string, unknown>): void {
    const message = {
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
    };

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    if (this.child.exitCode !== null) {
      return;
    }

    const exited = new Promise<void>((resolve) => {
      this.child.once("exit", () => {
        resolve();
      });
    });

    this.child.kill();
    await exited;
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }

      const line = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
      if (!line) {
        continue;
      }

      const response = JSON.parse(line) as JsonRpcResponse;
      const pending = this.pending.get(response.id);
      if (!pending) {
        continue;
      }

      this.pending.delete(response.id);
      clearTimeout(pending.timeout);
      pending.resolve(response);
    }
  }
}

let tempRoot: string;
let client: StdioMcpClient | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "foldory-mcp-"));
  await mkdir(path.join(tempRoot, "project1"));
  await writeFile(path.join(tempRoot, "project1", "overview.md"), "Project Alpha\nImportant detail\n", "utf8");
});

afterEach(async () => {
  await client?.close();
  client = undefined;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("MCP stdio integration", () => {
  it("initializes, lists tools, calls a tool, and returns tool errors as isError results", async () => {
    client = StdioMcpClient.start(tempRoot);

    const initialize = await client.request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "foldory-test",
        version: "0.1.0",
      },
    });
    expect(initialize.error).toBeUndefined();
    expect(initialize.result?.serverInfo).toMatchObject({
      name: "foldory",
      version: "0.1.0",
    });

    client.notify("notifications/initialized");

    const toolsList = await client.request("tools/list");
    expect(toolsList.error).toBeUndefined();
    expect(getToolNames(toolsList.result)).toEqual([
      "list_workspaces",
      "list_files",
      "read_files",
      "write_file",
      "append_file",
      "search_files",
    ]);

    const readResult = await client.request("tools/call", {
      name: "read_files",
      arguments: {
        workspace: "project1",
        paths: ["overview.md"],
      },
    });
    expect(readResult.error).toBeUndefined();
    expect(readResult.result?.isError).not.toBe(true);
    expect(readResult.result?.structuredContent).toMatchObject({
      files: [
        {
          workspace: "project1",
          path: "overview.md",
          content: "Project Alpha\nImportant detail\n",
        },
      ],
    });

    const errorResult = await client.request("tools/call", {
      name: "read_files",
      arguments: {
        workspace: "project1",
        paths: [path.join(tempRoot, "project1", "overview.md")],
      },
    });
    expect(errorResult.error).toBeUndefined();
    expect(errorResult.result?.isError).toBe(true);
    expect(errorResult.result?.structuredContent).toEqual({
      code: "invalid_path",
      message: "Path must be a relative file path inside the workspace.",
    });
    expect(JSON.stringify(errorResult.result)).not.toContain(tempRoot);
  });
});

function getToolNames(result: Record<string, unknown> | undefined): string[] {
  const tools = result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error("tools/list result did not contain a tools array.");
  }

  return tools.map((tool) => {
    if (!isToolEntry(tool)) {
      throw new Error("tools/list result contained an invalid tool entry.");
    }
    return tool.name;
  });
}

function isToolEntry(value: unknown): value is { name: string } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string";
}
