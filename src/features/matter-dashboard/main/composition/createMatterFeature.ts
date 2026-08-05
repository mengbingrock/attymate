import { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';

import { LinkMatterEvidenceSourceAdapter } from '../adapters/output/link/LinkMatterEvidenceSourceAdapter';
import { MatterLinkCoordinator } from '../application/MatterLinkCoordinator';
import { MatterRefreshCoordinator } from '../application/MatterRefreshCoordinator';
import { MatterFileReader } from '../infrastructure/MatterFileReader';
import { isMatterEffectivelyEmpty } from '../infrastructure/matterScanState';
import { MatterSkillSeeder } from '../infrastructure/MatterSkillSeeder';
import { readTeamRuntimeFacts } from '../infrastructure/teamRuntimeFacts';

import type {
  MatterEvidenceStatusDto,
  MatterLinkOperationResultDto,
  MatterRefreshResultDto,
  MatterSnapshotDto,
} from '../../contracts';
import type { MatterEvidenceSourcePort } from '../../core/application/ports/MatterEvidenceSourcePort';
import type { MatterLinkLeadNotifier } from '../application/MatterLinkCoordinator';
import type { MatterRefreshRequest } from '../application/MatterRefreshCoordinator';

export interface MatterProposalActions {
  applyProposal(teamName: string): Promise<void>;
  rejectProposal(teamName: string, reason?: string): Promise<void>;
}

export interface MatterFeatureFacade {
  getSnapshot(teamName: string): Promise<MatterSnapshotDto>;
  getLinkStatus(teamName: string): Promise<MatterEvidenceStatusDto>;
  initializeLink(teamName: string): Promise<MatterLinkOperationResultDto>;
  requestLinkRefresh(teamName: string): Promise<MatterLinkOperationResultDto>;
  requestLinkProposal(teamName: string): Promise<MatterLinkOperationResultDto>;
  /** Ask the lead to (re)build the dashboard by following the matter skill. */
  requestDashboardRefresh(teamName: string): Promise<MatterRefreshResultDto>;
  /** Same request, raised automatically when a job's last task completes. */
  requestJobWrapUpRefresh(
    teamName: string,
    completedTaskLabel?: string
  ): Promise<MatterRefreshResultDto>;
  applyProposal(teamName: string): Promise<MatterSnapshotDto>;
  rejectProposal(teamName: string, reason?: string): Promise<MatterSnapshotDto>;
}

export interface CreateMatterFeatureDeps {
  teamsBasePath: string;
  resolveProjectPath(teamName: string): Promise<string | null>;
  leadNotifier: MatterLinkLeadNotifier;
  /** Apply/reject are user-approval actions delegated to TeamDataService. */
  actions: MatterProposalActions;
  /** Test/provider seam. Production uses the local Link CLI adapter. */
  evidenceSource?: MatterEvidenceSourcePort;
  /** Test seam for the user-owned skill file. Production seeds and reads disk. */
  skillSeeder?: Pick<MatterSkillSeeder, 'seed' | 'readInstalledMarkdown'>;
}

export function createMatterFeature(deps: CreateMatterFeatureDeps): MatterFeatureFacade {
  const reader = new MatterFileReader(deps.teamsBasePath);
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

  const refreshCoordinator = new MatterRefreshCoordinator({
    isMatterEmpty: (teamName) => isMatterEffectivelyEmpty(deps.teamsBasePath, teamName),
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
    getSnapshot: (teamName) => reader.getSnapshot(teamName),
    getLinkStatus: (teamName) => linkCoordinator.getStatus(teamName),
    initializeLink: (teamName) => linkCoordinator.initialize(teamName),
    requestLinkRefresh: (teamName) => linkCoordinator.requestRefresh(teamName),
    requestLinkProposal: (teamName) => linkCoordinator.requestProposal(teamName),
    requestDashboardRefresh: (teamName) => requestRefresh({ teamName, trigger: 'user-refresh' }),
    requestJobWrapUpRefresh: (teamName, completedTaskLabel) =>
      requestRefresh({
        teamName,
        trigger: 'job-wrap-up',
        ...(completedTaskLabel ? { completedTaskLabel } : {}),
      }),
    applyProposal: async (teamName) => {
      await deps.actions.applyProposal(teamName);
      return reader.getSnapshot(teamName);
    },
    rejectProposal: async (teamName, reason) => {
      await deps.actions.rejectProposal(teamName, reason);
      return reader.getSnapshot(teamName);
    },
  };
}
