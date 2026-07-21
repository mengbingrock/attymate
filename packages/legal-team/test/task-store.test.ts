import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { defaultMsc } from "../src/orchestrator/msc.ts";
import { FileTaskStore, type Task } from "../src/orchestrator/task-store.ts";

const root = mkdtempSync(join(tmpdir(), "legal-team-store-"));
const store = new FileTaskStore(root);

after(() => rmSync(root, { recursive: true, force: true }));

function makeTask(id: string): Task {
	const now = new Date().toISOString();
	return {
		id,
		matter: "toy",
		agent: "facts-evidence-agent",
		title: "test",
		instructions: "do the thing",
		msc: defaultMsc(join(root, "matter"), join(root, "matter", "output")),
		status: "pending",
		createdAt: now,
		updatedAt: now,
	};
}

test("matter lifecycle and task ids", () => {
	store.createMatter({
		matter: "toy",
		label: "Toy Matter",
		createdAt: new Date().toISOString(),
		msc: makeTask("x").msc,
	});
	assert.equal(store.getMatter("toy")?.label, "Toy Matter");
	assert.deepEqual(store.listMatters(), ["toy"]);
	assert.equal(store.nextTaskId("toy"), "T-toy-001");
	const task = makeTask(store.nextTaskId("toy"));
	store.saveTask(task);
	assert.equal(store.nextTaskId("toy"), "T-toy-002");
	assert.equal(store.getTask("toy", "T-toy-001")?.title, "test");
});

test("task updates round-trip and approvals append", () => {
	const task = store.getTask("toy", "T-toy-001");
	assert.ok(task);
	task.status = "completed";
	task.report = { summary: "done", artifactPaths: ["a.md"] };
	store.saveTask(task);
	const reread = store.getTask("toy", "T-toy-001");
	assert.equal(reread?.status, "completed");
	assert.equal(reread?.report?.summary, "done");

	store.appendApproval("toy", "T-toy-001", { gate: "gmail_send", approved: false });
	store.appendApproval("toy", "T-toy-001", { gate: "gmail_send", approved: true });
	const lines = readFileSync(join(root, "toy", "tasks", "T-toy-001.approvals.jsonl"), "utf-8")
		.trim()
		.split("\n");
	assert.equal(lines.length, 2);
	assert.equal(JSON.parse(lines[1]).approved, true);
});

test("listTasks ignores approval logs and sorts by id", () => {
	const tasks = store.listTasks("toy");
	assert.equal(tasks.length, 1);
	assert.equal(tasks[0].id, "T-toy-001");
});
