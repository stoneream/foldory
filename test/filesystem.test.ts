import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KnowledgeAccessError, KnowledgeStore } from "../src/filesystem.js";

let tempRoot: string;
let store: KnowledgeStore;

beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "foldory-"));
  await mkdir(path.join(tempRoot, "project1"));
  await mkdir(path.join(tempRoot, "project2"));
  await mkdir(path.join(tempRoot, "project1", "notes"));
  await writeFile(path.join(tempRoot, "project1", "overview.md"), "Project Alpha\nImportant detail\n", "utf8");
  await writeFile(path.join(tempRoot, "project1", "notes", "discussion.md"), "Discuss alpha plans\n", "utf8");
  await writeFile(path.join(tempRoot, "project2", "ideas.md"), "Different project\n", "utf8");
  store = await KnowledgeStore.create(tempRoot);
});

afterEach(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

describe("KnowledgeStore", () => {
  it("lists root-level workspaces", async () => {
    await writeFile(path.join(tempRoot, "root.md"), "not a workspace", "utf8");

    await expect(store.listWorkspaces()).resolves.toEqual([{ name: "project1" }, { name: "project2" }]);
  });

  it("does not treat root-level symlinks as workspaces", async () => {
    await symlink(path.join(tempRoot, "project1"), path.join(tempRoot, "linked-project"), "dir");

    await expect(store.listWorkspaces()).resolves.toEqual([{ name: "project1" }, { name: "project2" }]);
    await expect(store.listFiles("linked-project")).rejects.toThrow(KnowledgeAccessError);
  });

  it("creates root-level workspaces", async () => {
    await expect(store.createWorkspace("project3")).resolves.toEqual({
      workspace: { name: "project3" },
      created: true,
    });

    const createdWorkspace = await lstat(path.join(tempRoot, "project3"));
    expect(createdWorkspace.isDirectory()).toBe(true);
    await expect(store.listWorkspaces()).resolves.toEqual([
      { name: "project1" },
      { name: "project2" },
      { name: "project3" },
    ]);
  });

  it("treats existing workspace creation as successful without replacing it", async () => {
    await expect(store.createWorkspace("project1")).resolves.toEqual({
      workspace: { name: "project1" },
      created: false,
    });
  });

  it("lists files inside a workspace recursively", async () => {
    const result = await store.listFiles("project1");

    expect(result.files.map((file) => file.path)).toEqual(["notes/discussion.md", "overview.md"]);
    expect(result.truncated).toBe(false);
  });

  it("reads UTF-8 text files", async () => {
    const result = await store.readFiles("project1", ["overview.md"]);

    expect(result).toHaveLength(1);
    expect(result[0]?.content).toBe("Project Alpha\nImportant detail\n");
  });

  it("writes and appends files inside a workspace", async () => {
    await expect(store.writeFile("project1", "notes/new.md", "hello")).resolves.toMatchObject({
      workspace: "project1",
      path: "notes/new.md",
      created: true,
    });

    await expect(store.appendFile("project1", "notes/new.md", "\nworld")).resolves.toMatchObject({
      workspace: "project1",
      path: "notes/new.md",
      created: false,
    });

    await expect(readFile(path.join(tempRoot, "project1", "notes", "new.md"), "utf8")).resolves.toBe("hello\nworld");
  });

  it("searches files with a plain substring query", async () => {
    const result = await store.searchFiles({ query: "alpha" });

    expect(result.matches).toEqual([
      expect.objectContaining({ workspace: "project1", path: "notes/discussion.md", line: 1 }),
      expect.objectContaining({ workspace: "project1", path: "overview.md", line: 1 }),
    ]);
  });

  it("applies the search file limit across all workspaces", async () => {
    const limitedStore = await KnowledgeStore.create(tempRoot, { maxSearchFiles: 1 });

    const result = await limitedStore.searchFiles({ query: "project" });

    expect(result.filesScanned).toBeLessThanOrEqual(1);
    expect(result.truncated).toBe(true);
  });

  it("marks list results truncated when the directory traversal limit is reached", async () => {
    const limitedStore = await KnowledgeStore.create(tempRoot, { maxListDirectories: 1 });

    const result = await limitedStore.listFiles("project1");

    expect(result.truncated).toBe(true);
  });

  it("rejects absolute file paths", async () => {
    await expect(store.readFiles("project1", [path.join(tempRoot, "project1", "overview.md")])).rejects.toThrow(
      KnowledgeAccessError,
    );
  });

  it("rejects path traversal outside the workspace", async () => {
    await expect(store.readFiles("project1", ["../project2/ideas.md"])).rejects.toThrow(KnowledgeAccessError);
  });

  it("rejects non-regular file reads", async () => {
    await expect(store.readFiles("project1", ["notes"])).rejects.toThrow(KnowledgeAccessError);
  });

  it("rejects symlinks that resolve outside the root", async () => {
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "foldory-outside-"));
    try {
      const outsideFile = path.join(outsideDirectory, "secret.md");
      await writeFile(outsideFile, "secret", "utf8");
      await symlink(outsideFile, path.join(tempRoot, "project1", "secret.md"));

      await expect(store.readFiles("project1", ["secret.md"])).rejects.toThrow(KnowledgeAccessError);
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("rejects writes through symlinks that resolve outside the root", async () => {
    const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "foldory-outside-"));
    try {
      const outsideFile = path.join(outsideDirectory, "secret.md");
      await writeFile(outsideFile, "secret", "utf8");
      await symlink(outsideFile, path.join(tempRoot, "project1", "write-secret.md"));

      await expect(store.writeFile("project1", "write-secret.md", "changed")).rejects.toThrow(KnowledgeAccessError);
      await expect(store.appendFile("project1", "write-secret.md", "\nchanged")).rejects.toThrow(KnowledgeAccessError);
      await expect(readFile(outsideFile, "utf8")).resolves.toBe("secret");
    } finally {
      await rm(outsideDirectory, { recursive: true, force: true });
    }
  });

  it("rejects dangling symlink writes instead of creating their targets", async () => {
    await symlink("missing.md", path.join(tempRoot, "project1", "dangling.md"));

    await expect(store.writeFile("project1", "dangling.md", "created")).rejects.toThrow(KnowledgeAccessError);
    await expect(readFile(path.join(tempRoot, "project1", "missing.md"), "utf8")).rejects.toThrow();
  });

  it("rejects workspace names with separators", async () => {
    await expect(store.listFiles("project1/notes")).rejects.toThrow(KnowledgeAccessError);
    await expect(store.createWorkspace("project1/notes")).rejects.toThrow(KnowledgeAccessError);
  });

  it("rejects workspace creation when a root-level path conflicts", async () => {
    await writeFile(path.join(tempRoot, "file-workspace"), "not a workspace", "utf8");
    await symlink(path.join(tempRoot, "project1"), path.join(tempRoot, "linked-workspace"), "dir");

    await expect(store.createWorkspace("file-workspace")).rejects.toThrow(KnowledgeAccessError);
    await expect(store.createWorkspace("linked-workspace")).rejects.toThrow(KnowledgeAccessError);
  });

  it("deleteFile removes the file from the workspace", async () => {
    await expect(store.deleteFile("project1", "overview.md")).resolves.toEqual({
      workspace: "project1",
      path: "overview.md",
    });
    await expect(lstat(path.join(tempRoot, "project1", "overview.md"))).rejects.toThrow();
  });

  it("deleteFile rejects non-existent file", async () => {
    await expect(store.deleteFile("project1", "missing.md")).rejects.toThrow(KnowledgeAccessError);
  });

  it("deleteFile rejects non-existent workspace", async () => {
    await expect(store.deleteFile("nonexistent", "file.md")).rejects.toThrow(KnowledgeAccessError);
  });

  it("deleteFile rejects path traversal", async () => {
    await expect(store.deleteFile("project1", "../project2/ideas.md")).rejects.toThrow(KnowledgeAccessError);
  });

  it("deleteWorkspace removes the workspace and all its contents", async () => {
    await expect(store.deleteWorkspace("project1")).resolves.toEqual({ name: "project1" });
    await expect(lstat(path.join(tempRoot, "project1"))).rejects.toThrow();
    await expect(store.listWorkspaces()).resolves.toEqual([{ name: "project2" }]);
  });

  it("deleteWorkspace rejects non-existent workspace", async () => {
    await expect(store.deleteWorkspace("nonexistent")).rejects.toThrow(KnowledgeAccessError);
  });

  it("moveFile renames a file within the same workspace", async () => {
    const result = await store.moveFile("project1", "overview.md", "project1", "renamed.md");

    expect(result.from).toEqual({ workspace: "project1", path: "overview.md" });
    expect(result.to).toMatchObject({ workspace: "project1", path: "renamed.md" });
    await expect(lstat(path.join(tempRoot, "project1", "overview.md"))).rejects.toThrow();
    await expect(lstat(path.join(tempRoot, "project1", "renamed.md"))).resolves.toBeDefined();
  });

  it("moveFile moves a file across workspaces", async () => {
    const result = await store.moveFile("project1", "overview.md", "project2", "overview.md");

    expect(result.from).toEqual({ workspace: "project1", path: "overview.md" });
    expect(result.to).toMatchObject({ workspace: "project2", path: "overview.md" });
    await expect(lstat(path.join(tempRoot, "project1", "overview.md"))).rejects.toThrow();
    await expect(lstat(path.join(tempRoot, "project2", "overview.md"))).resolves.toBeDefined();
  });

  it("moveFile rejects when destination already exists", async () => {
    const error = await store.moveFile("project1", "overview.md", "project2", "ideas.md").catch((e) => e);
    expect(error).toBeInstanceOf(KnowledgeAccessError);
    expect((error as KnowledgeAccessError).code).toBe("file_already_exists");
  });

  it("moveFile rejects non-existent source", async () => {
    await expect(store.moveFile("project1", "missing.md", "project1", "dest.md")).rejects.toThrow(KnowledgeAccessError);
  });

  it("moveFile rejects path traversal on source", async () => {
    await expect(store.moveFile("project1", "../project2/ideas.md", "project1", "dest.md")).rejects.toThrow(
      KnowledgeAccessError,
    );
  });

  it("moveFile rejects path traversal on destination", async () => {
    await expect(store.moveFile("project1", "overview.md", "project1", "../escape.md")).rejects.toThrow(
      KnowledgeAccessError,
    );
  });

  it("renameWorkspace renames the workspace directory", async () => {
    await expect(store.renameWorkspace("project1", "project-new")).resolves.toEqual({
      from: "project1",
      to: "project-new",
    });
    await expect(lstat(path.join(tempRoot, "project1"))).rejects.toThrow();
    await expect(lstat(path.join(tempRoot, "project-new"))).resolves.toBeDefined();
    await expect(store.listWorkspaces()).resolves.toEqual([{ name: "project-new" }, { name: "project2" }]);
  });

  it("renameWorkspace preserves files inside", async () => {
    await store.renameWorkspace("project1", "project-new");
    const result = await store.readFiles("project-new", ["overview.md"]);
    expect(result[0]?.content).toBe("Project Alpha\nImportant detail\n");
  });

  it("renameWorkspace rejects non-existent workspace", async () => {
    await expect(store.renameWorkspace("nonexistent", "project-new")).rejects.toThrow(KnowledgeAccessError);
  });

  it("renameWorkspace rejects when new name is already taken", async () => {
    const error = await store.renameWorkspace("project1", "project2").catch((e) => e);
    expect(error).toBeInstanceOf(KnowledgeAccessError);
    expect((error as KnowledgeAccessError).code).toBe("workspace_already_exists");
  });

  it("renameWorkspace rejects same name", async () => {
    const error = await store.renameWorkspace("project1", "project1").catch((e) => e);
    expect(error).toBeInstanceOf(KnowledgeAccessError);
    expect((error as KnowledgeAccessError).code).toBe("workspace_already_exists");
  });
});
