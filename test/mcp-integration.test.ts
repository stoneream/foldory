import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

class HttpMcpServerProcess {
  private stdoutBuffer = "";
  private stderrBuffer = "";

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
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

  private waitForListenUrl(): Promise<URL> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for server URL. stderr: ${this.stderrBuffer}`));
      }, 5000);

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.child.stdout.off("data", onStdout);
        this.child.off("exit", onExit);
      };

      const onStdout = (chunk: string): void => {
        this.stdoutBuffer += chunk;
        const match = /MCP HTTP server listening at (http:\/\/\S+)/.exec(this.stdoutBuffer);
        if (!match) {
          return;
        }

        cleanup();
        resolve(new URL(match[1]));
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        cleanup();
        reject(
          new Error(
            `MCP server exited before listening: code=${String(code)} signal=${String(signal)} stderr: ${
              this.stderrBuffer
            }`,
          ),
        );
      };

      this.child.stdout.on("data", onStdout);
      this.child.once("exit", onExit);
    });
  }
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
      "read_files",
      "write_file",
      "append_file",
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
  });
});
