import { CreateTeamImportDraftUseCase } from '../../core/application/use-cases/CreateTeamImportDraftUseCase';
import { ReviewTeamImportUseCase } from '../../core/application/use-cases/ReviewTeamImportUseCase';
import { SmartPreviewTeamImportUseCase } from '../../core/application/use-cases/SmartPreviewTeamImportUseCase';
import { ClaudeCliBundleParser } from '../infrastructure/ClaudeCliBundleParser';
import { ElectronTeamImportFolderPicker } from '../infrastructure/ElectronTeamImportFolderPicker';
import { ElectronWebPageSource } from '../infrastructure/ElectronWebPageSource';
import { InMemoryTeamImportReviewStore } from '../infrastructure/InMemoryTeamImportReviewStore';
import { SafeArbitraryFolderRawSource } from '../infrastructure/SafeArbitraryFolderRawSource';
import { SafeLocalTeamImportFolderSource } from '../infrastructure/SafeLocalTeamImportFolderSource';
import { SkillsMutationInstaller } from '../infrastructure/SkillsMutationInstaller';
import { TeamAgentFilesWriter } from '../infrastructure/TeamAgentFilesWriter';
import { TeamDataImportDraftRepository } from '../infrastructure/TeamDataImportDraftRepository';

import type { TeamImportProgressPort } from '../../core/application/ports/TeamImportProgressPort';
import type {
  CreateTeamImportDraftRequest,
  CreateTeamImportDraftResult,
  TeamImportPreview,
  TeamImportSourceRequest,
} from '@features/team-import/contracts';
import type { SkillsMutationService } from '@main/services/extensions/skills/SkillsMutationService';
import type { TeamDataService } from '@main/services/team/TeamDataService';

export interface TeamImportFeatureFacade {
  chooseFolderAndPreview(): Promise<TeamImportPreview | null>;
  smartPreview(
    request: TeamImportSourceRequest,
    progress?: TeamImportProgressPort
  ): Promise<TeamImportPreview | null>;
  createDraft(request: CreateTeamImportDraftRequest): Promise<CreateTeamImportDraftResult>;
}

export interface TeamImportFeatureDependencies {
  teamDataService: TeamDataService;
  skillsMutationService: SkillsMutationService;
}

const NO_PROGRESS: TeamImportProgressPort = { report: () => undefined };

export function createTeamImportFeature(
  dependencies: TeamImportFeatureDependencies
): TeamImportFeatureFacade {
  const reviewStore = new InMemoryTeamImportReviewStore();
  const folderPicker = new ElectronTeamImportFolderPicker();
  const deterministicSource = new SafeLocalTeamImportFolderSource();
  const skillsInstaller = new SkillsMutationInstaller(dependencies.skillsMutationService);

  const reviewUseCase = new ReviewTeamImportUseCase(folderPicker, deterministicSource, reviewStore);
  const smartPreviewUseCase = new SmartPreviewTeamImportUseCase(
    folderPicker,
    deterministicSource,
    new SafeArbitraryFolderRawSource(),
    new ElectronWebPageSource(),
    new ClaudeCliBundleParser(),
    skillsInstaller,
    reviewStore
  );
  const createDraftUseCase = new CreateTeamImportDraftUseCase(
    reviewStore,
    new TeamDataImportDraftRepository(dependencies.teamDataService),
    new TeamAgentFilesWriter(),
    skillsInstaller
  );

  return {
    chooseFolderAndPreview: () => reviewUseCase.execute(),
    smartPreview: (request, progress) =>
      smartPreviewUseCase.execute(request, progress ?? NO_PROGRESS),
    createDraft: (request) => createDraftUseCase.execute(request),
  };
}
