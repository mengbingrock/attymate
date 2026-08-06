import { getTmuxSessionCommandExecutor } from '@features/tmux-installer/main';
import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { getTeamsBasePath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { detectCodexPaneState } from '../core/domain/codexPaneState';
import { buildInteractiveTmuxSessionName } from '../core/domain/sessionNaming';

import { readRuntimeBinding, writeRuntimeBinding } from './runtimeBindingStore';

import type { InteractiveRuntimeBinding, RuntimeLaneBinding } from '../core/domain/runtimeBinding';

const logger = createLogger('Service:CodexTeamLanes');

const LANE_READY_TIMEOUT_MS = 90_000;
const LANE_READY_POLL_MS = 1_500;
/** Consecutive stable `ready` polls required before pasting. */
const LANE_READY_STABLE_POLLS = 2;

/**
 * How long member sync waits for config.json to be created by the lead's first
 * MCP registration. Normally seconds behind lane readiness; the generous cap
 * covers a lead that dawdles before its first tool call.
 */
const CONFIG_SYNC_WAIT_MS = 3 * 60_000;
const CONFIG_SYNC_POLL_MS = 2_000;

export interface CodexLaneSpec {
  memberName: string;
  isLead: boolean;
  /** Full argv after the codex binary (buildCodexLaneArgs output). */
  args: string[];
  /** First input pasted once the lane's composer is idle. */
  briefingPrompt: string;
}

export interface CodexLanesLaunchInput {
  teamName: string;
  runId: string;
  cwd: string;
  codexPath: string;
  env: NodeJS.ProcessEnv;
  /** Lead first; teammates in roster order. */
  lanes: CodexLaneSpec[];
  callbacks: {
    checkpoint: (label: string, detail?: string) => void;
    onLaneReady: (memberName: string, paneId: string) => void;
    onFailed: (reason: string) => void;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs every codex team member — lead included — as its own interactive stock
 * `codex` TUI inside one tmux session (one window per member). The app is the
 * team fabric: coordination happens through the agent-teams MCP tools each
 * lane is configured with, and inbound messages are pasted into lanes.
 */
export class CodexTeamLanesService {
  /**
   * Launch all lanes and drive them to a ready composer. Teammate lanes are
   * briefed first (concurrently); the lead's bootstrap is pasted last so the
   * roster is live before delegation starts.
   */
  async launchCodexLanes(input: CodexLanesLaunchInput): Promise<InteractiveRuntimeBinding> {
    const tmux = getTmuxSessionCommandExecutor();
    const tmuxSessionName = buildInteractiveTmuxSessionName(input.teamName, input.runId);
    const leadLane = input.lanes.find((lane) => lane.isLead);
    if (!leadLane) {
      throw new Error('Codex lane launch requires a lead lane');
    }

    input.callbacks.checkpoint('Writing codex lane launcher scripts');
    const launcherDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agteams-codex-'));
    const launcherByMember = new Map<string, string>();
    const envExports = Object.entries(input.env)
      .filter(([key, value]) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
      .join('\n');
    for (const lane of input.lanes) {
      const launcherPath = path.join(
        launcherDir,
        `${lane.memberName.replace(/[^a-zA-Z0-9_-]+/g, '-')}.sh`
      );
      const argLine = lane.args.map((arg) => JSON.stringify(arg)).join(' ');
      await fs.promises.writeFile(
        launcherPath,
        `#!/bin/sh\n${envExports}\nexec ${JSON.stringify(input.codexPath)} ${argLine}\n`,
        { mode: 0o700 }
      );
      launcherByMember.set(lane.memberName, launcherPath);
    }

    try {
      input.callbacks.checkpoint('Creating tmux session', tmuxSessionName);
      await tmux.newDetachedSession({
        sessionName: tmuxSessionName,
        cwd: input.cwd,
        command: launcherByMember.get(leadLane.memberName)!,
      });
      await tmux
        .execTmux(['rename-window', '-t', `=${tmuxSessionName}:0`, leadLane.memberName], 3_000)
        .catch(() => {});
      for (const lane of input.lanes) {
        if (lane.isLead) continue;
        input.callbacks.checkpoint('Starting codex lane', lane.memberName);
        await tmux.newWindowInSession({
          sessionName: tmuxSessionName,
          windowName: lane.memberName,
          cwd: input.cwd,
          command: launcherByMember.get(lane.memberName)!,
        });
      }
    } catch (error) {
      await fs.promises.rm(launcherDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    const panes = await tmux.listSessionPanes(tmuxSessionName);
    const lanes: RuntimeLaneBinding[] = [];
    for (const lane of input.lanes) {
      const pane = panes.find((candidate) => candidate.windowName === lane.memberName);
      if (!pane) {
        await fs.promises.rm(launcherDir, { recursive: true, force: true }).catch(() => {});
        throw new Error(`Codex lane pane for "${lane.memberName}" did not appear`);
      }
      lanes.push({
        memberName: lane.memberName,
        isLead: lane.isLead,
        paneId: pane.paneId,
        windowIndex: pane.windowIndex,
      });
    }

    const binding: InteractiveRuntimeBinding = {
      version: 2,
      runtime: 'codex-lanes',
      teamName: input.teamName,
      runId: input.runId,
      tmuxSessionName,
      leadSessionId: null,
      sessionTeamName: null,
      leadPaneId: lanes.find((lane) => lane.isLead)?.paneId ?? null,
      lanes,
      launchedAt: new Date().toISOString(),
    };
    await writeRuntimeBinding(binding);

    // Brief lanes in the background so team creation returns fast. Teammates
    // first (concurrently), lead last so the roster is live when it delegates.
    void (async () => {
      try {
        const teammateLanes = input.lanes.filter((lane) => !lane.isLead);
        await Promise.all(
          teammateLanes.map(async (lane) => {
            const paneId = lanes.find((entry) => entry.memberName === lane.memberName)!.paneId;
            await this.#driveLaneToReady(input, tmuxSessionName, lane, paneId);
          })
        );
        const leadPaneId = lanes.find((lane) => lane.isLead)!.paneId;
        await this.#driveLaneToReady(input, tmuxSessionName, leadLane, leadPaneId);
      } catch (error) {
        input.callbacks.onFailed(String(error instanceof Error ? error.message : error));
      } finally {
        await fs.promises.rm(launcherDir, { recursive: true, force: true }).catch(() => {});
      }
    })();

    return binding;
  }

  async #driveLaneToReady(
    input: CodexLanesLaunchInput,
    tmuxSessionName: string,
    lane: CodexLaneSpec,
    paneId: string
  ): Promise<void> {
    const tmux = getTmuxSessionCommandExecutor();
    const deadline = Date.now() + LANE_READY_TIMEOUT_MS;
    let stableReadyPolls = 0;
    let lastTail = '';
    while (Date.now() < deadline) {
      lastTail = await tmux.capturePaneTail(paneId, 40);
      const state = detectCodexPaneState(lastTail);
      if (state === 'trust-dialog') {
        // "1. Yes, continue" is the highlighted default (codex-cli 0.145.0).
        await tmux.execTmux(['send-keys', '-t', paneId, 'Enter'], 3_000);
        stableReadyPolls = 0;
      } else if (state === 'login-required') {
        throw new Error(
          `Codex lane "${lane.memberName}" requires login — connect the Codex account first`
        );
      } else if (state === 'ready') {
        stableReadyPolls += 1;
        if (stableReadyPolls >= LANE_READY_STABLE_POLLS) {
          input.callbacks.checkpoint('Briefing codex lane', lane.memberName);
          await tmux.pasteTextIntoPane(paneId, lane.briefingPrompt);
          input.callbacks.onLaneReady(lane.memberName, paneId);
          return;
        }
      } else {
        stableReadyPolls = 0;
        if (!(await tmux.hasSession(tmuxSessionName))) {
          throw new Error(`Codex lane tmux session exited before "${lane.memberName}" was ready`);
        }
      }
      await sleep(LANE_READY_POLL_MS);
    }
    throw new Error(
      `Codex lane "${lane.memberName}" did not reach an input prompt in time. Last output:\n${lastTail.slice(-500)}`
    );
  }

  /**
   * Deliver text into a member's lane (the codex "mailbox"): pasted input is
   * queued by the TUI even mid-turn. Returns false when the team has no live
   * codex lane for the member.
   */
  async pasteIntoLane(teamName: string, memberName: string, text: string): Promise<boolean> {
    const binding = await readRuntimeBinding(teamName);
    if (!binding || binding.runtime !== 'codex-lanes') return false;
    const lane =
      binding.lanes.find((entry) => entry.memberName === memberName) ??
      (memberName === 'team-lead' ? binding.lanes.find((entry) => entry.isLead) : undefined);
    if (!lane) return false;
    const tmux = getTmuxSessionCommandExecutor();
    if (!(await tmux.hasSession(binding.tmuxSessionName))) return false;
    const tail = await tmux.capturePaneTail(lane.paneId, 20);
    if (detectCodexPaneState(tail) === 'login-required') return false;
    try {
      await tmux.pasteTextIntoPane(lane.paneId, text);
      return true;
    } catch (error) {
      logger.warn(`[${teamName}] lane paste for "${memberName}" failed: ${String(error)}`);
      return false;
    }
  }

  /**
   * Mark every lane member active in the app team config.
   *
   * config.json is born when the lead's first MCP call registers the team —
   * seconds AFTER every lane reports ready, which is when this sync fires. A
   * single unretried attempt lost that race: it hit ENOENT, logged at debug,
   * and the UI showed all ten healthy lanes as "stale runtime" for the life of
   * the run. Wait for the file (bounded) instead of failing silently.
   */
  async syncAppConfigMembers(teamName: string, cwd: string): Promise<void> {
    const binding = await readRuntimeBinding(teamName);
    if (!binding || binding.runtime !== 'codex-lanes') return;
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = await this.readFileWhenItExists(configPath, CONFIG_SYNC_WAIT_MS);
      if (raw === null) {
        logger.warn(
          `[${teamName}] codex lane config sync gave up: ${configPath} did not appear within ${CONFIG_SYNC_WAIT_MS}ms`
        );
        return;
      }
      const config = JSON.parse(raw) as { members?: Record<string, unknown>[] };
      if (!Array.isArray(config.members)) return;
      for (const lane of binding.lanes) {
        const existing = config.members.find(
          (member) => (member.name as string | undefined)?.trim() === lane.memberName
        );
        if (existing) {
          existing.tmuxPaneId = lane.paneId;
          existing.backendType = 'tmux';
          existing.isActive = true;
          existing.provider = 'codex';
          existing.providerId = 'codex';
        } else {
          config.members.push({
            agentId: `${lane.memberName}@${teamName}`,
            name: lane.memberName,
            joinedAt: Date.now(),
            cwd,
            subscriptions: [],
            provider: 'codex',
            providerId: 'codex',
            tmuxPaneId: lane.paneId,
            backendType: 'tmux',
            isActive: true,
            ...(lane.isLead ? { agentType: 'team-lead' } : {}),
          });
        }
      }
      await atomicWriteAsync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      // A failure here leaves every healthy lane looking dead in the UI —
      // that is worth a visible log line, not a debug whisper.
      logger.warn(`[${teamName}] codex lane config sync failed: ${String(error)}`);
    }
  }

  /** Resolves the file's content, or null when it never appears in time. */
  private async readFileWhenItExists(filePath: string, timeoutMs: number): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        return await fs.promises.readFile(filePath, 'utf-8');
      } catch {
        if (Date.now() >= deadline) return null;
        await new Promise((resolve) => setTimeout(resolve, CONFIG_SYNC_POLL_MS));
      }
    }
  }
}

export const codexTeamLanesService = new CodexTeamLanesService();
