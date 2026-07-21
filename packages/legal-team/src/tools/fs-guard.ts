import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import {
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { MatterSafetyContract } from "../orchestrator/msc.ts";

/**
 * Resolve a tool path argument the way the built-in tools do (relative to the
 * session cwd), then follow symlinks on the nearest existing ancestor so a
 * link cannot smuggle a write outside the allowed root.
 */
function canonicalize(rawPath: string, cwd: string): string {
	const absolute = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
	let probe = absolute;
	const suffix: string[] = [];
	while (!existsSync(probe)) {
		const parent = dirname(probe);
		if (parent === probe) break;
		suffix.unshift(probe.slice(parent.length + 1));
		probe = parent;
	}
	const real = existsSync(probe) ? realpathSync(probe) : probe;
	return suffix.length > 0 ? resolve(real, ...suffix) : real;
}

function isInside(path: string, root: string): boolean {
	const rel = relative(resolve(root), path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function guardWrite(path: string, cwd: string, msc: MatterSafetyContract): void {
	const target = canonicalize(path, cwd);
	// Canonicalize the contract roots too: on macOS /var and /tmp are symlinks
	// (/var -> /private/var), so comparing a realpathed target against a raw
	// root both falsely blocks in-scope writes and misses forbidden reads.
	if (!isInside(target, canonicalize(msc.outputRoot, cwd))) {
		throw new Error(
			`Matter Safety Contract violation: write target ${target} is outside the output root ${msc.outputRoot}. ` +
				"Writes are only allowed under the output root; escalate if you believe this file is in scope.",
		);
	}
	for (const forbidden of msc.forbiddenRoots) {
		if (isInside(target, canonicalize(forbidden, cwd))) {
			throw new Error(`Matter Safety Contract violation: ${target} is inside forbidden root ${forbidden}.`);
		}
	}
}

function guardRead(path: string, cwd: string, msc: MatterSafetyContract): void {
	const target = canonicalize(path, cwd);
	for (const forbidden of msc.forbiddenRoots) {
		if (isInside(target, canonicalize(forbidden, cwd))) {
			throw new Error(
				`Matter Safety Contract violation: ${target} is inside forbidden root ${forbidden}. ` +
					"Never inspect other matters or protected roots.",
			);
		}
	}
}

type PathParams = { path?: string; file_path?: string };

function wrapPathGuard(tool: ToolDefinition<any, any>, check: (path: string) => void): ToolDefinition<any, any> {
	const execute: ToolDefinition<any, any>["execute"] = async (toolCallId, params, signal, onUpdate, ctx) => {
		const p = params as PathParams;
		const rawPath = p.file_path ?? p.path;
		if (typeof rawPath === "string") check(rawPath);
		return tool.execute(toolCallId, params, signal, onUpdate, ctx);
	};
	return { ...tool, execute };
}

/**
 * Build the MSC-guarded file tool set for a specialist session.
 *
 * - read/grep/find/ls operate from the matter root; read is checked against
 *   forbidden roots (grep/find/ls stay cwd-scoped by construction).
 * - write/edit are wrapped so every target must canonicalize under the MSC
 *   output root; bash is only present at `supervised-tools` and above, and is
 *   governed by prompt-level discipline rather than path checks.
 * - monitors and safe-draft-only sessions never receive bash.
 */
export function createGuardedFileTools(cwd: string, msc: MatterSafetyContract): ToolDefinition<any, any>[] {
	const tools: ToolDefinition<any, any>[] = [
		wrapPathGuard(createReadToolDefinition(cwd), (p) => guardRead(p, cwd, msc)),
		createGrepToolDefinition(cwd),
		createFindToolDefinition(cwd),
		createLsToolDefinition(cwd),
		wrapPathGuard(createWriteToolDefinition(cwd), (p) => guardWrite(p, cwd, msc)),
		wrapPathGuard(createEditToolDefinition(cwd), (p) => guardWrite(p, cwd, msc)),
	];
	return tools;
}

export function createReadOnlyFileTools(cwd: string, msc?: MatterSafetyContract): ToolDefinition<any, any>[] {
	const readTool = createReadToolDefinition(cwd);
	return [
		msc ? wrapPathGuard(readTool, (p) => guardRead(p, cwd, msc)) : readTool,
		createGrepToolDefinition(cwd),
		createFindToolDefinition(cwd),
		createLsToolDefinition(cwd),
	];
}
