import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface AgentModelConfig {
	provider: string;
	model: string;
	thinkingLevel: string;
	timeoutSec?: number;
}

export interface MonitorConfig {
	enabled: boolean;
	cron: string;
	maxResults?: number;
	lookaheadDays?: number;
}

export interface LegalTeamConfig {
	workspaceRoot: string;
	timezone: string;
	approvalMode: "interactive" | "auto-deny";
	taskTimeoutSec: number;
	agents: Record<string, Partial<AgentModelConfig>>;
	monitors: { gmail: MonitorConfig; calendar: MonitorConfig };
	google: { secretsDir: string };
	piAgentDir: string;
}

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function companyDir(): string {
	// dist/config.js and src/config.ts both sit one level below the package root.
	return join(pkgRoot, "company");
}

function defaults(): LegalTeamConfig {
	const workspaceRoot = join(homedir(), "attymate-workspace");
	return {
		workspaceRoot,
		timezone: "America/Los_Angeles",
		approvalMode: "interactive",
		taskTimeoutSec: 1200,
		agents: {},
		monitors: {
			gmail: { enabled: false, cron: "0 8-18 * * 1-5", maxResults: 25 },
			calendar: { enabled: false, cron: "0 8 * * 1-5", lookaheadDays: 30 },
		},
		google: { secretsDir: join(workspaceRoot, "secrets", "google") },
		piAgentDir: join(homedir(), ".pi", "agent"),
	};
}

/**
 * Load configuration: package defaults <- legal-team.config.json <- LEGAL_TEAM_* env.
 * The config file is looked up in the current working directory first, then in
 * the package root, so deployments can keep their own copy outside the repo.
 */
export function loadConfig(): LegalTeamConfig {
	const config = defaults();
	let secretsDirSet = false;
	const candidates = [
		process.env.LEGAL_TEAM_CONFIG,
		join(process.cwd(), "legal-team.config.json"),
		join(pkgRoot, "legal-team.config.json"),
	].filter((p): p is string => Boolean(p));
	for (const candidate of candidates) {
		if (!existsSync(candidate)) continue;
		const fileConfig = JSON.parse(readFileSync(candidate, "utf-8")) as Partial<LegalTeamConfig>;
		Object.assign(config, fileConfig, {
			monitors: { ...config.monitors, ...fileConfig.monitors },
			google: { ...config.google, ...fileConfig.google },
			agents: { ...config.agents, ...fileConfig.agents },
		});
		if (fileConfig.google?.secretsDir) secretsDirSet = true;
		break;
	}
	if (process.env.LEGAL_TEAM_WORKSPACE) config.workspaceRoot = process.env.LEGAL_TEAM_WORKSPACE;
	if (process.env.LEGAL_TEAM_TIMEZONE) config.timezone = process.env.LEGAL_TEAM_TIMEZONE;
	if (process.env.LEGAL_TEAM_APPROVAL_MODE === "auto-deny") config.approvalMode = "auto-deny";
	if (process.env.LEGAL_TEAM_GOOGLE_SECRETS) {
		config.google.secretsDir = process.env.LEGAL_TEAM_GOOGLE_SECRETS;
		secretsDirSet = true;
	}
	if (process.env.LEGAL_TEAM_PI_AGENT_DIR) config.piAgentDir = process.env.LEGAL_TEAM_PI_AGENT_DIR;
	config.workspaceRoot = config.workspaceRoot.replace(/^~(?=$|\/)/, homedir());
	// Keep the secrets dir tracking the (possibly overridden) workspace root
	// unless it was configured explicitly.
	if (!secretsDirSet) config.google.secretsDir = join(config.workspaceRoot, "secrets", "google");
	return config;
}

export function runsDir(config: LegalTeamConfig): string {
	return join(config.workspaceRoot, "runs");
}

export function monitorsDir(config: LegalTeamConfig): string {
	return join(config.workspaceRoot, "monitors");
}
