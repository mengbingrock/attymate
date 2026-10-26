import { z } from 'zod';

export const desktopChatActionSchema = z
  .object({
    action: z.enum(['context', 'open', 'default', 'attach']),
    teamId: z.uuid().nullable().optional(),
    threadId: z
      .string()
      .regex(/^[a-zA-Z0-9-]{1,100}$/)
      .optional(),
    requestId: z.uuid(),
  })
  .strict();
export type DesktopChatAction = z.infer<typeof desktopChatActionSchema>;

export const relayDesktopControlSchema = z
  .object({
    type: z.literal('relay.desktop_control'),
    request: desktopChatActionSchema,
  })
  .strict();
export const workerDesktopResultSchema = z
  .object({
    type: z.literal('worker.desktop_result'),
    requestId: z.uuid(),
    result: z.unknown().optional(),
    error: z.string().max(512).optional(),
  })
  .strict();

// Membership messages do not borrow an assignment's execution lease.
export const desktopMessageSchema = z
  .object({
    id: z.uuid(),
    teamId: z.uuid(),
    senderMembershipId: z.uuid(),
    recipientMembershipId: z.uuid(),
    text: z.string().trim().min(1).max(20000),
    sentAt: z.iso.datetime(),
  })
  .strict();
export type DesktopTeamMessage = z.infer<typeof desktopMessageSchema>;
export const workerDesktopMessageSchema = z
  .object({
    type: z.literal('worker.desktop_message'),
    message: desktopMessageSchema,
  })
  .strict();
export const relayDesktopMessageSchema = z
  .object({
    type: z.literal('relay.desktop_message'),
    message: desktopMessageSchema,
  })
  .strict();
export const desktopMessageAckSchema = z
  .object({
    type: z.enum(['worker.desktop_message_ack', 'relay.desktop_message_ack']),
    id: z.uuid(),
    error: z.string().max(512).optional(),
  })
  .strict();
