import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MatterRecord, MatterSafetyContract } from "./msc.ts";

export type TaskStatus = "pending" | "running" | "awaiting_approval" | "completed" | "escalated" | "failed";

export interface TaskReport {
	summary: string;
	artifactPaths: string[];
	gatesRequested?: string[];
}

export interface Task {
	id: string;
	matter: string;
	parentTaskId?: string;
	agent: string;
	title: string;
	instructions: string;
	msc: MatterSafetyContract;
	status: TaskStatus;
	createdAt: string;
	updatedAt: string;
	report?: TaskReport;
	escalation?: { reason: string; missingInputs: string[] };
	failure?: string;
	sessionFile?: string;
}

/**
 * File-backed task + matter store under `<workspace>/runs/<matter>/`.
 * Writes are atomic (tmp + rename) so a crashed run never leaves a torn JSON.
 */
export class FileTaskStore {
	private readonly runsRoot: string;

	constructor(runsRoot: string) {
		this.runsRoot = runsRoot;
	}

	private matterDir(matter: string): string {
		return join(this.runsRoot, matter);
	}

	private tasksDir(matter: string): string {
		return join(this.matterDir(matter), "tasks");
	}

	private writeJson(path: string, value: unknown): void {
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(value, null, "\t")}\n`);
		renameSync(tmp, path);
	}

	createMatter(record: MatterRecord): void {
		const dir = this.matterDir(record.matter);
		mkdirSync(join(dir, "tasks"), { recursive: true });
		mkdirSync(join(dir, "artifacts"), { recursive: true });
		mkdirSync(join(dir, "sessions"), { recursive: true });
		this.writeJson(join(dir, "matter.json"), record);
	}

	getMatter(matter: string): MatterRecord | undefined {
		try {
			return JSON.parse(readFileSync(join(this.matterDir(matter), "matter.json"), "utf-8")) as MatterRecord;
		} catch {
			return undefined;
		}
	}

	listMatters(): string[] {
		try {
			return readdirSync(this.runsRoot, { withFileTypes: true })
				.filter((e) => e.isDirectory())
				.map((e) => e.name);
		} catch {
			return [];
		}
	}

	nextTaskId(matter: string): string {
		const seq = this.listTasks(matter).length + 1;
		return `T-${matter}-${String(seq).padStart(3, "0")}`;
	}

	saveTask(task: Task): void {
		mkdirSync(this.tasksDir(task.matter), { recursive: true });
		task.updatedAt = new Date().toISOString();
		this.writeJson(join(this.tasksDir(task.matter), `${task.id}.json`), task);
	}

	getTask(matter: string, taskId: string): Task | undefined {
		try {
			return JSON.parse(readFileSync(join(this.tasksDir(matter), `${taskId}.json`), "utf-8")) as Task;
		} catch {
			return undefined;
		}
	}

	listTasks(matter: string): Task[] {
		try {
			return readdirSync(this.tasksDir(matter))
				.filter((f) => f.endsWith(".json") && !f.endsWith(".approvals.json"))
				.map((f) => JSON.parse(readFileSync(join(this.tasksDir(matter), f), "utf-8")) as Task)
				.sort((a, b) => a.id.localeCompare(b.id));
		} catch {
			return [];
		}
	}

	artifactsDir(matter: string, taskId: string): string {
		const dir = join(this.matterDir(matter), "artifacts", taskId);
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	sessionsDir(matter: string): string {
		const dir = join(this.matterDir(matter), "sessions");
		mkdirSync(dir, { recursive: true });
		return dir;
	}

	appendApproval(matter: string, taskId: string, entry: Record<string, unknown>): void {
		mkdirSync(this.tasksDir(matter), { recursive: true });
		const path = join(this.tasksDir(matter), `${taskId}.approvals.jsonl`);
		writeFileSync(path, `${JSON.stringify(entry)}\n`, { flag: "a" });
	}
}
