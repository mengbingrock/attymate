import type { MatterChanges, MatterSnapshotDto } from './dto';
import type {
  MatterEvidenceStatusDto,
  MatterLinkOperationResultDto,
  MatterRefreshResultDto,
} from './evidence';

export interface MatterElectronApi {
  matter: {
    get(teamName: string): Promise<MatterSnapshotDto>;
    /** Persist a user-authored edit straight into the matter (no proposal). */
    update(teamName: string, matterId: string, changes: MatterChanges): Promise<MatterSnapshotDto>;
    create(teamName: string, init?: { caption?: string }): Promise<MatterSnapshotDto>;
    linkTeam(teamName: string, matterId: string): Promise<MatterSnapshotDto>;
    unlinkTeam(teamName: string, matterId: string): Promise<MatterSnapshotDto>;
    getLinkStatus(teamName: string): Promise<MatterEvidenceStatusDto>;
    initializeLink(teamName: string): Promise<MatterLinkOperationResultDto>;
    requestLinkRefresh(teamName: string): Promise<MatterLinkOperationResultDto>;
    requestLinkProposal(teamName: string, matterId?: string): Promise<MatterLinkOperationResultDto>;
    requestRefresh(teamName: string, matterId?: string): Promise<MatterRefreshResultDto>;
    applyProposal(teamName: string): Promise<MatterSnapshotDto>;
    rejectProposal(teamName: string, reason?: string): Promise<MatterSnapshotDto>;
    onMattersChanged(listener: () => void): () => void;
  };
}
