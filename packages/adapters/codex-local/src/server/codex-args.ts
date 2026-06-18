import { asBoolean, asString, asStringArray } from "@paperclipai/adapter-utils/server-utils";
import {
  CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS,
  DEFAULT_CODEX_LOCAL_APPS_ENABLED,
  isCodexLocalFastModeSupported,
} from "../index.js";

export type BuildCodexExecArgsResult = {
  args: string[];
  model: string;
  fastModeRequested: boolean;
  fastModeApplied: boolean;
  fastModeIgnoredReason: string | null;
};

function readExtraArgs(config: unknown): string[] {
  const fromExtraArgs = asStringArray(asRecord(config).extraArgs);
  if (fromExtraArgs.length > 0) return fromExtraArgs;
  return asStringArray(asRecord(config).args);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function formatFastModeSupportedModels(): string {
  return `${CODEX_LOCAL_FAST_MODE_SUPPORTED_MODELS.join(", ")} or manually configured model IDs`;
}

export function buildCodexExecArgs(
  config: unknown,
  options: {
    resumeSessionId?: string | null;
    skipGitRepoCheck?: boolean;
  } = {},
): BuildCodexExecArgsResult {
  const record = asRecord(config);
  const model = asString(record.model, "").trim();
  const modelReasoningEffort = asString(
    record.modelReasoningEffort,
    asString(record.reasoningEffort, ""),
  ).trim();
  const search = asBoolean(record.search, false);
  const fastModeRequested = asBoolean(record.fastMode, false);
  const fastModeApplied = fastModeRequested && isCodexLocalFastModeSupported(model);
  const bypass = asBoolean(
    record.dangerouslyBypassApprovalsAndSandbox,
    asBoolean(record.dangerouslyBypassSandbox, false),
  );
  // `codex exec` defaults to the read-only sandbox, which can neither write files
  // nor reach the network — so agents can't call the Paperclip control-plane API
  // ($PAPERCLIP_API_URL), e.g. `curl .../api/issues/$PAPERCLIP_TASK_ID` fails with
  // "Could not resolve host". When we are NOT fully bypassing the sandbox, select
  // the workspace-write sandbox (so the agent can do its job) and, by default,
  // re-enable outbound network inside it while keeping file-write confinement.
  // Note: the network_access override only takes effect in workspace-write mode,
  // so both flags are required together. Skipped if the caller already pinned a
  // sandbox mode via extraArgs.
  const sandboxNetworkAccess = asBoolean(
    record.sandboxNetworkAccess,
    asBoolean(record.networkAccess, true),
  );
  const appsEnabled = asBoolean(record.appsEnabled, DEFAULT_CODEX_LOCAL_APPS_ENABLED);
  const extraArgs = readExtraArgs(record);
  const callerPinnedSandbox = extraArgs.some((arg) => arg === "-s" || arg === "--sandbox");

  const args = ["exec", "--json"];
  if (options.skipGitRepoCheck) args.push("--skip-git-repo-check");
  if (search) args.unshift("--search");
  if (bypass) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else if (!callerPinnedSandbox) {
    args.push("--sandbox", "workspace-write");
    if (sandboxNetworkAccess) {
      args.push("-c", "sandbox_workspace_write.network_access=true");
    }
  }
  if (model) args.push("--model", model);
  if (modelReasoningEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(modelReasoningEffort)}`);
  }
  if (fastModeApplied) {
    args.push("-c", 'service_tier="fast"', "-c", "features.fast_mode=true");
  }
  // Expose native Codex Apps/connectors (codex_apps) in headless exec. Pushed
  // before extraArgs so a caller can override with `-c apps_enabled=false`.
  if (appsEnabled) {
    args.push("-c", "apps_enabled=true");
  }
  if (extraArgs.length > 0) args.push(...extraArgs);
  if (options.resumeSessionId) args.push("resume", options.resumeSessionId, "-");
  else args.push("-");

  return {
    args,
    model,
    fastModeRequested,
    fastModeApplied,
    fastModeIgnoredReason:
      fastModeRequested && !fastModeApplied
        ? `Configured fast mode is currently only supported on ${formatFastModeSupportedModels()}; Paperclip will ignore it for model ${model || "(default)"}.`
        : null,
  };
}
