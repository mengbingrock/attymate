import type { TeamImportRawSourceDump } from '../../domain/teamImportLlmPrompt';

/** Bounded reader that flattens an arbitrary local folder into a text dump. */
export interface TeamImportRawSourcePort {
  readFolder(folderPath: string): Promise<TeamImportRawSourceDump>;
}

/** Bounded fetcher that flattens a webpage into a text dump. */
export interface TeamImportWebSourcePort {
  fetchPage(url: string): Promise<TeamImportRawSourceDump>;
}
