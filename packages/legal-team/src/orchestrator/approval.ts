import { askHuman, logLine } from "../runtime/events.ts";
import type { MatterSafetyContract, RedGate } from "./msc.ts";
import type { FileTaskStore } from "./task-store.ts";

export interface ApprovalRequest {
	matter: string;
	taskId: string;
	agent: string;
	gate: RedGate;
	description: string;
	payloadPreview: string;
}

export interface ApprovalDecision {
	approved: boolean;
	note: string;
	decidedBy: "human" | "auto-deny" | "pre-approved";
}

/**
 * Human approval gate for external side effects. Red gates are enforced inside
 * the side-effectful tools themselves (gmail_send, calendar_create_event call
 * this broker before acting), so a model cannot bypass them. Every decision is
 * appended to `tasks/<id>.approvals.jsonl` for the audit trail.
 */
export class ApprovalBroker {
	private readonly store: FileTaskStore;
	private readonly mode: "interactive" | "auto-deny";

	constructor(store: FileTaskStore, mode: "interactive" | "auto-deny") {
		this.store = store;
		this.mode = mode;
	}

	async request(req: ApprovalRequest, msc: MatterSafetyContract): Promise<ApprovalDecision> {
		let decision: ApprovalDecision;
		if (msc.approvedGates.includes(req.gate)) {
			decision = { approved: true, note: "gate pre-approved in Matter Safety Contract", decidedBy: "pre-approved" };
		} else if (this.mode === "auto-deny" || msc.approvalProfile === "sandbox_autopilot") {
			decision = {
				approved: false,
				note: "auto-denied (sandbox/auto-deny mode); external side effect simulated, not performed",
				decidedBy: "auto-deny",
			};
		} else {
			logLine("");
			logLine("\x1b[31m════════ HARD GATE — HUMAN APPROVAL REQUIRED ════════\x1b[0m");
			logLine(`Matter:  ${req.matter}    Task: ${req.taskId}    Agent: ${req.agent}`);
			logLine(`Gate:    ${req.gate}`);
			logLine(`Action:  ${req.description}`);
			logLine("──────── payload preview ────────");
			logLine(req.payloadPreview);
			logLine("─────────────────────────────────");
			const answer = (await askHuman("Approve this external action? [y/N] ")).trim().toLowerCase();
			const approved = answer === "y" || answer === "yes";
			const note = approved ? "" : (await askHuman("Optional note for the agent: ")).trim();
			decision = { approved, note, decidedBy: "human" };
		}
		this.store.appendApproval(req.matter, req.taskId, {
			at: new Date().toISOString(),
			gate: req.gate,
			agent: req.agent,
			description: req.description,
			...decision,
		});
		return decision;
	}
}
