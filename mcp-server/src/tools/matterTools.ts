import type { FastMCP } from 'fastmcp';
import { z } from 'zod';

import { getController } from '../controller';
import { jsonTextContent } from '../utils/format';
import { assertConfiguredTeam } from '../utils/teamConfig';

const toolContextSchema = {
  teamName: z.string().min(1),
  claudeDir: z.string().min(1).optional(),
};

const stageIdSchema = z.enum(['pleading', 'discovery', 'trial', 'post']);

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

const pleadingSchema = z.object({
  statusNote: z.string().optional(),
  operativePleading: z.string().optional(),
  pleadingType: z.string().optional(),
  amendmentDeadline: z.string().optional(),
  causesOfAction: z.string().optional(),
});

const discoverySchema = z.object({
  statusNote: z.string().optional(),
  requests: z
    .array(
      z.object({
        type: z.string().min(1),
        set: z.string().optional(),
        parties: z.string().optional(),
        served: z.string().optional(),
        due: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .optional(),
  meetConfer: z
    .object({
      date: z.string().optional(),
      method: z.string().optional(),
      outcome: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
  pendingMotion: z
    .object({
      motionType: z.string().optional(),
      relatedRequest: z.string().optional(),
      reservation: z.string().optional(),
      filed: z.string().optional(),
      oppositionDue: z.string().optional(),
      replyDue: z.string().optional(),
      hearing: z.string().optional(),
      outcome: z.string().optional(),
    })
    .optional(),
  productions: z
    .array(
      z.object({
        type: z.string().min(1),
        bates: z.string().optional(),
        date: z.string().optional(),
      })
    )
    .optional(),
  depositions: z
    .array(
      z.object({
        name: z.string().min(1),
        taken: z.string().optional(),
        review: z.string().optional(),
        note: z.string().optional(),
      })
    )
    .optional(),
});

const trialSchema = z.object({
  statusNote: z.string().optional(),
  trialDate: z.string().optional(),
  trialType: z.string().optional(),
  estimatedDuration: z.string().optional(),
  settingStatus: z.string().optional(),
  pretrialDeadlines: z
    .array(
      z.object({
        title: z.string().min(1),
        due: z.string().optional(),
        source: z.string().optional(),
        status: z.string().optional(),
      })
    )
    .optional(),
  witnesses: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().optional(),
        party: z.string().optional(),
        availability: z.string().optional(),
      })
    )
    .optional(),
  exhibits: z
    .array(
      z.object({
        number: z.string().min(1),
        title: z.string().min(1),
        admission: z.string().optional(),
      })
    )
    .optional(),
  continuancesNote: z.string().optional(),
});

const postJudgmentSchema = z.object({
  statusNote: z.string().optional(),
  judgmentStatus: z.string().optional(),
  judgmentDate: z.string().optional(),
  judgmentAmount: z.string().optional(),
  enforcementStatus: z.string().optional(),
  enforcementDeadline: z.string().optional(),
  enforcementActions: z.string().optional(),
});

const changesSchema = z
  .object({
    caption: z.string().min(1).optional(),
    status: z.string().min(1).optional(),
    matterNumber: z.string().min(1).optional(),
    currentStage: stageIdSchema.optional(),
    coreFields: z.array(fieldSchema).optional(),
    systemFields: z.array(fieldSchema).optional(),
    stages: z.array(stageSchema).optional(),
    nextDeadline: deadlineSchema.optional(),
    pleading: pleadingSchema.optional(),
    discovery: discoverySchema.optional(),
    trial: trialSchema.optional(),
    postJudgment: postJudgmentSchema.optional(),
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
  '- caption, status, matterNumber, currentStage (pleading|discovery|trial|post)',
  '- coreFields[] / systemFields[]: { label, value } (arrays replace the previous list wholesale)',
  '- stages[]: { id, label?, dates?, summary? }',
  '- nextDeadline: { date, label }',
  '- pleading: { statusNote?, operativePleading?, pleadingType?, amendmentDeadline?, causesOfAction? }',
  '- discovery: { statusNote?, requests[], meetConfer, pendingMotion, productions[], depositions[] }',
  '- trial: { statusNote?, trialDate?, trialType?, estimatedDuration?, settingStatus?, pretrialDeadlines[], witnesses[], exhibits[], continuancesNote? }',
  '- postJudgment: { statusNote?, judgmentStatus?, judgmentDate?, judgmentAmount?, enforcementStatus?, enforcementDeadline?, enforcementActions? }',
  'Object sections merge shallowly on apply; arrays replace wholesale.',
].join('\n');

export function registerMatterTools(server: Pick<FastMCP, 'addTool'>) {
  server.addTool({
    name: 'matter_get',
    description:
      'Read the current matter dashboard state, any pending update proposal, and the section schema. Call this before matter_propose to see what is already recorded.',
    parameters: z.object({
      ...toolContextSchema,
    }),
    execute: async ({ teamName, claudeDir }) => {
      assertConfiguredTeam(teamName, claudeDir);
      const controller = getController(teamName, claudeDir);
      return jsonTextContent({
        matter: controller.matter.readMatter(),
        pendingProposal: controller.matter.readProposal(),
        sectionReference: MATTER_SECTION_REFERENCE,
      });
    },
  });

  server.addTool({
    name: 'matter_propose',
    description:
      'Propose a matter dashboard update for USER review. Submit AFTER a related series of tasks (a job) finishes — not per task. Derive the summary and changes from the task board (comments, results): grounded facts only, leave unknown fields absent, never invent dates, amounts, or outcomes. This call does NOT update the dashboard — the user approves or rejects the proposal there; a rejection reason arrives in your inbox. Re-proposing replaces your previous pending proposal.',
    parameters: z.object({
      ...toolContextSchema,
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
