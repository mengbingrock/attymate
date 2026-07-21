import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type LegalTeamConfig, runsDir } from "../config.ts";
import { getAgentSpec } from "../registry/agents.ts";
import { taskPacket } from "../registry/prompt-assembly.ts";
import { logLine } from "../runtime/events.ts";
import { createGuardedFileTools, createReadOnlyFileTools } from "../tools/fs-guard.ts";
import { createCalendarTools } from "../tools/gcal.ts";
import { createGmailReadTools, createGmailSendTool, type GateContext } from "../tools/gmail.ts";
import { createSpecialistTools, type TaskRunState } from "../tools/specialist-tools.ts";
import { createSupervisorTools } from "../tools/supervisor-tools.ts";
import { ApprovalBroker } from "./approval.ts";
import { defaultMsc } from "./msc.ts";
import { buildAgentSession, promptWithTimeout } from "./session-factory.ts";
import { FileTaskStore, type Task } from "./task-store.ts";

/**
 * Single-process orchestrator: one long-lived supervisor session per matter,
 * ephemeral specialist sessions per delegated task (run synchronously inside
 * the supervisor's `delegate` tool call), shared task store and approval
 * broker.
 */
export class Orchestrator {
	readonly config: LegalTeamConfig;
	readonly store: FileTaskStore;
	readonly broker: ApprovalBroker;
	private currentMatter: string | undefined;

	constructor(config: LegalTeamConfig) {
		this.config = config;
		mkdirSync(runsDir(config), { recursive: true });
		this.store = new FileTaskStore(runsDir(config));
		this.broker = new ApprovalBroker(this.store, config.approvalMode);
	}

	private streamToStdout(session: AgentSession, dim = false): void {
		session.subscribe((event) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				const delta = event.assistantMessageEvent.delta;
				process.stdout.write(dim ? `\x1b[2m${delta}\x1b[0m` : delta);
			}
			if (event.type === "agent_end") process.stdout.write("\n");
		});
	}

	/** Run one delegated specialist task to completion and return it. */
	async runSpecialistTask(task: Task): Promise<Task> {
		const spec = getAgentSpec(task.agent);
		const state: TaskRunState = { task, finished: false };
		const save = (t: Task) => this.store.saveTask(t);
		const artifactsDir = this.store.artifactsDir(task.matter, task.id);
		const gateContext = (): GateContext => ({
			matter: task.matter,
			taskId: task.id,
			agent: task.agent,
			msc: task.msc,
		});

		const tools: ToolDefinition<any, any>[] = [
			...createGuardedFileTools(task.msc.matterRoot, task.msc),
			...createSpecialistTools(state, save),
		];
		if (task.agent === "calendar-agent") {
			tools.push(
				...createCalendarTools(
					this.config,
					this.broker,
					gateContext,
					() => artifactsDir,
					this.config.monitors.calendar.lookaheadDays,
				),
			);
		}

		// bash only at supervised-tools and above, and only for agents that need it.
		const effectiveSpec = {
			...spec,
			allowBash: spec.allowBash && task.msc.autonomyLevel !== "safe-draft-only",
		};

		task.status = "running";
		save(task);
		logLine(`\n\x1b[33m→ delegating ${task.id} to ${task.agent}: ${task.title}\x1b[0m`);
		const { session, timeoutSec } = await buildAgentSession({
			spec: effectiveSpec,
			config: this.config,
			cwd: ensureDir(task.msc.matterRoot),
			customTools: tools,
			sessionDir: this.store.sessionsDir(task.matter),
		});
		task.sessionFile = session.sessionFile;
		save(task);
		this.streamToStdout(session, true);
		try {
			const completedInTime = await promptWithTimeout(session, taskPacket(task), timeoutSec);
			if (!state.finished) {
				task.status = "failed";
				task.failure = completedInTime
					? "specialist finished without calling report_result or escalate"
					: `timed out after ${timeoutSec}s`;
				save(task);
			}
		} catch (error) {
			if (!state.finished) {
				task.status = "failed";
				task.failure = error instanceof Error ? error.message : String(error);
				save(task);
			}
		} finally {
			session.dispose();
		}
		logLine(`\x1b[33m← ${task.id} ${task.status}\x1b[0m`);
		return this.store.getTask(task.matter, task.id) ?? task;
	}

	/** Build (or re-open) the supervisor session for interactive intake/run. */
	async buildSupervisorSession(matter?: string): Promise<AgentSession> {
		const spec = getAgentSpec("legal-ops-supervisor");
		if (matter) this.currentMatter = matter;

		const supervisorGate = (): GateContext => {
			const m = this.currentMatter;
			const record = m ? this.store.getMatter(m) : undefined;
			return {
				matter: m ?? "no-matter",
				taskId: "supervisor",
				agent: "legal-ops-supervisor",
				msc: record?.msc ?? defaultMsc(this.config.workspaceRoot, join(this.config.workspaceRoot, "output")),
			};
		};

		const tools: ToolDefinition<any, any>[] = [
			...createReadOnlyFileTools(this.config.workspaceRoot),
			...createSupervisorTools({
				config: this.config,
				store: this.store,
				runSpecialist: (task) => this.runSpecialistTask(task),
				getCurrentMatter: () => this.currentMatter,
				setCurrentMatter: (m) => {
					this.currentMatter = m;
				},
			}),
			...createGmailReadTools(this.config, this.config.monitors.gmail.maxResults),
			createGmailSendTool(this.config, this.broker, supervisorGate),
		];

		let sessionDir: string | undefined;
		let sessionFile: string | undefined;
		if (matter) {
			sessionDir = this.store.sessionsDir(matter);
			sessionFile = latestSessionFile(sessionDir);
		}
		const { session } = await buildAgentSession({
			spec,
			config: this.config,
			cwd: ensureDir(this.config.workspaceRoot),
			customTools: tools,
			sessionDir: sessionDir ?? join(this.config.workspaceRoot, "supervisor-sessions"),
			sessionFile,
		});
		this.streamToStdout(session);
		return session;
	}
}

function ensureDir(dir: string): string {
	mkdirSync(dir, { recursive: true });
	return dir;
}

function latestSessionFile(dir: string): string | undefined {
	if (!existsSync(dir)) return undefined;
	const files = readdirSync(dir)
		.filter((f) => f.endsWith(".jsonl"))
		.sort();
	return files.length > 0 ? join(dir, files[files.length - 1]) : undefined;
}
