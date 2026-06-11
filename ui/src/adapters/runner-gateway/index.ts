import type { UIAdapterModule } from "../types";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { localRunnerVariantType } from "@paperclipai/shared";
import { claudeLocalUIAdapter } from "../claude-local";
import { codexLocalUIAdapter } from "../codex-local";
import { geminiLocalUIAdapter } from "../gemini-local";
import { openCodeLocalUIAdapter } from "../opencode-local";
import { piLocalUIAdapter } from "../pi-local";

// One picker entry per local agent that runs on the user's machine via the
// runner-client. Each reuses the underlying agent's config fields, model list,
// and stdout parser, and tags adapterConfig with runnerAdapterType so the
// `<agent>_runner` adapter routes to the runner_gateway engine on the server.
const UNDERLYING: UIAdapterModule[] = [
  claudeLocalUIAdapter,
  codexLocalUIAdapter,
  geminiLocalUIAdapter,
  openCodeLocalUIAdapter,
  piLocalUIAdapter,
];

export const runnerGatewayVariantUIAdapters: UIAdapterModule[] = UNDERLYING.map((base) => ({
  type: localRunnerVariantType(base.type),
  // Strip any "(Server's Remote)"-style suffix from the base label before
  // tagging the runner variant, so we get "Codex (User's Local)" not
  // "Codex (Server's Remote) (User's Local)". (The picker actually renders the
  // label from adapter-display-registry; this keeps the module label tidy too.)
  label: `${base.label.replace(/\s*\([^)]*\)\s*$/, "")} (User's Local)`,
  parseStdoutLine: base.parseStdoutLine,
  createStdoutParser: base.createStdoutParser,
  ConfigFields: base.ConfigFields,
  buildAdapterConfig: (v: CreateConfigValues) => ({
    ...base.buildAdapterConfig(v),
    runnerAdapterType: base.type,
  }),
}));
