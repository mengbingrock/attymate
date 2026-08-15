import { z } from 'zod';

import {
  eventIdSchema,
  membershipIdSchema,
  turnIdSchema,
  workspaceIdSchema,
} from './ids';

export const teamMessageEventPayloadSchema = z
  .object({
    senderMembershipId: membershipIdSchema,
    recipientMembershipId: membershipIdSchema,
    senderWorkspaceId: workspaceIdSchema,
    turnId: turnIdSchema,
    message: z.string().trim().min(1).max(20_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.senderMembershipId === value.recipientMembershipId) {
      context.addIssue({
        code: 'custom',
        message: 'A team message recipient must be a different membership',
      });
    }
  });

export type TeamMessageEventPayload = z.infer<typeof teamMessageEventPayloadSchema>;

export const teamMessageDeliveryPayloadSchema = teamMessageEventPayloadSchema.extend({
  messageId: eventIdSchema,
  recipientWorkspaceId: workspaceIdSchema,
  sentAt: z.iso.datetime({ offset: true }),
});

export type TeamMessageDeliveryPayload = z.infer<typeof teamMessageDeliveryPayloadSchema>;
