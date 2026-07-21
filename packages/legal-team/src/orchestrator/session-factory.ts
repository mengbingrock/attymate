import {
	type AgentSession,
	createAgentSession,
	createBashToolDefinition,
	DefaultResourceLoader,
	SessionManager,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { LegalTeamConfig } from "../config.ts";
import type { AgentSpec } from "../registry/agents.ts";
import { assembleAgentPrompt, companyContextFiles, skillsRoot } from "../registry/prompt-assembly.ts";
import { getModelRuntime, resolveAgentModel } from "../runtime/models.ts";

export interface BuildSessionOptions {
	spec: AgentSpec;
	config: LegalTeamConfig;
	cwd: string;
	/** File tools + protocol tools + Google tools for this session. */
	customTools: ToolDefinition<any, any>[];
	/** Persistent session dir; omit for in-memory (monitors, one-shot checks). */
	sessionDir?: string;
	/** Re-open this session file instead of starting fresh. */
	sessionFile?: string;
}

export interface BuiltSession {
	session: AgentSession;
	timeoutSec: number;
}

/**
 * Create one pi agent session for a team agent:
 * - pi's default system prompt stays intact (tool docs, guidelines, skills);
 * - the agent persona (runtime preamble, SOUL, AGENTS, TOOLS) is appended;
 * - COMPANY/OPERATIONS/PROJECT-INVENTORY ride along as virtual context files;
 * - skills come only from the ported company package, filtered per agent;
 * - all functional tools are supplied via customTools (built-ins disabled), so
 *   MSC guards cannot be bypassed by a default tool.
 */
export async function buildAgentSession(options: BuildSessionOptions): Promise<BuiltSession> {
	const { spec, config, cwd } = options;
	const { model, thinkingLevel, timeoutSec } = await resolveAgentModel(spec, config);
	const modelRuntime = await getModelRuntime(config);

	const allowedSkills = new Set(spec.skills);
	const resourceLoader = new DefaultResourceLoader({
		cwd,
		agentDir: config.piAgentDir,
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		additionalSkillPaths: spec.skills.length > 0 ? [skillsRoot()] : [],
		skillsOverride: (base) => ({
			skills: base.skills.filter((skill) => allowedSkills.has(skill.name)),
			diagnostics: base.diagnostics,
		}),
		agentsFilesOverride: () => ({ agentsFiles: companyContextFiles() }),
		appendSystemPrompt: assembleAgentPrompt(spec),
	});
	await resourceLoader.reload();

	const tools = [...options.customTools];
	if (spec.allowBash) tools.push(createBashToolDefinition(cwd));

	const sessionManager = options.sessionFile
		? SessionManager.open(options.sessionFile, options.sessionDir, cwd)
		: options.sessionDir
			? SessionManager.create(cwd, options.sessionDir)
			: SessionManager.inMemory(cwd);

	const { session } = await createAgentSession({
		cwd,
		agentDir: config.piAgentDir,
		modelRuntime,
		model,
		thinkingLevel,
		noTools: "builtin",
		customTools: tools,
		resourceLoader,
		sessionManager,
	});
	return { session, timeoutSec };
}

/** Run one prompt with a wall-clock timeout that aborts the session. */
export async function promptWithTimeout(session: AgentSession, prompt: string, timeoutSec: number): Promise<boolean> {
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		void session.abort();
	}, timeoutSec * 1000);
	try {
		await session.prompt(prompt);
	} finally {
		clearTimeout(timer);
	}
	return !timedOut;
}
