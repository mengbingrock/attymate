import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { isPathWithinRoot, validateFileName } from '@main/utils/pathValidation';

import { resolveWritableSkillRoot } from './resolveWritableSkillRoot';
import { SkillRootsResolver } from './SkillRootsResolver';

import type { SkillDraftFile, SkillRootKind, SkillScope } from '@shared/types/extensions';

export class SkillScaffoldService {
  constructor(private readonly rootsResolver = new SkillRootsResolver()) {}

  async resolveUpsertTarget(
    scope: SkillScope,
    rootKind: SkillRootKind,
    projectPath: string | undefined,
    folderName: string,
    existingSkillId?: string,
    teamName?: string
  ): Promise<string> {
    const root = resolveWritableSkillRoot(this.rootsResolver, {
      scope,
      rootKind,
      projectPath,
      teamName,
    });
    await fs.mkdir(root.rootPath, { recursive: true });

    const folderValidation = validateFileName(folderName);
    if (!folderValidation.valid) {
      throw new Error(folderValidation.error ?? 'Invalid folder name');
    }

    const targetSkillDir = existingSkillId
      ? path.resolve(existingSkillId)
      : path.join(root.rootPath, folderName);
    if (!isPathWithinRoot(targetSkillDir, root.rootPath)) {
      throw new Error('Target skill directory is outside the allowed root');
    }

    return targetSkillDir;
  }

  normalizeDraftFiles(files: SkillDraftFile[]): SkillDraftFile[] {
    return files.map((file) => ({
      ...file,
      relativePath: this.normalizeRelativePath(file.relativePath),
    }));
  }

  private normalizeRelativePath(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error('relativePath is required');
    }

    const normalized = path.normalize(relativePath).replace(/\\/g, '/');
    if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(normalized)) {
      throw new Error(`Invalid relative path: ${relativePath}`);
    }

    const parts = normalized.split('/').filter(Boolean);
    if (parts.length === 0) {
      throw new Error(`Invalid relative path: ${relativePath}`);
    }

    for (const part of parts) {
      const validation = validateFileName(part);
      if (!validation.valid) {
        throw new Error(validation.error ?? `Invalid path segment: ${part}`);
      }
    }

    return parts.join('/');
  }
}
