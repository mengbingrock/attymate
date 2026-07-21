import { join } from "node:path";
import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentModelConfig, LegalTeamConfig } from "../config.ts";
import type { AgentSpec } from "../registry/agents.ts";

export type ThinkingLevel = NonNullable<CreateAgentSessionOptions["thinkingLevel"]>;
export type ResolvedModel = {
	model: NonNullable<CreateAgentSessionOptions["model"]>;
	thinkingLevel: ThinkingLevel;
	timeoutSec: number;
};

let runtime: ModelRuntime | undefined;

/** One ModelRuntime for the whole process, backed by the stock pi auth store. */
export async function getModelRuntime(config: LegalTeamConfig): Promise<ModelRuntime> {
	if (!runtime) {
		runtime = await ModelRuntime.create({
			authPath: join(config.piAgentDir, "auth.json"),
			modelsPath: join(config.piAgentDir, "models.json"),
		});
	}
	return runtime;
}

/**
 * Resolve the model for an agent: registry default, overridden by config.
 * If the OpenAI subscription provider (openai-codex) has no stored auth but
 * OPENAI_API_KEY is set, fall back to the plain `openai` provider.
 */
export async function resolveAgentModel(spec: AgentSpec, config: LegalTeamConfig): Promise<ResolvedModel> {
	const override: Partial<AgentModelConfig> = config.agents[spec.slug] ?? {};
	let provider = override.provider ?? spec.provider;
	const modelId = override.model ?? spec.model;
	const thinkingLevel = (override.thinkingLevel ?? spec.thinkingLevel) as ThinkingLevel;
	const timeoutSec = override.timeoutSec ?? (config.taskTimeoutSec !== 1200 ? config.taskTimeoutSec : spec.timeoutSec);

	const modelRuntime = await getModelRuntime(config);
	if (provider === "openai-codex" && !override.provider) {
		const status = await modelRuntime.checkAuth("openai-codex");
		if (!statusOk(status) && process.env.OPENAI_API_KEY) {
			provider = "openai";
		}
	}
	const model = modelRuntime.getModel(provider, modelId);
	if (!model) {
		throw new Error(
			`Model ${provider}/${modelId} not found for agent ${spec.slug}. ` +
				"Check legal-team.config.json agent overrides, or run `legal-team auth check`.",
		);
	}
	return { model, thinkingLevel, timeoutSec };
}

function statusOk(status: unknown): boolean {
	if (typeof status === "boolean") return status;
	if (status && typeof status === "object") {
		const s = status as Record<string, unknown>;
		if (typeof s.authenticated === "boolean") return s.authenticated;
		if (typeof s.ok === "boolean") return s.ok;
		if (typeof s.status === "string") return s.status !== "none" && s.status !== "missing";
	}
	return Boolean(status);
}

export async function checkModelAuth(config: LegalTeamConfig): Promise<string> {
	const modelRuntime = await getModelRuntime(config);
	const lines: string[] = [];
	for (const providerId of ["openai-codex", "openai"]) {
		try {
			const status = await modelRuntime.checkAuth(providerId);
			lines.push(`${providerId}: ${statusOk(status) ? "ok" : "not configured"}`);
		} catch (error) {
			lines.push(`${providerId}: error (${error instanceof Error ? error.message : String(error)})`);
		}
	}
	if (!lines.some((l) => l.endsWith("ok"))) {
		lines.push("");
		lines.push("No OpenAI auth found. Run `/login` once in the stock pi TUI (OpenAI Codex provider),");
		lines.push("or export OPENAI_API_KEY to use the API-key provider instead.");
	}
	return lines.join("\n");
}
