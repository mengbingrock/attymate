#!/usr/bin/env node
/**
 * One-shot mechanical port of the Paperclip company package
 * `companies/california-litigation-legal-team` (from the attymate master branch)
 * into `packages/legal-team/company/` on pi-native vocabulary.
 *
 * Usage: node scripts/port-content.mjs <source-company-dir>
 *
 * The transform is intentionally mechanical: it strips Paperclip frontmatter
 * and API sections and maps coordination vocabulary (issues/board/heartbeats)
 * onto the pi task protocol. Domain content is preserved verbatim.
 */
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, "..");
const outRoot = join(pkgRoot, "company");

const srcRoot = process.argv[2];
if (!srcRoot) {
	console.error("usage: node scripts/port-content.mjs <source-company-dir>");
	process.exit(1);
}

const AGENTS = [
	"legal-ops-supervisor",
	"source-intake-agent",
	"facts-evidence-agent",
	"legal-research-agent",
	"drafting-assembly-agent",
	"legal-qa-agent",
	"calendar-agent",
	"email-monitor-agent",
];
// docket-agent and practice-learning-agent are deferred (BrowserOS / learning
// contract dependencies); their skills are likewise excluded.
const SKILLS = [
	"ca-litigation-drafting-workflow",
	"ca-pleading-intake-review",
	"ca-subpoena-mtc-autonomous-runner",
	"ca-subpoena-mtc-drafting-workflow",
	"docling-pdf-processing",
	"legal-calendaring-workflow",
	"lexis-browseros-legal-research",
];

/** Protect legitimate legal-verb usages of "issue" before the generic pass. */
const PROTECTED = [
	["issue legal opinions", "VERB_ISSUE_LEGAL"],
	["Issue legal opinions", "VERB_ISSUE_LEGAL_C"],
	["issuing opinions", "VERB_ISSUING_OP"],
	["issuing", "VERB_ISSUING"],
];

/** Ordered phrase-level vocabulary mapping (Paperclip -> pi task protocol). */
const PHRASES = [
	[/Paperclip issues?/g, "tasks"],
	[/child issues/g, "delegated tasks"],
	[/child issue/g, "delegated task"],
	[/Child issues/g, "Delegated tasks"],
	[/Child issue/g, "Delegated task"],
	[/parent matter issues/g, "matter records"],
	[/parent matter issue/g, "matter record"],
	[/parent issues/g, "matter records"],
	[/parent issue/g, "matter record"],
	[/Parent issues/g, "Matter records"],
	[/Parent issue/g, "Matter record"],
	[/matter issues/g, "matter records"],
	[/matter issue/g, "matter record"],
	[/issue comments/g, "task reports"],
	[/issue comment/g, "task report"],
	[/issue documents/g, "task artifacts"],
	[/issue document/g, "task artifact"],
	[/issue contracts/g, "task contracts"],
	[/issue contract/g, "task contract"],
	[/issue attachments/g, "task attachments"],
	[/issue audit trail/g, "task audit trail"],
	[/issue audit/g, "task audit"],
	[/_paperclip_issues\/\{?id\}?/g, "runs/<matter>/artifacts/<taskId>"],
	[/board-facing/g, "lawyer-facing"],
	[/Board \/ firm owner/g, "Supervising attorney (human owner)"],
	[/Board \/ supervising attorney/g, "Supervising attorney (human)"],
	[/the board/g, "the supervising attorney (human operator)"],
	[/the Board/g, "the supervising attorney (human operator)"],
	[/to board\b/g, "to the supervising attorney (human operator)"],
	[/board approval/g, "supervising-attorney approval"],
	[/board\/user approval/g, "supervising-attorney approval"],
	[/a Paperclip /g, "a pi "],
	[/Paperclip company/g, "agent company"],
	[/Paperclip supervision/g, "orchestrator supervision"],
	[/Codex\/Paperclip runtime/g, "pi runtime"],
	[/Paperclip runtime/g, "pi runtime"],
	[/codex_local adapters?/g, "pi agent runtime"],
	[/Codex local agents/g, "pi agent sessions"],
	[/Codex\b/g, "pi"],
	[/Paperclip API/g, "orchestrator tool protocol"],
	[/`paperclip` skill/g, "orchestrator tool protocol"],
	[/Paperclip/g, "the pi orchestrator"],
	[/paperclip/g, "the pi orchestrator"],
	[/HEARTBEAT\.md/g, "the task store journal"],
	[/heartbeats?/g, "session journals"],
	[/Heartbeats?/g, "Session journals"],
];

const GENERIC = [
	[/\bissues\b/g, "tasks"],
	[/\bIssues\b/g, "Tasks"],
	[/\bissue\b/g, "task"],
	[/\bIssue\b/g, "Task"],
];

function transform(text) {
	let out = text;
	for (const [from, to] of PROTECTED) out = out.split(from).join(to);
	for (const [re, to] of PHRASES) out = out.replace(re, to);
	for (const [re, to] of GENERIC) out = out.replace(re, to);
	for (const [from, to] of PROTECTED) out = out.split(to).join(from);
	// Grammar cleanup after the mechanical passes.
	out = out.replace(/delegated delegated/g, "delegated");
	out = out.replace(/delegating delegated tasks/g, "delegating tasks");
	out = out.replace(/(^|[.!?]\s+|\n)the pi orchestrator/g, "$1The pi orchestrator");
	return out;
}

/** Strip a leading YAML frontmatter block, returning [frontmatterText, body]. */
function splitFrontmatter(text) {
	const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
	if (!m) return [null, text];
	return [m[1], text.slice(m[0].length)];
}

/** Remove a "## Paperclip API" section (heading through the next ## heading). */
function stripPaperclipApiSection(text) {
	return text.replace(/## Paperclip API\r?\n[\s\S]*?(?=\n## )/g, "");
}

/** Rewrite the TOOLS.md "## File System" section onto the pi runtime layout. */
function rewriteFileSystemSection(text, slug) {
	return text.replace(/## File System\r?\n[\s\S]*?(?=\n## )/g, () =>
		[
			"## File System",
			"",
			"- Company docs: `COMPANY.md` (identity and hard constraints) and `OPERATIONS.md` (firm operating rules) are provided in your context.",
			"- Project inventory: `PROJECT-INVENTORY.md` in the company package (read before creating any deliverable).",
			`- Agent home: \`company/agents/${slug}/\` (SOUL.md, AGENTS.md, TOOLS.md, references/).`,
			"- Matter workspace: your working directory is the matter root named in the task packet; write only under the output root it names.",
			"- Task artifacts: `runs/<matter>/artifacts/<taskId>/` under the workspace root.",
			"",
		].join("\n"),
	);
}

function grabYamlScalar(frontmatter, key) {
	const m = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return m ? m[1].trim().replace(/^["']|["']$/g, "") : null;
}

function portFile(srcPath, destPath, opts = {}) {
	const raw = readFileSync(srcPath, "utf-8");
	let text = raw;
	if (opts.kind === "skill") {
		const [fm, body] = splitFrontmatter(text);
		const name = fm ? grabYamlScalar(fm, "name") : null;
		let description = fm ? grabYamlScalar(fm, "description") : null;
		if (!name || !description) throw new Error(`missing name/description frontmatter: ${srcPath}`);
		description = transform(description);
		if (description.length > 1024) description = `${description.slice(0, 1021)}...`;
		text = `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
		const [, rest] = splitFrontmatter(text);
		text = `---\nname: ${name}\ndescription: ${description}\n---\n${transform(rest)}`;
	} else {
		if (opts.stripFrontmatter) {
			const [, body] = splitFrontmatter(text);
			text = body;
		}
		if (opts.tools) {
			text = stripPaperclipApiSection(text);
			text = rewriteFileSystemSection(text, opts.slug);
		}
		text = transform(text);
	}
	if (opts.banner) text = `${opts.banner}\n\n${text}`;
	mkdirSync(dirname(destPath), { recursive: true });
	writeFileSync(destPath, text);
}

function portTree(srcDir, destDir, opts = {}) {
	for (const entry of readdirSync(srcDir)) {
		const s = join(srcDir, entry);
		const d = join(destDir, entry);
		if (statSync(s).isDirectory()) {
			portTree(s, d, opts);
		} else if (entry.endsWith(".md")) {
			portFile(s, d, opts);
		} else {
			mkdirSync(dirname(d), { recursive: true });
			cpSync(s, d);
		}
	}
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

portFile(join(srcRoot, "COMPANY.md"), join(outRoot, "COMPANY.md"), { stripFrontmatter: true });
portFile(join(srcRoot, "OPERATIONS.md"), join(outRoot, "OPERATIONS.md"));
portFile(join(srcRoot, "PROJECT-INVENTORY.md"), join(outRoot, "PROJECT-INVENTORY.md"));

for (const slug of AGENTS) {
	const srcAgent = join(srcRoot, "agents", slug);
	const destAgent = join(outRoot, "agents", slug);
	portFile(join(srcAgent, "SOUL.md"), join(destAgent, "SOUL.md"));
	portFile(join(srcAgent, "AGENTS.md"), join(destAgent, "AGENTS.md"), { stripFrontmatter: true });
	portFile(join(srcAgent, "TOOLS.md"), join(destAgent, "TOOLS.md"), { tools: true, slug });
	// HEARTBEAT.md is intentionally dropped: pi session files + the task store are the journal.
	const refs = join(srcAgent, "references");
	try {
		if (statSync(refs).isDirectory()) portTree(refs, join(destAgent, "references"));
	} catch {}
}

const LEXIS_BANNER =
	"> **Runtime note:** BrowserOS browser tooling is not available in this deployment. Work only from sources and authorities supplied in the task packet or matter workspace; if live external research is required, escalate to the supervisor instead of attempting browser access.";

for (const skill of SKILLS) {
	const srcSkill = join(srcRoot, "skills", skill);
	const destSkill = join(outRoot, "skills", skill);
	portFile(join(srcSkill, "SKILL.md"), join(destSkill, "SKILL.md"), {
		kind: "skill",
		banner: skill === "lexis-browseros-legal-research" ? undefined : undefined,
	});
	if (skill === "lexis-browseros-legal-research") {
		const p = join(destSkill, "SKILL.md");
		const t = readFileSync(p, "utf-8");
		const [fm, body] = splitFrontmatter(t);
		writeFileSync(p, `---\n${fm}\n---\n${LEXIS_BANNER}\n\n${body}`);
	}
	for (const entry of readdirSync(srcSkill)) {
		if (entry === "SKILL.md") continue;
		const s = join(srcSkill, entry);
		const d = join(destSkill, entry);
		if (statSync(s).isDirectory()) portTree(s, d);
		else {
			mkdirSync(dirname(d), { recursive: true });
			cpSync(s, d);
		}
	}
}

// Report any residual Paperclip vocabulary so the port can be verified.
let residual = 0;
function scan(dir) {
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) {
			scan(p);
		} else if (entry.endsWith(".md")) {
			let text = readFileSync(p, "utf-8");
			for (const [from] of PROTECTED) text = text.split(from).join("");
			const hits = text.match(/paperclip|PAPERCLIP|\bissues?\b/gi);
			if (hits) {
				residual += hits.length;
				console.error(`residual vocabulary in ${relative(outRoot, p)}: ${[...new Set(hits)].join(", ")}`);
			}
		}
	}
}
scan(outRoot);
console.log(residual === 0 ? "port complete: no residual Paperclip vocabulary" : `port complete with ${residual} residual hits`);
