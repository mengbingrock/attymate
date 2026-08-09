import { SkillProjectionService } from '@main/services/extensions/skills/SkillProjectionService';
import { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';
import { SkillStore } from '@main/services/extensions/skills/SkillStore';

import { LinkMatterEvidenceSourceAdapter } from '../adapters/output/link/LinkMatterEvidenceSourceAdapter';
import { MatterLinkCoordinator } from '../application/MatterLinkCoordinator';
import { MatterRefreshCoordinator } from '../application/MatterRefreshCoordinator';
import { MatterSkillSeeder } from '../infrastructure/MatterSkillSeeder';
import { normalizeMatterSnapshot } from '../infrastructure/matterSnapshot';
import { TeamMatterSkillProvisioner } from '../infrastructure/TeamMatterSkillProvisioner';
import { readTeamRuntimeFacts } from '../infrastructure/teamRuntimeFacts';

import type {
  MatterChanges,
  MatterEvidenceStatusDto,
  MatterLinkOperationResultDto,
  MatterRefreshResultDto,
  MatterSnapshotDto,
} from '../../contracts';
import type { MatterEvidenceSourcePort } from '../../core/application/ports/MatterEvidenceSourcePort';
import type { MatterLinkLeadNotifier } from '../application/MatterLinkCoordinator';
import type { MatterRefreshRequest } from '../application/MatterRefreshCoordinator';

/**
 * Store operations delegated to TeamDataService, which owns the controller —
 * the single writer of matter state. Raw returns are normalized here.
 */
export interface MatterStoreActions {
  getSnapshot(teamName: string): unknown;
  updateMatter(teamName: string, matterId: string, changes: MatterChanges): unknown;
  createMatter(teamName: string, init?: { caption?: string }): unknown;
  linkTeam(teamName: string, matterId: string): unknown;
  unlinkTeam(teamName: string, matterId: string): unknown;
  /** Apply/reject are user-approval actions that also notify the lead. */
  applyProposal(teamName: string): Promise<void>;
  rejectProposal(teamName: string, reason?: string): Promise<void>;
}

export interface MatterFeatureFacade {
  getSnapshot(teamName: string): Promise<MatterSnapshotDto>;
  updateMatter(
    teamName: string,
    matterId: string,
    changes: MatterChanges
  ): Promise<MatterSnapshotDto>;
  createMatter(teamName: string, init?: { caption?: string }): Promise<MatterSnapshotDto>;
  linkTeam(teamName: string, matterId: string): Promise<MatterSnapshotDto>;
  unlinkTeam(teamName: string, matterId: string): Promise<MatterSnapshotDto>;
  getLinkStatus(teamName: string): Promise<MatterEvidenceStatusDto>;
  initializeLink(teamName: string): Promise<MatterLinkOperationResultDto>;
  requestLinkRefresh(teamName: string): Promise<MatterLinkOperationResultDto>;
  requestLinkProposal(teamName: string, matterId?: string): Promise<MatterLinkOperationResultDto>;
  /** Ask the lead to (re)build the dashboard by following the matter skill. */
  requestDashboardRefresh(teamName: string, matterId?: string): Promise<MatterRefreshResultDto>;
  /** Same request, raised automatically when a job's last task completes. */
  requestJobWrapUpRefresh(
    teamName: string,
    completedTaskLabel?: string
  ): Promise<MatterRefreshResultDto>;
  applyProposal(teamName: string): Promise<MatterSnapshotDto>;
  rejectProposal(teamName: string, reason?: string): Promise<MatterSnapshotDto>;
  /**
   * Prepare this team's copy of the matter skill and point the runtimes at the
   * team's skills. Called at launch so the path named in bootstrap prompts
   * exists before the lead reads it.
   */
  prepareTeamSkills(teamName: string, projectPath?: string): Promise<void>;
  /** Reclaim those pointers when the team stops. */
  releaseTeamSkills(teamName: string, projectPath?: string): Promise<void>;
  /** Absolute path of this team's matter SKILL.md, for prompt text. */
  resolveTeamSkillFilePath(teamName: string): string;
}

export interface CreateMatterFeatureDeps {
  resolveProjectPath(teamName: string): Promise<string | null>;
  teamsBasePath: string;
  leadNotifier: MatterLinkLeadNotifier;
  actions: MatterStoreActions;
  /** Fired after every successful write so the renderer can refetch. */
  notifyMattersChanged?: () => void;
  /** Test/provider seam. Production uses the local Link CLI adapter. */
  evidenceSource?: MatterEvidenceSourcePort;
  /** Test seam for the library skill file. Production seeds and reads disk. */
  skillSeeder?: Pick<MatterSkillSeeder, 'seed' | 'readInstalledMarkdown'>;
  /** Test seam for each team's own copy of the skill. */
  teamSkillProvisioner?: Pick<
    TeamMatterSkillProvisioner,
    'ensure' | 'project' | 'release' | 'resolveSkillFilePath'
  >;
}

export function createMatterFeature(deps: CreateMatterFeatureDeps): MatterFeatureFacade {
  const evidenceSource = deps.evidenceSource ?? new LinkMatterEvidenceSourceAdapter();
  const linkCoordinator = new MatterLinkCoordinator({
    resolveProjectPath: (teamName) => deps.resolveProjectPath(teamName),
    evidenceSource,
    leadNotifier: deps.leadNotifier,
  });

  const skillStore = new SkillStore();
  const projectionService = new SkillProjectionService();
  const skillSeeder =
    deps.skillSeeder ??
    new MatterSkillSeeder(new SkillsMutationService(), skillStore, projectionService);
  // The skill is an ordinary library skill: written once when absent, then owned
  // by the user. Seeding is fire-and-forget because the refresh path falls back
  // to the bundled markdown if the file never lands.
  void skillSeeder.seed();

  // Each team gets its own copy, seeded from the library, so a team's edits and
  // its exported bundle stay independent of the machine-wide skill.
  const teamSkillProvisioner =
    deps.teamSkillProvisioner ??
    new TeamMatterSkillProvisioner(
      skillStore,
      () => skillSeeder.readInstalledMarkdown(),
      projectionService
    );

  const readSnapshot = async (teamName: string): Promise<MatterSnapshotDto> =>
    normalizeMatterSnapshot(deps.actions.getSnapshot(teamName));

  const changed = async (teamName: string): Promise<MatterSnapshotDto> => {
    deps.notifyMattersChanged?.();
    return readSnapshot(teamName);
  };

  const refreshCoordinator = new MatterRefreshCoordinator({
    readSnapshot,
    resolveRuntimeFacts: async (teamName) => ({
      projectPath: await deps.resolveProjectPath(teamName),
      ...(await readTeamRuntimeFacts(deps.teamsBasePath, teamName)),
    }),
    ensureTeamSkill: (teamName) => teamSkillProvisioner.ensure(teamName),
    leadNotifier: deps.leadNotifier,
  });
  const requestRefresh = (request: MatterRefreshRequest): Promise<MatterRefreshResultDto> =>
    refreshCoordinator.requestRefresh(request);

  return {
    getSnapshot: readSnapshot,
    updateMatter: async (teamName, matterId, changes) => {
      deps.actions.updateMatter(teamName, matterId, changes);
      return changed(teamName);
    },
    createMatter: async (teamName, init) => {
      deps.actions.createMatter(teamName, init);
      return changed(teamName);
    },
    linkTeam: async (teamName, matterId) => {
      deps.actions.linkTeam(teamName, matterId);
      return changed(teamName);
    },
    unlinkTeam: async (teamName, matterId) => {
      deps.actions.unlinkTeam(teamName, matterId);
      return changed(teamName);
    },
    getLinkStatus: (teamName) => linkCoordinator.getStatus(teamName),
    initializeLink: (teamName) => linkCoordinator.initialize(teamName),
    requestLinkRefresh: (teamName) => linkCoordinator.requestRefresh(teamName),
    requestLinkProposal: (teamName, matterId) =>
      linkCoordinator.requestProposal(teamName, matterId),
    requestDashboardRefresh: (teamName, matterId) =>
      requestRefresh({ teamName, trigger: 'user-refresh', ...(matterId ? { matterId } : {}) }),
    requestJobWrapUpRefresh: (teamName, completedTaskLabel) =>
      requestRefresh({
        teamName,
        trigger: 'job-wrap-up',
        ...(completedTaskLabel ? { completedTaskLabel } : {}),
      }),
    applyProposal: async (teamName) => {
      await deps.actions.applyProposal(teamName);
      return changed(teamName);
    },
    rejectProposal: async (teamName, reason) => {
      await deps.actions.rejectProposal(teamName, reason);
      return changed(teamName);
    },
    prepareTeamSkills: async (teamName, projectPath) => {
      await teamSkillProvisioner.ensure(teamName);
      await teamSkillProvisioner.project(teamName, projectPath);
    },
    releaseTeamSkills: (teamName, projectPath) =>
      teamSkillProvisioner.release(teamName, projectPath),
    resolveTeamSkillFilePath: (teamName) => teamSkillProvisioner.resolveSkillFilePath(teamName),
  };
}
