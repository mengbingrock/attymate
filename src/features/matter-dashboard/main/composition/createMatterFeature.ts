import { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

import { LinkMatterEvidenceSourceAdapter } from '../adapters/output/link/LinkMatterEvidenceSourceAdapter';
import { MatterLinkCoordinator } from '../application/MatterLinkCoordinator';
import { MatterRefreshCoordinator } from '../application/MatterRefreshCoordinator';
import { MatterSkillSeeder } from '../infrastructure/MatterSkillSeeder';
import { normalizeMatterSnapshot } from '../infrastructure/matterSnapshot';
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
  /** Test seam for the user-owned skill file. Production seeds and reads disk. */
  skillSeeder?: Pick<MatterSkillSeeder, 'seed' | 'readInstalledMarkdown'>;
}

export function createMatterFeature(deps: CreateMatterFeatureDeps): MatterFeatureFacade {
  const evidenceSource = deps.evidenceSource ?? new LinkMatterEvidenceSourceAdapter();
  const linkCoordinator = new MatterLinkCoordinator({
    resolveProjectPath: (teamName) => deps.resolveProjectPath(teamName),
    evidenceSource,
    leadNotifier: deps.leadNotifier,
  });

  const skillSeeder = deps.skillSeeder ?? new MatterSkillSeeder(new SkillsMutationService());
  // The skill is an ordinary user skill: written once when absent, then owned
  // by the user. Seeding is fire-and-forget because the refresh path falls back
  // to the bundled markdown if the file never lands.
  void skillSeeder.seed();

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
    readInstalledSkillMarkdown: () => skillSeeder.readInstalledMarkdown(),
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
  };
}
