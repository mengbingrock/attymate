import type { TeamProvisioningMemberInput } from '@shared/types/team';

export type TeamImportWarning =
  | { code: 'unsafeTaskCall'; call: string }
  | { code: 'unknownTaskOwner'; description: string; owner: string }
  | { code: 'memberReserved'; fileName: string; name: string }
  | { code: 'memberInvalid'; fileName: string; name: string }
  | { code: 'memberReservedSuffix'; fileName: string; name: string }
  | { code: 'duplicateMember'; fileName: string; name: string }
  | { code: 'missingClaudeMd' }
  | { code: 'bundleMemberDropped'; name: string; reason: string }
  | { code: 'bundleSkillDropped'; slug: string; reason: string }
  | { code: 'bundleFileDropped'; path: string; reason: string }
  | { code: 'bundleSourceTruncated' };

export const TEAM_IMPORT_BUNDLE_SCHEMA = 'team-import-bundle/v1';

export interface TeamImportBundleFile {
  relativePath: string;
  content: string;
}

/**
 * Claude Code subagent-definition frontmatter captured from the source, so an
 * imported member can be re-emitted as a standard `.claude/agents/<name>.md`
 * definition. Every field is optional and only present when grounded in the
 * source material. Mirrors https://code.claude.com/docs/en/sub-agents.
 */
export interface TeamImportAgentDefinition {
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  permissionMode?: string;
  maxTurns?: number;
  skills?: string[];
  mcpServers?: string[];
  hooks?: Record<string, unknown>;
  memory?: 'user' | 'project' | 'local';
}

export interface TeamImportBundleMember {
  name: string;
  role: string;
  workflow: string;
  skills: string[];
  memoryFiles: TeamImportBundleFile[];
  agentDefinition?: TeamImportAgentDefinition;
}

export interface TeamImportBundleSkill {
  slug: string;
  description: string;
  files: TeamImportBundleFile[];
}

export interface TeamImportBundle {
  schema: typeof TEAM_IMPORT_BUNDLE_SCHEMA;
  team: { name: string; description?: string; leadPrompt?: string };
  members: TeamImportBundleMember[];
  skills: TeamImportBundleSkill[];
}

export type TeamImportSourceRequest =
  | { kind: 'folder'; smart: boolean; folderPath?: string }
  | { kind: 'url'; url: string };

export type TeamImportJobStage = 'reading' | 'fetching' | 'parsing' | 'validating';

export interface TeamImportJobProgress {
  stage: TeamImportJobStage;
  /** Seconds since the current stage started (reported for long stages). */
  elapsedSeconds?: number;
  /** Characters of model output streamed so far during the parsing stage. */
  receivedChars?: number;
}

export interface TeamImportSkillPlan {
  slug: string;
  description: string;
  fileCount: number;
  alreadyExists: boolean;
}

export interface TeamImportMemberDetail {
  name: string;
  role: string;
  skills: string[];
  memoryFileCount: number;
}

export interface TeamImportPreview {
  reviewId: string;
  importKind: 'deterministic' | 'smart';
  suggestedTeamName: string;
  projectPath: string;
  sourceLabel?: string;
  teamDescription?: string;
  members: TeamProvisioningMemberInput[];
  memberDetails?: TeamImportMemberDetail[];
  prompt?: string;
  skillsFound: string[];
  skillPlans?: TeamImportSkillPlan[];
  warnings: TeamImportWarning[];
  blockingErrors: string[];
}

export interface CreateTeamImportDraftRequest {
  reviewId: string;
  teamName: string;
}

export interface CreateTeamImportDraftResult {
  teamName: string;
  applyWarnings?: string[];
}
