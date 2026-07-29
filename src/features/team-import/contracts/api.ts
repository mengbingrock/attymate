import type {
  CreateTeamImportDraftRequest,
  CreateTeamImportDraftResult,
  TeamImportJobProgress,
  TeamImportPreview,
  TeamImportSourceRequest,
} from './dto';

export interface TeamImportApi {
  chooseFolderAndPreview(): Promise<TeamImportPreview | null>;
  smartPreview(request: TeamImportSourceRequest): Promise<TeamImportPreview | null>;
  createDraft(request: CreateTeamImportDraftRequest): Promise<CreateTeamImportDraftResult>;
  onJobProgress(listener: (progress: TeamImportJobProgress) => void): () => void;
}
