import type { MatterEvidenceRefDto, MatterEvidenceSourceMode } from './evidence';

/**
 * v2: matters are firm-level entities in the app's own store, independent of
 * any team or AI runtime. Keep this constant in sync with
 * agent-teams-controller/src/internal/matterStore.js and
 * mcp-server/src/tools/matterTools.ts (no shared import across packages).
 */
export const MATTER_SCHEMA_VERSION = 2;
export const MATTER_LEGACY_SCHEMA_VERSION = 1;

export type MatterStageId = 'pleading' | 'discovery' | 'trial' | 'settlement' | 'post';

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

/**
 * A party to the matter. `side` and `kind` hold display strings ("Our client",
 * "Corporation", …) — the tone system maps words to colors, same as statuses.
 */
export interface MatterPartyDto {
  id: string;
  name: string;
  /** Designation in this matter, e.g. "Defendant · Cross-Complainant". */
  role?: string;
  side?: string;
  kind?: string;
  contact?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

/** Counsel of record. Without a `partyId` it lists under "not linked". */
export interface MatterCounselDto {
  id: string;
  partyId?: string;
  name: string;
  role?: string;
  firm?: string;
  bar?: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}

export interface MatterPleadingRecordDto {
  id: string;
  /** Filing party; records without one render in the Unassigned column. */
  partyId?: string;
  type: string;
  status?: string;
  filed?: string;
  served?: string;
  responseDue?: string;
  responseFiled?: string;
  related?: string;
  amendmentDue?: string;
  claims?: string;
  dir?: string;
}

export interface MatterPleadingDto {
  statusNote?: string;
  records?: MatterPleadingRecordDto[];
}

export interface MatterDiscoveryRequestDto {
  id: string;
  type: string;
  set?: string;
  parties?: string;
  issued?: string;
  served?: string;
  due?: string;
  prodDue?: string;
  status?: string;
  dir?: string;
}

export interface MatterMotionDto {
  id: string;
  type: string;
  outcome?: string;
  movingParty?: string;
  request?: string;
  reservation?: string;
  filed?: string;
  oppositionDue?: string;
  replyDue?: string;
  hearing?: string;
  ruled?: string;
  issues?: string;
  dir?: string;
}

export interface MatterMeetConferDto {
  id: string;
  date?: string;
  method?: string;
  outcome?: string;
  participants?: string;
  dispute?: string;
  next?: string;
  dir?: string;
}

export interface MatterProductionDto {
  id: string;
  type: string;
  bates?: string;
  date?: string;
  party?: string;
  dir?: string;
}

export interface MatterDepositionDto {
  id: string;
  name: string;
  taken?: string;
  review?: string;
  note?: string;
  dir?: string;
}

export interface MatterDiscoveryDto {
  statusNote?: string;
  requests?: MatterDiscoveryRequestDto[];
  motions?: MatterMotionDto[];
  meetAndConfers?: MatterMeetConferDto[];
  productions?: MatterProductionDto[];
  depositions?: MatterDepositionDto[];
}

export interface MatterTrialSettingDto {
  id: string;
  type?: string;
  setAt?: string;
  trialDate?: string;
  days?: string;
  venue?: string;
  status?: string;
}

export interface MatterContinuanceDto {
  id: string;
  /** "Requested by · original date → new date · ruling · reason". */
  text: string;
}

export interface MatterPretrialDeadlineDto {
  id: string;
  title: string;
  due?: string;
  source?: string;
  status?: string;
}

export interface MatterPretrialFilingDto {
  id: string;
  title: string;
  party?: string;
  due?: string;
  filed?: string;
  dir?: string;
}

export interface MatterWitnessDto {
  id: string;
  name: string;
  role?: string;
  party?: string;
  availability?: string;
  topics?: string;
  docs?: string;
}

export interface MatterExhibitDto {
  id: string;
  number: string;
  title: string;
  admission?: string;
  foundation?: string;
  objections?: string;
  dir?: string;
}

export interface MatterMotionInLimineDto {
  id: string;
  number?: string;
  issue?: string;
  party?: string;
  filed?: string;
  hearing?: string;
  outcome?: string;
  dir?: string;
}

export interface MatterTrialSessionDto {
  id: string;
  date?: string;
  witnesses?: string;
  rulings?: string;
  transcript?: string;
}

export interface MatterVerdictDto {
  id: string;
  date?: string;
  result?: string;
  damages?: string;
  form?: string;
}

export interface MatterPostTrialMotionDto {
  id: string;
  type: string;
  filed?: string;
  hearing?: string;
  outcome?: string;
  notes?: string;
}

export interface MatterTrialDto {
  statusNote?: string;
  settings?: MatterTrialSettingDto[];
  continuances?: MatterContinuanceDto[];
  pretrialDeadlines?: MatterPretrialDeadlineDto[];
  pretrialFilings?: MatterPretrialFilingDto[];
  witnesses?: MatterWitnessDto[];
  exhibits?: MatterExhibitDto[];
  motionsInLimine?: MatterMotionInLimineDto[];
  sessions?: MatterTrialSessionDto[];
  verdicts?: MatterVerdictDto[];
  postTrialMotions?: MatterPostTrialMotionDto[];
}

export interface MatterSettlementRecordDto {
  id: string;
  date?: string;
  type?: string;
  /** "Proposing → recipient". */
  parties?: string;
  amount?: string;
  outcome?: string;
  terms?: string;
  dir?: string;
}

export interface MatterMediationDto {
  id: string;
  when?: string;
  status?: string;
  result?: string;
  mediator?: string;
  org?: string;
  contact?: string;
  method?: string;
  location?: string;
  participants?: string;
  amount?: string;
  deadline?: string;
  discussion?: string;
  unresolved?: string;
  next?: string;
  dir?: string;
}

export interface MatterSettlementDto {
  statusNote?: string;
  records?: MatterSettlementRecordDto[];
  mediations?: MatterMediationDto[];
}

export interface MatterEnforcementActionDto {
  id: string;
  date?: string;
  action?: string;
  detail?: string;
  status?: string;
  dir?: string;
}

export interface MatterPostJudgmentDto {
  statusNote?: string;
  judgmentStatus?: string;
  judgmentDate?: string;
  judgmentAmount?: string;
  interest?: string;
  satisfaction?: string;
  enforcementStatus?: string;
  enforcementDeadline?: string;
  enforcementActions?: MatterEnforcementActionDto[];
}

/**
 * A manually-entered procedural-history event. Only manual events are stored;
 * the timeline's auto entries are derived from stage records at render time,
 * so editing a source record updates the timeline without any sync machinery.
 */
export interface MatterEventDto {
  id: string;
  date: string;
  time?: string;
  type?: string;
  group?: string;
  description?: string;
  parties?: string;
  docs?: string;
  note?: string;
  sourceRef?: string;
}

/**
 * The updatable sections of a matter. Mirrors the v3 dashboard structure;
 * object sections shallow-merge, arrays replace wholesale.
 */
export interface MatterChanges {
  caption?: string;
  status?: string;
  matterNumber?: string;
  /** Named scalars the list view searches; back-filled from coreFields labels. */
  client?: string;
  caseNumber?: string;
  department?: string;
  currentStage?: MatterStageId;
  coreFields?: MatterFieldDto[];
  systemFields?: MatterFieldDto[];
  stages?: MatterStageDto[];
  nextDeadline?: MatterDeadlineDto;
  parties?: MatterPartyDto[];
  counsel?: MatterCounselDto[];
  pleading?: MatterPleadingDto;
  discovery?: MatterDiscoveryDto;
  trial?: MatterTrialDto;
  settlement?: MatterSettlementDto;
  postJudgment?: MatterPostJudgmentDto;
  events?: MatterEventDto[];
}

/**
 * One matter, stored as its own document in the app's matters store. Carries
 * NO team fields: matters predate and outlive teams; the team↔matter link
 * lives in the store's team-links registry.
 */
export interface MatterDto extends MatterChanges {
  id: string;
  schemaVersion: typeof MATTER_SCHEMA_VERSION;
  createdAt?: string;
  updatedAt?: string;
  /** 'user' for direct edits; a member name when a proposal was applied. */
  updatedBy?: string;
  /** Who confirmed the last applied proposal (always the human operator). */
  approvedBy?: string;
}

/**
 * A pending, not-yet-applied dashboard update submitted by a team's lead.
 * Presence of the proposal file means "awaiting user review". Applying merges
 * `changes` into the target matter (sections shallow-merged, arrays replaced
 * wholesale) and deletes the proposal; rejecting just deletes it.
 */
export interface MatterProposalDto {
  schemaVersion: typeof MATTER_SCHEMA_VERSION;
  /**
   * Target matter. Optional only while the proposing team is linked to at
   * most one matter; absent + no linked matter means "create a new matter".
   */
  matterId?: string;
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

/**
 * Everything the dashboard needs for one team's pane: the full store listing
 * (the list view browses every matter), which of those ids the team is linked
 * to, and the team's pending proposal.
 */
export interface MatterSnapshotDto {
  matters: MatterDto[];
  linkedMatterIds: string[];
  proposal: MatterProposalDto | null;
}
