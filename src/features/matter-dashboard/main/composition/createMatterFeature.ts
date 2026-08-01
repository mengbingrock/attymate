import { MatterFileReader } from '../infrastructure/MatterFileReader';

import type { MatterSnapshotDto } from '../../contracts';

export interface MatterProposalActions {
  applyProposal(teamName: string): Promise<void>;
  rejectProposal(teamName: string, reason?: string): Promise<void>;
}

export interface MatterFeatureFacade {
  getSnapshot(teamName: string): Promise<MatterSnapshotDto>;
  applyProposal(teamName: string): Promise<MatterSnapshotDto>;
  rejectProposal(teamName: string, reason?: string): Promise<MatterSnapshotDto>;
}

export interface CreateMatterFeatureDeps {
  teamsBasePath: string;
  /** Apply/reject are user-approval actions delegated to TeamDataService. */
  actions: MatterProposalActions;
}

export function createMatterFeature(deps: CreateMatterFeatureDeps): MatterFeatureFacade {
  const reader = new MatterFileReader(deps.teamsBasePath);
  return {
    getSnapshot: (teamName) => reader.getSnapshot(teamName),
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
