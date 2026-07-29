import type { TeamImportJobProgress } from '@features/team-import/contracts';

export interface TeamImportProgressPort {
  report(progress: TeamImportJobProgress): void;
}
