import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { LegalTeamConfig } from "../src/config.ts";
import { collectUnroutedReports } from "../src/monitors/monitor-run.ts";

const root = mkdtempSync(join(tmpdir(), "legal-team-monitors-"));
const config = {
	workspaceRoot: root,
	timezone: "America/Los_Angeles",
	approvalMode: "auto-deny",
	taskTimeoutSec: 1200,
	agents: {},
	monitors: {
		gmail: { enabled: false, cron: "0 8-18 * * 1-5", maxResults: 25 },
		calendar: { enabled: false, cron: "0 8 * * 1-5", lookaheadDays: 30 },
	},
	google: { secretsDir: join(root, "secrets") },
	piAgentDir: join(root, ".pi"),
} satisfies LegalTeamConfig;

after(() => rmSync(root, { recursive: true, force: true }));

test("unrouted reports surface once and the cursor advances", () => {
	const reports = join(root, "monitors", "gmail", "reports");
	mkdirSync(reports, { recursive: true });
	writeFileSync(join(reports, "2026-07-21T08-00-00-000Z.md"), "# Monitor report\n\nOne new filing email.\n");

	const first = collectUnroutedReports(config);
	assert.ok(first.text?.includes("One new filing email"));
	first.markSeen();

	const second = collectUnroutedReports(config);
	assert.equal(second.text, undefined);

	writeFileSync(join(reports, "2026-07-21T09-00-00-000Z.md"), "# Monitor report\n\nAnother candidate.\n");
	const third = collectUnroutedReports(config);
	assert.ok(third.text?.includes("Another candidate"));
	assert.ok(!third.text?.includes("One new filing email"), "already-routed report resurfaced");
});
