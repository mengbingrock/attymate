import type { UIAdapterModule } from "../types";
import { parseGeminiStdoutLine } from "@paperclipai/adapter-gemini-local/ui";
import { GeminiLocalConfigFields } from "./config-fields";
import { buildGeminiLocalConfig } from "@paperclipai/adapter-gemini-local/ui";

export const geminiLocalUIAdapter: UIAdapterModule = {
  type: "gemini_local",
  label: "Gemini CLI (Server's Remote)",
  parseStdoutLine: parseGeminiStdoutLine,
  ConfigFields: GeminiLocalConfigFields,
  buildAdapterConfig: buildGeminiLocalConfig,
};
