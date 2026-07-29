import type { TeamImportBundleFile } from '@features/team-import/contracts';

export interface TeamImportAgentFilesWriterPort {
  /** Absolute per-agent directory (~/.claude/teams/<team>/agents/<member>) without creating it. */
  resolveAgentDir(teamName: string, memberName: string): string;
  writeAgentFiles(
    teamName: string,
    memberName: string,
    files: readonly TeamImportBundleFile[]
  ): Promise<void>;
}
