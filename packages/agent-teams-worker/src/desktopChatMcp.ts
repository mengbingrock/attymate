import { FastMCP } from 'fastmcp';
import { z } from 'zod';
import { collaborationRequestParameters, teamMessageParameters } from './teamCollaborationRequests';
import { requestWorkerControl } from './workerControlServer';
import { messageIdParameters, messageListParameters } from './runtimeMcpServer';

export const createDesktopChatMcp = (socket: string, token: string) => {
  const server = new FastMCP({ name: 'agent-teams-runtime', version: '2.1.0' });
  for (const name of ['runtime_context', 'team_membership_list', 'message_list'] as const) {
    server.addTool({
      name,
      description:
        name === 'message_list'
          ? 'Read messages delivered to this team member'
          : 'Discover this chat’s team, your membership, and the active roster',
      parameters: name === 'message_list' ? messageListParameters : z.object({}).strict(),
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
  for (const name of ['message_get', 'message_ack'] as const) {
    server.addTool({
      name,
      description:
        name === 'message_get'
          ? 'Read an incoming message in this membership inbox'
          : 'Mark an incoming message processed locally without sending a reply',
      parameters: messageIdParameters,
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
    parameters: teamMessageParameters,
    execute: async (input) =>
      JSON.stringify(
        await requestWorkerControl(socket, '/v2/desktop-chat/tool', {
          method: 'POST',
          bearerToken: token,
          body: { tool: 'message_send', arguments: input },
        })
      ),
  });
  for (const name of ['support_request', 'review_request'] as const) {
    server.addTool({
      name,
      description:
        name === 'support_request'
          ? 'Ask a teammate or the lead for help'
          : 'Request review without approving or changing task state',
      parameters: collaborationRequestParameters,
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
  return server;
};
