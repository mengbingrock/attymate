import { MATTER_SCHEMA_VERSION } from './dto';

import type {
  MatterChanges,
  MatterContinuanceDto,
  MatterCounselDto,
  MatterDeadlineDto,
  MatterDepositionDto,
  MatterDiscoveryDto,
  MatterDiscoveryRequestDto,
  MatterDto,
  MatterEnforcementActionDto,
  MatterEventDto,
  MatterExhibitDto,
  MatterFieldDto,
  MatterMediationDto,
  MatterMeetConferDto,
  MatterMotionDto,
  MatterMotionInLimineDto,
  MatterPartyDto,
  MatterPleadingDto,
  MatterPleadingRecordDto,
  MatterPostJudgmentDto,
  MatterPostTrialMotionDto,
  MatterPretrialDeadlineDto,
  MatterPretrialFilingDto,
  MatterProductionDto,
  MatterProposalDto,
  MatterSettlementDto,
  MatterSettlementRecordDto,
  MatterStageDto,
  MatterStageId,
  MatterTrialDto,
  MatterTrialSessionDto,
  MatterTrialSettingDto,
  MatterVerdictDto,
  MatterWitnessDto,
} from './dto';
import type { MatterEvidenceRefDto, MatterEvidenceSourceMode } from './evidence';

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
  return value === 'pleading' ||
    value === 'discovery' ||
    value === 'trial' ||
    value === 'settlement' ||
    value === 'post'
    ? value
    : undefined;
}

function readEvidenceSourceMode(value: unknown): MatterEvidenceSourceMode | undefined {
  return value === 'direct-scan' || value === 'link' ? value : undefined;
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

/**
 * Record ids: agents routinely omit them, and the store assigns durable ones
 * at persist time. Until then, a positional id keeps rendering keys stable
 * for a given array order without inventing randomness on every read.
 */
function readRecordId(
  record: Record<string, unknown> | null,
  prefix: string,
  index: number
): string {
  return readString(record?.id) ?? `${prefix}-${index + 1}`;
}

type ItemNormalizer<T> = (item: unknown, index: number) => T | null;

function normalizeArray<T>(value: unknown, normalizeItem: ItemNormalizer<T>): T[] {
  return Array.isArray(value)
    ? value
        .map((item, index) => normalizeItem(item, index))
        .filter((item): item is T => item !== null)
    : [];
}

function normalizeEvidenceRef(value: unknown): MatterEvidenceRefDto | null {
  const record = isRecord(value) ? value : null;
  const path = readString(record?.path);
  if (!path) return null;
  const page =
    typeof record?.page === 'number' && record.page > 0 ? Math.floor(record.page) : undefined;
  const fieldPaths = readStringArray(record?.fieldPaths);
  return pruneUndefined({
    path,
    source: readString(record?.source),
    title: readString(record?.title),
    page,
    section: readString(record?.section),
    dateUpdated: readString(record?.dateUpdated),
    relationship: readString(record?.relationship),
    fieldPaths: fieldPaths.length > 0 ? fieldPaths : undefined,
  });
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

function normalizeParty(value: unknown, index: number): MatterPartyDto | null {
  const record = isRecord(value) ? value : null;
  const name = readString(record?.name);
  if (!name) return null;
  return pruneUndefined({
    id: readRecordId(record, 'party', index),
    name,
    role: readString(record?.role),
    side: readString(record?.side),
    kind: readString(record?.kind),
    contact: readString(record?.contact),
    phone: readString(record?.phone),
    email: readString(record?.email),
    address: readString(record?.address),
    notes: readString(record?.notes),
  });
}

function normalizeCounsel(value: unknown, index: number): MatterCounselDto | null {
  const record = isRecord(value) ? value : null;
  const name = readString(record?.name);
  if (!name) return null;
  return pruneUndefined({
    id: readRecordId(record, 'counsel', index),
    partyId: readString(record?.partyId),
    name,
    role: readString(record?.role),
    firm: readString(record?.firm),
    bar: readString(record?.bar),
    phone: readString(record?.phone),
    email: readString(record?.email),
    address: readString(record?.address),
    notes: readString(record?.notes),
  });
}

function normalizePleadingRecord(value: unknown, index: number): MatterPleadingRecordDto | null {
  const record = isRecord(value) ? value : null;
  const type = readString(record?.type);
  if (!type) return null;
  return pruneUndefined({
    id: readRecordId(record, 'pleading', index),
    partyId: readString(record?.partyId),
    type,
    status: readString(record?.status),
    filed: readString(record?.filed),
    served: readString(record?.served),
    responseDue: readString(record?.responseDue),
    responseFiled: readString(record?.responseFiled),
    related: readString(record?.related),
    amendmentDue: readString(record?.amendmentDue),
    claims: readString(record?.claims),
    dir: readString(record?.dir),
  });
}

/**
 * Pleading section, v2-first with a v1 fallback: legacy scalar keys
 * (operativePleading/pleadingType/amendmentDeadline/causesOfAction) become
 * the first record when no v2 records are present, so v1 documents and
 * proposals from leads still running the v1 skill migrate on read.
 */
function normalizePleading(value: unknown): MatterPleadingDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterPleadingDto = pruneUndefined({
    statusNote: readString(record.statusNote),
  });
  if (Array.isArray(record.records)) {
    section.records = normalizeArray(record.records, normalizePleadingRecord);
  } else {
    const operative = readString(record.operativePleading);
    const legacyType = operative ?? readString(record.pleadingType);
    if (legacyType) {
      section.records = [
        pruneUndefined({
          id: 'pleading-1',
          type: legacyType,
          status: operative ? 'Operative' : undefined,
          amendmentDue: readString(record.amendmentDeadline),
          claims: readString(record.causesOfAction),
        }),
      ];
    }
  }
  return emptyToUndefined(section);
}

function normalizeDiscoveryRequest(
  value: unknown,
  index: number
): MatterDiscoveryRequestDto | null {
  const record = isRecord(value) ? value : null;
  const type = readString(record?.type);
  if (!type) return null;
  return pruneUndefined({
    id: readRecordId(record, 'request', index),
    type,
    set: readString(record?.set),
    parties: readString(record?.parties),
    issued: readString(record?.issued),
    served: readString(record?.served),
    due: readString(record?.due),
    prodDue: readString(record?.prodDue),
    status: readString(record?.status),
    dir: readString(record?.dir),
  });
}

function normalizeMotion(value: unknown, index: number): MatterMotionDto | null {
  const record = isRecord(value) ? value : null;
  // v1 pendingMotion used motionType/relatedRequest; accept both spellings.
  const type = readString(record?.type) ?? readString(record?.motionType);
  if (!type) return null;
  return pruneUndefined({
    id: readRecordId(record, 'motion', index),
    type,
    outcome: readString(record?.outcome),
    movingParty: readString(record?.movingParty),
    request: readString(record?.request) ?? readString(record?.relatedRequest),
    reservation: readString(record?.reservation),
    filed: readString(record?.filed),
    oppositionDue: readString(record?.oppositionDue),
    replyDue: readString(record?.replyDue),
    hearing: readString(record?.hearing),
    ruled: readString(record?.ruled),
    issues: readString(record?.issues),
    dir: readString(record?.dir),
  });
}

function normalizeMeetConfer(value: unknown, index: number): MatterMeetConferDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const entry: MatterMeetConferDto = pruneUndefined({
    id: readRecordId(record, 'meet-confer', index),
    date: readString(record.date),
    method: readString(record.method),
    outcome: readString(record.outcome),
    participants: readString(record.participants),
    // v1 stored the substance as `notes`.
    dispute: readString(record.dispute) ?? readString(record.notes),
    next: readString(record.next),
    dir: readString(record.dir),
  });
  return Object.keys(entry).length > 1 ? entry : null;
}

function normalizeProduction(value: unknown, index: number): MatterProductionDto | null {
  const record = isRecord(value) ? value : null;
  const type = readString(record?.type);
  if (!type) return null;
  return pruneUndefined({
    id: readRecordId(record, 'production', index),
    type,
    bates: readString(record?.bates),
    date: readString(record?.date),
    party: readString(record?.party),
    dir: readString(record?.dir),
  });
}

function normalizeDeposition(value: unknown, index: number): MatterDepositionDto | null {
  const record = isRecord(value) ? value : null;
  const name = readString(record?.name);
  if (!name) return null;
  return pruneUndefined({
    id: readRecordId(record, 'deposition', index),
    name,
    taken: readString(record?.taken),
    review: readString(record?.review),
    note: readString(record?.note),
    dir: readString(record?.dir),
  });
}

function normalizeDiscovery(value: unknown): MatterDiscoveryDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterDiscoveryDto = pruneUndefined({
    statusNote: readString(record.statusNote),
  });
  if (Array.isArray(record.requests)) {
    section.requests = normalizeArray(record.requests, normalizeDiscoveryRequest);
  }
  if (Array.isArray(record.motions)) {
    section.motions = normalizeArray(record.motions, normalizeMotion);
  } else if (isRecord(record.pendingMotion)) {
    const motion = normalizeMotion(record.pendingMotion, 0);
    if (motion) section.motions = [motion];
  }
  if (Array.isArray(record.meetAndConfers)) {
    section.meetAndConfers = normalizeArray(record.meetAndConfers, normalizeMeetConfer);
  } else if (isRecord(record.meetConfer)) {
    const entry = normalizeMeetConfer(record.meetConfer, 0);
    if (entry) section.meetAndConfers = [entry];
  }
  if (Array.isArray(record.productions)) {
    section.productions = normalizeArray(record.productions, normalizeProduction);
  }
  if (Array.isArray(record.depositions)) {
    section.depositions = normalizeArray(record.depositions, normalizeDeposition);
  }
  return emptyToUndefined(section);
}

function normalizeTrialSetting(value: unknown, index: number): MatterTrialSettingDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const setting: MatterTrialSettingDto = pruneUndefined({
    id: readRecordId(record, 'setting', index),
    type: readString(record.type),
    setAt: readString(record.setAt),
    trialDate: readString(record.trialDate),
    days: readString(record.days),
    venue: readString(record.venue),
    status: readString(record.status),
  });
  return Object.keys(setting).length > 1 ? setting : null;
}

function normalizeContinuance(value: unknown, index: number): MatterContinuanceDto | null {
  const record = isRecord(value) ? value : null;
  const text = readString(record?.text) ?? readString(value);
  if (!text) return null;
  return { id: readRecordId(record, 'continuance', index), text };
}

function normalizePretrialDeadline(
  value: unknown,
  index: number
): MatterPretrialDeadlineDto | null {
  const record = isRecord(value) ? value : null;
  const title = readString(record?.title);
  if (!title) return null;
  return pruneUndefined({
    id: readRecordId(record, 'pretrial', index),
    title,
    due: readString(record?.due),
    source: readString(record?.source),
    status: readString(record?.status),
  });
}

function normalizePretrialFiling(value: unknown, index: number): MatterPretrialFilingDto | null {
  const record = isRecord(value) ? value : null;
  const title = readString(record?.title);
  if (!title) return null;
  return pruneUndefined({
    id: readRecordId(record, 'filing', index),
    title,
    party: readString(record?.party),
    due: readString(record?.due),
    filed: readString(record?.filed),
    dir: readString(record?.dir),
  });
}

function normalizeWitness(value: unknown, index: number): MatterWitnessDto | null {
  const record = isRecord(value) ? value : null;
  const name = readString(record?.name);
  if (!name) return null;
  return pruneUndefined({
    id: readRecordId(record, 'witness', index),
    name,
    role: readString(record?.role),
    party: readString(record?.party),
    availability: readString(record?.availability),
    topics: readString(record?.topics),
    docs: readString(record?.docs),
  });
}

function normalizeExhibit(value: unknown, index: number): MatterExhibitDto | null {
  const record = isRecord(value) ? value : null;
  const number = readString(record?.number);
  const title = readString(record?.title);
  if (!number || !title) return null;
  return pruneUndefined({
    id: readRecordId(record, 'exhibit', index),
    number,
    title,
    admission: readString(record?.admission),
    foundation: readString(record?.foundation),
    objections: readString(record?.objections),
    dir: readString(record?.dir),
  });
}

function normalizeMotionInLimine(value: unknown, index: number): MatterMotionInLimineDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const mil: MatterMotionInLimineDto = pruneUndefined({
    id: readRecordId(record, 'mil', index),
    number: readString(record.number),
    issue: readString(record.issue),
    party: readString(record.party),
    filed: readString(record.filed),
    hearing: readString(record.hearing),
    outcome: readString(record.outcome),
    dir: readString(record.dir),
  });
  return Object.keys(mil).length > 1 ? mil : null;
}

function normalizeTrialSession(value: unknown, index: number): MatterTrialSessionDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const session: MatterTrialSessionDto = pruneUndefined({
    id: readRecordId(record, 'session', index),
    date: readString(record.date),
    witnesses: readString(record.witnesses),
    rulings: readString(record.rulings),
    transcript: readString(record.transcript),
  });
  return Object.keys(session).length > 1 ? session : null;
}

function normalizeVerdict(value: unknown, index: number): MatterVerdictDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const verdict: MatterVerdictDto = pruneUndefined({
    id: readRecordId(record, 'verdict', index),
    date: readString(record.date),
    result: readString(record.result),
    damages: readString(record.damages),
    form: readString(record.form),
  });
  return Object.keys(verdict).length > 1 ? verdict : null;
}

function normalizePostTrialMotion(value: unknown, index: number): MatterPostTrialMotionDto | null {
  const record = isRecord(value) ? value : null;
  const type = readString(record?.type);
  if (!type) return null;
  return pruneUndefined({
    id: readRecordId(record, 'post-trial', index),
    type,
    filed: readString(record?.filed),
    hearing: readString(record?.hearing),
    outcome: readString(record?.outcome),
    notes: readString(record?.notes),
  });
}

/**
 * Trial section, v2-first: the v1 scalars (trialDate/trialType/
 * estimatedDuration/settingStatus) collapse into the first trial setting and
 * `continuancesNote` into the first continuance row.
 */
function normalizeTrial(value: unknown): MatterTrialDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterTrialDto = pruneUndefined({
    statusNote: readString(record.statusNote),
  });
  if (Array.isArray(record.settings)) {
    section.settings = normalizeArray(record.settings, normalizeTrialSetting);
  } else {
    const legacySetting = normalizeTrialSetting(
      {
        type: record.trialType,
        trialDate: record.trialDate,
        days: record.estimatedDuration,
        status: record.settingStatus,
      },
      0
    );
    if (legacySetting) section.settings = [legacySetting];
  }
  if (Array.isArray(record.continuances)) {
    section.continuances = normalizeArray(record.continuances, normalizeContinuance);
  } else {
    const note = readString(record.continuancesNote);
    if (note) section.continuances = [{ id: 'continuance-1', text: note }];
  }
  if (Array.isArray(record.pretrialDeadlines)) {
    section.pretrialDeadlines = normalizeArray(record.pretrialDeadlines, normalizePretrialDeadline);
  }
  if (Array.isArray(record.pretrialFilings)) {
    section.pretrialFilings = normalizeArray(record.pretrialFilings, normalizePretrialFiling);
  }
  if (Array.isArray(record.witnesses)) {
    section.witnesses = normalizeArray(record.witnesses, normalizeWitness);
  }
  if (Array.isArray(record.exhibits)) {
    section.exhibits = normalizeArray(record.exhibits, normalizeExhibit);
  }
  if (Array.isArray(record.motionsInLimine)) {
    section.motionsInLimine = normalizeArray(record.motionsInLimine, normalizeMotionInLimine);
  }
  if (Array.isArray(record.sessions)) {
    section.sessions = normalizeArray(record.sessions, normalizeTrialSession);
  }
  if (Array.isArray(record.verdicts)) {
    section.verdicts = normalizeArray(record.verdicts, normalizeVerdict);
  }
  if (Array.isArray(record.postTrialMotions)) {
    section.postTrialMotions = normalizeArray(record.postTrialMotions, normalizePostTrialMotion);
  }
  return emptyToUndefined(section);
}

function normalizeSettlementRecord(
  value: unknown,
  index: number
): MatterSettlementRecordDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const entry: MatterSettlementRecordDto = pruneUndefined({
    id: readRecordId(record, 'settlement', index),
    date: readString(record.date),
    type: readString(record.type),
    parties: readString(record.parties),
    amount: readString(record.amount),
    outcome: readString(record.outcome),
    terms: readString(record.terms),
    dir: readString(record.dir),
  });
  return Object.keys(entry).length > 1 ? entry : null;
}

function normalizeMediation(value: unknown, index: number): MatterMediationDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) return null;
  const entry: MatterMediationDto = pruneUndefined({
    id: readRecordId(record, 'mediation', index),
    when: readString(record.when),
    status: readString(record.status),
    result: readString(record.result),
    mediator: readString(record.mediator),
    org: readString(record.org),
    contact: readString(record.contact),
    method: readString(record.method),
    location: readString(record.location),
    participants: readString(record.participants),
    amount: readString(record.amount),
    deadline: readString(record.deadline),
    discussion: readString(record.discussion),
    unresolved: readString(record.unresolved),
    next: readString(record.next),
    dir: readString(record.dir),
  });
  return Object.keys(entry).length > 1 ? entry : null;
}

function normalizeSettlement(value: unknown): MatterSettlementDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterSettlementDto = pruneUndefined({
    statusNote: readString(record.statusNote),
  });
  if (Array.isArray(record.records)) {
    section.records = normalizeArray(record.records, normalizeSettlementRecord);
  }
  if (Array.isArray(record.mediations)) {
    section.mediations = normalizeArray(record.mediations, normalizeMediation);
  }
  return emptyToUndefined(section);
}

function normalizeEnforcementAction(
  value: unknown,
  index: number
): MatterEnforcementActionDto | null {
  const record = isRecord(value) ? value : null;
  if (!record) {
    // v1 stored enforcement actions as one free-text string.
    const detail = readString(value);
    return detail ? { id: `enforcement-${index + 1}`, detail } : null;
  }
  const action: MatterEnforcementActionDto = pruneUndefined({
    id: readRecordId(record, 'enforcement', index),
    date: readString(record.date),
    action: readString(record.action),
    detail: readString(record.detail),
    status: readString(record.status),
    dir: readString(record.dir),
  });
  return Object.keys(action).length > 1 ? action : null;
}

function normalizePostJudgment(value: unknown): MatterPostJudgmentDto | undefined {
  const record = isRecord(value) ? value : null;
  if (!record) return undefined;
  const section: MatterPostJudgmentDto = pruneUndefined({
    statusNote: readString(record.statusNote),
    judgmentStatus: readString(record.judgmentStatus),
    judgmentDate: readString(record.judgmentDate),
    judgmentAmount: readString(record.judgmentAmount),
    interest: readString(record.interest),
    satisfaction: readString(record.satisfaction),
    enforcementStatus: readString(record.enforcementStatus),
    enforcementDeadline: readString(record.enforcementDeadline),
  });
  if (Array.isArray(record.enforcementActions)) {
    section.enforcementActions = normalizeArray(
      record.enforcementActions,
      normalizeEnforcementAction
    );
  } else {
    const legacy = readString(record.enforcementActions);
    if (legacy) section.enforcementActions = [{ id: 'enforcement-1', detail: legacy }];
  }
  return emptyToUndefined(section);
}

function normalizeEvent(value: unknown, index: number): MatterEventDto | null {
  const record = isRecord(value) ? value : null;
  const date = readString(record?.date);
  if (!date) return null;
  return pruneUndefined({
    id: readRecordId(record, 'event', index),
    date,
    time: readString(record?.time),
    type: readString(record?.type),
    group: readString(record?.group),
    description: readString(record?.description),
    parties: readString(record?.parties),
    docs: readString(record?.docs),
    note: readString(record?.note),
    sourceRef: readString(record?.sourceRef),
  });
}

/** Finds the value of a core field by any of the given labels. */
function readCoreFieldValue(
  fields: MatterFieldDto[] | undefined,
  labels: string[]
): string | undefined {
  if (!fields) return undefined;
  const wanted = labels.map((label) => label.toLowerCase());
  const match = fields.find((field) => wanted.includes(field.label.toLowerCase()));
  return match?.value.trim() ? match.value.trim() : undefined;
}

/**
 * Tolerantly normalizes the section payload shared by the matter document and
 * a proposal's `changes`. Accepts BOTH v1 and v2 shapes (v1 keys migrate into
 * their v2 sections), drops unknown keys, never throws. Arrays keep
 * "present but empty" semantics because a provided array replaces the
 * previous one wholesale on merge.
 */
export function normalizeMatterChanges(value: unknown): MatterChanges {
  const record = isRecord(value) ? value : {};
  const changes: MatterChanges = pruneUndefined({
    caption: readString(record.caption),
    status: readString(record.status),
    matterNumber: readString(record.matterNumber),
    client: readString(record.client),
    caseNumber: readString(record.caseNumber),
    department: readString(record.department),
    currentStage: readStageId(record.currentStage),
    nextDeadline: normalizeDeadline(record.nextDeadline),
    pleading: normalizePleading(record.pleading),
    discovery: normalizeDiscovery(record.discovery),
    trial: normalizeTrial(record.trial),
    settlement: normalizeSettlement(record.settlement),
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
  if (Array.isArray(record.parties)) {
    changes.parties = normalizeArray(record.parties, normalizeParty);
  }
  if (Array.isArray(record.counsel)) {
    changes.counsel = normalizeArray(record.counsel, normalizeCounsel);
  }
  if (Array.isArray(record.events)) {
    changes.events = normalizeArray(record.events, normalizeEvent);
  }
  // The list view searches these named scalars; older documents only carry
  // the labeled core fields, so back-fill from the well-known labels.
  if (!changes.client) {
    changes.client = readCoreFieldValue(changes.coreFields, ['client']);
  }
  if (!changes.caseNumber) {
    changes.caseNumber = readCoreFieldValue(changes.coreFields, ['case no.', 'case number']);
  }
  if (!changes.department) {
    changes.department = readCoreFieldValue(changes.coreFields, ['department', 'dept.']);
  }
  return pruneUndefined(changes);
}

/**
 * One matter document (any schema version) → v2 MatterDto. `fallbackId` names
 * the matter when the raw document has no id — e.g. a legacy v1 team file.
 */
export function normalizeMatterDto(value: unknown, fallbackId?: string): MatterDto | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id) ?? fallbackId;
  if (!id) return null;
  const dto: MatterDto = {
    ...normalizeMatterChanges(value),
    id,
    schemaVersion: MATTER_SCHEMA_VERSION,
    createdAt: readString(value.createdAt),
    updatedAt: readString(value.updatedAt),
    updatedBy: readString(value.updatedBy),
    approvedBy: readString(value.approvedBy),
  };
  return pruneUndefined(dto);
}

/**
 * True when a raw matter document carries meaningful content beyond
 * bookkeeping — the signal that a legacy team file is worth importing.
 */
export function hasMatterContent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const bookkeeping = new Set([
    'schemaVersion',
    'id',
    'createdAt',
    'updatedAt',
    'updatedBy',
    'approvedBy',
    'migratedTo',
  ]);
  return Object.keys(value).some((key) => !bookkeeping.has(key));
}

export function normalizeMatterProposalDto(value: unknown): MatterProposalDto | null {
  if (!isRecord(value)) return null;
  const proposedAt = readString(value.proposedAt);
  const proposedBy = readString(value.proposedBy);
  const summary = readStringArray(value.summary);
  if (!proposedAt || !proposedBy || summary.length === 0) return null;
  const matterId = readString(value.matterId);
  const taskRefs = readStringArray(value.taskRefs);
  const evidence = normalizeArray(value.evidence, normalizeEvidenceRef);
  const sourceMode = readEvidenceSourceMode(value.sourceMode);
  const sourceRevision = readString(value.sourceRevision);
  return {
    schemaVersion: MATTER_SCHEMA_VERSION,
    ...(matterId ? { matterId } : {}),
    proposedAt,
    proposedBy,
    summary,
    changes: normalizeMatterChanges(value.changes),
    ...(taskRefs.length > 0 ? { taskRefs } : {}),
    ...(sourceMode ? { sourceMode } : {}),
    ...(sourceRevision ? { sourceRevision } : {}),
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}
