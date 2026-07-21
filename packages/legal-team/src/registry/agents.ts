export type AgentRole = "supervisor" | "specialist" | "monitor";

export interface AgentSpec {
	slug: string;
	role: AgentRole;
	provider: string;
	model: string;
	thinkingLevel: string;
	/** Skill names this agent may load (subset of company/skills). */
	skills: string[];
	/** Whether the session gets bash in addition to guarded file tools. */
	allowBash: boolean;
	timeoutSec: number;
}

const GPT_MAIN = { provider: "openai-codex", model: "gpt-5.5" };
const GPT_MONITOR = { provider: "openai-codex", model: "gpt-5.4-mini" };

/**
 * The phase-1 team: 8 of the source company's 10 agents. docket-agent and
 * practice-learning-agent are deferred (BrowserOS docket access and the
 * opt-in learning contract are not available in this deployment).
 */
export const AGENT_REGISTRY: Record<string, AgentSpec> = {
	"legal-ops-supervisor": {
		slug: "legal-ops-supervisor",
		role: "supervisor",
		...GPT_MAIN,
		thinkingLevel: "high",
		skills: [
			"ca-subpoena-mtc-autonomous-runner",
			"ca-subpoena-mtc-drafting-workflow",
			"legal-calendaring-workflow",
			"ca-litigation-drafting-workflow",
			"ca-pleading-intake-review",
			"docling-pdf-processing",
			"lexis-browseros-legal-research",
		],
		allowBash: false,
		timeoutSec: 1200,
	},
	"source-intake-agent": {
		slug: "source-intake-agent",
		role: "specialist",
		...GPT_MAIN,
		thinkingLevel: "medium",
		skills: ["ca-pleading-intake-review", "docling-pdf-processing", "ca-subpoena-mtc-drafting-workflow"],
		allowBash: true,
		timeoutSec: 1200,
	},
	"facts-evidence-agent": {
		slug: "facts-evidence-agent",
		role: "specialist",
		...GPT_MAIN,
		thinkingLevel: "medium",
		skills: ["ca-litigation-drafting-workflow", "ca-subpoena-mtc-drafting-workflow"],
		allowBash: false,
		timeoutSec: 1200,
	},
	"legal-research-agent": {
		slug: "legal-research-agent",
		role: "specialist",
		...GPT_MAIN,
		thinkingLevel: "medium",
		skills: [
			"lexis-browseros-legal-research",
			"ca-litigation-drafting-workflow",
			"ca-subpoena-mtc-drafting-workflow",
		],
		allowBash: false,
		timeoutSec: 1200,
	},
	"drafting-assembly-agent": {
		slug: "drafting-assembly-agent",
		role: "specialist",
		...GPT_MAIN,
		thinkingLevel: "high",
		skills: ["ca-litigation-drafting-workflow", "ca-subpoena-mtc-drafting-workflow"],
		allowBash: true,
		timeoutSec: 1800,
	},
	"legal-qa-agent": {
		slug: "legal-qa-agent",
		role: "specialist",
		...GPT_MAIN,
		thinkingLevel: "medium",
		skills: [
			"ca-litigation-drafting-workflow",
			"ca-subpoena-mtc-drafting-workflow",
			"ca-pleading-intake-review",
			"lexis-browseros-legal-research",
		],
		allowBash: false,
		timeoutSec: 1200,
	},
	// calendar-agent is a delegatable specialist (deadline calcs, proposals,
	// hard-gated event creation) and also runs the scheduled calendar monitor
	// sweeps, where monitor-run downshifts it to the monitor model.
	"calendar-agent": {
		slug: "calendar-agent",
		role: "specialist",
		...GPT_MAIN,
		thinkingLevel: "medium",
		skills: ["legal-calendaring-workflow"],
		allowBash: false,
		timeoutSec: 900,
	},
	"email-monitor-agent": {
		slug: "email-monitor-agent",
		role: "monitor",
		...GPT_MONITOR,
		thinkingLevel: "low",
		skills: [],
		allowBash: false,
		timeoutSec: 600,
	},
};

export function getAgentSpec(slug: string): AgentSpec {
	const spec = AGENT_REGISTRY[slug];
	if (!spec) {
		throw new Error(`Unknown agent: ${slug}. Known agents: ${Object.keys(AGENT_REGISTRY).join(", ")}`);
	}
	return spec;
}

export const DELEGATABLE_AGENTS = Object.values(AGENT_REGISTRY)
	.filter((a) => a.role === "specialist")
	.map((a) => a.slug);
