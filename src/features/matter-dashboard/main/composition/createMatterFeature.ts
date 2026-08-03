import { LinkMatterEvidenceSourceAdapter } from '../adapters/output/link/LinkMatterEvidenceSourceAdapter';
import { MatterLinkCoordinator } from '../application/MatterLinkCoordinator';
import { MatterFileReader } from '../infrastructure/MatterFileReader';

import type {
  MatterEvidenceStatusDto,
  MatterLinkOperationResultDto,
  MatterSnapshotDto,
} from '../../contracts';
import type { MatterEvidenceSourcePort } from '../../core/application/ports/MatterEvidenceSourcePort';
import type { MatterLinkLeadNotifier } from '../application/MatterLinkCoordinator';

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
}

export function createMatterFeature(deps: CreateMatterFeatureDeps): MatterFeatureFacade {
  const reader = new MatterFileReader(deps.teamsBasePath);
  const evidenceSource = deps.evidenceSource ?? new LinkMatterEvidenceSourceAdapter();
  const linkCoordinator = new MatterLinkCoordinator({
    resolveProjectPath: (teamName) => deps.resolveProjectPath(teamName),
    evidenceSource,
    leadNotifier: deps.leadNotifier,
  });
  return {
    getSnapshot: (teamName) => reader.getSnapshot(teamName),
    getLinkStatus: (teamName) => linkCoordinator.getStatus(teamName),
    initializeLink: (teamName) => linkCoordinator.initialize(teamName),
    requestLinkRefresh: (teamName) => linkCoordinator.requestRefresh(teamName),
    requestLinkProposal: (teamName) => linkCoordinator.requestProposal(teamName),
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
