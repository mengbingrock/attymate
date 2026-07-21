import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type LegalTeamConfig, monitorsDir, runsDir } from "../config.ts";
import { buildAgentSession, promptWithTimeout } from "../orchestrator/session-factory.ts";
import { getAgentSpec } from "../registry/agents.ts";
import { logLine } from "../runtime/events.ts";
import { createReadOnlyFileTools } from "../tools/fs-guard.ts";
import { createCalendarListTool } from "../tools/gcal.ts";
import { createGmailReadTools } from "../tools/gmail.ts";

export type MonitorKind = "gmail" | "calendar";

interface MonitorState {
	lastRunAt?: string;
	lastReportPath?: string;
}

const running: Partial<Record<MonitorKind, boolean>> = {};

function stateDir(config: LegalTeamConfig, kind: MonitorKind): string {
	const dir = join(monitorsDir(config), kind);
	mkdirSync(join(dir, "reports"), { recursive: true });
	return dir;
}

function readState(dir: string): MonitorState {
	try {
		return JSON.parse(readFileSync(join(dir, "state.json"), "utf-8")) as MonitorState;
	} catch {
		return {};
	}
}

function writeState(dir: string, state: MonitorState): void {
	const path = join(dir, "state.json");
	writeFileSync(`${path}.tmp`, `${JSON.stringify(state, null, "\t")}\n`);
	renameSync(`${path}.tmp`, path);
}

function monitorPrompt(kind: MonitorKind, config: LegalTeamConfig, state: MonitorState): string {
	const sinceLine = state.lastRunAt
		? `The previous monitor run covered everything up to ${state.lastRunAt}; only report items newer than that (the window cursor is maintained by the runtime, not by you).`
		: "This is the first monitor run; use a conservative recent window (last 2 days).";
	if (kind === "gmail") {
		const days = state.lastRunAt
			? Math.max(1, Math.ceil((Date.now() - Date.parse(state.lastRunAt)) / 86_400_000))
			: 2;
		return [
			"# Monitor run: email intake (read-only)",
			"",
			sinceLine,
			`Search the mailbox with gmail_search using \`newer_than:${days}d\` (cap ${config.monitors.gmail.maxResults} results), read what matters with gmail_read_message, and produce ONE monitoring report per references/monitoring-report-contract.md: run scope, findings table (candidates routed to Legal Ops), and a no-findings note if empty.`,
			"Do not act on any finding; you are read-only. Finish by calling write_monitor_report exactly once.",
		].join("\n");
	}
	return [
		"# Monitor run: calendar (read-only)",
		"",
		sinceLine,
		`List events on the primary calendar for the next ${config.monitors.calendar.lookaheadDays ?? 30} days with calendar_list_events and produce ONE monitoring report per references/monitoring-report-contract.md: upcoming deadlines/hearings, conflicts or gaps worth flagging, and a no-findings note if empty.`,
		"Do not create or modify any event; you are read-only. Finish by calling write_monitor_report exactly once.",
	].join("\n");
}

/**
 * One-shot monitor run: an in-memory read-only session that must end by
 * writing a single durable report under `monitors/<kind>/reports/`.
 * Concurrent invocations of the same kind coalesce (in-process mutex).
 */
export async function runMonitor(kind: MonitorKind, config: LegalTeamConfig): Promise<string | undefined> {
	if (running[kind]) {
		logLine(`monitor ${kind}: previous run still active; coalescing`);
		return undefined;
	}
	running[kind] = true;
	try {
		const dir = stateDir(config, kind);
		const state = readState(dir);
		const startedAt = new Date();
		const reportPath = join(dir, "reports", `${startedAt.toISOString().replace(/[:.]/g, "-")}.md`);
		let reportWritten = false;

		const writeReport = defineTool({
			name: "write_monitor_report",
			label: "Write Monitor Report",
			description:
				"Write this run's single monitoring report (markdown, per the monitoring report contract). Call exactly once.",
			parameters: Type.Object({
				report: Type.String({ description: "Full markdown report body" }),
			}),
			execute: async (_id, params) => {
				writeFileSync(reportPath, params.report.endsWith("\n") ? params.report : `${params.report}\n`);
				reportWritten = true;
				return {
					content: [{ type: "text" as const, text: `Report written to ${reportPath}. You are done.` }],
					details: {},
				};
			},
		});

		const spec =
			kind === "gmail"
				? getAgentSpec("email-monitor-agent")
				: {
						// Calendar sweeps run the calendar-agent in monitor posture on
						// the cheap monitor model (config.agents can still override).
						...getAgentSpec("calendar-agent"),
						role: "monitor" as const,
						model: "gpt-5.4-mini",
						thinkingLevel: "low",
						timeoutSec: 600,
					};
		const tools: ToolDefinition<any, any>[] = [
			...createReadOnlyFileTools(monitorsDir(config)),
			writeReport,
			...(kind === "gmail"
				? createGmailReadTools(config, config.monitors.gmail.maxResults)
				: [createCalendarListTool(config, config.monitors.calendar.lookaheadDays ?? 30)]),
		];
		const { session, timeoutSec } = await buildAgentSession({
			spec,
			config,
			cwd: stateDir(config, kind),
			customTools: tools,
		});
		try {
			await promptWithTimeout(session, monitorPrompt(kind, config, state), timeoutSec);
		} finally {
			session.dispose();
		}
		if (!reportWritten) {
			logLine(`monitor ${kind}: run produced no report`);
			return undefined;
		}
		writeState(dir, { lastRunAt: startedAt.toISOString(), lastReportPath: reportPath });
		logLine(`monitor ${kind}: report written to ${reportPath}`);
		return reportPath;
	} finally {
		running[kind] = false;
	}
}

/**
 * Reports produced since the supervisor last saw one. The cursor lives in
 * `runs/.monitor-cursor` and is advanced when the reports are surfaced.
 */
export function collectUnroutedReports(config: LegalTeamConfig): { text: string | undefined; markSeen: () => void } {
	const cursorPath = join(runsDir(config), ".monitor-cursor");
	let cursor = "";
	try {
		cursor = readFileSync(cursorPath, "utf-8").trim();
	} catch {}
	const sections: string[] = [];
	let newest = cursor;
	for (const kind of ["gmail", "calendar"] as MonitorKind[]) {
		const reports = join(monitorsDir(config), kind, "reports");
		if (!existsSync(reports)) continue;
		for (const file of readdirSync(reports).sort()) {
			if (!file.endsWith(".md") || file <= cursor) continue;
			sections.push(`## Monitor report (${kind}) ${file}\n\n${readFileSync(join(reports, file), "utf-8")}`);
			if (file > newest) newest = file;
		}
	}
	if (sections.length === 0) return { text: undefined, markSeen: () => {} };
	return {
		text: `# Unrouted monitor reports\n\nThese monitor reports arrived since your last session; triage them per OPERATIONS.md.\n\n${sections.join("\n\n")}`,
		markSeen: () => {
			mkdirSync(runsDir(config), { recursive: true });
			writeFileSync(cursorPath, `${newest}\n`);
		},
	};
}
