// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PRESENCE_HEADER, SESSION_EXPIRES_MS } from '@claude-teams/agent-teams-protocol';
import { startAgentTeamsRelay } from '@claude-teams/agent-teams-relay';
import { expect, it, vi } from 'vitest';
import WebSocket from 'ws';

import { RelayAccountStore } from '../../../../packages/agent-teams-relay/src/accountPortal/accountStore';
import { startLocalWorkerRelay } from '../../../../packages/agent-teams-worker/src/localWorkerRelay';

it('requires negotiated fresh team sessions through the local relay and fences old connections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'team-presence-'));
  const accounts = new RelayAccountStore(root);
  const login = accounts.signIn({
    sub: 'presence-test',
    email: 'presence@example.test',
    name: 'Presence fixture',
  });
  const origin = 'https://presence.example.test';
  const headers = {
    cookie: `agent_teams_session=${login.token}`,
    origin,
    'x-csrf-token': login.csrf,
  };
  const relay = await startAgentTeamsRelay({
    host: '127.0.0.1',
    port: 0,
    dataDir: root,
    heartbeatIntervalMs: 100,
    staleAfterMs: 500,
    auth: { workerToken: 'w'.repeat(40), managerToken: 'm'.repeat(40) },
    joinPortal: { publicUrl: origin, accounts: {} },
  });
  const clients: WebSocket[] = [];
  let local: Awaited<ReturnType<typeof startLocalWorkerRelay>> | undefined;
  try {
    const created = await relay.app.inject({
      method: 'POST',
      url: '/join/api/account/teams',
      headers,
      payload: { name: 'Disposable presence team' },
    });
    expect(created.statusCode).toBe(201);
    const teamId = created.json().team.teamId;
    const { device, token } = accounts.createDevice(teamId, login.user.id, 'fixture');
    const nodeId = randomUUID();
    local = await startLocalWorkerRelay({ upstreamUrl: relay.wsUrl, token });
    const connect = async (presence: boolean) => {
      const socket = new WebSocket(local!.url, {
        headers: {
          authorization: `Bearer ${token}`,
          ...(presence ? { [PRESENCE_HEADER]: '1' } : {}),
        },
      });
      clients.push(socket);
      const welcome = new Promise<Record<string, unknown>>((resolve) =>
        socket.on('message', (data) => {
          const message = JSON.parse(data.toString());
          if (message.type === 'relay.welcome') resolve(message);
        })
      );
      await once(socket, 'open');
      socket.send(
        JSON.stringify({
          type: 'worker.hello',
          protocolVersion: 2,
          organizationId: randomUUID(),
          personId: randomUUID(),
          nodeId,
          workerInstanceId: randomUUID(),
          workerGeneration: clients.length,
          label: 'Presence fixture',
          autoJoinTeamId: teamId,
          lastInboundCursor: 0,
          sentAt: new Date().toISOString(),
        })
      );
      const message = await welcome;
      expect(message.presenceVersion).toBe(presence ? 1 : undefined);
      return socket;
    };
    const view = async () =>
      (await relay.app.inject({ url: '/join/api/account/dashboard', headers }))
        .json()
        .devices.find((d: { id: string }) => d.id === device.id);
    let sequence = 0;
    const beat = async (socket: WebSocket, sessions?: unknown[]) => {
      const expected = ++sequence;
      const ack = new Promise<void>((resolve) => {
        const onMessage = (data: WebSocket.RawData) => {
          const m = JSON.parse(data.toString());
          if (m.type === 'relay.heartbeat_ack' && m.sequence === expected) {
            socket.off('message', onMessage);
            resolve();
          }
        };
        socket.on('message', onMessage);
      });
      socket.send(
        JSON.stringify({
          type: 'worker.heartbeat',
          protocolVersion: 2,
          sequence: expected,
          sentAt: new Date().toISOString(),
          ...(sessions === undefined ? {} : { sessions }),
        })
      );
      await ack;
    };
    const old = await connect(false);
    await beat(old);
    expect(await view()).toMatchObject({
      online: false,
      computerConnected: true,
      reason: 'session_status_unavailable',
    });
    const socket = await connect(true);
    await beat(socket, []);
    expect(await view()).toMatchObject({
      online: false,
      computerConnected: true,
      reason: 'session_disconnected',
    });
    const membership = relay
      .listMembershipRoutes()
      .find((r) => r.teamId === teamId && r.nodeId === nodeId)!;
    expect(membership).toBeDefined();
    const session = {
      connectionId: randomUUID(),
      teamId,
      membershipId: membership.membershipId,
      threadId: randomUUID(),
      ageMs: 0,
    };
    await beat(socket, [{ ...session, teamId: randomUUID() }]);
    expect((await view()).online).toBe(false);
    await beat(socket, [{ ...session, membershipId: randomUUID() }]);
    expect((await view()).online).toBe(false);
    await beat(socket, [session]);
    expect(await view()).toMatchObject({ online: true, computerConnected: true });
    // Repeating a dead bridge's observations cannot refresh their age.
    await beat(socket, [{ ...session, ageMs: SESSION_EXPIRES_MS }]);
    expect((await view()).online).toBe(false);
    await beat(socket, [session]);
    await vi.waitFor(
      async () => expect(await view()).toMatchObject({ online: false, computerConnected: false }),
      { timeout: 1500 }
    );
    await beat(socket, [session, { ...session, connectionId: randomUUID() }]);
    expect((await view()).online).toBe(true);
    const replacement = await connect(true);
    expect((await view()).online).toBe(false);
    await beat(replacement, []);
    expect((await view()).online).toBe(false);
    await beat(replacement, [session]);
    expect((await view()).online).toBe(true);
    const removed = await relay.app.inject({
      method: 'POST',
      url: `/join/api/account/devices/${device.id}/remove`,
      headers,
      payload: { expectedNodeId: nodeId },
    });
    expect(removed.statusCode).toBe(200);
    expect(await view()).toBeUndefined();
  } finally {
    clients.forEach((c) => c.terminate());
    await local?.close();
    await relay.close();
    accounts.close();
    await rm(root, { recursive: true, force: true });
  }
});
