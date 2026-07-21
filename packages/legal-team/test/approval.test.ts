import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ApprovalBroker } from "../src/orchestrator/approval.ts";
import { defaultMsc } from "../src/orchestrator/msc.ts";
import { FileTaskStore } from "../src/orchestrator/task-store.ts";

const root = mkdtempSync(join(tmpdir(), "legal-team-approval-"));
const store = new FileTaskStore(root);
const msc = defaultMsc(join(root, "m"), join(root, "m", "out"));

after(() => rmSync(root, { recursive: true, force: true }));

const request = {
	matter: "toy",
	taskId: "T-toy-001",
	agent: "legal-ops-supervisor",
	gate: "gmail_send" as const,
	description: "send test email",
	payloadPreview: "To: someone@example.com",
};

test("auto-deny mode blocks external side effects and audits the decision", async () => {
	const broker = new ApprovalBroker(store, "auto-deny");
	const decision = await broker.request(request, msc);
	assert.equal(decision.approved, false);
	assert.equal(decision.decidedBy, "auto-deny");
	const log = readFileSync(join(root, "toy", "tasks", "T-toy-001.approvals.jsonl"), "utf-8")
		.trim()
		.split("\n");
	assert.equal(JSON.parse(log[0]).gate, "gmail_send");
});

test("sandbox_autopilot profile is auto-denied even in interactive mode", async () => {
	const broker = new ApprovalBroker(store, "interactive");
	const decision = await broker.request(request, { ...msc, approvalProfile: "sandbox_autopilot" });
	assert.equal(decision.approved, false);
	assert.equal(decision.decidedBy, "auto-deny");
});

test("a gate pre-approved in the MSC passes without prompting", async () => {
	const broker = new ApprovalBroker(store, "interactive");
	const decision = await broker.request(request, { ...msc, approvedGates: ["gmail_send"] });
	assert.equal(decision.approved, true);
	assert.equal(decision.decidedBy, "pre-approved");
});
