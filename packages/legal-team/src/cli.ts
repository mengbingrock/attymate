#!/usr/bin/env node
import { loadConfig } from "./config.ts";
import { collectUnroutedReports, type MonitorKind, runMonitor } from "./monitors/monitor-run.ts";
import { startMonitorSchedules } from "./monitors/scheduler.ts";
import { Orchestrator } from "./orchestrator/orchestrator.ts";
import { AGENT_REGISTRY, getAgentSpec } from "./registry/agents.ts";
import { assembleAgentPrompt } from "./registry/prompt-assembly.ts";
import { askHuman, closeHumanIO, logLine } from "./runtime/events.ts";
import { checkModelAuth } from "./runtime/models.ts";
import { grantedScopes, runGoogleConsentFlow } from "./tools/google-auth.ts";

const USAGE = `legal-team — California litigation legal team on the pi coding agent

Usage:
  legal-team intake "<request>"        start supervisor intake for a new request
  legal-team run <matter> ["<instr>"]  continue an existing matter with the supervisor
  legal-team monitor gmail|calendar    one-shot read-only monitor run
  legal-team monitors start            start the in-process monitor schedules
  legal-team status [<matter>]         show matters and task statuses
  legal-team auth google               grant Gmail + Calendar access (loopback consent)
  legal-team auth check                report OpenAI + Google auth status
  legal-team print-prompt <agent>      print an agent's assembled prompt blocks (debug)
`;

async function supervisorLoop(orchestrator: Orchestrator, firstPrompt: string, matter?: string): Promise<void> {
	const session = await orchestrator.buildSupervisorSession(matter);
	const unrouted = collectUnroutedReports(orchestrator.config);
	let prompt = firstPrompt;
	if (unrouted.text) {
		prompt = `${unrouted.text}\n\n---\n\n${firstPrompt}`;
		unrouted.markSeen();
	}
	try {
		while (true) {
			await session.prompt(prompt);
			const next = (await askHuman("\n\x1b[36mlawyer>\x1b[0m ")).trim();
			if (!next || next === "exit" || next === "quit") break;
			prompt = next;
		}
	} finally {
		session.dispose();
	}
}

async function main(): Promise<number> {
	const [command, ...args] = process.argv.slice(2);
	const config = loadConfig();
	switch (command) {
		case "intake": {
			const request = args.join(" ").trim();
			if (!request) {
				logLine('usage: legal-team intake "<request>"');
				return 1;
			}
			await supervisorLoop(new Orchestrator(config), request);
			return 0;
		}
		case "run": {
			const [matter, ...rest] = args;
			if (!matter) {
				logLine('usage: legal-team run <matter> ["<instruction>"]');
				return 1;
			}
			const orchestrator = new Orchestrator(config);
			if (!orchestrator.store.getMatter(matter)) {
				logLine(`Unknown matter: ${matter}. Known: ${orchestrator.store.listMatters().join(", ") || "(none)"}`);
				return 1;
			}
			const instruction =
				rest.join(" ").trim() || "Give me the current Matter Dashboard and the next recommended step.";
			await supervisorLoop(orchestrator, instruction, matter);
			return 0;
		}
		case "monitor": {
			const kind = args[0] as MonitorKind;
			if (kind !== "gmail" && kind !== "calendar") {
				logLine("usage: legal-team monitor gmail|calendar");
				return 1;
			}
			const report = await runMonitor(kind, config);
			return report ? 0 : 1;
		}
		case "monitors": {
			if (args[0] !== "start") {
				logLine("usage: legal-team monitors start");
				return 1;
			}
			const started = startMonitorSchedules(config);
			if (started === 0) {
				logLine("No monitors enabled; nothing to do.");
				return 1;
			}
			logLine("Monitor schedules running; press Ctrl-C to stop.");
			await new Promise(() => {});
			return 0;
		}
		case "status": {
			const orchestrator = new Orchestrator(config);
			const matters = args[0] ? [args[0]] : orchestrator.store.listMatters();
			if (matters.length === 0) {
				logLine("No matters yet.");
				return 0;
			}
			for (const matter of matters) {
				const record = orchestrator.store.getMatter(matter);
				if (!record) {
					logLine(`${matter}: not found`);
					continue;
				}
				logLine(`\n${matter} — ${record.label} (created ${record.createdAt})`);
				const tasks = orchestrator.store.listTasks(matter);
				if (tasks.length === 0) logLine("  (no tasks)");
				for (const t of tasks) logLine(`  ${t.id} [${t.status}] ${t.agent} — ${t.title}`);
			}
			return 0;
		}
		case "auth": {
			if (args[0] === "google") {
				logLine(await runGoogleConsentFlow(config));
				return 0;
			}
			if (args[0] === "check") {
				logLine("Model auth:");
				logLine(await checkModelAuth(config));
				const scopes = grantedScopes(config);
				logLine("\nGoogle scopes:");
				logLine(
					scopes.length > 0 ? scopes.map((s) => `  ${s}`).join("\n") : "  (none — run `legal-team auth google`)",
				);
				return 0;
			}
			logLine("usage: legal-team auth google|check");
			return 1;
		}
		case "print-prompt": {
			const slug = args[0];
			if (!slug || !(slug in AGENT_REGISTRY)) {
				logLine(`usage: legal-team print-prompt <${Object.keys(AGENT_REGISTRY).join("|")}>`);
				return 1;
			}
			for (const block of assembleAgentPrompt(getAgentSpec(slug))) {
				logLine(`\n${"═".repeat(72)}\n${block}`);
			}
			return 0;
		}
		default:
			logLine(USAGE);
			return command ? 1 : 0;
	}
}

main()
	.then((code) => {
		closeHumanIO();
		process.exitCode = code;
	})
	.catch((error) => {
		closeHumanIO();
		console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
		process.exitCode = 1;
	});
