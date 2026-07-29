import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import {
  isPathWithinRoot,
  matchesSensitivePattern,
  validateOpenPathUserSelected,
} from '@main/utils/pathValidation';

import type { TeamImportRawSourcePort } from '../../core/application/ports/TeamImportRawSourcePort';
import type {
  TeamImportRawSourceDump,
  TeamImportRawSourceFile,
} from '../../core/domain/teamImportLlmPrompt';
import type { Dirent } from 'node:fs';

export const TEAM_IMPORT_RAW_SOURCE_LIMITS = {
  maxFiles: 400,
  maxFileBytes: 64 * 1024,
  maxDumpBytes: 300 * 1024,
  maxDepth: 8,
} as const;

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.yaml', '.yml', '.txt', '.json']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.venv',
  '__pycache__',
]);

interface WalkState {
  files: TeamImportRawSourceFile[];
  dumpBytes: number;
  visited: number;
  truncated: boolean;
}

/**
 * Flattens an arbitrary local folder into a bounded text dump for LLM parsing.
 * Unlike SafeLocalTeamImportFolderSource this makes no layout assumptions, but
 * it applies the same safety posture: no symlinks, no path escapes, hard size
 * budgets, text files only.
 */
export class SafeArbitraryFolderRawSource implements TeamImportRawSourcePort {
  async readFolder(folderPath: string): Promise<TeamImportRawSourceDump> {
    const validation = validateOpenPathUserSelected(folderPath);
    if (!validation.valid || !validation.normalizedPath) {
      throw new Error(validation.error ?? 'Invalid import source.');
    }
    const selectedStat = await fs.lstat(validation.normalizedPath);
    if (selectedStat.isSymbolicLink() || !selectedStat.isDirectory()) {
      throw new Error('Import source must be a real directory, not a symbolic link.');
    }
    const realRoot = await fs.realpath(validation.normalizedPath);
    if (matchesSensitivePattern(`${realRoot}${path.sep}`)) {
      throw new Error('Cannot import from a sensitive system directory.');
    }

    const state: WalkState = { files: [], dumpBytes: 0, visited: 0, truncated: false };
    await this.walk(realRoot, realRoot, 0, state);
    state.files.sort((left, right) => left.path.localeCompare(right.path));
    return {
      label: `folder ${path.basename(realRoot)}`,
      files: state.files,
      truncated: state.truncated,
    };
  }

  private async walk(
    directoryPath: string,
    realRoot: string,
    depth: number,
    state: WalkState
  ): Promise<void> {
    if (depth > TEAM_IMPORT_RAW_SOURCE_LIMITS.maxDepth) {
      state.truncated = true;
      return;
    }
    const realDirectory = await fs.realpath(directoryPath);
    if (!isPathWithinRoot(realDirectory, realRoot)) {
      throw new Error(`Import path escapes the selected folder: ${directoryPath}`);
    }

    let entries: Dirent[];
    try {
      entries = await fs.readdir(directoryPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (state.dumpBytes >= TEAM_IMPORT_RAW_SOURCE_LIMITS.maxDumpBytes) {
        state.truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) {
        // Arbitrary sources may legitimately contain links; skip rather than fail.
        state.truncated = true;
        continue;
      }
      const entryPath = path.join(directoryPath, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') && entry.name !== '.claude') {
          continue;
        }
        if (SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) continue;
        await this.walk(entryPath, realRoot, depth + 1, state);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).toLowerCase();
      const isDotConfigFile = entry.name.startsWith('.') && TEXT_EXTENSIONS.has(extension);
      if (!TEXT_EXTENSIONS.has(extension) && !isDotConfigFile) continue;

      if (state.visited >= TEAM_IMPORT_RAW_SOURCE_LIMITS.maxFiles) {
        state.truncated = true;
        return;
      }
      state.visited += 1;

      const stat = await fs.lstat(entryPath);
      if (!stat.isFile()) continue;
      if (stat.size > TEAM_IMPORT_RAW_SOURCE_LIMITS.maxFileBytes) {
        state.truncated = true;
        continue;
      }
      const remaining = TEAM_IMPORT_RAW_SOURCE_LIMITS.maxDumpBytes - state.dumpBytes;
      const buffer = await fs.readFile(entryPath);
      if (buffer.includes(0)) continue; // binary despite the extension
      let content = buffer.toString('utf8');
      if (Buffer.byteLength(content, 'utf8') > remaining) {
        content = buffer.subarray(0, remaining).toString('utf8');
        state.truncated = true;
      }
      state.dumpBytes += Buffer.byteLength(content, 'utf8');
      state.files.push({
        path: path.relative(realRoot, entryPath).split(path.sep).join('/'),
        content,
      });
    }
  }
}
