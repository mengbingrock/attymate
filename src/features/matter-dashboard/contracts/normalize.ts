import { MATTER_SCHEMA_VERSION } from './dto';

import type {
  MatterChanges,
  MatterDeadlineDto,
  MatterDepositionDto,
  MatterDiscoveryDto,
  MatterDiscoveryRequestDto,
  MatterDto,
  MatterExhibitDto,
  MatterFieldDto,
  MatterMeetConferDto,
  MatterPendingMotionDto,
  MatterPleadingDto,
  MatterPostJudgmentDto,
  MatterPretrialDeadlineDto,
  MatterProductionDto,
  MatterProposalDto,
  MatterStageDto,
  MatterStageId,
  MatterTrialDto,
  MatterWitnessDto,
} from './dto';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter((item): item is string => item !== undefined)
    : [];
}

function readStageId(value: unknown): MatterStageId | undefined {
  return value === 'pleading' || value === 'discovery' || value === 'trial' || value === 'post'
    ? value
    : undefined;
}

function pruneUndefined<T extends object>(record: T): T {
  const mutable = record as Record<string, unknown>;
  for (const key of Object.keys(mutable)) {
    if (mutable[key] === undefined) delete mutable[key];
  }
  return record;
}

function emptyToUndefined<T extends object>(record: T): T | undefined {
  return Object.keys(record).length > 0 ? record : undefined;
}

function normalizeField(value: unknown): MatterFieldDto | null {
  const record = isRecord(value) ? value : null;
  const label = readString(record?.label);
  if (!label) return null;
  return { label, value: readString(record?.value) ?? '' };
}

function normalizeStage(value: unknown): MatterStageDto | null {
  const record = isRecord(value) ? value : null;
  const id = readStageId(record?.id);
  if (!id) return null;
  return pruneUndefined({
    id,
    label: readString(record?.label),
    dates: readString(record?.dates),
    summary: readString(record?.summary),
  });
}

function normalizeDeadline(value: unknown): MatterDeadlineDto | undefined {
  const record = isRecord(value) ? value : null;
  const date = readString(record?.date);
  const label = readString(record?.label);
  if (!date || !label) return undefined;
  return { date, label };
}

function normalizePleading(value: unknown): MatterPleadingDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  return emptyToUndefined(
    pruneUndefined({
      statusNote: readString(record.statusNote),
      operativePleading: readString(record.operativePleading),
      pleadingType: readString(record.pleadingType),
      amendmentDeadline: readString(record.amendmentDeadline),
      causesOfAction: readString(record.causesOfAction),
    })
  );
}

function normalizeDiscoveryRequest(value: unknown): MatterDiscoveryRequestDto | null {
  const record = isRecord(value) ? value : null;
  const type = readString(record?.type);
  if (!type) return null;
  return pruneUndefined({
    type,
    set: readString(record?.set),
    parties: readString(record?.parties),
    served: readString(record?.served),
    due: readString(record?.due),
    status: readString(record?.status),
  });
}

function normalizeMeetConfer(value: unknown): MatterMeetConferDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  return emptyToUndefined(
    pruneUndefined({
      date: readString(record.date),
      method: readString(record.method),
      outcome: readString(record.outcome),
      notes: readString(record.notes),
    })
  );
}

function normalizePendingMotion(value: unknown): MatterPendingMotionDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  return emptyToUndefined(
    pruneUndefined({
      motionType: readString(record.motionType),
      relatedRequest: readString(record.relatedRequest),
      reservation: readString(record.reservation),
      filed: readString(record.filed),
      oppositionDue: readString(record.oppositionDue),
      replyDue: readString(record.replyDue),
      hearing: readString(record.hearing),
      outcome: readString(record.outcome),
    })
  );
}

function normalizeProduction(value: unknown): MatterProductionDto | null {
  const record = isRecord(value) ? value : null;
  const type = readString(record?.type);
  if (!type) return null;
  return pruneUndefined({
    type,
    bates: readString(record?.bates),
    date: readString(record?.date),
  });
}

function normalizeDeposition(value: unknown): MatterDepositionDto | null {
  const record = isRecord(value) ? value : null;
  const name = readString(record?.name);
  if (!name) return null;
  return pruneUndefined({
    name,
    taken: readString(record?.taken),
    review: readString(record?.review),
    note: readString(record?.note),
  });
}

function normalizeArray<T>(value: unknown, normalizeItem: (item: unknown) => T | null): T[] {
  return Array.isArray(value)
    ? value.map((item) => normalizeItem(item)).filter((item): item is T => item !== null)
    : [];
}

function normalizeDiscovery(value: unknown): MatterDiscoveryDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterDiscoveryDto = pruneUndefined({
    statusNote: readString(record.statusNote),
    meetConfer: normalizeMeetConfer(record.meetConfer),
    pendingMotion: normalizePendingMotion(record.pendingMotion),
  });
  if (Array.isArray(record.requests)) {
    section.requests = normalizeArray(record.requests, normalizeDiscoveryRequest);
  }
  if (Array.isArray(record.productions)) {
    section.productions = normalizeArray(record.productions, normalizeProduction);
  }
  if (Array.isArray(record.depositions)) {
    section.depositions = normalizeArray(record.depositions, normalizeDeposition);
  }
  return emptyToUndefined(section);
}

function normalizePretrialDeadline(value: unknown): MatterPretrialDeadlineDto | null {
  const record = isRecord(value) ? value : null;
  const title = readString(record?.title);
  if (!title) return null;
  return pruneUndefined({
    title,
    due: readString(record?.due),
    source: readString(record?.source),
    status: readString(record?.status),
  });
}

function normalizeWitness(value: unknown): MatterWitnessDto | null {
  const record = isRecord(value) ? value : null;
  const name = readString(record?.name);
  if (!name) return null;
  return pruneUndefined({
    name,
    role: readString(record?.role),
    party: readString(record?.party),
    availability: readString(record?.availability),
  });
}

function normalizeExhibit(value: unknown): MatterExhibitDto | null {
  const record = isRecord(value) ? value : null;
  const number = readString(record?.number);
  const title = readString(record?.title);
  if (!number || !title) return null;
  return pruneUndefined({
    number,
    title,
    admission: readString(record?.admission),
  });
}

function normalizeTrial(value: unknown): MatterTrialDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterTrialDto = pruneUndefined({
    statusNote: readString(record.statusNote),
    trialDate: readString(record.trialDate),
    trialType: readString(record.trialType),
    estimatedDuration: readString(record.estimatedDuration),
    settingStatus: readString(record.settingStatus),
    continuancesNote: readString(record.continuancesNote),
  });
  if (Array.isArray(record.pretrialDeadlines)) {
    section.pretrialDeadlines = normalizeArray(record.pretrialDeadlines, normalizePretrialDeadline);
  }
  if (Array.isArray(record.witnesses)) {
    section.witnesses = normalizeArray(record.witnesses, normalizeWitness);
  }
  if (Array.isArray(record.exhibits)) {
    section.exhibits = normalizeArray(record.exhibits, normalizeExhibit);
  }
  return emptyToUndefined(section);
}

function normalizePostJudgment(value: unknown): MatterPostJudgmentDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  return emptyToUndefined(
    pruneUndefined({
      statusNote: readString(record.statusNote),
      judgmentStatus: readString(record.judgmentStatus),
      judgmentDate: readString(record.judgmentDate),
      judgmentAmount: readString(record.judgmentAmount),
      enforcementStatus: readString(record.enforcementStatus),
      enforcementDeadline: readString(record.enforcementDeadline),
      enforcementActions: readString(record.enforcementActions),
    })
  );
}

/**
 * Tolerantly normalizes the section payload shared by the matter document and
 * a proposal's `changes`. Unknown keys are dropped, malformed entries skipped,
 * never throws. Arrays keep "present but empty" semantics because a provided
 * array replaces the previous one wholesale on merge.
 */
export function normalizeMatterChanges(value: unknown): MatterChanges {
  const record = isRecord(value) ? value : {};
  const changes: MatterChanges = pruneUndefined({
    caption: readString(record.caption),
    status: readString(record.status),
    matterNumber: readString(record.matterNumber),
    currentStage: readStageId(record.currentStage),
    nextDeadline: normalizeDeadline(record.nextDeadline),
    pleading: normalizePleading(record.pleading),
    discovery: normalizeDiscovery(record.discovery),
    trial: normalizeTrial(record.trial),
    postJudgment: normalizePostJudgment(record.postJudgment),
  });
  if (Array.isArray(record.coreFields)) {
    changes.coreFields = normalizeArray(record.coreFields, normalizeField);
  }
  if (Array.isArray(record.systemFields)) {
    changes.systemFields = normalizeArray(record.systemFields, normalizeField);
  }
  if (Array.isArray(record.stages)) {
    changes.stages = normalizeArray(record.stages, normalizeStage);
  }
  return changes;
}

export function normalizeMatterDto(value: unknown): MatterDto | null {
  if (!isRecord(value)) return null;
  const dto: MatterDto = {
    ...normalizeMatterChanges(value),
    schemaVersion: MATTER_SCHEMA_VERSION,
    updatedAt: readString(value.updatedAt),
    updatedBy: readString(value.updatedBy),
    approvedBy: readString(value.approvedBy),
  };
  return pruneUndefined(dto);
}

export function normalizeMatterProposalDto(value: unknown): MatterProposalDto | null {
  if (!isRecord(value)) return null;
  const proposedAt = readString(value.proposedAt);
  const proposedBy = readString(value.proposedBy);
  const summary = readStringArray(value.summary);
  if (!proposedAt || !proposedBy || summary.length === 0) return null;
  const taskRefs = readStringArray(value.taskRefs);
  return {
    schemaVersion: MATTER_SCHEMA_VERSION,
    proposedAt,
    proposedBy,
    summary,
    changes: normalizeMatterChanges(value.changes),
    ...(taskRefs.length > 0 ? { taskRefs } : {}),
  };
}
