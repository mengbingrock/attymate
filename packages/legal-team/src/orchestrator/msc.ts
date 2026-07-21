/**
 * Matter Safety Contract — the scoping object every delegated task carries.
 * Ported from the source company's matter-safety-contract reference: it names
 * the matter root, the only writable output root, autonomy level, approval
 * profile, read-only source roots, forbidden roots, and gate state.
 */

export type AutonomyLevel = "safe-draft-only" | "supervised-tools" | "approved-external-actions";
export type ApprovalProfile = "live" | "sandbox_autopilot";

/** Hard gates that always require visible human approval before acting. */
export type RedGate = "gmail_send" | "calendar_create_event";

export interface MatterSafetyContract {
	matterRoot: string;
	outputRoot: string;
	workflowType: string;
	autonomyLevel: AutonomyLevel;
	approvalProfile: ApprovalProfile;
	readOnlyRoots: string[];
	forbiddenRoots: string[];
	allowedOutputs: string[];
	learningMode: "off" | "scoped";
	approvedGates: RedGate[];
}

export interface MatterRecord {
	matter: string;
	label: string;
	createdAt: string;
	msc: MatterSafetyContract;
	dashboard?: string;
}

export function defaultMsc(matterRoot: string, outputRoot: string): MatterSafetyContract {
	return {
		matterRoot,
		outputRoot,
		workflowType: "general-litigation-support",
		autonomyLevel: "safe-draft-only",
		approvalProfile: "live",
		readOnlyRoots: [matterRoot],
		forbiddenRoots: [],
		allowedOutputs: ["drafts", "task reports", "artifacts"],
		learningMode: "off",
		approvedGates: [],
	};
}

export function describeMsc(msc: MatterSafetyContract): string {
	return [
		"Matter Safety Contract:",
		`- matter root (read scope): ${msc.matterRoot}`,
		`- output root (only writable location): ${msc.outputRoot}`,
		`- workflow type: ${msc.workflowType}`,
		`- autonomy level: ${msc.autonomyLevel}`,
		`- approval profile: ${msc.approvalProfile}`,
		`- read-only source roots: ${msc.readOnlyRoots.join(", ") || "(none)"}`,
		`- forbidden roots (never read or write): ${msc.forbiddenRoots.join(", ") || "(none)"}`,
		`- allowed outputs: ${msc.allowedOutputs.join(", ")}`,
		`- learning mode: ${msc.learningMode}`,
		`- hard gates pre-approved: ${msc.approvedGates.join(", ") || "none"}`,
	].join("\n");
}
