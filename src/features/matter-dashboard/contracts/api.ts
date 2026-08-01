import type { MatterSnapshotDto } from './dto';

export interface MatterElectronApi {
  matter: {
    get(teamName: string): Promise<MatterSnapshotDto>;
    applyProposal(teamName: string): Promise<MatterSnapshotDto>;
    rejectProposal(teamName: string, reason?: string): Promise<MatterSnapshotDto>;
  };
}
