import type { Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";

export type WorkspaceEntry = {
  name: string;
};

export type CreateWorkspaceResult = {
  workspace: WorkspaceEntry;
  created: boolean;
};

export type FileEntry = {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
};

export type ReadFileResult = FileEntry & {
  workspace: string;
  content: string;
};

export type WriteFileResult = FileEntry & {
  workspace: string;
  created: boolean;
};

export type ListFilesOptions = {
  recursive?: boolean;
  maxFiles?: number;
};

export type ListFilesResult = {
  workspace: string;
  files: FileEntry[];
  truncated: boolean;
  skipped: {
    inaccessible: number;
    unsafeSymlink: number;
    nonRegular: number;
  };
};

export type SearchFilesOptions = {
  workspace?: string;
  query: string;
  caseSensitive?: boolean;
  maxResults?: number;
};

export type SearchMatch = {
  workspace: string;
  path: string;
  line: number;
  column: number;
  preview: string;
};

export type SearchFilesResult = {
  query: string;
  matches: SearchMatch[];
  truncated: boolean;
  filesScanned: number;
  skipped: {
    tooLarge: number;
    binary: number;
    inaccessible: number;
  };
};

export type StoreOptions = {
  maxFileBytes?: number;
  maxReadFiles?: number;
  maxListFiles?: number;
  maxListDirectories?: number;
  maxSearchFiles?: number;
  maxSearchResults?: number;
  maxSearchWorkspaces?: number;
};

export type ResolvedStoreOptions = Required<StoreOptions>;

export type WorkspaceResolution = {
  name: string;
  realPath: string;
};

export type FileResolution = {
  normalizedPath: string;
  realPath: string;
  workspaceRealPath: string;
  stat: Stats;
};

export type WritableFileResolution = {
  normalizedPath: string;
  writePath: string;
  workspaceRealPath: string;
  created: boolean;
  stat: Stats | null;
};

export type OpenedRegularFile = {
  fileHandle: FileHandle;
  stat: Stats;
};

export type TextFileRead = {
  content: string;
  stat: Stats;
};
