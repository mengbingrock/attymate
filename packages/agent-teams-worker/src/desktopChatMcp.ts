import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { requestWorkerControl } from './workerControlServer';

export const createDesktopChatMcp = (socket: string, token: string) => {
  const server = new FastMCP({ name: 'agent-teams-runtime', version: '2.1.0' });
  for (const name of ['runtime_context', 'team_membership_list', 'message_list'] as const) {
    server.addTool({
      name,
      description:
        name === 'message_list'
          ? 'Read messages delivered to this team member'
          : 'Discover this chat’s team, your membership, and the active roster',
      parameters: z.object({}).strict(),
      execute: async (input) =>
        JSON.stringify(
          await requestWorkerControl(socket, '/v2/desktop-chat/tool', {
            method: 'POST',
            bearerToken: token,
            body: { tool: name, arguments: input },
          })
        ),
    });
  }
  server.addTool({
    name: 'message_send',
    description: 'Send a durable message to another member of this chat’s team',
    parameters: z
      .object({ recipientMembershipId: z.uuid(), message: z.string().trim().min(1).max(20000) })
      .strict(),
    execute: async (input) =>
      JSON.stringify(
        await requestWorkerControl(socket, '/v2/desktop-chat/tool', {
          method: 'POST',
          bearerToken: token,
          body: { tool: 'message_send', arguments: input },
        })
      ),
  });
  return server;
};
