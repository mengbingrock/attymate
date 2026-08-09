export type MatterEvidenceSourceMode = 'direct-scan' | 'link';

export type MatterEvidenceStatusState =
  | 'project-unresolved'
  | 'source-unavailable'
  | 'not-initialized'
  | 'blocked'
  | 'stale'
  | 'pending'
  | 'empty'
  | 'ready'
  | 'error';

export interface MatterEvidenceCountsDto {
  sourceFiles: number;
  sourcePages: number;
  representedFiles: number;
  pendingFiles: number;
  staleFiles: number;
  secretWarnings: number;
}

/**
 * Read-only health snapshot for a dashboard evidence provider. The first
 * provider is Link; keeping the DTO provider-neutral lets direct scanning or
 * another retrieval source implement the same feature boundary later.
 */
export interface MatterEvidenceStatusDto {
  source: MatterEvidenceSourceMode;
  checkedAt: string;
  projectPath: string | null;
  state: MatterEvidenceStatusState;
  /** True when the provider executable/runtime responded. */
  available: boolean;
  /** True only when the provider has current evidence that is safe to query. */
  queryReady: boolean;
  summary: string;
  /** Provider-native state retained for diagnostics without driving UI policy. */
  providerState?: string;
  counts: MatterEvidenceCountsDto;
}

export interface MatterEvidenceRefDto {
  /** Link wiki page or source path used to support the proposed change. */
  path: string;
  source?: string;
  title?: string;
  page?: number;
  section?: string;
  dateUpdated?: string;
  relationship?: string;
  /** Matter field paths supported by this source, filled by the proposing lead. */
  fieldPaths?: string[];
}

/** Whether the lead was asked for a first scan or an incremental update. */
export type MatterRefreshMode = 'initial-scan' | 'update';

export interface MatterRefreshResultDto {
  accepted: boolean;
  mode: MatterRefreshMode;
  message: string;
  /**
   * True when the lead was pointed at this team's own copy of the skill; false
   * when that copy could not be prepared and the bundled workflow was inlined.
   */
  usedInstalledSkill: boolean;
}

export type MatterLinkOperation = 'initialize' | 'refresh-request' | 'proposal-request';

export interface MatterLinkOperationResultDto {
  operation: MatterLinkOperation;
  accepted: boolean;
  message: string;
  status: MatterEvidenceStatusDto;
  sourceRevision?: string;
  evidenceCount?: number;
}
