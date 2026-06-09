import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

// Self-contained client-side eval for the Gmail Monitor Agent's skill.
//
// Unlike the promptfoo suite (which needs OPENROUTER/OpenAI API keys), this test
// drives the locally-installed, subscription-authenticated Codex CLI. It feeds a
// real prompt built from the actual AGENTS.md + SKILL.md and asserts on the
// model's final answer.
//
// It is opt-in because it spends real tokens and needs the Codex CLI + network:
//   RUN_CODEX_EVAL=1 pnpm --filter @paperclipai/ui exec vitest run src/evals/gmail-monitoring-skill.codex.test.ts
//
// Optional overrides:
//   CODEX_BIN (default "codex"), CODEX_EVAL_MODEL (default: Codex CLI default).

const runCodexEval = process.env.RUN_CODEX_EVAL === "1";
const describeCodex = runCodexEval ? describe : describe.skip;

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const companyRoot = path.join(repoRoot, "companies/california-litigation-legal-team");
const agentPath = path.join(companyRoot, "agents/gmail-monitor-agent/AGENTS.md");
const skillPath = path.join(companyRoot, "skills/gmail-monitoring-workflow/SKILL.md");

function stripFrontmatter(markdown: string): string {
  const match = markdown.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return (match ? match[1] : markdown).trim();
}

async function buildPrompt(): Promise<string> {
  const [agentMarkdown, skillMarkdown] = await Promise.all([
    fs.readFile(agentPath, "utf8"),
    fs.readFile(skillPath, "utf8"),
  ]);

  return [
    "You are an AI agent running one heartbeat in the Paperclip control plane.",
    "Act strictly according to the agent instructions and skill below. Carry out the heartbeat now, then report in plain text the concrete monitoring steps you take and what you would route.",
    "",
    "=== AGENT INSTRUCTIONS (gmail-monitor-agent) ===",
    stripFrontmatter(agentMarkdown),
    "",
    "=== SKILL: gmail-monitoring-workflow ===",
    stripFrontmatter(skillMarkdown),
    "",
    "=== CURRENT ISSUE ASSIGNED TO YOU ===",
    '"Please check Gmail for anything new and route any legal assignments to Legal Ops Supervisor."',
    "",
    "Run the heartbeat and report what you did.",
  ].join("\n");
}

function runCodex(prompt: string, timeoutMs: number): Promise<string> {
  const bin = process.env.CODEX_BIN || "codex";
  const model = process.env.CODEX_EVAL_MODEL;
  const args = ["exec", "--json", "--skip-git-repo-check"];
  if (model) args.push("--model", model);
  args.push("-");

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`codex exec timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`codex exec exited with code ${code}: ${stderr.slice(-500)}`));
        return;
      }
      resolve(extractFinalAgentMessage(stdout));
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// Codex `exec --json` emits JSONL events. The model's text answers arrive as
// `{ type: "item.completed", item: { type: "agent_message", text } }`.
function extractFinalAgentMessage(stdout: string): string {
  const messages: string[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const event = parsed as { type?: unknown; item?: { type?: unknown; text?: unknown } };
    if (event.type === "item.completed" && event.item?.type === "agent_message") {
      const text = typeof event.item.text === "string" ? event.item.text : "";
      if (text.trim()) messages.push(text.trim());
    }
  }
  return messages.join("\n\n");
}

describeCodex("gmail-monitoring skill (real Codex prompt)", () => {
  it(
    "proceeds to monitor via the proper Gmail plugin without inventing private profile keys",
    async () => {
      const prompt = await buildPrompt();
      const answer = await runCodex(prompt, 180_000);

      console.log("\n===== CODEX MODEL ANSWER =====\n" + answer + "\n===== END ANSWER =====\n");

      expect(answer.length).toBeGreaterThan(0);

      // It should reference Gmail (the monitored mailbox / connector).
      expect(answer.toLowerCase()).toMatch(/gmail/);

      // It should actually run the monitor: search/review/scan/classify candidate signals.
      expect(answer.toLowerCase()).toMatch(/search|scan|review|monitor|check|classif|candidate/);

      // It must not resurrect the private profile key that we deliberately removed.
      expect(answer).not.toContain("gmail_monitor_profile");
    },
    200_000,
  );
});
