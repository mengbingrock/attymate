import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { companyDir } from "../src/config.ts";
import { AGENT_REGISTRY } from "../src/registry/agents.ts";
import { assembleAgentPrompt, companyContextFiles } from "../src/registry/prompt-assembly.ts";

const EXPECTED_AGENTS = [
	"legal-ops-supervisor",
	"source-intake-agent",
	"facts-evidence-agent",
	"legal-research-agent",
	"drafting-assembly-agent",
	"legal-qa-agent",
	"calendar-agent",
	"email-monitor-agent",
];

const EXPECTED_SKILLS = [
	"ca-litigation-drafting-workflow",
	"ca-pleading-intake-review",
	"ca-subpoena-mtc-autonomous-runner",
	"ca-subpoena-mtc-drafting-workflow",
	"docling-pdf-processing",
	"legal-calendaring-workflow",
	"supplied-authority-legal-research",
];

function* markdownFiles(dir: string): Generator<string> {
	for (const entry of readdirSync(dir)) {
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) yield* markdownFiles(path);
		else if (entry.endsWith(".md")) yield path;
	}
}

test("company package has the 8 ported agents and 7 skills", () => {
	for (const agent of EXPECTED_AGENTS) {
		for (const file of ["SOUL.md", "AGENTS.md", "TOOLS.md"]) {
			assert.ok(statSync(join(companyDir(), "agents", agent, file)).isFile(), `${agent}/${file}`);
		}
	}
	for (const skill of EXPECTED_SKILLS) {
		assert.ok(statSync(join(companyDir(), "skills", skill, "SKILL.md")).isFile(), skill);
	}
	assert.deepEqual(Object.keys(AGENT_REGISTRY).sort(), [...EXPECTED_AGENTS].sort());
});

test("ported markdown contains no Paperclip vocabulary", () => {
	for (const path of markdownFiles(companyDir())) {
		const text = readFileSync(path, "utf-8")
			.replaceAll("issue legal opinions", "")
			.replaceAll("Issue legal opinions", "")
			.replaceAll("issuing opinions", "");
		for (const token of [/paperclip/i, /\$PAPERCLIP/, /\bissues?\b/i, /HEARTBEAT\.md/]) {
			assert.ok(!token.test(text), `${path} still contains ${token}`);
		}
	}
});

test("assembled prompts are complete and Paperclip-free", () => {
	for (const spec of Object.values(AGENT_REGISTRY)) {
		const blocks = assembleAgentPrompt(spec);
		assert.equal(blocks.length, 4, `${spec.slug} prompt blocks`);
		for (const block of blocks) {
			assert.ok(block.trim().length > 0, `${spec.slug} has an empty prompt block`);
			assert.ok(!/paperclip/i.test(block), `${spec.slug} prompt mentions Paperclip`);
		}
		assert.ok(blocks[0].includes(spec.slug), `${spec.slug} preamble names the agent`);
	}
	const context = companyContextFiles();
	assert.equal(context.length, 3);
	assert.ok(context[0].content.includes("California Litigation Legal Team"));
});

test("skill frontmatter matches pi's Agent Skills constraints", () => {
	for (const skill of EXPECTED_SKILLS) {
		const text = readFileSync(join(companyDir(), "skills", skill, "SKILL.md"), "utf-8");
		const match = text.match(/^---\n([\s\S]*?)\n---\n/);
		assert.ok(match, `${skill} has frontmatter`);
		const name = match[1].match(/^name: (.+)$/m)?.[1];
		const description = match[1].match(/^description: (.+)$/m)?.[1];
		assert.equal(name, skill);
		assert.ok(description && description.length <= 1024, `${skill} description length`);
	}
});
