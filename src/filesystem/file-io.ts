import { constants as fsConstants, type Stats } from "node:fs";
import { open, rename, unlink, type FileHandle } from "node:fs/promises";

import { KnowledgeAccessError, isNodeErrorCode, toKnowledgeError } from "./errors.js";
import { assertSameFile } from "./path-safety.js";
import { decodeText, readFileHandleWithLimit } from "./text.js";
import type { FileResolution, OpenedRegularFile, TextFileRead, WritableFileResolution } from "./types.js";

const NOFOLLOW_FLAG = fsConstants.O_NOFOLLOW ?? 0;
const NONBLOCK_FLAG = fsConstants.O_NONBLOCK ?? 0;
const READ_EXISTING_FLAGS = fsConstants.O_RDONLY | NOFOLLOW_FLAG | NONBLOCK_FLAG;
const WRITE_EXISTING_FLAGS = fsConstants.O_WRONLY | NOFOLLOW_FLAG | NONBLOCK_FLAG;
const APPEND_EXISTING_FLAGS = fsConstants.O_WRONLY | fsConstants.O_APPEND | NOFOLLOW_FLAG | NONBLOCK_FLAG;
const CREATE_FILE_FLAGS =
  fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | NOFOLLOW_FLAG | NONBLOCK_FLAG;

export async function deleteFile(resolvedFile: FileResolution): Promise<void> {
  try {
    await unlink(resolvedFile.realPath);
  } catch (error) {
    throw toKnowledgeError(error, "file_delete_failed", `Could not delete file: ${resolvedFile.normalizedPath}`);
  }
}

export async function moveFile(resolvedSource: FileResolution, resolvedDest: WritableFileResolution): Promise<void> {
  if (!resolvedDest.created) {
    throw new KnowledgeAccessError(
      "file_already_exists",
      `Destination file already exists: ${resolvedDest.normalizedPath}`,
    );
  }
  try {
    await rename(resolvedSource.realPath, resolvedDest.writePath);
  } catch (error) {
    if (isNodeErrorCode(error, "EXDEV")) {
      throw new KnowledgeAccessError("move_failed", "Cannot move file across filesystems.");
    }
    throw toKnowledgeError(error, "move_failed", `Could not move file: ${resolvedSource.normalizedPath}`);
  }
}

export async function readTextFile(resolvedFile: FileResolution, maxFileBytes: number): Promise<TextFileRead> {
  const openedFile = await openExistingRegularFile(resolvedFile.realPath, READ_EXISTING_FLAGS, resolvedFile);

  try {
    if (openedFile.stat.size > maxFileBytes) {
      throw new KnowledgeAccessError(
        "file_too_large",
        `File exceeds the ${maxFileBytes} byte limit: ${resolvedFile.normalizedPath}`,
      );
    }

    const content = await readFileHandleWithLimit(
      openedFile.fileHandle,
      maxFileBytes,
      resolvedFile.normalizedPath,
    );
    return {
      content: decodeText(content, resolvedFile.normalizedPath),
      stat: await statRegularFileHandle(openedFile.fileHandle, resolvedFile.normalizedPath),
    };
  } finally {
    await openedFile.fileHandle.close();
  }
}

export async function openWritableFile(
  resolvedFile: WritableFileResolution,
  append: boolean,
): Promise<OpenedRegularFile> {
  const flags = resolvedFile.created ? CREATE_FILE_FLAGS : append ? APPEND_EXISTING_FLAGS : WRITE_EXISTING_FLAGS;
  let fileHandle: FileHandle;
  try {
    fileHandle = await open(resolvedFile.writePath, flags, 0o666);
  } catch (error) {
    if (isNodeErrorCode(error, "EEXIST")) {
      throw new KnowledgeAccessError(
        "write_conflict",
        `File appeared before it could be created: ${resolvedFile.normalizedPath}`,
      );
    }
    if (isNodeErrorCode(error, "ELOOP")) {
      throw new KnowledgeAccessError("non_regular_file", `Path is not a regular file: ${resolvedFile.normalizedPath}`);
    }
    throw toKnowledgeError(error, "file_open_failed", `Could not open file: ${resolvedFile.normalizedPath}`);
  }

  try {
    const fileStat = await statRegularFileHandle(fileHandle, resolvedFile.normalizedPath);
    if (resolvedFile.stat !== null) {
      assertSameFile(resolvedFile.stat, fileStat, resolvedFile.normalizedPath);
    }
    return {
      fileHandle,
      stat: fileStat,
    };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}

export async function statRegularFileHandle(fileHandle: FileHandle, normalizedPath: string): Promise<Stats> {
  let fileStat: Stats;
  try {
    fileStat = await fileHandle.stat();
  } catch (error) {
    throw toKnowledgeError(error, "file_stat_failed", `Could not inspect file: ${normalizedPath}`);
  }

  if (!fileStat.isFile()) {
    throw new KnowledgeAccessError("non_regular_file", `Path is not a regular file: ${normalizedPath}`);
  }

  return fileStat;
}

async function openExistingRegularFile(
  filePath: string,
  flags: number,
  resolvedFile: FileResolution,
): Promise<OpenedRegularFile> {
  let fileHandle: FileHandle;
  try {
    fileHandle = await open(filePath, flags);
  } catch (error) {
    if (isNodeErrorCode(error, "ELOOP")) {
      throw new KnowledgeAccessError("non_regular_file", `Path is not a regular file: ${resolvedFile.normalizedPath}`);
    }
    throw toKnowledgeError(error, "file_open_failed", `Could not open file: ${resolvedFile.normalizedPath}`);
  }

  try {
    const fileStat = await statRegularFileHandle(fileHandle, resolvedFile.normalizedPath);
    assertSameFile(resolvedFile.stat, fileStat, resolvedFile.normalizedPath);
    return {
      fileHandle,
      stat: fileStat,
    };
  } catch (error) {
    await fileHandle.close();
    throw error;
  }
}
