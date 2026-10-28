/** Exercises one role orientation and delivery mode with real engines and local Relay routing. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  workerInstanceIdSchema,
} from '../../packages/agent-teams-protocol/src';
import { RelayMembershipRouteStore } from '../../packages/agent-teams-relay/src/relayMembershipRouteStore';
import { startAgentTeamsRelay } from '../../packages/agent-teams-relay/src/relayServer';
import type { WorkerCodexAppServerSession } from '../../packages/agent-teams-worker/src/codexAppServerClient';
import { startAgentTeamsWorker } from '../../packages/agent-teams-worker/src/workerDaemon';
import {
  callRuntimeTool as tool,
  type startNativeServer,
  verifyWakeDelivery,
  waitFor,
} from './nativeCodexFixture';
import { startResponsesFixture } from './nativeResponsesFixture';
import { runNativeTaskScenario } from './nativeCodexTaskScenario';

export const runNativeOrientation = async (options: {
  root: string;
  bundle: string;
  leadKind: 'stock' | 'fork';
  deliveryMode: 'inline' | 'mcp-inbox';
  engines: Awaited<ReturnType<typeof startNativeServer>>[];
  responses: Awaited<ReturnType<typeof startResponsesFixture>>;
  evidence: Record<string, unknown>[];
  emit: (stage: string, detail: Record<string, unknown>) => void;
}) => {
  const { root, bundle, leadKind, deliveryMode, engines, responses, evidence, emit } = options;
  const caseRoot = join(root, leadKind + '-lead-' + deliveryMode);
  await mkdir(caseRoot);
  const managerToken = randomBytes(32).toString('hex'),
    workerToken = randomBytes(32).toString('hex');
  const relay = await startAgentTeamsRelay({
    host: '127.0.0.1',
    port: 0,
    dataDir: join(caseRoot, 'relay'),
    heartbeatIntervalMs: 200,
    auth: { managerToken, workerToken },
    joinPortal: { publicUrl: 'http://127.0.0.1' },
  });
  const routes = new RelayMembershipRouteStore(join(caseRoot, 'relay'));
  const sessions: WorkerCodexAppServerSession[] = [];
  const workers: Awaited<ReturnType<typeof startAgentTeamsWorker>>[] = [];
  const members: {
    kind: string;
    dataDir: string;
    membershipId: string;
    code: string;
    threadId: string;
    session: WorkerCodexAppServerSession;
    peer: WorkerCodexAppServerSession;
    options: Parameters<typeof startAgentTeamsWorker>[0];
  }[] = [];
  try {
    const created = await relay.app.inject({
      method: 'POST',
      url: '/v2/team-directory',
      headers: { authorization: 'Bearer ' + managerToken },
      payload: { name: 'Native mixed runtime smoke', description: 'Disposable local test only' },
    });
    assert.equal(created.statusCode, 201);
    const teamId = created.json().team.teamId as string;
    for (const engine of engines) {
      const dataDir = join(caseRoot, engine.kind);
      await mkdir(dataDir);
      const nodeId = randomUUID(),
        membershipId = randomUUID(),
        control = join(caseRoot, engine.kind + '-control.sock');
      routes.register({
        teamId,
        membershipId,
        nodeId,
        workspaceId: randomUUID(),
        role: engine.kind === leadKind ? 'lead' : 'member',
        label: 'native-' + engine.kind,
      });
      const options: Parameters<typeof startAgentTeamsWorker>[0] = {
        relayUrl: relay.wsUrl,
        relayToken: workerToken,
        dataDir,
        controlSocketPath: control,
        organizationId: organizationIdSchema.parse(randomUUID()),
        personId: personIdSchema.parse(randomUUID()),
        nodeId: nodeIdSchema.parse(nodeId),
        workerInstanceId: workerInstanceIdSchema.parse(randomUUID()),
        workerGeneration: 1,
        messageDeliveryMode: deliveryMode,
        label: 'native-' + engine.kind,
        reconnectDelayMs: 100,
        desktopChat: {
          sessionFactory: engine.factory,
          runtimeMcp: {
            command: process.execPath,
            args: [join(bundle!, 'runtimeMcpCli.js'), '--socket', control],
          },
        },
      };
      const worker = await startAgentTeamsWorker(options);
      workers.push(worker);
      await worker.ready;
      const session = await engine.factory.open(),
        peer = await engine.factory.open();
      sessions.push(session, peer);
      members.push({
        kind: engine.kind,
        dataDir,
        membershipId,
        code: (await readFile(join(dataDir, 'desktop-pairing-code'), 'utf8')).trim(),
        threadId: '',
        session,
        peer,
        options,
      });
    }
    await waitFor(
      async () =>
        workers.every((worker) =>
          worker
            .listTeamMemberships()
            .some((team) => team.teamId === teamId && team.members.length === 2)
        ),
      'Mixed roster not synchronized'
    );
    for (const member of members) {
      const opened = await relay.app.inject({
        method: 'POST',
        url: '/join/api/desktop',
        payload: {
          pairingCode: member.code,
          request: { action: 'open', teamId, requestId: randomUUID() },
        },
      });
      assert.equal(opened.statusCode, 200, opened.body);
      member.threadId = opened.json().result.threadId;
      assert.ok(member.threadId);
      await member.session.request('thread/resume', { threadId: member.threadId });
      await member.peer.request('thread/resume', { threadId: member.threadId });
      const context = await tool(member.peer, member.threadId, 'runtime_context');
      assert.ok(context.includes(member.membershipId), 'Wrong membership context');
    }
    emit('chats-open', {
      leadKind,
      deliveryMode,
      threads: members.map(({ kind, threadId }) => ({ kind, threadId })),
    });
    for (const [senderIndex, receiverIndex] of [
      [0, 1],
      [1, 0],
    ] as const) {
      const sender = members[senderIndex]!,
        receiver = members[receiverIndex]!;
      const events: { method: string; params: unknown }[] = [];
      const unsubscribe = receiver.peer.onNotification((notification) => events.push(notification));
      try {
        const requestOffset = responses.requests.length;
        const message = `${sender.kind.toUpperCase()}_TO_${receiver.kind.toUpperCase()}_${randomUUID()}`;
        await tool(sender.session, sender.threadId, 'message_send', {
          recipientMembershipId: receiver.membershipId,
          message,
        });
        await waitFor(
          async () =>
            (await tool(receiver.peer, receiver.threadId, 'message_list')).includes(message),
          'Peer message missing from native MCP inbox'
        );
        await waitFor(
          async () =>
            events.some(
              (event) =>
                event.method === 'turn/completed' &&
                (event.params as { turn?: { status?: string } }).turn?.status === 'completed'
            ),
          'Incoming message did not finish a native turn',
          45000
        );
        assert.ok(
          events.some((event) => JSON.stringify(event.params).includes('NATIVE_TEAM_WAKE_OK')),
          'Native turn omitted fixture response'
        );
        assert.ok(
          events.some((event) => event.method === 'turn/started'),
          'Idle thread did not start a turn'
        );
        verifyWakeDelivery(responses.requests.slice(requestOffset), message, deliveryMode);
        evidence.push({
          leadKind,
          deliveryMode,
          sender: sender.kind,
          receiver: receiver.kind,
          messageReadThroughMcp: true,
          modelReadThroughMcp: deliveryMode === 'mcp-inbox',
          idleWakeCompleted: true,
          simultaneousClients: true,
        });
      } finally {
        unsubscribe();
      }
    }
    const receiverIndex = leadKind === 'stock' ? 1 : 0;
    const receiver = members[receiverIndex]!,
      sender = members[1 - receiverIndex]!;
    await workers[receiverIndex]!.stop();
    workers[receiverIndex] = await startAgentTeamsWorker({
      ...receiver.options,
      workerGeneration: 2,
    });
    await workers[receiverIndex]!.ready;
    await waitFor(
      async () =>
        workers[receiverIndex]!.listTeamMemberships().some(
          (team) => team.teamId === teamId && team.members.length === 2
        ),
      'Membership did not recover after restart'
    );
    const current = await tool(receiver.session, receiver.threadId, 'runtime_context');
    assert.ok(current.includes(receiver.membershipId));
    const context = await relay.app.inject({
      method: 'POST',
      url: '/join/api/desktop',
      payload: {
        pairingCode: receiver.code,
        request: { action: 'context', requestId: randomUUID() },
      },
    });
    assert.equal(context.statusCode, 200, context.body);
    assert.ok(context.body.includes(receiver.threadId), 'Persistent thread binding lost');
    const events: { method: string; params: unknown }[] = [];
    const unsubscribe = receiver.peer.onNotification((notification) => events.push(notification));
    try {
      const message = 'NATIVE_RESTART_MESSAGE_' + randomUUID();
      await tool(sender.session, sender.threadId, 'message_send', {
        recipientMembershipId: receiver.membershipId,
        message,
      });
      await waitFor(
        async () =>
          (await tool(receiver.peer, receiver.threadId, 'message_list')).includes(message),
        'Post-restart message missing'
      );
      await waitFor(
        async () =>
          events.some(
            (event) =>
              event.method === 'turn/completed' &&
              (event.params as { turn?: { status?: string } }).turn?.status === 'completed'
          ),
        'Restarted Worker failed to wake native thread',
        45000
      );
      assert.ok(
        events.some((event) => JSON.stringify(event.params).includes('NATIVE_TEAM_WAKE_OK'))
      );
      evidence.push({
        leadKind,
        deliveryMode,
        restarted: receiver.kind,
        membershipRecovered: true,
        persistentThread: true,
        mcpRecovered: true,
        idleWakeCompleted: true,
      });
    } finally {
      unsubscribe();
    }
    await runNativeTaskScenario({
      relay,
      workers,
      engines,
      members,
      teamId,
      managerToken,
      leadKind,
      deliveryMode,
      responses,
      evidence,
      emit,
    });
  } finally {
    for (const worker of workers) await worker.stop();
    for (const session of sessions) await session.close();
    routes.close();
    await relay.close();
  }
};
