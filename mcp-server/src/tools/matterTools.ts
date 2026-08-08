import type { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { getController } from '../controller';
import { jsonTextContent } from '../utils/format';
import { assertConfiguredTeam } from '../utils/teamConfig';

const toolContextSchema = {
  teamName: z.string().min(1),
  claudeDir: z.string().min(1).optional(),
};

// Keep in sync with src/features/matter-dashboard/contracts/dto.ts (v2) and
// agent-teams-controller/src/internal/matterStore.js. The schema accepts BOTH
// v2 shapes and the legacy v1 keys so leads still running a cached v1 skill
// never hit a strict-schema error; normalization migrates v1 shapes on read.
const stageIdSchema = z.enum(['pleading', 'discovery', 'trial', 'settlement', 'post']);

const fieldSchema = z.object({
  label: z.string().min(1),
  value: z.string(),
});

const stageSchema = z.object({
  id: stageIdSchema,
  label: z.string().optional(),
  dates: z.string().optional(),
  summary: z.string().optional(),
});

const deadlineSchema = z.object({
  date: z.string().min(1),
  label: z.string().min(1),
});

const recordIdSchema = z.string().min(1).optional();
const dirSchema = z.string().optional();

const partySchema = z.object({
  id: recordIdSchema,
  name: z.string().min(1),
  role: z.string().optional(),
  side: z.string().optional(),
  kind: z.string().optional(),
  contact: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const counselSchema = z.object({
  id: recordIdSchema,
  partyId: z.string().optional(),
  name: z.string().min(1),
  role: z.string().optional(),
  firm: z.string().optional(),
  bar: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional(),
});

const pleadingRecordSchema = z.object({
  id: recordIdSchema,
  partyId: z.string().optional(),
  type: z.string().min(1),
  status: z.string().optional(),
  filed: z.string().optional(),
  served: z.string().optional(),
  responseDue: z.string().optional(),
  responseFiled: z.string().optional(),
  related: z.string().optional(),
  amendmentDue: z.string().optional(),
  claims: z.string().optional(),
  dir: dirSchema,
});

const pleadingSchema = z.object({
  statusNote: z.string().optional(),
  records: z.array(pleadingRecordSchema).optional(),
  // v1 scalar keys, migrated to records[0] on read.
  operativePleading: z.string().optional(),
  pleadingType: z.string().optional(),
  amendmentDeadline: z.string().optional(),
  causesOfAction: z.string().optional(),
});

const motionSchema = z.object({
  id: recordIdSchema,
  type: z.string().min(1).optional(),
  // v1 pendingMotion spellings.
  motionType: z.string().optional(),
  relatedRequest: z.string().optional(),
  outcome: z.string().optional(),
  movingParty: z.string().optional(),
  request: z.string().optional(),
  reservation: z.string().optional(),
  filed: z.string().optional(),
  oppositionDue: z.string().optional(),
  replyDue: z.string().optional(),
  hearing: z.string().optional(),
  ruled: z.string().optional(),
  issues: z.string().optional(),
  dir: dirSchema,
});

const meetConferSchema = z.object({
  id: recordIdSchema,
  date: z.string().optional(),
  method: z.string().optional(),
  outcome: z.string().optional(),
  participants: z.string().optional(),
  dispute: z.string().optional(),
  next: z.string().optional(),
  // v1 key, migrated to `dispute`.
  notes: z.string().optional(),
  dir: dirSchema,
});

const discoverySchema = z.object({
  statusNote: z.string().optional(),
  requests: z
    .array(
      z.object({
        id: recordIdSchema,
        type: z.string().min(1),
        set: z.string().optional(),
        parties: z.string().optional(),
        issued: z.string().optional(),
        served: z.string().optional(),
        due: z.string().optional(),
        prodDue: z.string().optional(),
        status: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
  motions: z.array(motionSchema).optional(),
  meetAndConfers: z.array(meetConferSchema).optional(),
  // v1 single-record keys, migrated to the arrays above on read.
  meetConfer: meetConferSchema.optional(),
  pendingMotion: motionSchema.optional(),
  productions: z
    .array(
      z.object({
        id: recordIdSchema,
        type: z.string().min(1),
        bates: z.string().optional(),
        date: z.string().optional(),
        party: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
  depositions: z
    .array(
      z.object({
        id: recordIdSchema,
        name: z.string().min(1),
        taken: z.string().optional(),
        review: z.string().optional(),
        note: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
});

const trialSchema = z.object({
  statusNote: z.string().optional(),
  settings: z
    .array(
      z.object({
        id: recordIdSchema,
        type: z.string().optional(),
        setAt: z.string().optional(),
        trialDate: z.string().optional(),
        days: z.string().optional(),
        venue: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .optional(),
  continuances: z
    .array(z.object({ id: recordIdSchema, text: z.string().min(1) }))
    .optional(),
  // v1 scalar keys, migrated to settings[0] / continuances[0] on read.
  trialDate: z.string().optional(),
  trialType: z.string().optional(),
  estimatedDuration: z.string().optional(),
  settingStatus: z.string().optional(),
  continuancesNote: z.string().optional(),
  pretrialDeadlines: z
    .array(
      z.object({
        id: recordIdSchema,
        title: z.string().min(1),
        due: z.string().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .optional(),
  pretrialFilings: z
    .array(
      z.object({
        id: recordIdSchema,
        title: z.string().min(1),
        party: z.string().optional(),
        due: z.string().optional(),
        filed: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
  witnesses: z
    .array(
      z.object({
        id: recordIdSchema,
        name: z.string().min(1),
        role: z.string().optional(),
        party: z.string().optional(),
        availability: z.string().optional(),
        topics: z.string().optional(),
        docs: z.string().optional(),
      })
    )
    .optional(),
  exhibits: z
    .array(
      z.object({
        id: recordIdSchema,
        number: z.string().min(1),
        title: z.string().min(1),
        admission: z.string().optional(),
        foundation: z.string().optional(),
        objections: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
  motionsInLimine: z
    .array(
      z.object({
        id: recordIdSchema,
        number: z.string().optional(),
        issue: z.string().optional(),
        party: z.string().optional(),
        filed: z.string().optional(),
        hearing: z.string().optional(),
        outcome: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
  sessions: z
    .array(
      z.object({
        id: recordIdSchema,
        date: z.string().optional(),
        witnesses: z.string().optional(),
        rulings: z.string().optional(),
        transcript: z.string().optional(),
      })
    )
    .optional(),
  verdicts: z
    .array(
      z.object({
        id: recordIdSchema,
        date: z.string().optional(),
        result: z.string().optional(),
        damages: z.string().optional(),
        form: z.string().optional(),
      })
    )
    .optional(),
  postTrialMotions: z
    .array(
      z.object({
        id: recordIdSchema,
        type: z.string().min(1),
        filed: z.string().optional(),
        hearing: z.string().optional(),
        outcome: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .optional(),
});

const settlementSchema = z.object({
  statusNote: z.string().optional(),
  records: z
    .array(
      z.object({
        id: recordIdSchema,
        date: z.string().optional(),
        type: z.string().optional(),
        parties: z.string().optional(),
        amount: z.string().optional(),
        outcome: z.string().optional(),
        terms: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
  mediations: z
    .array(
      z.object({
        id: recordIdSchema,
        when: z.string().optional(),
        status: z.string().optional(),
        result: z.string().optional(),
        mediator: z.string().optional(),
        org: z.string().optional(),
        contact: z.string().optional(),
        method: z.string().optional(),
        location: z.string().optional(),
        participants: z.string().optional(),
        amount: z.string().optional(),
        deadline: z.string().optional(),
        discussion: z.string().optional(),
        unresolved: z.string().optional(),
        next: z.string().optional(),
        dir: dirSchema,
      })
    )
    .optional(),
});

const postJudgmentSchema = z.object({
  statusNote: z.string().optional(),
  judgmentStatus: z.string().optional(),
  judgmentDate: z.string().optional(),
  judgmentAmount: z.string().optional(),
  interest: z.string().optional(),
  satisfaction: z.string().optional(),
  enforcementStatus: z.string().optional(),
  enforcementDeadline: z.string().optional(),
  // v2 rows or the v1 free-text string, migrated to one row on read.
  enforcementActions: z
    .union([
      z.string(),
      z.array(
        z.object({
          id: recordIdSchema,
          date: z.string().optional(),
          action: z.string().optional(),
          detail: z.string().optional(),
          status: z.string().optional(),
          dir: dirSchema,
        })
      ),
    ])
    .optional(),
});

const eventSchema = z.object({
  id: recordIdSchema,
  date: z.string().min(1),
  time: z.string().optional(),
  type: z.string().optional(),
  group: z.string().optional(),
  description: z.string().optional(),
  parties: z.string().optional(),
  docs: z.string().optional(),
  note: z.string().optional(),
  sourceRef: z.string().optional(),
});

const changesSchema = z
  .object({
    caption: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    matterNumber: z.string().min(1).optional(),
    client: z.string().min(1).optional(),
    caseNumber: z.string().min(1).optional(),
    department: z.string().min(1).optional(),
    currentStage: stageIdSchema.optional(),
    coreFields: z.array(fieldSchema).optional(),
    systemFields: z.array(fieldSchema).optional(),
    stages: z.array(stageSchema).optional(),
    nextDeadline: deadlineSchema.optional(),
    parties: z.array(partySchema).optional(),
    counsel: z.array(counselSchema).optional(),
    pleading: pleadingSchema.optional(),
    discovery: discoverySchema.optional(),
    trial: trialSchema.optional(),
    settlement: settlementSchema.optional(),
    postJudgment: postJudgmentSchema.optional(),
    events: z.array(eventSchema).optional(),
  })
  .strict();

const evidenceRefSchema = z
  .object({
    path: z.string().min(1),
    source: z.string().min(1).optional(),
    title: z.string().min(1).optional(),
    page: z.number().int().positive().optional(),
    section: z.string().min(1).optional(),
    dateUpdated: z.string().min(1).optional(),
    relationship: z.string().min(1).optional(),
    fieldPaths: z.array(z.string().min(1)).optional(),
  })
  .strict();

const MATTER_SECTION_REFERENCE = [
  'Matter sections (send only changed ones in matter_propose changes):',
  '- caption, status, matterNumber, client, caseNumber, department, currentStage (pleading|discovery|trial|settlement|post)',
  '- coreFields[] / systemFields[]: { label, value } (arrays replace the previous list wholesale)',
  '- stages[]: { id, label?, dates?, summary? }',
  '- nextDeadline: { date, label }',
  '- parties[]: { id?, name, role?, side?, kind?, contact?, phone?, email?, address?, notes? }',
  '- counsel[]: { id?, partyId?, name, role?, firm?, bar?, phone?, email?, address?, notes? } (partyId links counsel to a party)',
  '- pleading: { statusNote?, records[]: { id?, partyId?, type, status?, filed?, served?, responseDue?, responseFiled?, related?, amendmentDue?, claims?, dir? } }',
  '- discovery: { statusNote?, requests[], motions[], meetAndConfers[], productions[], depositions[] } (each record may carry id? and dir?)',
  '- trial: { statusNote?, settings[], continuances[], pretrialDeadlines[], pretrialFilings[], witnesses[], exhibits[], motionsInLimine[], sessions[], verdicts[], postTrialMotions[] }',
  '- settlement: { statusNote?, records[]: { date?, type?, parties?, amount?, outcome?, terms? }, mediations[] }',
  '- postJudgment: { statusNote?, judgmentStatus?, judgmentDate?, judgmentAmount?, interest?, satisfaction?, enforcementStatus?, enforcementDeadline?, enforcementActions[] }',
  '- events[]: { date, time?, type?, group?, description?, parties?, docs?, note? } — MANUAL timeline entries only; the procedural history otherwise derives from the records above, so do not duplicate record facts as events',
  'Object sections merge shallowly on apply; arrays replace wholesale — resend the FULL array when changing any record in it.',
  'Records keep their id across updates; include the id when editing an existing record.',
].join('\n');

export function registerMatterTools(server: Pick<FastMCP, 'addTool'>) {
  server.addTool({
    name: 'matter_get',
    description:
      "Read the team's matters (the team may be linked to several), any pending update proposal, and the section schema. Call this before matter_propose to see what is already recorded and which matterId to target.",
    parameters: z.object({
      ...toolContextSchema,
      matterId: z.string().min(1).optional(),
    }),
    execute: async ({ teamName, claudeDir, matterId }) => {
      assertConfiguredTeam(teamName, claudeDir);
      const controller = getController(teamName, claudeDir);
      const snapshot = controller.matter.getSnapshot() as {
        matters: Array<Record<string, unknown>>;
        linkedMatterIds: string[];
        proposal: unknown;
      };
      const linked = snapshot.matters.filter((matter) =>
        snapshot.linkedMatterIds.includes(String(matter.id))
      );
      const detail =
        (matterId
          ? snapshot.matters.find((matter) => matter.id === matterId)
          : linked.length === 1
            ? linked[0]
            : null) ?? null;
      return jsonTextContent({
        matters: linked.map((matter) => ({
          id: matter.id,
          caption: matter.caption,
          status: matter.status,
          matterNumber: matter.matterNumber,
          currentStage: matter.currentStage,
        })),
        matter: detail,
        pendingProposal: snapshot.proposal,
        sectionReference: MATTER_SECTION_REFERENCE,
      });
    },
  });

  server.addTool({
    name: 'matter_propose',
    description:
      'Propose a matter dashboard update for USER review. Submit AFTER a related series of tasks (a job) finishes — not per task. Pass matterId from matter_get; it is required when the team works several matters (omit it only when the team has at most one). Derive the summary and changes from the task board (comments, results): grounded facts only, leave unknown fields absent, never invent dates, amounts, or outcomes. This call does NOT update the dashboard — the user approves or rejects the proposal there; a rejection reason arrives in your inbox. Re-proposing replaces your previous pending proposal.',
    parameters: z.object({
      ...toolContextSchema,
      matterId: z.string().min(1).optional(),
      from: z.string().min(1).optional(),
      summary: z.array(z.string().min(1)).min(1),
      changes: changesSchema,
      taskRefs: z.array(z.string().min(1)).optional(),
      sourceMode: z.enum(['direct-scan', 'link']).optional(),
      sourceRevision: z.string().min(1).optional(),
      evidence: z.array(evidenceRefSchema).max(50).optional(),
    }),
    execute: async ({
      teamName,
      claudeDir,
      matterId,
      from,
      summary,
      changes,
      taskRefs,
      sourceMode,
      sourceRevision,
      evidence,
    }) => {
      assertConfiguredTeam(teamName, claudeDir);
      const proposal = getController(teamName, claudeDir).matter.submitProposal(
        {
          ...(matterId ? { matterId } : {}),
          summary,
          changes,
          ...(taskRefs && taskRefs.length > 0 ? { taskRefs } : {}),
          ...(sourceMode ? { sourceMode } : {}),
          ...(sourceRevision ? { sourceRevision } : {}),
          ...(evidence && evidence.length > 0 ? { evidence } : {}),
        },
        from
      );
      return jsonTextContent({
        submitted: true,
        pendingUserReview: true,
        message:
          'Proposal recorded for user review in the matter dashboard. Do not re-propose unless the user rejects it or new facts emerge.',
        proposal,
      });
    },
  });
}
