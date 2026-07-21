import { readFileSync } from "node:fs";
import { join } from "node:path";
import { companyDir } from "../config.ts";
import { describeMsc, type MatterSafetyContract } from "../orchestrator/msc.ts";
import type { Task } from "../orchestrator/task-store.ts";
import { type AgentSpec, DELEGATABLE_AGENTS } from "./agents.ts";

function readCompanyFile(...parts: string[]): string {
	return readFileSync(join(companyDir(), ...parts), "utf-8");
}

/**
 * Runtime preamble generated per agent. This replaces the source package's
 * Paperclip issue mechanics with the pi task/tool protocol.
 */
function runtimePreamble(spec: AgentSpec): string {
	const lines = [
		`You are **${spec.slug}**, an agent of the California Litigation Legal Team, running as a pi agent session.`,
		"",
		"## Runtime protocol",
		"",
	];
	if (spec.role === "supervisor") {
		lines.push(
			"You are the supervisor and the only lawyer-facing agent. The supervising attorney talks to you on the CLI.",
			"Coordination tools:",
			"- `create_matter` — open a matter record with a Matter Safety Contract before any specialist work.",
			`- \`delegate\` — run one specialist task to completion and receive its report. Available specialists: ${DELEGATABLE_AGENTS.join(", ")}.`,
			"- `check_status` / `read_report` — inspect the task store for this matter.",
			"- `ask_lawyer` — ask the supervising attorney a short plain-English intake question (not for hard gates; those are enforced inside the side-effectful tools).",
			"- `gmail_search` / `gmail_read_message` — read-only mailbox access within approved scope.",
			"- `gmail_send` — HARD GATE: composing is fine, but the send itself always requires visible human approval, which the tool obtains itself.",
			"",
			"Deferred roles: docket-agent and practice-learning-agent are not deployed. Do not delegate to them; note docket checks as manual follow-ups for the lawyer.",
		);
	} else if (spec.role === "monitor") {
		lines.push(
			"You run scheduled read-only monitor sweeps. Each run's scope (time window, caps) is in the user prompt; the window cursor is maintained by the runtime, not by you.",
			"You have no write access to mail, calendars, or matter files, and no delegation tools. Produce exactly one monitoring report per run by calling `write_monitor_report`; route candidates to Legal Ops in the report rather than acting on them.",
		);
	} else {
		lines.push(
			"You are running one delegated task handed to you by the Legal Ops Supervisor. The task packet (matter, Matter Safety Contract, instructions) is in the user prompt.",
			"Completion tools — you MUST end your work through one of these:",
			"- `report_result` — report your summary and artifact paths when the task is done.",
			"- `escalate` — stop and hand back when inputs are missing or the task would exceed your scope.",
			"- `request_approval` — record that a hard-gated action is needed; the gate itself stays with the supervisor and human.",
			"",
			"Never act outside the Matter Safety Contract in your task packet. Writes outside the output root are blocked by the runtime and are a contract violation.",
		);
	}
	return lines.join("\n");
}

/**
 * Assemble the per-agent append-system-prompt blocks: generated preamble,
 * then SOUL.md, AGENTS.md, and TOOLS.md from the ported company package.
 * pi's own system prompt (tool docs, skills, context files) stays intact.
 */
export function assembleAgentPrompt(spec: AgentSpec): string[] {
	const agentDir = ["agents", spec.slug] as const;
	return [
		runtimePreamble(spec),
		readCompanyFile(...agentDir, "SOUL.md"),
		readCompanyFile(...agentDir, "AGENTS.md"),
		readCompanyFile(...agentDir, "TOOLS.md"),
	];
}

/** Shared virtual context files given to every agent session. */
export function companyContextFiles(): Array<{ path: string; content: string }> {
	return [
		{ path: join(companyDir(), "COMPANY.md"), content: readCompanyFile("COMPANY.md") },
		{ path: join(companyDir(), "OPERATIONS.md"), content: readCompanyFile("OPERATIONS.md") },
		{ path: join(companyDir(), "PROJECT-INVENTORY.md"), content: readCompanyFile("PROJECT-INVENTORY.md") },
	];
}

/** The user prompt for a delegated specialist task. */
export function taskPacket(task: Task): string {
	return [
		`# Task packet ${task.id}`,
		"",
		`Matter: ${task.matter}`,
		`Title: ${task.title}`,
		"",
		describeMsc(task.msc),
		"",
		"## Instructions",
		"",
		task.instructions,
		"",
		`Write artifacts under ${task.msc.outputRoot} and finish with \`report_result\` (or \`escalate\`).`,
	].join("\n");
}

export function skillsRoot(): string {
	return join(companyDir(), "skills");
}

export { describeMsc };
export type { MatterSafetyContract };
