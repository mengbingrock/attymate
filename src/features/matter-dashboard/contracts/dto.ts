import type { MatterEvidenceRefDto, MatterEvidenceSourceMode } from './evidence';

export const MATTER_SCHEMA_VERSION = 1;

export type MatterStageId = 'pleading' | 'discovery' | 'trial' | 'post';

export interface MatterFieldDto {
  label: string;
  value: string;
}

export interface MatterStageDto {
  id: MatterStageId;
  label?: string;
  dates?: string;
  summary?: string;
}

export interface MatterDeadlineDto {
  date: string;
  label: string;
}

export interface MatterPleadingDto {
  statusNote?: string;
  operativePleading?: string;
  pleadingType?: string;
  amendmentDeadline?: string;
  causesOfAction?: string;
}

export interface MatterDiscoveryRequestDto {
  type: string;
  set?: string;
  parties?: string;
  served?: string;
  due?: string;
  status?: string;
}

export interface MatterMeetConferDto {
  date?: string;
  method?: string;
  outcome?: string;
  notes?: string;
}

export interface MatterPendingMotionDto {
  motionType?: string;
  relatedRequest?: string;
  reservation?: string;
  filed?: string;
  oppositionDue?: string;
  replyDue?: string;
  hearing?: string;
  outcome?: string;
}

export interface MatterProductionDto {
  type: string;
  bates?: string;
  date?: string;
}

export interface MatterDepositionDto {
  name: string;
  taken?: string;
  review?: string;
  note?: string;
}

export interface MatterDiscoveryDto {
  statusNote?: string;
  requests?: MatterDiscoveryRequestDto[];
  meetConfer?: MatterMeetConferDto;
  pendingMotion?: MatterPendingMotionDto;
  productions?: MatterProductionDto[];
  depositions?: MatterDepositionDto[];
}

export interface MatterPretrialDeadlineDto {
  title: string;
  due?: string;
  source?: string;
  status?: string;
}

export interface MatterWitnessDto {
  name: string;
  role?: string;
  party?: string;
  availability?: string;
}

export interface MatterExhibitDto {
  number: string;
  title: string;
  admission?: string;
}

export interface MatterTrialDto {
  statusNote?: string;
  trialDate?: string;
  trialType?: string;
  estimatedDuration?: string;
  settingStatus?: string;
  pretrialDeadlines?: MatterPretrialDeadlineDto[];
  witnesses?: MatterWitnessDto[];
  exhibits?: MatterExhibitDto[];
  continuancesNote?: string;
}

export interface MatterPostJudgmentDto {
  statusNote?: string;
  judgmentStatus?: string;
  judgmentDate?: string;
  judgmentAmount?: string;
  enforcementStatus?: string;
  enforcementDeadline?: string;
  enforcementActions?: string;
}

/**
 * The updatable sections of the matter dashboard. Mirrors the view's fixture
 * structures 1:1 (see MatterDashboardView.tsx) — deliberately not a "proper"
 * domain model in v1 so live values can override fixtures mechanically.
 */
export interface MatterChanges {
  caption?: string;
  status?: string;
  matterNumber?: string;
  currentStage?: MatterStageId;
  coreFields?: MatterFieldDto[];
  systemFields?: MatterFieldDto[];
  stages?: MatterStageDto[];
  nextDeadline?: MatterDeadlineDto;
  pleading?: MatterPleadingDto;
  discovery?: MatterDiscoveryDto;
  trial?: MatterTrialDto;
  postJudgment?: MatterPostJudgmentDto;
}

export interface MatterDto extends MatterChanges {
  schemaVersion: typeof MATTER_SCHEMA_VERSION;
  updatedAt?: string;
  /** Team member whose approved proposal produced the current state. */
  updatedBy?: string;
  /** Who confirmed the last applied proposal (always the human operator). */
  approvedBy?: string;
}

/**
 * A pending, not-yet-applied dashboard update submitted by the lead after a
 * job's tasks finished. Presence of the proposal file means "awaiting user
 * review" — there is no status field. Applying merges `changes` into the
 * matter (sections shallow-merged, arrays replaced wholesale) and deletes the
 * proposal; rejecting just deletes it.
 */
export interface MatterProposalDto {
  schemaVersion: typeof MATTER_SCHEMA_VERSION;
  proposedAt: string;
  proposedBy: string;
  /** Human-readable "what changed" list, one bullet per established fact. */
  summary: string[];
  changes: MatterChanges;
  /** Task ids the facts were established by. */
  taskRefs?: string[];
  /** How the proposing lead found the supporting case evidence. */
  sourceMode?: MatterEvidenceSourceMode;
  /** Fingerprint of the bounded evidence packet used for this proposal. */
  sourceRevision?: string;
  /** Source references supporting the proposed fields. */
  evidence?: MatterEvidenceRefDto[];
}

export interface MatterSnapshotDto {
  matter: MatterDto | null;
  proposal: MatterProposalDto | null;
}
