import {
  getTmuxSessionCommandExecutor,
  isTmuxRuntimeReadyForCurrentPlatform,
} from '@features/tmux-installer/main';
import { atomicWriteAsync } from '@main/utils/atomicWrite';
import { encodePath, getProjectsBasePath, getTeamsBasePath } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { isClaudeComposerSubmitted } from '../core/domain/claudePaneState';
import {
  buildInteractiveTmuxSessionName,
  buildViewerSessionName,
  isViewerSessionNameFor,
} from '../core/domain/sessionNaming';

import {
  clearRuntimeBinding,
  readRuntimeBinding,
  writeRuntimeBinding,
} from './runtimeBindingStore';

import type {
  ConsoleTargetDto,
  InteractiveRuntimeStatusDto,
  OpenConsoleResultDto,
} from '../contracts';
import type { InteractiveRuntimeBinding } from '../core/domain/runtimeBinding';

export type { InteractiveRuntimeBinding } from '../core/domain/runtimeBinding';

const logger = createLogger('Service:InteractiveTeamRuntime');

const LEAD_SESSION_DETECT_TIMEOUT_MS = 90_000;
const LEAD_SESSION_POLL_MS = 1_000;
const PROMPT_READY_TIMEOUT_MS = 60_000;
const PROMPT_READY_POLL_MS = 1_500;
const SESSION_TEAM_WATCH_POLL_MS = 2_000;
const SESSION_TEAM_WATCH_TIMEOUT_MS = 10 * 60_000;
const GRACEFUL_EXIT_WAIT_MS = 12_000;
const CODEX_LANE_EXIT_WAIT_MS = 5_000;

export interface InteractiveLaunchInput {
  teamName: string;
  runId: string;
  cwd: string;
  claudePath: string;
  /** Interactive CLI args (no --print/--input-format/--output-format). */
  args: string[];
  env: NodeJS.ProcessEnv;
  bootstrapPrompt: string;
  /** Expected teammate names (excludes the lead). */
  rosterMemberNames: string[];
  callbacks: {
    checkpoint: (label: string, detail?: string) => void;
    onLeadSessionDetected: (leadSessionId: string) => void;
    onMemberRegistered: (memberName: string, paneId: string) => void;
    onFailed: (reason: string) => void;
  };
}

function getSessionTeamName(leadSessionId: string): string {
  return `session-${leadSessionId.slice(0, 8)}`;
}

function getProjectsDir(cwd: string): string {
  return path.join(getProjectsBasePath(), encodePath(cwd));
}

async function listSessionFiles(projectsDir: string): Promise<Set<string>> {
  try {
    const entries = await fs.promises.readdir(projectsDir);
    return new Set(entries.filter((entry) => entry.endsWith('.jsonl')));
  } catch {
    return new Set();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class InteractiveTeamRuntimeService {
  #viewerSequence = 0;
  readonly #watchAborts = new Map<string, AbortController>();

  async isEligible(): Promise<boolean> {
    if (process.platform === 'win32') return false;
    if (process.env.AGENT_TEAMS_DISABLE_INTERACTIVE_RUNTIME === '1') return false;
    try {
      return await isTmuxRuntimeReadyForCurrentPlatform();
    } catch {
      return false;
    }
  }

  async readBinding(teamName: string): Promise<InteractiveRuntimeBinding | null> {
    return readRuntimeBinding(teamName);
  }

  async #writeBinding(binding: InteractiveRuntimeBinding): Promise<void> {
    await writeRuntimeBinding(binding);
  }

  async clearBinding(teamName: string): Promise<void> {
    await clearRuntimeBinding(teamName);
  }

  /**
   * Launch the interactive lead inside a fresh detached tmux session and drive
   * bootstrap: dialog handling, prompt paste, session-team watch, pane
   * break-out, and app-config mirroring. Resolves once the tmux session is up
   * and the bootstrap prompt has been submitted; member registration continues
   * asynchronously via callbacks.
   */
  async launchInteractiveLead(input: InteractiveLaunchInput): Promise<InteractiveRuntimeBinding> {
    const tmux = getTmuxSessionCommandExecutor();
    const tmuxSessionName = buildInteractiveTmuxSessionName(input.teamName, input.runId);
    const projectsDir = getProjectsDir(input.cwd);
    const preLaunchSessions = await listSessionFiles(projectsDir);

    input.callbacks.checkpoint('Writing interactive launcher script');
    const launcherDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agteams-launch-'));
    const launcherPath = path.join(launcherDir, 'launch.sh');
    const envExports = Object.entries(input.env)
      .filter(([key, value]) => typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
      .map(([key, value]) => `export ${key}=${JSON.stringify(value)}`)
      .join('\n');
    const argLine = input.args.map((arg) => JSON.stringify(arg)).join(' ');
    await fs.promises.writeFile(
      launcherPath,
      `#!/bin/sh\n${envExports}\nunset CLAUDE_TEAM_FORCE_PROCESS_TEAMMATES\nexec ${JSON.stringify(input.claudePath)} ${argLine}\n`,
      { mode: 0o700 }
    );

    try {
      input.callbacks.checkpoint('Creating tmux session', tmuxSessionName);
      await tmux.newDetachedSession({
        sessionName: tmuxSessionName,
        cwd: input.cwd,
        command: launcherPath,
      });
    } catch (error) {
      await fs.promises.rm(launcherDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    const binding: InteractiveRuntimeBinding = {
      version: 2,
      runtime: 'claude-interactive',
      teamName: input.teamName,
      runId: input.runId,
      tmuxSessionName,
      leadSessionId: null,
      sessionTeamName: null,
      leadPaneId: null,
      lanes: [],
      launchedAt: new Date().toISOString(),
    };
    await this.#writeBinding(binding);

    const panes = await tmux.listSessionPanes(tmuxSessionName);
    binding.leadPaneId = panes[0]?.paneId ?? null;
    await this.#writeBinding(binding);
    const leadPaneId = binding.leadPaneId;
    if (!leadPaneId) {
      throw new Error('Interactive lead pane did not appear');
    }

    input.callbacks.checkpoint('Waiting for interactive prompt');
    await this.#answerStartupDialogsUntilPromptReady(tmuxSessionName, leadPaneId);

    // Paste FIRST: interactive Claude creates the session transcript only
    // after the first input is submitted, so detection must follow the paste.
    input.callbacks.checkpoint('Pasting bootstrap prompt into lead pane');
    await tmux.pasteTextIntoPane(leadPaneId, input.bootstrapPrompt, {
      // The bootstrap is large enough that Enter can be coalesced into the
      // paste instead of submitting it. Submission is visible in the pane:
      // the composer stops showing the collapsed "[Pasted text …]" chip (and
      // pending input in general) once the message is actually sent.
      verifySubmitted: (paneTail) => isClaudeComposerSubmitted(paneTail),
    });

    // Launcher env material no longer needed once claude is running.
    await fs.promises.rm(launcherDir, { recursive: true, force: true }).catch(() => {});

    // Detect the lead session in the background so team creation returns fast;
    // the session-team watcher consumes the binding as fields fill in.
    void (async () => {
      const leadSessionId = await this.#detectLeadSession(projectsDir, preLaunchSessions);
      if (leadSessionId) {
        binding.leadSessionId = leadSessionId;
        binding.sessionTeamName = getSessionTeamName(leadSessionId);
        await this.#writeBinding(binding);
        input.callbacks.onLeadSessionDetected(leadSessionId);
      } else {
        logger.warn(`[${input.teamName}] interactive lead session id not detected within timeout`);
      }
    })();

    this.#watchSessionTeam(input, binding);
    return binding;
  }

  /**
   * Fallback discovery: find a freshly created session-derived team dir whose
   * config matches this launch (cwd + created after launch). Stock's config
   * carries leadSessionId, which backfills the binding when transcript-based
   * detection misses.
   */
  async #discoverSessionTeamByScan(
    cwd: string,
    launchedAtMs: number,
    excludedSessionTeams?: ReadonlySet<string>
  ): Promise<{ sessionTeamName: string; leadSessionId: string | null } | null> {
    try {
      const teamsBase = getTeamsBasePath();
      const entries = await fs.promises.readdir(teamsBase);
      for (const entry of entries) {
        if (!entry.startsWith('session-')) continue;
        if (excludedSessionTeams?.has(entry)) continue;
        const configPath = path.join(teamsBase, entry, 'config.json');
        try {
          const stat = await fs.promises.stat(configPath);
          if (stat.mtimeMs < launchedAtMs - 5_000) continue;
          const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8')) as {
            leadSessionId?: string;
            members?: { agentType?: string; cwd?: string }[];
          };
          const leadMember = (config.members ?? []).find(
            (member) => member.agentType === 'team-lead'
          );
          if (leadMember?.cwd && path.resolve(leadMember.cwd) !== path.resolve(cwd)) continue;
          return {
            sessionTeamName: entry,
            leadSessionId: typeof config.leadSessionId === 'string' ? config.leadSessionId : null,
          };
        } catch {
          continue;
        }
      }
    } catch {
      // teams base unreadable — fall through
    }
    return null;
  }

  async #answerStartupDialogsUntilPromptReady(
    tmuxSessionName: string,
    leadPaneId: string
  ): Promise<void> {
    const tmux = getTmuxSessionCommandExecutor();
    const deadline = Date.now() + PROMPT_READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const tail = await tmux.capturePaneTail(leadPaneId, 40);
      if (/Do you trust this folder|Yes, I trust this folder/i.test(tail)) {
        await tmux.execTmux(['send-keys', '-t', leadPaneId, 'Enter'], 3_000);
      } else if (/Bypass Permissions mode|Yes, I accept/i.test(tail)) {
        await tmux.execTmux(['send-keys', '-t', leadPaneId, 'Down'], 3_000);
        await sleep(300);
        await tmux.execTmux(['send-keys', '-t', leadPaneId, 'Enter'], 3_000);
      } else if (/❯\s*$/m.test(tail) || tail.includes('shift+tab to cycle')) {
        return;
      } else if (!(await tmux.hasSession(tmuxSessionName))) {
        throw new Error('Interactive lead tmux session exited before becoming ready');
      }
      await sleep(PROMPT_READY_POLL_MS);
    }
    throw new Error('Interactive lead did not reach an input prompt in time');
  }

  async #detectLeadSession(
    projectsDir: string,
    preLaunchSessions: Set<string>
  ): Promise<string | null> {
    const deadline = Date.now() + LEAD_SESSION_DETECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const current = await listSessionFiles(projectsDir);
      for (const entry of current) {
        if (!preLaunchSessions.has(entry)) {
          return entry.replace(/\.jsonl$/, '');
        }
      }
      await sleep(LEAD_SESSION_POLL_MS);
    }
    return null;
  }

  #watchSessionTeam(input: InteractiveLaunchInput, binding: InteractiveRuntimeBinding): void {
    const abort = new AbortController();
    this.#watchAborts.get(input.teamName)?.abort();
    this.#watchAborts.set(input.teamName, abort);

    void (async () => {
      const tmux = getTmuxSessionCommandExecutor();
      const seenMembers = new Set<string>();
      const rejectedSessionTeams = new Set<string>();
      const deadline = Date.now() + SESSION_TEAM_WATCH_TIMEOUT_MS;
      const launchedAtMs = Date.parse(binding.launchedAt) || Date.now();
      while (!abort.signal.aborted && Date.now() < deadline) {
        try {
          let sessionTeamName =
            binding.sessionTeamName ??
            (binding.leadSessionId ? getSessionTeamName(binding.leadSessionId) : null);
          if (!sessionTeamName) {
            const discovered = await this.#discoverSessionTeamByScan(
              input.cwd,
              launchedAtMs,
              rejectedSessionTeams
            );
            if (discovered) {
              sessionTeamName = discovered.sessionTeamName;
              binding.sessionTeamName = discovered.sessionTeamName;
              if (!binding.leadSessionId && discovered.leadSessionId) {
                binding.leadSessionId = discovered.leadSessionId;
                input.callbacks.onLeadSessionDetected(discovered.leadSessionId);
              }
              await this.#writeBinding(binding);
            }
          }
          if (sessionTeamName) {
            const configPath = path.join(getTeamsBasePath(), sessionTeamName, 'config.json');
            const raw = await fs.promises.readFile(configPath, 'utf-8').catch(() => null);
            if (raw) {
              const config = JSON.parse(raw) as {
                members?: { name?: string; tmuxPaneId?: string; agentType?: string }[];
              };
              // Ground truth: stock spawns teammate panes inside OUR tmux
              // session. A candidate whose pane ids don't exist there is a
              // stale session-team dir from a previous (hard-killed) run —
              // hard-kills skip Claude's cleanup and the backup service can
              // refresh the dir's mtime, defeating freshness checks.
              const ourPaneIds = new Set(
                (await tmux.listSessionPanes(binding.tmuxSessionName)).map((pane) => pane.paneId)
              );
              const teammateEntries = (config.members ?? []).filter(
                (member) =>
                  member.agentType !== 'team-lead' && member.tmuxPaneId?.trim().startsWith('%')
              );
              const staleCandidate =
                teammateEntries.length > 0 &&
                teammateEntries.every((member) => !ourPaneIds.has(member.tmuxPaneId!.trim()));
              if (staleCandidate) {
                logger.warn(
                  `[${input.teamName}] ignoring stale session team "${sessionTeamName}" (panes not in ${binding.tmuxSessionName})`
                );
                rejectedSessionTeams.add(sessionTeamName);
                binding.sessionTeamName = null;
                binding.leadSessionId = null;
                await this.#writeBinding(binding);
                await sleep(SESSION_TEAM_WATCH_POLL_MS);
                continue;
              }
              for (const member of config.members ?? []) {
                const name = member.name?.trim();
                const paneId = member.tmuxPaneId?.trim();
                if (!name || seenMembers.has(name) || member.agentType === 'team-lead') continue;
                if (!paneId?.startsWith('%')) continue;
                if (!ourPaneIds.has(paneId)) continue;
                seenMembers.add(name);
                await tmux
                  .breakPaneToWindow(paneId, name, binding.tmuxSessionName)
                  .catch((error: unknown) =>
                    logger.warn(
                      `[${input.teamName}] break-pane for "${name}" failed: ${String(error)}`
                    )
                  );
                await this.#mirrorMemberIntoAppConfig(input.teamName, name, paneId, input.cwd);
                input.callbacks.onMemberRegistered(name, paneId);
              }
              if (
                input.rosterMemberNames.length > 0 &&
                input.rosterMemberNames.every((name) => seenMembers.has(name))
              ) {
                return;
              }
            }
          }
          if (!(await tmux.hasSession(binding.tmuxSessionName))) {
            input.callbacks.onFailed('Interactive lead tmux session exited');
            return;
          }
        } catch (error) {
          logger.debug(`[${input.teamName}] session-team watch error: ${String(error)}`);
        }
        await sleep(SESSION_TEAM_WATCH_POLL_MS);
      }
    })();
  }

  async #mirrorMemberIntoAppConfig(
    teamName: string,
    memberName: string,
    paneId: string,
    cwd: string
  ): Promise<void> {
    const configPath = path.join(getTeamsBasePath(), teamName, 'config.json');
    try {
      const raw = await fs.promises.readFile(configPath, 'utf-8');
      const config = JSON.parse(raw) as {
        members?: Record<string, unknown>[];
      };
      if (!Array.isArray(config.members)) return;
      let matched = false;
      for (const member of config.members) {
        if ((member.name as string | undefined)?.trim() === memberName) {
          member.tmuxPaneId = paneId;
          member.backendType = 'tmux';
          member.isActive = true;
          matched = true;
        }
      }
      if (!matched) {
        // Launch flows can reset config members to the lead only; the audit
        // treats absence as "never registered", so append the entry.
        config.members.push({
          agentId: `${memberName}@${teamName}`,
          name: memberName,
          joinedAt: Date.now(),
          cwd,
          subscriptions: [],
          provider: 'anthropic',
          providerId: 'anthropic',
          tmuxPaneId: paneId,
          backendType: 'tmux',
          isActive: true,
        });
      }
      await atomicWriteAsync(configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      logger.debug(`[${teamName}] app-config mirror failed for "${memberName}": ${String(error)}`);
    }
  }

  async stopInteractiveTeam(teamName: string): Promise<boolean> {
    const binding = await this.readBinding(teamName);
    if (!binding) return false;
    this.#watchAborts.get(teamName)?.abort();
    this.#watchAborts.delete(teamName);

    const tmux = getTmuxSessionCommandExecutor();
    if (await tmux.hasSession(binding.tmuxSessionName)) {
      if (binding.runtime === 'codex-lanes') {
        // Graceful per-lane exit; codex quits on "/quit" + Enter.
        for (const lane of binding.lanes) {
          await tmux.sendKeysToPane(lane.paneId, '/quit').catch(() => {});
          await sleep(400);
          await tmux.execTmux(['send-keys', '-t', lane.paneId, 'Enter'], 3_000).catch(() => {});
        }
        const deadline = Date.now() + CODEX_LANE_EXIT_WAIT_MS;
        while (Date.now() < deadline && (await tmux.hasSession(binding.tmuxSessionName))) {
          await sleep(1_000);
        }
      } else if (binding.leadPaneId) {
        // Graceful: /exit, then Enter to confirm "Exit anyway" if teammates run.
        await tmux.sendKeysToPane(binding.leadPaneId, '/exit').catch(() => {});
        await sleep(1_500);
        await tmux.execTmux(['send-keys', '-t', binding.leadPaneId, 'Enter'], 3_000);
        const deadline = Date.now() + GRACEFUL_EXIT_WAIT_MS;
        while (Date.now() < deadline && (await tmux.hasSession(binding.tmuxSessionName))) {
          await sleep(1_000);
        }
      }
      if (await tmux.hasSession(binding.tmuxSessionName)) {
        await tmux.killSession(binding.tmuxSessionName).catch(() => {});
      }
    }
    for (const session of await tmux.listSessions()) {
      if (isViewerSessionNameFor(session, binding.tmuxSessionName)) {
        await tmux.killSession(session).catch(() => {});
      }
    }
    await this.clearBinding(teamName);
    return true;
  }

  async getStatus(teamName: string): Promise<InteractiveRuntimeStatusDto> {
    const binding = await this.readBinding(teamName);
    if (!binding) return { active: false };
    const tmux = getTmuxSessionCommandExecutor();
    const alive = await tmux.hasSession(binding.tmuxSessionName);
    return {
      active: alive,
      tmuxSessionName: binding.tmuxSessionName,
      leadSessionId: binding.leadSessionId ?? undefined,
      sessionTeamName: binding.sessionTeamName ?? undefined,
    };
  }

  async listConsoleTargets(teamName: string): Promise<ConsoleTargetDto[]> {
    const binding = await this.readBinding(teamName);
    if (!binding) return [];
    const tmux = getTmuxSessionCommandExecutor();
    const panes = await tmux.listSessionPanes(binding.tmuxSessionName);
    if (panes.length === 0) return [];
    if (binding.runtime === 'codex-lanes') {
      const livePaneIds = new Set(panes.map((pane) => pane.paneId));
      return binding.lanes
        .filter((lane) => livePaneIds.has(lane.paneId))
        .map((lane) => ({
          memberName: lane.memberName,
          isLead: lane.isLead,
          paneId: lane.paneId,
          windowIndex:
            panes.find((pane) => pane.paneId === lane.paneId)?.windowIndex ?? lane.windowIndex,
        }));
    }
    const targets: ConsoleTargetDto[] = [];
    for (const pane of panes) {
      if (pane.paneId === binding.leadPaneId) {
        targets.push({
          memberName: 'team-lead',
          isLead: true,
          paneId: pane.paneId,
          windowIndex: pane.windowIndex,
        });
      } else if (pane.windowName) {
        targets.push({
          memberName: pane.windowName,
          isLead: false,
          paneId: pane.paneId,
          windowIndex: pane.windowIndex,
        });
      }
    }
    return targets;
  }

  async openConsole(teamName: string, memberName: string): Promise<OpenConsoleResultDto> {
    const binding = await this.readBinding(teamName);
    if (!binding) {
      throw new Error(`Team "${teamName}" has no interactive runtime`);
    }
    const targets = await this.listConsoleTargets(teamName);
    const target =
      targets.find((candidate) => candidate.memberName === memberName) ??
      (memberName === 'team-lead' ? targets.find((candidate) => candidate.isLead) : undefined);
    if (!target) {
      throw new Error(`No console target for "${memberName}" in team "${teamName}"`);
    }
    const tmux = getTmuxSessionCommandExecutor();
    this.#viewerSequence += 1;
    const viewerSessionName = buildViewerSessionName(binding.tmuxSessionName, this.#viewerSequence);
    await tmux.newViewerSession({
      groupSessionName: binding.tmuxSessionName,
      viewerSessionName,
      windowTarget: target.windowIndex,
    });
    const tmuxBinaryPath = await tmux.resolveTmuxBinaryPath();
    return {
      command: tmuxBinaryPath,
      args: ['attach-session', '-t', `=${viewerSessionName}`],
      viewerSessionName,
    };
  }

  async closeConsole(_teamName: string, viewerSessionName: string): Promise<void> {
    if (!viewerSessionName.startsWith('con-')) return;
    await getTmuxSessionCommandExecutor()
      .killSession(viewerSessionName)
      .catch(() => {});
  }
}

export const interactiveTeamRuntimeService = new InteractiveTeamRuntimeService();
