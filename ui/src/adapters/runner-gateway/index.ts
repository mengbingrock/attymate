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
  label: `${base.label} (Local Runner)`,
  parseStdoutLine: base.parseStdoutLine,
  createStdoutParser: base.createStdoutParser,
  ConfigFields: base.ConfigFields,
  buildAdapterConfig: (v: CreateConfigValues) => ({
    ...base.buildAdapterConfig(v),
    runnerAdapterType: base.type,
  }),
}));
