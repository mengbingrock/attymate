import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { Task } from "../orchestrator/task-store.ts";

/** Mutable run state shared between a specialist session and the orchestrator. */
export interface TaskRunState {
	task: Task;
	finished: boolean;
}

/**
 * The specialist completion protocol: every delegated session must end through
 * report_result or escalate; request_approval records a gate request for the
 * supervisor without granting anything.
 */
export function createSpecialistTools(state: TaskRunState, saveTask: (task: Task) => void): ToolDefinition<any, any>[] {
	const reportResult = defineTool({
		name: "report_result",
		label: "Report Result",
		description:
			"Report the completed task back to the supervisor: a lawyer-readable summary and the artifact paths you produced. Call exactly once, when the task is done.",
		parameters: Type.Object({
			summary: Type.String({ description: "Lawyer-readable summary of what was done and what it relies on" }),
			artifactPaths: Type.Array(Type.String(), { description: "Paths of artifacts written under the output root" }),
			gatesRequested: Type.Optional(
				Type.Array(Type.String(), { description: "Hard gates the supervisor should consider next" }),
			),
		}),
		execute: async (_id, params) => {
			state.task.status = "completed";
			state.task.report = {
				summary: params.summary,
				artifactPaths: params.artifactPaths,
				gatesRequested: params.gatesRequested,
			};
			state.finished = true;
			saveTask(state.task);
			return {
				content: [{ type: "text" as const, text: "Report recorded. You are done; do not start new work." }],
				details: {},
			};
		},
	});

	const escalate = defineTool({
		name: "escalate",
		label: "Escalate",
		description:
			"Stop and hand the task back to the supervisor: inputs are missing, scope is unclear, or the work would exceed the Matter Safety Contract.",
		parameters: Type.Object({
			reason: Type.String({ description: "Why the task cannot proceed" }),
			missingInputs: Type.Array(Type.String(), {
				description: "Concrete inputs or approvals that would unblock it",
			}),
		}),
		execute: async (_id, params) => {
			state.task.status = "escalated";
			state.task.escalation = { reason: params.reason, missingInputs: params.missingInputs };
			state.finished = true;
			saveTask(state.task);
			return {
				content: [{ type: "text" as const, text: "Escalation recorded. Stop working on this task." }],
				details: {},
			};
		},
	});

	const requestApproval = defineTool({
		name: "request_approval",
		label: "Request Approval",
		description:
			"Record that a hard-gated external action is needed (send, file, serve, calendar write, external upload). This does NOT grant approval; it surfaces the request to the supervisor.",
		parameters: Type.Object({
			gate: Type.String({ description: "Which gate, e.g. gmail_send, calendar_create_event, external-filing" }),
			description: Type.String({ description: "What would be done if approved" }),
			payloadPreview: Type.String({ description: "The exact content that would go out" }),
		}),
		execute: async (_id, params) => {
			const requested = state.task.report?.gatesRequested ?? [];
			state.task.report = {
				summary: state.task.report?.summary ?? "",
				artifactPaths: state.task.report?.artifactPaths ?? [],
				gatesRequested: [...requested, `${params.gate}: ${params.description}`],
			};
			saveTask(state.task);
			return {
				content: [
					{
						type: "text" as const,
						text: "Gate request recorded for the supervisor. Continue with in-scope work or report_result/escalate.",
					},
				],
				details: {},
			};
		},
	});

	return [reportResult, escalate, requestApproval];
}
