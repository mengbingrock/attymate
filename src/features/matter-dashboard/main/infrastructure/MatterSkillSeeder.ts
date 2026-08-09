import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { getHomeDir } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';

import { MATTER_SKILL_MARKDOWN, MATTER_SKILL_SLUG } from '../../core/domain/matterSkillDefinition';

import type { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';
import type { SkillStore } from '@main/services/extensions/skills/SkillStore';

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

export function isPristineBundledSkill(content: string): boolean {
  const hash = sha256(content);
  return LEGACY_SKILL_SHA256.has(hash) || hash === sha256(MATTER_SKILL_MARKDOWN);
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/** The runtime-branded copies older builds wrote, in read-preference order. */
interface LegacyCopy {
  label: string;
  skillDir: string;
  skillFile: string;
}

/**
 * Installs the matter dashboard workflow as an ordinary skill in the app's
 * model-agnostic library, then points every runtime's skill folder at it.
 *
 * Older builds wrote two independent copies (~/.claude/skills and
 * ~/.codex/skills) which drifted apart and were read runtime-blind, so a Codex
 * team could silently run the Claude copy. There is now one canonical file;
 * `adoptLegacyCopies` carries a user's edits over from whichever branded copy
 * they edited, and never discards the other one silently.
 */
export class MatterSkillSeeder {
  constructor(
    private readonly skillsMutationService: SkillsMutationService,
    private readonly skillStore: SkillStore,
    private readonly projectionService: SkillProjectionService,
    private readonly homeDir: string = getHomeDir()
  ) {}

  /** Absolute path of the canonical skill file. */
  getPrimarySkillFilePath(): string {
    return this.skillStore.resolveSkillFilePath(
      this.skillStore.resolveLibrarySkillDir(MATTER_SKILL_SLUG)
    );
  }

  /** The library copy of the skill body, or null when it is absent/unreadable. */
  async readInstalledMarkdown(): Promise<string | null> {
    return this.skillStore.readSkillMarkdown(
      this.skillStore.resolveLibrarySkillDir(MATTER_SKILL_SLUG)
    );
  }

  private getLegacyCopies(): LegacyCopy[] {
    return [
      {
        label: '~/.claude/skills',
        skillDir: path.join(this.homeDir, '.claude', 'skills', MATTER_SKILL_SLUG),
        skillFile: path.join(this.homeDir, '.claude', 'skills', MATTER_SKILL_SLUG, SKILL_FILE),
      },
      {
        label: '~/.codex/skills',
        skillDir: path.join(this.homeDir, '.codex', 'skills', MATTER_SKILL_SLUG),
        skillFile: path.join(this.homeDir, '.codex', 'skills', MATTER_SKILL_SLUG, SKILL_FILE),
      },
    ];
  }

  /**
   * Moves the pre-library copies aside, returning the user's edited body when
   * they had one so the library inherits it. A pristine copy carries nothing:
   * the bundled text is already current. Copies that are neither pristine nor
   * the chosen seed are kept on disk under a `.superseded` name rather than
   * deleted, because they may hold edits the user still wants.
   */
  private async adoptLegacyCopies(): Promise<string | null> {
    let adopted: string | null = null;

    for (const copy of this.getLegacyCopies()) {
      let content: string;
      try {
        content = await fs.readFile(copy.skillFile, 'utf8');
      } catch {
        continue;
      }

      const pristine = isPristineBundledSkill(content);
      if (!pristine && adopted === null) {
        adopted = content;
        logger.info(`Adopting the edited ${MATTER_SKILL_SLUG} skill from ${copy.label}`);
      } else if (!pristine) {
        const supersededDir = `${copy.skillDir}.superseded`;
        try {
          await fs.rm(supersededDir, { recursive: true, force: true });
          await fs.rename(copy.skillDir, supersededDir);
          logger.warn(
            `Two edited ${MATTER_SKILL_SLUG} copies existed; kept ${copy.label} at ${supersededDir}`
          );
        } catch (error) {
          logger.warn(`Could not set aside the superseded copy in ${copy.label}`, error);
        }
        continue;
      }

      // Pristine, or already adopted: remove so the pointer can take its place.
      try {
        await fs.rm(copy.skillDir, { recursive: true, force: true });
      } catch (error) {
        logger.warn(
          `Could not remove the legacy ${MATTER_SKILL_SLUG} copy in ${copy.label}`,
          error
        );
      }
    }

    return adopted;
  }

  /**
   * Idempotent: creates the library copy when missing (inheriting a legacy
   * edited copy if there is one), upgrades a pristine older seed in place, and
   * (re)installs the pointers so both CLIs keep discovering it.
   */
  async seed(): Promise<void> {
    try {
      const librarySkillDir = this.skillStore.resolveLibrarySkillDir(MATTER_SKILL_SLUG);
      const existing = await this.skillStore.readSkillMarkdown(librarySkillDir);

      if (existing === null) {
        const adopted = await this.adoptLegacyCopies();
        await this.writeLibrarySkill(adopted ?? MATTER_SKILL_MARKDOWN);
        logger.info(
          adopted
            ? `Moved the user's ${MATTER_SKILL_SLUG} skill into the app library`
            : `Seeded the ${MATTER_SKILL_SLUG} skill into the app library`
        );
      } else if (LEGACY_SKILL_SHA256.has(sha256(existing))) {
        await this.writeLibrarySkill(MATTER_SKILL_MARKDOWN);
        logger.info(`Upgraded the pristine ${MATTER_SKILL_SLUG} skill in the app library`);
      }

      await this.projectionService.project(librarySkillDir, MATTER_SKILL_SLUG);
    } catch (error) {
      // Non-fatal: the refresh path falls back to the bundled markdown.
      logger.warn(`Could not seed the ${MATTER_SKILL_SLUG} skill`, error);
    }
  }

  private async writeLibrarySkill(content: string): Promise<void> {
    const files = [{ relativePath: SKILL_FILE, content }];
    const request = {
      scope: 'library' as const,
      rootKind: 'library' as const,
      folderName: MATTER_SKILL_SLUG,
      files,
    };
    const preview = await this.skillsMutationService.previewUpsert(request);
    await this.skillsMutationService.applyUpsert({ ...request, reviewPlanId: preview.planId });
  }
}
