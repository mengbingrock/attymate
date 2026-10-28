// @vitest-environment node

import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  nodeIdSchema,
  organizationIdSchema,
  personIdSchema,
  type RuntimeSessionCreated,
  teamIdSchema,
  workerInstanceIdSchema,
} from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import {
  type CodexAppServerNotification,
  createOwnerRuntimeClient,
  startAgentTeamsWorker,
  type WorkerCodexAppServerSession,
  WorkerRuntimeOwnerAuthorization,
} from '@claude-teams/agent-teams-worker';
import { createDistributedAgentTeamsFeature } from '@features/distributed-agent-teams/main';
import { createPilotIngress } from '@features/microsoft-teams/main';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import * as relayOwnerAuthorization from '../../../../packages/agent-teams-relay/src/runtimeOwnerAuthorization';

import type { AddressInfo } from 'node:net';

const managerToken = 'manager-token-owner-isolation-regression';
const workerToken = 'worker-token-owner-isolation-regression';

describe('personal Worker owner isolation', () => {
  it('does not turn a manager credential and an active lease into owner access', async () => {
    const root = await mkdtemp(join(tmpdir(), 'worker-owner-isolation-'));
    const workspace = join(root, 'workspace');
    await mkdir(workspace);
    await writeFile(join(workspace, 'private.txt'), 'employee-private-fixture');
    const teamId = teamIdSchema.parse('42000000-0000-4000-8000-000000000001');
    const nodeId = nodeIdSchema.parse('42000000-0000-4000-8000-000000000002');
    const relay = await startAgentTeamsRelay({
      host: '127.0.0.1',
      port: 0,
      dataDir: join(root, 'relay'),
      heartbeatIntervalMs: 250,
      leaseDurationMs: 30_000,
      auth: { managerToken, workerToken },
    });
    const calls: string[] = [];
    const notifications = new Set<(value: CodexAppServerNotification) => void>();
    const codex: WorkerCodexAppServerSession = {
      request: async <T>(method: string): Promise<T> => {
        calls.push(method);
        if (method === 'thread/start') return { thread: { id: 'employee-thread' } } as T;
        if (method === 'turn/start') return { turn: { id: 'employee-turn' } } as T;
        return {} as T;
      },
      notify: () => undefined,
      onNotification: (listener) => {
        notifications.add(listener);
        return () => notifications.delete(listener);
      },
      onRequest: () => () => undefined,
      respondToRequest: () => undefined,
      onClose: () => () => undefined,
      close: async () => undefined,
    };
    const worker = await startAgentTeamsWorker({
      relayUrl: relay.wsUrl,
      relayToken: workerToken,
      dataDir: join(root, 'worker'),
      controlSocketPath: join(root, 'control.sock'),
      organizationId: organizationIdSchema.parse('42000000-0000-4000-8000-000000000003'),
      personId: personIdSchema.parse('42000000-0000-4000-8000-000000000004'),
      nodeId,
      workerInstanceId: workerInstanceIdSchema.parse('42000000-0000-4000-8000-000000000005'),
      workerGeneration: 1,
      label: 'Independent employee',
      codexRuntime: { cwd: workspace, sessionFactory: { open: async () => codex } },
    });
    const managerData = join(root, 'manager-owner');
    await mkdir(managerData);
    const managerOwner = await WorkerRuntimeOwnerAuthorization.open(
      managerData,
      personIdSchema.parse('42000000-0000-4000-8000-000000000006')
    );
    const ingress = createPilotIngress({
      teamsPort: 1,
      relayPort: Number(new URL(relay.httpUrl).port),
    });
    ingress.listen(0, '127.0.0.1');
    await once(ingress, 'listening');
    const publicUrl = `http://127.0.0.1:${(ingress.address() as AddressInfo).port}`;
    try {
      const malformed = await fetch(`${publicUrl}/v2/runtime-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.get('cache-control')).toBe('no-store');
      await worker.ready;
      const manager = createDistributedAgentTeamsFeature({ relayUrl: relay.httpUrl, managerToken });
      await manager.createRemoteAssignment({
        teamId,
        targetNodeId: nodeId,
        title: 'Synthetic collaboration request',
      });
      await vi.waitFor(() => expect(worker.listAssignments()).toHaveLength(1));
      await vi.waitFor(async () =>
        expect((await manager.getAssignmentEvents()).events.length).toBeGreaterThan(0)
      );
      await manager.startTeam({ teamId });
      await vi.waitFor(() => expect(worker.listRuntimeBindings()[0]?.state).toBe('active'));
      const lease = relay.listLeases()[0]!;
      const response = await fetch(`${relay.httpUrl}/v2/runtime-sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          teamId,
          nodeId,
          assignmentId: lease.assignmentId,
          attemptId: lease.attemptId,
          leaseEpoch: lease.leaseEpoch,
        }),
      });
      expect(response.status).toBe(403);
      expect(calls).not.toContain('turn/steer');
      expect(worker.listRuntimeBindings()[0]?.state).toBe('active');

      // Owner-local operations need no manager credential and do not transit the Relay.
      const privateFrames: unknown[] = [];
      const originalSend = WebSocket.prototype.send;
      const privateSpy = vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (
        this: WebSocket,
        ...args: Parameters<WebSocket['send']>
      ) {
        if (typeof args[0] === 'string' && args[0].includes('worker.runtime_event'))
          privateFrames.push(JSON.parse(args[0]));
        return originalSend.apply(this, args);
      });
      const localOwner = await createOwnerRuntimeClient(join(root, 'control.sock'));
      expect(JSON.stringify(await localOwner.read())).toContain('employee-thread');
      const localRead = await localOwner.control({
        controlId: randomUUID(),
        type: 'filesystem.read',
        payload: { path: 'private.txt' },
      });
      expect(localRead).toMatchObject({ ok: true });
      expect(JSON.stringify(localRead)).toContain('employee-private-fixture');
      expect(privateFrames).toEqual([]);
      privateSpy.mockRestore();

      // The real owner retains private access through the owner-only local socket.
      const scope = {
        teamId,
        nodeId,
        assignmentId: lease.assignmentId!,
        attemptId: lease.attemptId!,
        leaseEpoch: lease.leaseEpoch,
      };
      const owner = createDistributedAgentTeamsFeature({
        relayUrl: relay.httpUrl,
        ownerControlSocketPath: join(root, 'control.sock'),
      });
      await vi.waitFor(async () =>
        expect((await owner.getRuntimeSession(scope)).events.length).toBeGreaterThan(0)
      );
      const ownerClient = await createOwnerRuntimeClient(join(root, 'control.sock'), publicUrl);
      await vi.waitFor(async () =>
        expect(JSON.stringify(await ownerClient.read())).toContain('employee-thread')
      );
      expect(
        (
          await fetch(`${publicUrl}/v2/workers`, {
            headers: { authorization: `Bearer ${managerToken}` },
          })
        ).status
      ).toBe(404);
      expect(
        (await fetch(`${publicUrl}/v2/runtime-owner/authorize`, { method: 'POST' })).status
      ).toBe(404);

      // A malicious broker cannot substitute an action into a signed read-only opening.
      const substitutedSession = randomUUID();
      const send = WebSocket.prototype.send;
      const sendSpy = vi.spyOn(WebSocket.prototype, 'send').mockImplementation(function (
        this: WebSocket,
        ...args: Parameters<WebSocket['send']>
      ) {
        if (typeof args[0] === 'string') {
          const message = JSON.parse(args[0]) as Record<string, unknown>;
          if (
            message.type === 'relay.runtime_control' &&
            message.sessionId === substitutedSession &&
            message.ownerOperation === 'session.open'
          )
            args[0] = JSON.stringify({
              ...message,
              control: {
                controlId: randomUUID(),
                type: 'filesystem.read',
                payload: { path: 'private.txt' },
              },
            });
        }
        return send.apply(this, args);
      });
      const substitutedProof = worker.authorizeOwnerRuntimeRequest({
        operation: 'session.open',
        sessionId: substitutedSession,
        scope,
      });
      const substitutedOpen = await fetch(`${relay.httpUrl}/v2/runtime-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...scope,
          sessionId: substitutedSession,
          ownerAuthorization: substitutedProof,
        }),
      });
      expect(substitutedOpen.status).toBe(201);
      const substituted = (await substitutedOpen.json()) as RuntimeSessionCreated;
      await vi.waitFor(async () => {
        const result = (await (
          await fetch(`${relay.httpUrl}/v2/runtime-sessions/${substitutedSession}/events`, {
            headers: { authorization: `Bearer ${substituted.sessionToken}` },
          })
        ).json()) as { events: unknown[] };
        expect(JSON.stringify(result.events)).toContain('Device-owner authorization is required');
        expect(JSON.stringify(result.events)).not.toContain('employee-private-fixture');
      });
      sendSpy.mockRestore();

      const sessionId = randomUUID();
      const wrongOwnerProof = managerOwner.sign({ operation: 'session.open', sessionId, scope });
      const wrongOwnerOpen = await fetch(`${relay.httpUrl}/v2/runtime-sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${managerToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...scope, sessionId, ownerAuthorization: wrongOwnerProof }),
      });
      expect(wrongOwnerOpen.status).toBe(403);

      // Simulate a Relay incorrectly accepting the manager. The Worker must still refuse.
      vi.spyOn(relayOwnerAuthorization, 'verifyRuntimeOwnerAuthorization').mockReturnValue(true);
      const forgedOpen = await fetch(`${relay.httpUrl}/v2/runtime-sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...scope, sessionId, ownerAuthorization: wrongOwnerProof }),
      });
      expect(forgedOpen.status).toBe(201);
      const forged = (await forgedOpen.json()) as RuntimeSessionCreated;
      const readEvents = async () => {
        const response = await fetch(`${relay.httpUrl}/v2/runtime-sessions/${sessionId}/events`, {
          headers: { authorization: `Bearer ${forged.sessionToken}` },
        });
        return (await response.json()) as {
          events: Array<{ event: { kind: string; payload: { ok?: boolean; controlId?: string } } }>;
        };
      };
      await vi.waitFor(async () =>
        expect((await readEvents()).events.some((e) => e.event.payload.ok === false)).toBe(true)
      );
      for (const listener of notifications)
        listener({
          method: 'item/agentMessage/delta',
          params: {
            threadId: 'employee-thread',
            turnId: 'employee-turn',
            delta: 'employee-private-fixture',
          },
        });
      for (const control of [
        { type: 'filesystem.read', payload: { path: 'private.txt' } },
        { type: 'filesystem.write', payload: { path: 'private.txt', content: 'changed' } },
        {
          type: 'turn.steer',
          payload: {
            threadId: 'employee-thread',
            expectedTurnId: 'employee-turn',
            appServerGeneration: 1,
            message: 'Use browser or connector tools',
          },
        },
        { type: 'approval.resolve', payload: { approvalRequestId: 42, decision: 'accept' } },
      ]) {
        const controlId = randomUUID();
        const signedControl = { ...control, controlId };
        const ownerAuthorization = managerOwner.sign({
          operation: 'runtime.control',
          sessionId,
          scope,
          control: signedControl,
        });
        const sent = await fetch(`${relay.httpUrl}/v2/runtime-sessions/${sessionId}/controls`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${forged.sessionToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ ...signedControl, ownerAuthorization }),
        });
        expect(sent.status).toBe(202);
        await vi.waitFor(async () =>
          expect(
            (await readEvents()).events.some(
              (e) => e.event.payload.controlId === controlId && e.event.payload.ok === false
            )
          ).toBe(true)
        );
      }
      const deniedEvents = (await readEvents()).events;
      expect(
        deniedEvents.every((e) => e.event.kind === 'control.result' && e.event.payload.ok === false)
      ).toBe(true);
      expect(JSON.stringify(deniedEvents)).not.toContain('employee-private-fixture');
      expect(await readFile(join(workspace, 'private.txt'), 'utf8')).toBe(
        'employee-private-fixture'
      );
      expect(calls.filter((method) => method === 'turn/start')).toHaveLength(1);
      expect(calls).not.toContain('turn/steer');
    } finally {
      vi.restoreAllMocks();
      ingress.closeAllConnections();
      await new Promise<void>((resolve) => ingress.close(() => resolve()));
      await worker.stop();
      managerOwner.close();
      await relay.close();
    }
  });
});
