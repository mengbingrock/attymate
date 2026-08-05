import type { TeamExportRequest, TeamExportResult } from './dto';

export interface TeamExportElectronApi {
  teamExport: {
    run(request: TeamExportRequest): Promise<TeamExportResult | null>;
  };
}
