import { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';
import { createLogger } from '@shared/utils/logger';

import { MATTER_SKILL_MARKDOWN, MATTER_SKILL_SLUG } from '../../core/domain/matterSkillDefinition';

import { isPristineBundledSkill } from './MatterSkillSeeder';

const logger = createLogger('Feature:Matter:TeamSkill');

export interface EnsuredTeamMatterSkill {
  /** Absolute path of this team's SKILL.md — what the lead is told to read. */
  filePath: string;
  skillDir: string;
  markdown: string;
  source: 'team' | 'seeded-from-library' | 'seeded-from-bundled';
}

/**
 * Gives each team its own copy of the matter workflow.
 *
 * A team's copy is what its lead follows, what the user edits for that matter,
 * and what travels in the team's export bundle — so two teams can run
 * different versions of the workflow without touching each other or the
 * machine-wide library copy.
 */
export class TeamMatterSkillProvisioner {
  constructor(
    private readonly skillStore: SkillStore,
    private readonly readLibraryMarkdown: () => Promise<string | null>,
    private readonly projectionService?: SkillProjectionService
  ) {}

  /**
   * Production wiring: the library copy is the seed source, and pointers go
   * into every runtime's skills folder.
   */
  static create(): TeamMatterSkillProvisioner {
    const store = new SkillStore();
    return new TeamMatterSkillProvisioner(
      store,
      () => store.readSkillMarkdown(store.resolveLibrarySkillDir(MATTER_SKILL_SLUG)),
      new SkillProjectionService()
    );
  }

  resolveSkillFilePath(teamName: string): string {
    return this.skillStore.resolveSkillFilePath(
      this.skillStore.resolveTeamSkillDir(teamName, MATTER_SKILL_SLUG)
    );
  }

  /**
   * Idempotent. Returns null only when the team's copy can be neither read nor
   * written, which leaves the caller to fall back to the bundled text.
   */
  async ensure(teamName: string): Promise<EnsuredTeamMatterSkill | null> {
    let skillDir: string;
    try {
      skillDir = this.skillStore.resolveTeamSkillDir(teamName, MATTER_SKILL_SLUG);
    } catch (error) {
      logger.warn(`Cannot resolve the ${MATTER_SKILL_SLUG} skill dir for "${teamName}"`, error);
      return null;
    }
    const filePath = this.skillStore.resolveSkillFilePath(skillDir);

    try {
      const existing = await this.skillStore.readSkillMarkdown(skillDir);
      if (existing !== null && !isPristineBundledSkill(existing)) {
        return { filePath, skillDir, markdown: existing, source: 'team' };
      }

      // Absent, or a copy of a shipped version nobody has edited: (re)seed so a
      // stale bundled workflow does not outlive an app upgrade.
      const library = await this.readLibraryMarkdown().catch(() => null);
      const markdown = library?.trim() ? library : MATTER_SKILL_MARKDOWN;
      await this.skillStore.writeSkill(
        skillDir,
        [{ relativePath: 'SKILL.md', content: markdown }],
        { overwrite: true }
      );

      return {
        filePath,
        skillDir,
        markdown,
        source: library?.trim() ? 'seeded-from-library' : 'seeded-from-bundled',
      };
    } catch (error) {
      logger.warn(`Could not prepare the ${MATTER_SKILL_SLUG} skill for "${teamName}"`, error);
      return null;
    }
  }

  /** Point the runtimes at this team's skills while the team is running. */
  async project(teamName: string, projectPath?: string): Promise<void> {
    if (!this.projectionService) return;
    try {
      const teamSkillsRoot = this.skillStore.resolveTeamSkillsDir(teamName);
      // Interactive runs are not adopted after an app restart. Reclaim any
      // recorded pointers from that team's previous run before installing the
      // current launch projection, so a crashed run cannot shadow this one.
      await this.projectionService.releaseUnder(teamSkillsRoot);
      for (const slug of await this.skillStore.listTeamSlugs(teamName)) {
        await this.projectionService.project(
          this.skillStore.resolveTeamSkillDir(teamName, slug),
          slug,
          projectPath?.trim() ? { projectPath: projectPath.trim() } : undefined
        );
      }
    } catch (error) {
      logger.warn(`Could not project team skills for "${teamName}"`, error);
    }
  }

  /** Reclaim those pointers when the team stops. */
  async release(teamName: string, projectPath?: string): Promise<void> {
    if (!this.projectionService) return;
    try {
      await this.projectionService.releaseUnder(
        this.skillStore.resolveTeamSkillsDir(teamName),
        projectPath?.trim() ? { projectPath: projectPath.trim() } : undefined
      );
    } catch (error) {
      logger.warn(`Could not release team skill pointers for "${teamName}"`, error);
    }
  }
}
