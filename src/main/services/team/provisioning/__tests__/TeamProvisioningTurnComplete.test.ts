import { describe, expect, it, vi } from 'vitest';

import {
  handleTeamProvisioningTurnComplete,
  type TeamProvisioningTurnCompletePorts,
  type TeamProvisioningTurnCompleteRun,
} from '../TeamProvisioningTurnComplete';

const ISO = '2026-08-09T00:00:00.000Z';

function createRun(): TeamProvisioningTurnCompleteRun {
  return {
    runId: 'run-1',
    teamName: 'turn-complete-config-order',
    provisioningComplete: false,
    cancelRequested: false,
    processKilled: false,
    progress: {
      runId: 'run-1',
      teamName: 'turn-complete-config-order',
      state: 'spawning',
      message: 'Starting',
      startedAt: ISO,
      updatedAt: ISO,
    },
    apiErrorWarningEmitted: false,
    timeoutHandle: null,
    isLaunch: true,
    request: {
      teamName: 'turn-complete-config-order',
      cwd: '/tmp/turn-complete-config-order',
      providerId: 'codex',
      members: [{ name: 'researcher' }],
    },
    detectedSessionId: null,
    allEffectiveMembers: [{ name: 'researcher' }],
    deterministicBootstrap: false,
    pendingGeminiPostLaunchHydration: false,
    geminiPostLaunchHydrationInFlight: false,
    child: null,
    onProgress: vi.fn(),
  };
}

function createPorts(
  order: string[],
  waitForPostLaunch: Promise<void>
): TeamProvisioningTurnCompletePorts<TeamProvisioningTurnCompleteRun, null> {
  return {
    hasPendingDeterministicFirstRealTurn: () => false,
    isProvisioningRunStillPromotable: () => true,
    getPreCompleteCliErrorText: () => '',
    hasApiError: () => false,
    isAuthFailureWarning: () => false,
    failProvisioningWithApiError: vi.fn(),
    handleAuthFailureInOutput: vi.fn(),
    scheduleDeterministicBootstrapCompletionRecovery: vi.fn(),
    resetRuntimeToolActivity: vi.fn(),
    getRunLeadName: () => 'lead',
    setLeadActivity: vi.fn(),
    stopFilesystemMonitor: vi.fn(),
    stopStallWatchdog: vi.fn(),
    updateConfigPostLaunch: async () => {
      order.push('post-launch-start');
      await waitForPostLaunch;
      order.push('post-launch-finish');
    },
    syncCodexLaneConfigMembers: async () => {
      order.push('lane-sync');
    },
    cleanupPrelaunchBackup: async () => {
      order.push('cleanup-backup');
    },
    refreshMemberSpawnStatusesFromLeadInbox: async () => undefined,
    maybeAuditMemberSpawnStatuses: async () => undefined,
    finalizeMissingRegisteredMembersAsFailed: async () => undefined,
    launchMixedSecondaryLaneIfNeeded: async () => null,
    reconcileFinalLaunchReportingSnapshot: async () => null,
    getFailedSpawnMembers: () => [],
    getMemberLaunchSummary: () => ({
      confirmedCount: 1,
      pendingCount: 0,
      failedCount: 0,
      runtimeAlivePendingCount: 0,
    }),
    hasPendingLaunchMembers: () => false,
    isProvisioningRunPromotedToAlive: () => false,
    buildAggregatePendingLaunchMessage: () => 'pending',
    updateProgress: (run, state, message, extras) => {
      run.progress = {
        ...run.progress,
        ...extras,
        state,
        message,
        updatedAt: ISO,
      };
      return run.progress;
    },
    extractCliLogsFromRun: () => undefined,
    provisioningRunByTeam: { delete: vi.fn(() => true) },
    setAliveRunId: vi.fn(),
    emitTeamChange: vi.fn(),
    fireTeamLaunchedNotification: async () => undefined,
    fireTeamLaunchIncompleteNotification: async () => undefined,
    sendMessageToRun: async () => undefined,
    relayLeadInboxMessages: async () => undefined,
    injectGeminiPostLaunchHydration: async () => undefined,
    waitForValidConfig: async () => ({ ok: true }),
    persistMembersMeta: async () => undefined,
    writeLaunchFailureArtifactPackBestEffort: vi.fn(),
    killTeamProcess: vi.fn(),
    cleanupRun: vi.fn(),
  };
}

describe('handleTeamProvisioningTurnComplete config ordering', () => {
  it('waits for post-launch materialization before syncing Codex lane members', async () => {
    const order: string[] = [];
    let releasePostLaunch = (): void => undefined;
    const postLaunchPending = new Promise<void>((resolve) => {
      releasePostLaunch = resolve;
    });
    const run = createRun();
    const completion = handleTeamProvisioningTurnComplete(
      run,
      createPorts(order, postLaunchPending)
    );

    await vi.waitFor(() => expect(order).toEqual(['post-launch-start']));
    expect(order).not.toContain('lane-sync');

    releasePostLaunch();
    await completion;

    expect(order.slice(0, 4)).toEqual([
      'post-launch-start',
      'post-launch-finish',
      'lane-sync',
      'cleanup-backup',
    ]);
  });
});
