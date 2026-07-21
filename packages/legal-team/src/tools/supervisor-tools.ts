import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { LegalTeamConfig } from "../config.ts";
import {
	type ApprovalProfile,
	type AutonomyLevel,
	defaultMsc,
	describeMsc,
	type MatterSafetyContract,
	type RedGate,
} from "../orchestrator/msc.ts";
import type { FileTaskStore, Task } from "../orchestrator/task-store.ts";
import { DELEGATABLE_AGENTS } from "../registry/agents.ts";
import { askHuman } from "../runtime/events.ts";

export type SpecialistRunner = (task: Task) => Promise<Task>;

export interface SupervisorContext {
	config: LegalTeamConfig;
	store: FileTaskStore;
	runSpecialist: SpecialistRunner;
	/** The matter the supervisor is currently working; set by create_matter / CLI. */
	getCurrentMatter: () => string | undefined;
	setCurrentMatter: (matter: string) => void;
}

function text(value: string) {
	return { content: [{ type: "text" as const, text: value }], details: {} };
}

function slugify(label: string): string {
	return (
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 48) || "matter"
	);
}

export function createSupervisorTools(ctx: SupervisorContext): ToolDefinition<any, any>[] {
	const { config, store } = ctx;

	const createMatter = defineTool({
		name: "create_matter",
		label: "Create Matter",
		description:
			"Open a matter record with its Matter Safety Contract. Do this before delegating any specialist work. Translate the lawyer's plain-English answers into the contract yourself.",
		parameters: Type.Object({
			label: Type.String({ description: "Short matter label, e.g. 'Smith v. Jones subpoena MTC'" }),
			matterRoot: Type.Optional(
				Type.String({ description: "Approved matter folder (read scope). Default: <workspace>/matters/<slug>" }),
			),
			outputRoot: Type.Optional(Type.String({ description: "Only writable folder. Default: <matterRoot>/output" })),
			workflowType: Type.Optional(Type.String()),
			autonomyLevel: Type.Optional(
				Type.Union([
					Type.Literal("safe-draft-only"),
					Type.Literal("supervised-tools"),
					Type.Literal("approved-external-actions"),
				]),
			),
			approvalProfile: Type.Optional(Type.Union([Type.Literal("live"), Type.Literal("sandbox_autopilot")])),
			readOnlyRoots: Type.Optional(Type.Array(Type.String())),
			forbiddenRoots: Type.Optional(Type.Array(Type.String())),
			approvedGates: Type.Optional(
				Type.Array(Type.String(), { description: "Hard gates the lawyer already approved (rare)" }),
			),
		}),
		execute: async (_id, params) => {
			const matter = slugify(params.label);
			if (store.getMatter(matter)) {
				ctx.setCurrentMatter(matter);
				return text(`Matter ${matter} already exists; it is now the current matter.`);
			}
			const matterRoot = params.matterRoot ?? join(config.workspaceRoot, "matters", matter);
			const outputRoot = params.outputRoot ?? join(matterRoot, "output");
			mkdirSync(outputRoot, { recursive: true });
			const msc: MatterSafetyContract = {
				...defaultMsc(matterRoot, outputRoot),
				workflowType: params.workflowType ?? "general-litigation-support",
				autonomyLevel: (params.autonomyLevel as AutonomyLevel | undefined) ?? "safe-draft-only",
				approvalProfile: (params.approvalProfile as ApprovalProfile | undefined) ?? "live",
				readOnlyRoots: params.readOnlyRoots ?? [matterRoot],
				forbiddenRoots: params.forbiddenRoots ?? [],
				approvedGates: (params.approvedGates as RedGate[] | undefined) ?? [],
			};
			store.createMatter({ matter, label: params.label, createdAt: new Date().toISOString(), msc });
			ctx.setCurrentMatter(matter);
			return text(`Matter ${matter} created.\n${describeMsc(msc)}`);
		},
	});

	const delegate = defineTool({
		name: "delegate",
		label: "Delegate Task",
		description:
			`Delegate one task to a specialist and wait for its report. Specialists: ${DELEGATABLE_AGENTS.join(", ")}. ` +
			"The task instructions must be self-contained: the specialist sees only the task packet, not this conversation.",
		parameters: Type.Object({
			matter: Type.Optional(Type.String({ description: "Matter slug (default: current matter)" })),
			agent: Type.String({ description: "Specialist agent slug" }),
			title: Type.String(),
			instructions: Type.String({
				description: "Complete, self-contained instructions incl. source list and deliverable",
			}),
			autonomyLevel: Type.Optional(
				Type.Union([
					Type.Literal("safe-draft-only"),
					Type.Literal("supervised-tools"),
					Type.Literal("approved-external-actions"),
				]),
			),
		}),
		executionMode: "sequential",
		execute: async (_id, params) => {
			const matter = params.matter ?? ctx.getCurrentMatter();
			if (!matter) throw new Error("No matter selected. Call create_matter first.");
			const record = store.getMatter(matter);
			if (!record) throw new Error(`Unknown matter: ${matter}`);
			if (!DELEGATABLE_AGENTS.includes(params.agent)) {
				throw new Error(`Cannot delegate to ${params.agent}. Specialists: ${DELEGATABLE_AGENTS.join(", ")}`);
			}
			const msc: MatterSafetyContract = {
				...record.msc,
				autonomyLevel: (params.autonomyLevel as AutonomyLevel | undefined) ?? record.msc.autonomyLevel,
			};
			const now = new Date().toISOString();
			const task: Task = {
				id: store.nextTaskId(matter),
				matter,
				agent: params.agent,
				title: params.title,
				instructions: params.instructions,
				msc,
				status: "pending",
				createdAt: now,
				updatedAt: now,
			};
			store.saveTask(task);
			const finished = await ctx.runSpecialist(task);
			if (finished.status === "completed" && finished.report) {
				const gates = finished.report.gatesRequested?.length
					? `\nGates requested: ${finished.report.gatesRequested.join("; ")}`
					: "";
				return text(
					`Task ${finished.id} completed by ${finished.agent}.\nSummary: ${finished.report.summary}\nArtifacts: ${finished.report.artifactPaths.join(", ") || "(none)"}${gates}`,
				);
			}
			if (finished.status === "escalated" && finished.escalation) {
				return text(
					`Task ${finished.id} ESCALATED by ${finished.agent}.\nReason: ${finished.escalation.reason}\nMissing inputs: ${finished.escalation.missingInputs.join("; ") || "(unspecified)"}`,
				);
			}
			return text(
				`Task ${finished.id} ended with status ${finished.status}${finished.failure ? `: ${finished.failure}` : ""}.`,
			);
		},
	});

	const checkStatus = defineTool({
		name: "check_status",
		label: "Check Status",
		description: "List the tasks of a matter with their statuses.",
		parameters: Type.Object({
			matter: Type.Optional(Type.String({ description: "Matter slug (default: current matter)" })),
		}),
		execute: async (_id, params) => {
			const matter = params.matter ?? ctx.getCurrentMatter();
			if (!matter) return text("No matter selected.");
			const tasks = ctx.store.listTasks(matter);
			if (tasks.length === 0) return text(`No tasks recorded for matter ${matter}.`);
			return text(tasks.map((t) => `${t.id} [${t.status}] ${t.agent} — ${t.title}`).join("\n"));
		},
	});

	const readReport = defineTool({
		name: "read_report",
		label: "Read Report",
		description: "Read the stored report/escalation of one task.",
		parameters: Type.Object({
			taskId: Type.String(),
			matter: Type.Optional(Type.String({ description: "Matter slug (default: current matter)" })),
		}),
		execute: async (_id, params) => {
			const matter = params.matter ?? ctx.getCurrentMatter();
			if (!matter) return text("No matter selected.");
			const task = ctx.store.getTask(matter, params.taskId);
			if (!task) return text(`No task ${params.taskId} in matter ${matter}.`);
			return text(JSON.stringify(task, null, "\t"));
		},
	});

	const askLawyer = defineTool({
		name: "ask_lawyer",
		label: "Ask Lawyer",
		description:
			"Ask the supervising attorney one short plain-English question on the terminal (intake decisions, source choices, safe defaults). Not for hard gates — those are enforced inside the side-effectful tools.",
		parameters: Type.Object({
			question: Type.String({ description: "One short question, with the safe default stated" }),
		}),
		executionMode: "sequential",
		execute: async (_id, params) => {
			const answer = await askHuman(`\n\x1b[36m[legal-ops-supervisor asks]\x1b[0m ${params.question}\n> `);
			return text(answer.trim() || "(no answer — use the safe default)");
		},
	});

	return [createMatter, delegate, checkStatus, readReport, askLawyer];
}
