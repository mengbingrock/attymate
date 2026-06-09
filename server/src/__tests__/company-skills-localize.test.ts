import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { agents, companies, companySkills, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companySkillService } from "../services/company-skills.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres skill localization tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("company skill localization", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof companySkillService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const originalPaperclipHome = process.env.PAPERCLIP_HOME;
  const originalInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
  const cleanupDirs = new Set<string>();
  let paperclipHome = "";

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-skill-localize-");
    db = createDb(tempDb.connectionString);
    svc = companySkillService(db);
  }, 20_000);

  beforeEach(async () => {
    paperclipHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-skill-localize-home-"));
    cleanupDirs.add(paperclipHome);
    process.env.PAPERCLIP_HOME = paperclipHome;
    process.env.PAPERCLIP_INSTANCE_ID = "test-instance";
  });

  afterEach(async () => {
    if (originalPaperclipHome === undefined) delete process.env.PAPERCLIP_HOME;
    else process.env.PAPERCLIP_HOME = originalPaperclipHome;
    if (originalInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = originalInstanceId;
    await db.delete(agents);
    await db.delete(companySkills);
    await db.delete(companies);
    await Promise.all([...cleanupDirs].map((dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    return companyId;
  }

  async function seedCatalogSkill(companyId: string, markdown = "# Survey Protocol\n") {
    const skillId = randomUUID();
    await db.insert(companySkills).values({
      id: skillId,
      companyId,
      key: `catalog/${companyId}/audience-survey-protocol`,
      slug: "audience-survey-protocol",
      name: "Audience Survey Protocol",
      description: null,
      markdown,
      sourceType: "catalog",
      sourceLocator: "paperclip://catalog/audience-survey-protocol",
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      metadata: { sourceKind: "catalog" },
    });
    return skillId;
  }

  it("localizes a catalog skill on detail() — becomes editable local_path on disk", async () => {
    const companyId = await seedCompany();
    const skillId = await seedCatalogSkill(companyId);

    const detail = await svc.detail(companyId, skillId);
    expect(detail?.editable).toBe(true);
    expect(detail?.editableReason).toBeNull();

    const [row] = await db
      .select()
      .from(companySkills)
      .where(eq(companySkills.id, skillId));
    expect(row.sourceType).toBe("local_path");
    expect((row.metadata as Record<string, unknown>).localized).toBe(true);
    expect((row.metadata as Record<string, unknown>).originalSourceType).toBe("catalog");
    expect(row.sourceLocator).toContain(path.join("skills", companyId));

    const onDisk = await fs.readFile(path.join(row.sourceLocator!, "SKILL.md"), "utf8");
    expect(onDisk).toContain("Survey Protocol");
  });

  it("updateFile persists to disk AND DB markdown for a previously-catalog skill", async () => {
    const companyId = await seedCompany();
    const skillId = await seedCatalogSkill(companyId);

    const updated = await svc.updateFile(companyId, skillId, "SKILL.md", "---\nname: Renamed\n---\n# Edited\n");
    expect(updated.content).toContain("# Edited");

    const [row] = await db.select().from(companySkills).where(eq(companySkills.id, skillId));
    expect(row.sourceType).toBe("local_path");
    expect(row.markdown).toContain("# Edited");
    const onDisk = await fs.readFile(path.join(row.sourceLocator!, "SKILL.md"), "utf8");
    expect(onDisk).toContain("# Edited");
  });

  it("localization is idempotent and does not clobber edits", async () => {
    const companyId = await seedCompany();
    const skillId = await seedCatalogSkill(companyId);

    await svc.detail(companyId, skillId);
    await svc.updateFile(companyId, skillId, "SKILL.md", "# My edit\n");
    // Second access must NOT re-materialize over the edit.
    await svc.detail(companyId, skillId);

    const file = await svc.readFile(companyId, skillId, "SKILL.md");
    expect(file?.content).toContain("# My edit");
  });

  it("self-heals a localized skill whose managed dir was deleted (no DB delete)", async () => {
    const companyId = await seedCompany();
    const skillId = await seedCatalogSkill(companyId, "# Heal Me\n");

    await svc.detail(companyId, skillId); // localize
    const [row] = await db.select().from(companySkills).where(eq(companySkills.id, skillId));
    await fs.rm(row.sourceLocator!, { recursive: true, force: true });

    // ensureSkillInventoryCurrent runs prune; localized rows must survive + restore.
    const detail = await svc.detail(companyId, skillId);
    expect(detail).not.toBeNull();
    expect(detail?.editable).toBe(true);
    const healed = await fs.readFile(path.join(row.sourceLocator!, "SKILL.md"), "utf8");
    expect(healed).toContain("Heal Me");
  });
});
