import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';

import type {
  TeamImportSkillInstallResult,
  TeamImportSkillsInstallerPort,
} from '../../core/application/ports/TeamImportSkillsInstallerPort';
import type { TeamImportBundleSkill } from '@features/team-import/contracts';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

/**
 * Installs imported skills into the user Claude skill root (~/.claude/skills)
 * through the reviewed plan/apply pipeline. Existing slugs are never touched:
 * the user chose skip-and-warn over overwrite for conflicts.
 */
export class SkillsMutationInstaller implements TeamImportSkillsInstallerPort {
  constructor(private readonly skillsMutationService: SkillsMutationService) {}

  private getUserSkillRoot(): string {
    return path.join(getHomeDir(), '.claude', 'skills');
  }

  async listExistingSlugs(): Promise<ReadonlySet<string>> {
    try {
      const entries = await fs.readdir(this.getUserSkillRoot(), { withFileTypes: true });
      return new Set(
        entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name.toLowerCase())
      );
    } catch {
      return new Set();
    }
  }

  async install(skill: TeamImportBundleSkill): Promise<TeamImportSkillInstallResult> {
    const existing = await this.listExistingSlugs();
    if (existing.has(skill.slug.toLowerCase())) {
      return { status: 'skipped', detail: 'already exists' };
    }
    try {
      const preview = await this.skillsMutationService.previewUpsert({
        scope: 'user',
        rootKind: 'claude',
        folderName: skill.slug,
        files: skill.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
        })),
      });
      await this.skillsMutationService.applyUpsert({
        scope: 'user',
        rootKind: 'claude',
        folderName: skill.slug,
        files: skill.files.map((file) => ({
          relativePath: file.relativePath,
          content: file.content,
        })),
        reviewPlanId: preview.planId,
      });
      return { status: 'installed' };
    } catch (error) {
      return {
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
