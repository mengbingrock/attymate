import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { defaultMsc } from "../src/orchestrator/msc.ts";
import { createGuardedFileTools, createReadOnlyFileTools } from "../src/tools/fs-guard.ts";

const root = mkdtempSync(join(tmpdir(), "legal-team-guard-"));
const matterRoot = join(root, "matter");
const outputRoot = join(matterRoot, "output");
const otherMatter = join(root, "other-matter");
mkdirSync(outputRoot, { recursive: true });
mkdirSync(otherMatter, { recursive: true });
writeFileSync(join(otherMatter, "secret.txt"), "other matter facts\n");

const msc = { ...defaultMsc(matterRoot, outputRoot), forbiddenRoots: [otherMatter] };
const tools = createGuardedFileTools(matterRoot, msc);
const writeTool = tools.find((t) => t.name === "write");
const editTool = tools.find((t) => t.name === "edit");
const readTool = tools.find((t) => t.name === "read");
assert.ok(writeTool && editTool && readTool);

const noCtx = undefined as never;

after(() => rmSync(root, { recursive: true, force: true }));

test("write inside the output root succeeds", async () => {
	await writeTool.execute(
		"t1",
		{ path: join(outputRoot, "draft.md"), content: "draft\n" },
		undefined,
		undefined,
		noCtx,
	);
	assert.equal(readFileSync(join(outputRoot, "draft.md"), "utf-8"), "draft\n");
});

test("write outside the output root is blocked", async () => {
	await assert.rejects(
		writeTool.execute("t2", { path: join(matterRoot, "source.md"), content: "x" }, undefined, undefined, noCtx),
		/Matter Safety Contract violation/,
	);
	await assert.rejects(
		writeTool.execute("t3", { path: "../escape.md", content: "x" }, undefined, undefined, noCtx),
		/Matter Safety Contract violation/,
	);
});

test("edit outside the output root is blocked", async () => {
	await assert.rejects(
		editTool.execute("t4", { path: join(otherMatter, "secret.txt"), edits: [] }, undefined, undefined, noCtx),
		/Matter Safety Contract violation/,
	);
});

test("a symlink under the output root cannot smuggle a write outside it", async () => {
	symlinkSync(otherMatter, join(outputRoot, "sneaky"));
	await assert.rejects(
		writeTool.execute(
			"t5",
			{ path: join(outputRoot, "sneaky", "secret.txt"), content: "x" },
			undefined,
			undefined,
			noCtx,
		),
		/Matter Safety Contract violation/,
	);
});

test("read of a forbidden root is blocked, in-scope read succeeds", async () => {
	await assert.rejects(
		readTool.execute("t6", { path: join(otherMatter, "secret.txt") }, undefined, undefined, noCtx),
		/Matter Safety Contract violation/,
	);
	const result = await readTool.execute("t7", { path: join(outputRoot, "draft.md") }, undefined, undefined, noCtx);
	assert.ok(JSON.stringify(result.content).includes("draft"));
});

test("read-only tool set has no write or edit tools", () => {
	const names = createReadOnlyFileTools(matterRoot, msc).map((t) => t.name);
	assert.deepEqual(names.sort(), ["find", "grep", "ls", "read"]);
	assert.ok(!names.includes("bash"));
});
