import { z } from 'zod';

import { encodeTeamReply } from './teamMessageReplies';

const recipientFields = {
  recipientMembershipId: z.uuid().optional(),
  recipient: z.literal('lead').optional(),
};

/** These are references to work, never authoritative membership or execution identities. */
export const collaborationTaskRefSchema = z
  .object({
    taskId: z.string().trim().min(1).max(512),
    displayId: z.string().trim().min(1).max(128),
    teamName: z.string().trim().min(1).max(128),
  })
  .strict();

const validateRecipient = (
  value: { recipientMembershipId?: string; recipient?: 'lead' },
  context: z.RefinementCtx,
  required: boolean
) => {
  if (
    (value.recipientMembershipId && value.recipient) ||
    (required && !value.recipientMembershipId && !value.recipient)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Choose exactly one recipientMembershipId or recipient: lead',
    });
  }
};

export const teamMessageParameters = z
  .object({
    ...recipientFields,
    message: z.string().trim().min(1).max(20_000),
    inReplyToMessageId: z.uuid().optional(),
  })
  .strict()
  .superRefine((value, context) => validateRecipient(value, context, true));

export const collaborationRequestParameters = z
  .object({
    ...recipientFields,
    summary: z.string().trim().min(1).max(4_000),
    details: z.string().trim().min(1).max(12_000).optional(),
    taskRefs: z.array(collaborationTaskRefSchema).max(32).optional(),
    artifacts: z.array(z.string().trim().min(1).max(2_000)).max(32).optional(),
  })
  .strict()
  .superRefine((value, context) => validateRecipient(value, context, false));

export const isTeamCommunicationTool = (
  name: string
): name is 'message_send' | 'support_request' | 'review_request' =>
  name === 'message_send' || name === 'support_request' || name === 'review_request';

interface RosterMember {
  readonly membershipId: string;
  readonly role: string;
  readonly status: string;
}

/** Resolve aliases on the server using its authenticated roster, then emit the existing message contract. */
export const teamCommunicationMessage = (
  tool: 'message_send' | 'support_request' | 'review_request',
  input: unknown,
  senderMembershipId: string,
  roster: readonly RosterMember[] | undefined
): { recipientMembershipId: string; message: string } => {
  const args =
    tool === 'message_send'
      ? teamMessageParameters.parse(input)
      : collaborationRequestParameters.parse(input);
  let recipientMembershipId = args.recipientMembershipId;
  if (!recipientMembershipId) {
    const leads =
      roster?.filter((member) => member.role === 'lead' && member.status === 'active') ?? [];
    if (leads.length !== 1)
      throw new Error(
        'This team has no single active lead; choose an active recipientMembershipId'
      );
    recipientMembershipId = leads[0]!.membershipId;
  }
  if (recipientMembershipId === senderMembershipId)
    throw new Error('Recipient must be another active member of this team');
  if (
    roster &&
    !roster.some(
      (member) => member.membershipId === recipientMembershipId && member.status === 'active'
    )
  ) {
    throw new Error('Recipient must be another active member of this team');
  }
  if (tool !== 'message_send' && !roster)
    throw new Error('An active team roster is required for collaboration requests');
  if (tool === 'message_send') {
    const message = teamMessageParameters.parse(input);
    return {
      recipientMembershipId,
      message: encodeTeamReply(message.message, message.inReplyToMessageId),
    };
  }
  const request = collaborationRequestParameters.parse(input);
  const message = JSON.stringify({
    type: 'agent-teams.collaboration-request',
    version: 1,
    kind: tool,
    summary: request.summary,
    ...(request.details ? { details: request.details } : {}),
    ...(request.taskRefs ? { taskRefs: request.taskRefs } : {}),
    ...(request.artifacts ? { artifacts: request.artifacts } : {}),
  });
  if (message.length > 20_000)
    throw new Error('Collaboration request exceeds the team message size limit');
  return { recipientMembershipId, message };
};
