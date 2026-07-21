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
// docket-agent and practice-learning-agent are deferred (external docket
// access / learning contract dependencies); their skills are likewise
// excluded. The source's lexis-browseros-legal-research skill is replaced by
// the authored supplied-authority-legal-research skill below — this
// deployment has no browser tooling and no BrowserOS dependency.
const SKILLS = [
	"ca-litigation-drafting-workflow",
	"ca-pleading-intake-review",
	"ca-subpoena-mtc-autonomous-runner",
	"ca-subpoena-mtc-drafting-workflow",
	"docling-pdf-processing",
	"legal-calendaring-workflow",
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
	// De-BrowserOS: this deployment has no browser tooling; the browser-based
	// research skill is replaced and all external-browser tool mentions drop out.
	[/`?lexis-browseros-legal-research`?/g, "`supplied-authority-legal-research`"],
	[
		/Legal research runs against \*\*Lexis via BrowserOS\*\* through the `supplied-authority-legal-research` skill\./g,
		"Legal research is supplied-authority workup through the `supplied-authority-legal-research` skill. No live external research tooling (Lexis, browser) exists in this deployment; unresolved external research needs are escalated to the supervisor.",
	],
	[/BrowserOS, Lexis, LASC, email provider/g, "Email provider"],
	[/the Lexis Research and Citation Verification Specialist/g, "the Research and Citation Verification Specialist"],
	[/\(BrowserOS, email provider, calendar provider, Drive, Lexis, LASC, filing\)/g, "(email provider, calendar provider, Drive, filing)"],
	[/`lasc-browseros-docket-check`/g, "deferred — no browser tooling; manual follow-up"],
	[/Lexis research & citation verification/g, "Supplied-authority research & citation verification"],
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

for (const skill of SKILLS) {
	const srcSkill = join(srcRoot, "skills", skill);
	const destSkill = join(outRoot, "skills", skill);
	portFile(join(srcSkill, "SKILL.md"), join(destSkill, "SKILL.md"), { kind: "skill" });
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

// Authored replacement for the source's lexis-browseros-legal-research skill:
// same supplied-authority discipline, no browser/Lexis session workflow. The
// research-output-format reference is reused verbatim (it is browser-neutral).
const RESEARCH_SKILL = `---
name: supplied-authority-legal-research
description: Use when a pi legal research agent must perform source-bound legal research from supplied or already-approved authorities, including citation verification against supplied source text, treatment notes, authority-table creation, and source-supported legal research memoranda. Do not use for memory-derived authorities or unapproved external research; no live external research tooling (Lexis, browser) exists in this deployment — unresolved external research needs are escalated to the supervisor.
---

# supplied-authority-legal-research

*How the California Litigation Legal Team runs legal research — source-bound and supervised, never from memory, never beyond the approved source set. This deployment has no browser or Lexis tooling: all research is workup of supplied or already-approved authorities.*

## When to load this skill

- A Legal Research Agent is assigned to a scoped research task and is opening it for the first time.
- A task requires citation verification or treatment-checking of authorities the legal point depends on, from supplied source text.
- An authority table or source-supported research memorandum must be built from approved sources.
- This skill is generic and reusable: it carries no client facts, matter examples, firm accounts, saved searches, internal URLs, or private credentials.

## Inputs

Before research begins, confirm the task states the contract fields:

- Research question and jurisdiction.
- Matter label to use for audit purposes, supplied at runtime.
- Approved source scope: the supplied authority files and any already-approved source materials.
- Output root for research logs, authority tables, and memos.
- Authority-use limits, including whether only supplied authorities may be used.
- Forbidden roots and no-cross-matter inspection rule.
- Firm Operations Guide reference or scoped guide excerpt, autonomy level, approval profile, learning mode, and any visible hard-gate approvals already granted.

If research scope or matter label is missing, return the missing-field list to the supervisor. External research is never available: when a legal point cannot be resolved from the supplied/approved set, record it on the unresolved external-research list and escalate rather than filling the gap from memory.

## Procedure

1. **Checkout the assigned task.**
2. **Read context.** Read the matter record, task reports, supplied authorities, and research scope.
3. **Verify before relying.** Open and verify primary authorities in the supplied source text before relying on them. Treat all authority claims as needing source verification. Never use authorities derived from memory.
4. **Check treatment.** Note treatment and subsequent-history signals only insofar as they appear in the supplied/approved materials; anything requiring live treatment-checking goes on the unresolved external-research list.
5. **Log everything.** Keep a research log with sources reviewed, accepted authorities, rejected authorities, and treatment notes.
6. **Checkpoint and gate.** Proceed autonomously with green work: supplied-authority tables, citation formatting checks from supplied text, task research logs, and source-supported memo notes using approved sources. Route yellow tasks to the Legal Ops Supervisor when scope expands or a discrete legal strategy question can be separated from source verification — but continue supplied-authority work where possible. Hard-gate approval is required before: adding new authorities beyond the supplied/approved source set; downloading, exporting, uploading, emailing, filing, serving, or finalizing; or adopting legal theory, relief, sanctions, privacy, or protective-order recommendations through external action or protected mutation.
7. **Post and save.** Post findings and save approved outputs under \`{output_root}\`.

## Outputs

- Outputs may include task reports, research logs, authority tables, treatment notes, and source-supported research memos.
- Mark done only after posting a source-supported answer, an authority table, and an unresolved external-research list.
- Return discrete yellow or hard-gate tasks to the Legal Ops Supervisor, but continue supplied-authority work when possible.
- Do not embed credentials, private account details, client secrets, or confidential facts in reusable skill files.

## Anti-patterns

- Citing authorities from memory. Every authority claim needs source verification.
- Adding authorities beyond the supplied or approved source set without approval.
- Attempting live external research; none exists in this deployment — escalate instead.
- Downloading, exporting, uploading, emailing, filing, serving, or finalizing without approval.
- Storing credentials, or embedding client secrets, private account details, or confidential facts in this reusable skill.
- Blocking indefinitely on a missing field instead of continuing safe supplied-authority work and recording what remains.

## Reference

- \`references/research-output-format.md\`: generic research-log and authority-table fields.
`;

{
	const destSkill = join(outRoot, "skills", "supplied-authority-legal-research");
	mkdirSync(join(destSkill, "references"), { recursive: true });
	writeFileSync(join(destSkill, "SKILL.md"), RESEARCH_SKILL);
	portFile(
		join(srcRoot, "skills", "lexis-browseros-legal-research", "references", "research-output-format.md"),
		join(destSkill, "references", "research-output-format.md"),
	);
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
			const hits = text.match(/paperclip|PAPERCLIP|\bissues?\b|browseros/gi);
			if (hits) {
				residual += hits.length;
				console.error(`residual vocabulary in ${relative(outRoot, p)}: ${[...new Set(hits)].join(", ")}`);
			}
		}
	}
}
scan(outRoot);
console.log(residual === 0 ? "port complete: no residual Paperclip vocabulary" : `port complete with ${residual} residual hits`);
