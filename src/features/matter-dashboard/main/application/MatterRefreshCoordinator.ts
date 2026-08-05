import { MATTER_SKILL_MARKDOWN } from '../../core/domain/matterSkillDefinition';

import { buildMatterSkillInvocationPrompt } from './MatterSkillLeadPrompt';

import type { MatterRefreshResultDto } from '../../contracts';
import type { MatterRefreshTrigger } from './MatterSkillLeadPrompt';

/** Runtime facts the skill prompt needs but the skill itself must not encode. */
export interface MatterTeamRuntimeFacts {
  projectPath: string | null;
  hasTeammates: boolean;
  /** False for codex lanes, whose teammates are launched by the app. */
  canSpawnTeammates: boolean;
}

export interface MatterRefreshLeadNotifier {
  notifyLead(teamName: string, summary: string, text: string): Promise<void>;
}

export interface MatterRefreshCoordinatorDeps {
  isMatterEmpty(teamName: string): Promise<boolean>;
  resolveRuntimeFacts(teamName: string): Promise<MatterTeamRuntimeFacts>;
  /** The user's SKILL.md when it exists; null falls back to the bundled copy. */
  readInstalledSkillMarkdown(): Promise<string | null>;
  leadNotifier: MatterRefreshLeadNotifier;
}

export interface MatterRefreshRequest {
  teamName: string;
  trigger: MatterRefreshTrigger;
  completedTaskLabel?: string;
}

/**
 * Asks the team lead to bring the matter dashboard up to date, by delivering
 * the matter-dashboard skill plus this team's situational parameters.
 *
 * One path serves both entry points: the dashboard's Refresh button and the
 * automatic job wrap-up nudge.
 */
export class MatterRefreshCoordinator {
  constructor(private readonly deps: MatterRefreshCoordinatorDeps) {}

  async requestRefresh(request: MatterRefreshRequest): Promise<MatterRefreshResultDto> {
    const { teamName } = request;
    const [empty, facts, installedMarkdown] = await Promise.all([
      this.deps.isMatterEmpty(teamName),
      this.deps.resolveRuntimeFacts(teamName),
      this.deps.readInstalledSkillMarkdown(),
    ]);

    const mode = empty ? 'initial-scan' : 'update';
    const text = buildMatterSkillInvocationPrompt({
      teamName,
      projectPath: facts.projectPath,
      mode,
      hasTeammates: facts.hasTeammates,
      canSpawnTeammates: facts.canSpawnTeammates,
      skillMarkdown: installedMarkdown ?? MATTER_SKILL_MARKDOWN,
      trigger: request.trigger,
      ...(request.completedTaskLabel ? { completedTaskLabel: request.completedTaskLabel } : {}),
    });

    try {
      await this.deps.leadNotifier.notifyLead(
        teamName,
        mode === 'initial-scan' ? 'Scan the case folder' : 'Refresh matter dashboard',
        text
      );
    } catch (error) {
      // A team that has never been launched has no lead to address yet. That is
      // a state to explain, not an error to throw at the dashboard.
      return {
        accepted: false,
        mode,
        usedInstalledSkill: installedMarkdown !== null,
        message: `The request could not be delivered: ${
          error instanceof Error ? error.message : String(error)
        }. Launch the team first.`,
      };
    }

    return {
      accepted: true,
      mode,
      usedInstalledSkill: installedMarkdown !== null,
      message:
        mode === 'initial-scan'
          ? 'The team lead was asked to scan the case folder and propose an initial dashboard.'
          : 'The team lead was asked to compile changes and propose a dashboard update.',
    };
  }
}
