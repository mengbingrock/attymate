import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { App } from '@microsoft/teams.apps';

import { createDistributedAgentTeamsFeature } from '../../../src/features/distributed-agent-teams/main';
import type { TeamsBinding, TeamsRequest } from '../../../src/features/microsoft-teams/contracts';
import {
  RelayTeamsRuntime,
  SqliteRequestJournal,
  TeamsGateway,
  TeamsResultDelivery,
  TeamsApprovalDelivery,
  SqliteTeamsApprovalJournal,
} from '../../../src/features/microsoft-teams/main';

for (const name of ['CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID', 'TEAMS_PILOT_CONFIG']) {
  if (!process.env[name]) throw new Error(`${name} is required; unauthenticated mode is disabled`);
}
const config = JSON.parse(readFileSync(resolve(process.env.TEAMS_PILOT_CONFIG!), 'utf8')) as {
  relayUrl: string;
  managerToken: string;
  ownerControlSocketPath?: string;
  journalPath: string;
  bindings: TeamsBinding[];
};
if (
  config.bindings.length === 0 ||
  config.bindings.some((binding) => binding.tenantId !== process.env.TENANT_ID)
) {
  throw new Error('Configure explicit bindings in the registered tenant');
}
const framework = createDistributedAgentTeamsFeature({
  ownerControlSocketPath: config.ownerControlSocketPath,
  relayUrl: config.relayUrl,
  managerToken: config.managerToken,
});
const journal = new SqliteRequestJournal(config.journalPath);
const gateway = new TeamsGateway(config.bindings, new RelayTeamsRuntime(framework), journal);
const app = new App();
const results = new TeamsResultDelivery(
  createDistributedAgentTeamsFeature({
    ownerControlSocketPath: config.ownerControlSocketPath,
    relayUrl: config.relayUrl,
    managerToken: config.managerToken,
  }),
  config.bindings,
  journal,
  async (target, text) => (await app.send(target.conversationId, text)).id,
  () =>
    console.error(
      'Teams result delivery needs attention; inspect the delivery journal and runtime coverage.'
    )
);
const approvals = new TeamsApprovalDelivery(
  createDistributedAgentTeamsFeature({
    ownerControlSocketPath: config.ownerControlSocketPath,
    relayUrl: config.relayUrl,
    managerToken: config.managerToken,
  }),
  config.bindings,
  journal,
  new SqliteTeamsApprovalJournal(config.journalPath),
  async (target, card) =>
    (
      await app.send(target.conversationId, {
        type: 'message',
        attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: card }],
      })
    ).id,
  () =>
    console.error('Teams approval delivery needs attention; inspect the private approval journal.')
);

app.on('card.action', async ({ activity }) => {
  let text: string;
  try {
    const binding = gateway.authorize({
      requestKey: activity.id ?? 'approval',
      channelId: activity.channelId,
      tenantId: activity.channelData?.tenant?.id ?? '',
      aadObjectId: activity.from.aadObjectId ?? '',
      conversationType: activity.conversation.conversationType,
      text: 'approval',
    });
    const data = activity.value.action.data as Record<string, unknown>;
    if (
      data.action !== 'agentApproval' ||
      typeof data.approvalId !== 'string' ||
      !['accept', 'decline'].includes(String(data.decision))
    )
      throw new Error('Invalid approval action');
    text = await approvals.resolve(
      { ...binding, conversationId: activity.conversation.id },
      data.approvalId,
      data.decision as 'accept' | 'decline',
      data
    );
  } catch {
    text =
      'This approval is unavailable or does not belong to your account. No new permission was granted.';
  }
  return {
    statusCode: 200,
    type: 'application/vnd.microsoft.activity.message' as const,
    value: text,
  };
});
app.server.serveStatic('/pilot-info', fileURLToPath(new URL('../public', import.meta.url)));
if (process.env.TEAMS_PILOT_UPDATES_DIR)
  app.server.serveStatic('/pilot-updates', resolve(process.env.TEAMS_PILOT_UPDATES_DIR));

app.on('message', async (context) => {
  const { activity } = context;
  const tenantId = activity.channelData?.tenant?.id ?? '';
  const aadObjectId = activity.from.aadObjectId ?? '';
  const input: TeamsRequest = {
    channelId: activity.channelId,
    tenantId,
    aadObjectId,
    conversationType: activity.conversation.conversationType,
    text: activity.text,
    requestKey: createHash('sha256')
      .update(JSON.stringify([tenantId, aadObjectId, activity.conversation.id, activity.id]))
      .digest('hex'),
  };
  try {
    const binding = gateway.authorize(input);
    journal.rememberConversation({ ...binding, conversationId: activity.conversation.id });
  } catch {
    await context.send('This pilot is available only in an enrolled user’s private chat.');
    return;
  }
  try {
    await results.activate(gateway.authorize(input));
    await approvals.tick();
    if (input.text.trim().toLowerCase() === 'approval status') {
      await context.send(
        await approvals.refreshUnknown({
          ...gateway.authorize(input),
          conversationId: activity.conversation.id,
        })
      );
      return;
    }
  } catch {
    await context.send(
      'Your agent connection is temporarily unavailable. No work has been started.'
    );
    return;
  }
  await context.send({ type: 'typing' });
  const conversationId = activity.conversation.id;
  void gateway
    .handleResponse(input)
    .then(async (reply) => {
      const binding = gateway.authorize(input);
      journal.enqueue(
        reply.deliveryKey ?? `request:${input.requestKey}`,
        { ...binding, conversationId },
        reply.text
      );
      await results.tick();
    })
    .catch(async () => {
      console.error('Teams request failed; inspect the pilot journal.');
      await app
        .send(
          conversationId,
          'The request could not be confirmed complete. Check the pilot diagnostics before retrying.'
        )
        .catch(() => undefined);
    });
});

await app.start(Number(process.env.PORT ?? 3978));
setInterval(() => {
  void results.tick();
  void approvals.tick().catch(() => console.error('Could not refresh Teams approvals.'));
}, 500);
console.log('Authenticated Teams pilot adapter started.');
