import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";

const skillSlug = "gmail-monitoring-workflow";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const companyRoot = path.join(repoRoot, "companies/california-litigation-legal-team");
const skillPath = path.join(companyRoot, "skills", skillSlug, "SKILL.md");
const agentPath = path.join(companyRoot, "agents/gmail-monitor-agent/AGENTS.md");

function parseFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Expected markdown frontmatter block");
  }

  return {
    frontmatter: match[1] ?? "",
    body: match[2] ?? "",
  };
}

function readYamlScalar(frontmatter: string, key: string): string | null {
  const line = frontmatter.split("\n").find((entry) => entry.startsWith(`${key}:`));
  return line?.slice(key.length + 1).trim() ?? null;
}

describe("gmail monitoring skill package", () => {
  it("is attached to the Gmail Monitor Agent", async () => {
    const agentMarkdown = await fs.readFile(agentPath, "utf8");

    expect(agentMarkdown).toContain(`  - ${skillSlug}`);
  });

  it("uses the proper Gmail plugin wording without naming private profile keys", async () => {
    const skillMarkdown = await fs.readFile(skillPath, "utf8");
    const { frontmatter, body } = parseFrontmatter(skillMarkdown);
    const description = readYamlScalar(frontmatter, "description");

    expect(readYamlScalar(frontmatter, "name")).toBe(skillSlug);
    expect(description).toContain("proper Gmail plugin");
    expect(description).not.toContain("gmail_monitor_profile");
    expect(body).toContain("proper Gmail plugin configuration");
    expect(body).toContain("Use the proper Gmail plugin to search the mailbox");
    expect(skillMarkdown).not.toContain("gmail_monitor_profile");
  });
});
