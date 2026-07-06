import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

type StructuredLog = Record<string, unknown>;

class HttpMcpServerProcess {
  private stdoutBuffer = "";
  private stderrBuffer = "";

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.stdoutBuffer += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      this.stderrBuffer += chunk;
    });
  }

  static async start(root: string): Promise<{ process: HttpMcpServerProcess; url: URL }> {
    const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts", "--root", root, "--port", "0"], {
      cwd: process.cwd(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    const serverProcess = new HttpMcpServerProcess(child);
    const url = await serverProcess.waitForListenUrl();

    return {
      process: serverProcess,
      url,
    };
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

  waitForStdoutLog(predicate: (log: StructuredLog) => boolean): Promise<StructuredLog> {
    const matchingLog = findJsonLog(this.stdoutBuffer, predicate);
    if (matchingLog !== undefined) {
      return Promise.resolve(matchingLog);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for stdout log. stdout: ${this.stdoutBuffer}`));
      }, 5000);

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.child.stdout.off("data", onStdout);
        this.child.off("exit", onExit);
      };

      const onStdout = (): void => {
        const log = findJsonLog(this.stdoutBuffer, predicate);
        if (log === undefined) {
          return;
        }

        cleanup();
        resolve(log);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        reject(
          new Error(
            `MCP server exited before stdout log: code=${String(code)} signal=${String(signal)} stdout: ${
              this.stdoutBuffer
            } stderr: ${this.stderrBuffer}`,
          ),
        );
      };

      this.child.stdout.on("data", onStdout);
      this.child.once("exit", onExit);
    });
  }

  waitForStderrLog(predicate: (log: StructuredLog) => boolean): Promise<StructuredLog> {
    const matchingLog = findJsonLog(this.stderrBuffer, predicate);
    if (matchingLog !== undefined) {
      return Promise.resolve(matchingLog);
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for stderr log. stderr: ${this.stderrBuffer}`));
      }, 5000);

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.child.stderr.off("data", onStderr);
        this.child.off("exit", onExit);
      };

      const onStderr = (): void => {
        const log = findJsonLog(this.stderrBuffer, predicate);
        if (log === undefined) {
          return;
        }

        cleanup();
        resolve(log);
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        reject(
          new Error(
            `MCP server exited before stderr log: code=${String(code)} signal=${String(signal)} stderr: ${
              this.stderrBuffer
            }`,
          ),
        );
      };

      this.child.stderr.on("data", onStderr);
      this.child.once("exit", onExit);
    });
  }

  private async waitForListenUrl(): Promise<URL> {
    const log = await this.waitForStdoutLog((entry) => entry.message === "server_listening");
    if (typeof log.url !== "string") {
      throw new Error(`Server listening log did not include a URL: ${JSON.stringify(log)}`);
    }
    return new URL(log.url);
  }
}

function findJsonLog(buffer: string, predicate: (log: StructuredLog) => boolean): StructuredLog | undefined {
  for (const line of buffer.split(/\r?\n/)) {
    if (line.trim() === "") {
      continue;
    }

    const log = parseJsonLog(line);
    if (log !== undefined && predicate(log)) {
      return log;
    }
  }
  return undefined;
}

function parseJsonLog(line: string): StructuredLog | undefined {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

let tempRoot: string;
let serverProcess: HttpMcpServerProcess | undefined;
let client: Client | undefined;
let transport: StreamableHTTPClientTransport | undefined;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "foldory-mcp-"));
  await mkdir(path.join(tempRoot, "project1"));
  await writeFile(path.join(tempRoot, "project1", "overview.md"), "Project Alpha\nImportant detail\n", "utf8");
});

afterEach(async () => {
  await transport?.close();
  transport = undefined;
  client = undefined;
  await serverProcess?.close();
  serverProcess = undefined;
  await rm(tempRoot, { recursive: true, force: true });
});

describe("MCP HTTP integration", () => {
  it("initializes, lists tools, calls a tool, and returns tool errors as isError results", async () => {
    const started = await HttpMcpServerProcess.start(tempRoot);
    serverProcess = started.process;

    client = new Client({
      name: "foldory-test",
      version: "0.1.0",
    });
    transport = new StreamableHTTPClientTransport(started.url);
    await client.connect(transport);

    expect(client.getServerVersion()).toMatchObject({
      name: "foldory",
      version: "0.1.0",
    });

    const toolsList = await client.listTools();
    expect(toolsList.tools.map((tool) => tool.name)).toEqual([
      "list_workspaces",
      "create_workspace",
      "list_files",
      "delete_workspace",
      "rename_workspace",
      "read_files",
      "write_file",
      "append_file",
      "delete_file",
      "move_file",
      "search_files",
    ]);

    const createResult = await client.callTool({
      name: "create_workspace",
      arguments: {
        name: "project2",
      },
    });
    expect(createResult.isError).not.toBe(true);
    expect(createResult.structuredContent).toEqual({
      workspace: {
        name: "project2",
      },
      created: true,
    });

    const readResult = await client.callTool({
      name: "read_files",
      arguments: {
        workspace: "project1",
        paths: ["overview.md"],
      },
    });
    expect(readResult.isError).not.toBe(true);
    expect(readResult.structuredContent).toMatchObject({
      files: [
        {
          workspace: "project1",
          path: "overview.md",
          content: "Project Alpha\nImportant detail\n",
        },
      ],
    });
    await expect(
      serverProcess.waitForStdoutLog(
        (log) => log.message === "tool_call" && log.tool === "read_files" && log.status === "ok",
      ),
    ).resolves.toMatchObject({
      level: "info",
      message: "tool_call",
      service: "foldory",
      status: "ok",
      tool: "read_files",
      duration_ms: expect.any(Number),
      timestamp: expect.any(String),
    });

    const errorResult = await client.callTool({
      name: "read_files",
      arguments: {
        workspace: "project1",
        paths: [path.join(tempRoot, "project1", "overview.md")],
      },
    });
    expect(errorResult.isError).toBe(true);
    expect(errorResult.structuredContent).toEqual({
      code: "invalid_path",
      message: "Path must be a relative file path inside the workspace.",
    });
    expect(JSON.stringify(errorResult)).not.toContain(tempRoot);
    await expect(
      serverProcess.waitForStdoutLog(
        (log) =>
          log.message === "tool_call" &&
          log.tool === "read_files" &&
          log.status === "error" &&
          log.error_code === "invalid_path",
      ),
    ).resolves.toMatchObject({
      error_code: "invalid_path",
      level: "info",
      message: "tool_call",
      service: "foldory",
      status: "error",
      tool: "read_files",
    });
  });

  it("delete_file, move_file, delete_workspace, rename_workspace work end-to-end", async () => {
    const started = await HttpMcpServerProcess.start(tempRoot);
    serverProcess = started.process;

    client = new Client({ name: "foldory-test", version: "0.1.0" });
    transport = new StreamableHTTPClientTransport(started.url);
    await client.connect(transport);

    await client.callTool({ name: "create_workspace", arguments: { name: "staging" } });
    await client.callTool({
      name: "write_file",
      arguments: { workspace: "staging", path: "draft.md", content: "hello" },
    });

    const moveResult = await client.callTool({
      name: "move_file",
      arguments: { workspace: "staging", path: "draft.md", dest_workspace: "project1", dest_path: "draft.md" },
    });
    expect(moveResult.isError).not.toBe(true);
    expect(moveResult.structuredContent).toMatchObject({
      from: { workspace: "staging", path: "draft.md" },
      to: { workspace: "project1", path: "draft.md" },
    });
    expect(JSON.stringify(moveResult)).not.toContain(tempRoot);

    const moveConflictResult = await client.callTool({
      name: "move_file",
      arguments: { workspace: "project1", path: "overview.md", dest_workspace: "project1", dest_path: "draft.md" },
    });
    expect(moveConflictResult.isError).toBe(true);
    expect(moveConflictResult.structuredContent).toMatchObject({ code: "file_already_exists" });

    const deleteFileResult = await client.callTool({
      name: "delete_file",
      arguments: { workspace: "project1", path: "draft.md" },
    });
    expect(deleteFileResult.isError).not.toBe(true);
    expect(deleteFileResult.structuredContent).toEqual({ workspace: "project1", path: "draft.md" });

    const deleteWorkspaceResult = await client.callTool({
      name: "delete_workspace",
      arguments: { name: "staging" },
    });
    expect(deleteWorkspaceResult.isError).not.toBe(true);
    expect(deleteWorkspaceResult.structuredContent).toEqual({ name: "staging" });

    const renameResult = await client.callTool({
      name: "rename_workspace",
      arguments: { name: "project1", new_name: "project-renamed" },
    });
    expect(renameResult.isError).not.toBe(true);
    expect(renameResult.structuredContent).toEqual({ from: "project1", to: "project-renamed" });

    const renameConflictResult = await client.callTool({
      name: "rename_workspace",
      arguments: { name: "project-renamed", new_name: "project-renamed" },
    });
    expect(renameConflictResult.isError).toBe(true);
    expect(renameConflictResult.structuredContent).toMatchObject({ code: "workspace_already_exists" });
  });

  it("rejects non-POST requests to the MCP endpoint", async () => {
    const started = await HttpMcpServerProcess.start(tempRoot);
    serverProcess = started.process;

    const response = await fetch(started.url, {
      method: "GET",
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
    expect(await response.text()).toBe("Method Not Allowed");

    await expect(
      serverProcess.waitForStderrLog(
        (log) =>
          log.message === "http_request" &&
          log.method === "GET" &&
          log.path === "/mcp" &&
          log.status === 405,
      ),
    ).resolves.toMatchObject({
      duration_ms: expect.any(Number),
      level: "http",
      message: "http_request",
      method: "GET",
      path: "/mcp",
      service: "foldory",
      started_at: expect.any(String),
      status: 405,
      timestamp: expect.any(String),
    });
  });
});
