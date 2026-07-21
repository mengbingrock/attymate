import cron from "node-cron";
import type { LegalTeamConfig } from "../config.ts";
import { logLine } from "../runtime/events.ts";
import { type MonitorKind, runMonitor } from "./monitor-run.ts";

/**
 * In-process scheduler for the monitor routines. Both routines default to
 * `enabled: false` (the source company shipped with routines paused); enable
 * them in legal-team.config.json, or drive one-shot runs from external cron
 * via `legal-team monitor gmail|calendar`.
 */
export function startMonitorSchedules(config: LegalTeamConfig): number {
	let started = 0;
	const kinds: MonitorKind[] = ["gmail", "calendar"];
	for (const kind of kinds) {
		const monitorConfig = config.monitors[kind];
		if (!monitorConfig.enabled) {
			logLine(`monitor ${kind}: disabled (enable in legal-team.config.json)`);
			continue;
		}
		cron.schedule(
			monitorConfig.cron,
			() => {
				runMonitor(kind, config).catch((error) => {
					logLine(`monitor ${kind}: run failed: ${error instanceof Error ? error.message : String(error)}`);
				});
			},
			{ timezone: config.timezone },
		);
		logLine(`monitor ${kind}: scheduled (${monitorConfig.cron} ${config.timezone})`);
		started += 1;
	}
	return started;
}
