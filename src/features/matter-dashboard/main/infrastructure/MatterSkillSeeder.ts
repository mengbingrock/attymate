import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';

import { MATTER_SKILL_MARKDOWN, MATTER_SKILL_SLUG } from '../../core/domain/matterSkillDefinition';

import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

const logger = createLogger('Feature:Matter:SkillSeeder');

const SKILL_FILE = 'SKILL.md';

/**
 * sha-256 of every PAST bundled MATTER_SKILL_MARKDOWN. An installed file
 * matching one of these was never edited by the user, so upgrading it in
 * place is safe; anything else is user-owned and is never overwritten.
 * Append the outgoing hash here whenever the bundled markdown changes.
 */
const LEGACY_SKILL_SHA256 = new Set([
  // v1 (schema v1 sections, single-matter tools)
  'a5a44d09ecb7257b6aff78b7c47975888ea80fb14f235d3b7cf882374eb3dfcb',
]);

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

interface SeedTarget {
  rootKind: 'claude' | 'codex';
  rootPath: string;
  label: string;
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    return (await fs.stat(dirPath)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Seeds the matter dashboard workflow as an ordinary user skill the first time
 * it is missing, then leaves it alone forever.
 *
 * Same targets and same skip-never-overwrite policy as imported team skills
 * (`SkillsMutationInstaller`): stock Claude reads ~/.claude/skills and stock
 * Codex reads ~/.codex/skills, and a team's provider is chosen later. The user
 * owns the file once it exists — edits, renames, and additions all survive, and
 * `MatterRefreshCoordinator` reads the on-disk copy rather than this constant.
 */
export class MatterSkillSeeder {
  constructor(
    private readonly skillsMutationService: SkillsMutationService,
    private readonly homeDir: string = getHomeDir()
  ) {}

  private async getTargets(): Promise<SeedTarget[]> {
    const targets: SeedTarget[] = [
      {
        rootKind: 'claude',
        rootPath: path.join(this.homeDir, '.claude', 'skills'),
        label: '~/.claude/skills',
      },
    ];
    if (await directoryExists(path.join(this.homeDir, '.codex'))) {
      targets.push({
        rootKind: 'codex',
        rootPath: path.join(this.homeDir, '.codex', 'skills'),
        label: '~/.codex/skills',
      });
    }
    return targets;
  }

  /** Absolute path of the seeded skill file in the primary (Claude) root. */
  getPrimarySkillFilePath(): string {
    return path.join(this.homeDir, '.claude', 'skills', MATTER_SKILL_SLUG, SKILL_FILE);
  }

  /**
   * The user's copy of the skill body, or null when it is absent/unreadable.
   * Runtime-agnostic read order: the Claude root, then the Codex root — a
   * Codex-only machine still gets its edited copy honored.
   */
  async readInstalledMarkdown(): Promise<string | null> {
    const candidates = [
      this.getPrimarySkillFilePath(),
      path.join(this.homeDir, '.codex', 'skills', MATTER_SKILL_SLUG, SKILL_FILE),
    ];
    for (const candidate of candidates) {
      try {
        const content = await fs.readFile(candidate, 'utf8');
        if (content.trim()) return content;
      } catch {
        // Try the next root.
      }
    }
    return null;
  }

  private async slugExists(rootPath: string): Promise<boolean> {
    try {
      const entries = await fs.readdir(rootPath, { withFileTypes: true });
      return entries.some(
        (entry) => entry.isDirectory() && entry.name.toLowerCase() === MATTER_SKILL_SLUG
      );
    } catch {
      return false;
    }
  }

  /**
   * True when the installed copy is byte-identical to a PAST bundled version —
   * i.e. it was seeded by an older app build and never touched by the user.
   */
  private async isPristineLegacyInstall(rootPath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(path.join(rootPath, MATTER_SKILL_SLUG, SKILL_FILE), 'utf8');
      return LEGACY_SKILL_SHA256.has(sha256(content));
    } catch {
      return false;
    }
  }

  /**
   * Idempotent: writes the skill into roots that do not have it, and upgrades
   * a pristine older seed in place. A user-edited file is never overwritten —
   * the refresh prompt appends the current section schema instead.
   */
  async seed(): Promise<void> {
    const files = [{ relativePath: SKILL_FILE, content: MATTER_SKILL_MARKDOWN }];
    for (const target of await this.getTargets()) {
      const exists = await this.slugExists(target.rootPath);
      const upgrade = exists && (await this.isPristineLegacyInstall(target.rootPath));
      if (exists && !upgrade) continue;
      try {
        const preview = await this.skillsMutationService.previewUpsert({
          scope: 'user',
          rootKind: target.rootKind,
          folderName: MATTER_SKILL_SLUG,
          files,
        });
        await this.skillsMutationService.applyUpsert({
          scope: 'user',
          rootKind: target.rootKind,
          folderName: MATTER_SKILL_SLUG,
          files,
          reviewPlanId: preview.planId,
        });
        logger.info(
          upgrade
            ? `Upgraded the pristine ${MATTER_SKILL_SLUG} skill in ${target.label}`
            : `Seeded the ${MATTER_SKILL_SLUG} skill into ${target.label}`
        );
      } catch (error) {
        // Non-fatal: the refresh path falls back to the bundled markdown.
        logger.warn(`Could not seed the ${MATTER_SKILL_SLUG} skill into ${target.label}`, error);
      }
    }
  }
}
