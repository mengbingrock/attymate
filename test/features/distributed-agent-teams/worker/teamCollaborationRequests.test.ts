// @vitest-environment node
import { randomUUID } from 'node:crypto';

import { DESKTOP_TEAM_TOOLS } from '../../../../packages/agent-teams-worker/src/desktopChatService';
import {
  createRuntimeMcpToolDefinitions,
  parseRuntimeMcpToolArguments,
  runtimeBridgeToolNames,
} from '../../../../packages/agent-teams-worker/src/runtimeMcpServer';
import { teamCommunicationMessage } from '../../../../packages/agent-teams-worker/src/teamCollaborationRequests';
import {
  decodeTeamReply,
  encodeTeamReply,
} from '../../../../packages/agent-teams-worker/src/teamMessageReplies';

describe('team collaboration request contracts', () => {
  it('bounds versioned reply envelopes while preserving ordinary and unknown-version messages', () => {
    const messageId = randomUUID();
    expect(decodeTeamReply(encodeTeamReply('Reply', messageId))).toEqual({
      text: 'Reply',
      inReplyToMessageId: messageId,
    });
    expect(encodeTeamReply('Plain message')).toBe('Plain message');
    const unknown = JSON.stringify({
      type: 'agent-teams.message-reply',
      version: 2,
      text: 'Future',
      inReplyToMessageId: messageId,
    });
    expect(decodeTeamReply(unknown)).toEqual({ text: unknown });
    expect(() => encodeTeamReply('x'.repeat(20_000), messageId)).toThrow('size limit');
  });
  it.each(['member', 'lead'] as const)(
    'implements advertised collaboration tools for %s runtime sessions',
    (role) => {
      const definitions = createRuntimeMcpToolDefinitions(
        '/fixture/control.sock',
        'fixture-token',
        role
      );
      expect(definitions.map(({ name }) => name).sort()).toEqual(
        [...runtimeBridgeToolNames(role)].sort()
      );
      for (const tool of ['support_request', 'review_request'] as const) {
        expect(DESKTOP_TEAM_TOOLS).toContain(tool);
        expect(definitions.find(({ name }) => name === tool)).toBeDefined();
        expect(parseRuntimeMcpToolArguments(tool, { summary: 'Ask the lead for help' })).toEqual({
          summary: 'Ask the lead for help',
        });
        expect(() =>
          parseRuntimeMcpToolArguments(tool, { summary: 'Spoof', actor: randomUUID() })
        ).toThrow();
      }
    }
  );

  it('resolves the current lead on the server and refuses absent, ambiguous, or self targets', () => {
    const sender = randomUUID(),
      oldLead = randomUUID(),
      newLead = randomUUID();
    const roster = [
      { membershipId: sender, role: 'member', status: 'active' },
      { membershipId: oldLead, role: 'lead', status: 'left' },
      { membershipId: newLead, role: 'lead', status: 'active' },
    ];
    expect(
      teamCommunicationMessage(
        'message_send',
        { recipient: 'lead', message: 'Question' },
        sender,
        roster
      )
    ).toEqual({ recipientMembershipId: newLead, message: 'Question' });
    expect(() =>
      teamCommunicationMessage('support_request', { summary: 'Help' }, newLead, roster)
    ).toThrow('another active');
    expect(() =>
      teamCommunicationMessage('review_request', { summary: 'Review' }, sender, [])
    ).toThrow('no single active lead');
    expect(() =>
      teamCommunicationMessage('review_request', { summary: 'Review' }, sender, [
        ...roster,
        { membershipId: randomUUID(), role: 'lead', status: 'active' },
      ])
    ).toThrow('no single active lead');
    expect(() =>
      teamCommunicationMessage(
        'review_request',
        { recipientMembershipId: oldLead, summary: 'Review' },
        sender,
        roster
      )
    ).toThrow('another active');
    expect(() =>
      teamCommunicationMessage(
        'review_request',
        { recipientMembershipId: newLead, summary: 'Review' },
        sender,
        undefined
      )
    ).toThrow('active team roster');
  });

  it('preserves UUID message calls and bounds structured request payloads before enqueue', () => {
    const sender = randomUUID(),
      recipientMembershipId = randomUUID();
    expect(
      teamCommunicationMessage(
        'message_send',
        { recipientMembershipId, message: 'Legacy message' },
        sender,
        undefined
      )
    ).toEqual({ recipientMembershipId, message: 'Legacy message' });
    const roster = [{ membershipId: recipientMembershipId, role: 'lead', status: 'active' }];
    expect(() =>
      teamCommunicationMessage(
        'support_request',
        { recipientMembershipId, recipient: 'lead', summary: 'Ambiguous' },
        sender,
        roster
      )
    ).toThrow('exactly one');
    expect(() =>
      teamCommunicationMessage(
        'review_request',
        {
          recipientMembershipId,
          summary: 's'.repeat(4000),
          details: 'd'.repeat(12000),
          artifacts: ['a'.repeat(2000), 'b'.repeat(2000), 'c'.repeat(2000)],
        },
        sender,
        roster
      )
    ).toThrow('size limit');
  });
});
