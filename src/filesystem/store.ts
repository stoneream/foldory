import { constants as fsConstants } from "node:fs";
import { access, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { KnowledgeAccessError } from "./errors.js";
import { toFileEntry } from "./file-entry.js";
import { openWritableFile, readTextFile, statRegularFileHandle } from "./file-io.js";
import { assertTextSize, resolveStoreOptions } from "./options.js";
import { normalizeWorkspaceName } from "./path-safety.js";
import { resolveExistingFile, resolveWritableFile } from "./resolution.js";
import { searchFiles as searchKnowledgeFiles } from "./search.js";
import { listFiles as listKnowledgeFiles, listWorkspaces as listKnowledgeWorkspaces } from "./workspaces.js";
import type {
  ListFilesOptions,
  ListFilesResult,
  ReadFileResult,
  ResolvedStoreOptions,
  SearchFilesOptions,
  SearchFilesResult,
  StoreOptions,
  WorkspaceEntry,
  WriteFileResult,
} from "./types.js";

export class KnowledgeStore {
  private constructor(
    public readonly rootPath: string,
    private readonly options: ResolvedStoreOptions,
  ) {}

  static async create(rootPath: string, options: StoreOptions = {}): Promise<KnowledgeStore> {
    if (!rootPath) {
      throw new KnowledgeAccessError("missing_root", "Root directory is required.");
    }

    const resolvedRoot = path.resolve(rootPath);
    const rootRealPath = await realpath(resolvedRoot);
    const rootStat = await stat(rootRealPath);

    if (!rootStat.isDirectory()) {
      throw new KnowledgeAccessError("invalid_root", `Root is not a directory: ${rootPath}`);
    }

    return new KnowledgeStore(rootRealPath, resolveStoreOptions(options));
  }

  async listWorkspaces(): Promise<WorkspaceEntry[]> {
    return listKnowledgeWorkspaces(this.rootPath);
  }

  async listFiles(workspaceName: string, options: ListFilesOptions = {}): Promise<ListFilesResult> {
    return listKnowledgeFiles(this.rootPath, workspaceName, options, this.options);
  }

  async readFiles(workspaceName: string, paths: string[]): Promise<ReadFileResult[]> {
    if (paths.length === 0) {
      throw new KnowledgeAccessError("empty_file_list", "At least one file path is required.");
    }
    if (paths.length > this.options.maxReadFiles) {
      throw new KnowledgeAccessError(
        "too_many_files",
        `read_files accepts at most ${this.options.maxReadFiles} files per call.`,
      );
    }

    const results: ReadFileResult[] = [];
    for (const filePath of paths) {
      const resolvedFile = await resolveExistingFile(this.rootPath, workspaceName, filePath);
      const readFile = await readTextFile(resolvedFile, this.options.maxFileBytes);
      results.push({
        workspace: normalizeWorkspaceName(workspaceName),
        ...toFileEntry(resolvedFile.normalizedPath, readFile.stat),
        content: readFile.content,
      });
    }

    return results;
  }

  async writeFile(workspaceName: string, filePath: string, content: string): Promise<WriteFileResult> {
    assertTextSize(content, this.options.maxFileBytes);

    const resolvedFile = await resolveWritableFile(this.rootPath, workspaceName, filePath);
    const openedFile = await openWritableFile(resolvedFile, false);
    let fileStat = openedFile.stat;
    try {
      await openedFile.fileHandle.truncate(0);
      await openedFile.fileHandle.writeFile(content, "utf8");
      fileStat = await statRegularFileHandle(openedFile.fileHandle, resolvedFile.normalizedPath);
    } finally {
      await openedFile.fileHandle.close();
    }

    return {
      workspace: normalizeWorkspaceName(workspaceName),
      ...toFileEntry(resolvedFile.normalizedPath, fileStat),
      created: resolvedFile.created,
    };
  }

  async appendFile(workspaceName: string, filePath: string, content: string): Promise<WriteFileResult> {
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes > this.options.maxFileBytes) {
      throw new KnowledgeAccessError(
        "file_too_large",
        `Content exceeds the ${this.options.maxFileBytes} byte limit.`,
      );
    }

    const resolvedFile = await resolveWritableFile(this.rootPath, workspaceName, filePath);
    const openedFile = await openWritableFile(resolvedFile, true);
    let fileStat = openedFile.stat;
    try {
      if (!resolvedFile.created && fileStat.size + contentBytes > this.options.maxFileBytes) {
        throw new KnowledgeAccessError(
          "file_too_large",
          `Appended file would exceed the ${this.options.maxFileBytes} byte limit.`,
        );
      }

      await openedFile.fileHandle.writeFile(content, "utf8");
      fileStat = await statRegularFileHandle(openedFile.fileHandle, resolvedFile.normalizedPath);
    } finally {
      await openedFile.fileHandle.close();
    }

    return {
      workspace: normalizeWorkspaceName(workspaceName),
      ...toFileEntry(resolvedFile.normalizedPath, fileStat),
      created: resolvedFile.created,
    };
  }

  async searchFiles(options: SearchFilesOptions): Promise<SearchFilesResult> {
    return searchKnowledgeFiles(this.rootPath, options, this.options);
  }
}

export async function ensureDirectory(rootPath: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  await access(rootPath, fsConstants.R_OK | fsConstants.W_OK);
}
