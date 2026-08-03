import type { MatterSnapshotDto } from './dto';
import type { MatterEvidenceStatusDto, MatterLinkOperationResultDto } from './evidence';

export interface MatterElectronApi {
  matter: {
    get(teamName: string): Promise<MatterSnapshotDto>;
    getLinkStatus(teamName: string): Promise<MatterEvidenceStatusDto>;
    initializeLink(teamName: string): Promise<MatterLinkOperationResultDto>;
    requestLinkRefresh(teamName: string): Promise<MatterLinkOperationResultDto>;
    requestLinkProposal(teamName: string): Promise<MatterLinkOperationResultDto>;
    applyProposal(teamName: string): Promise<MatterSnapshotDto>;
    rejectProposal(teamName: string, reason?: string): Promise<MatterSnapshotDto>;
  };
}
