import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { companies, companySkills, createDb } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { companySkillService } from "../services/company-skills.ts";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres company skill service tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("companySkillService.list", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof companySkillService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const cleanupDirs = new Set<string>();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-company-skills-service-");
    db = createDb(tempDb.connectionString);
    svc = companySkillService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(companySkills);
    await db.delete(companies);
    await Promise.all(Array.from(cleanupDirs, (dir) => fs.rm(dir, { recursive: true, force: true })));
    cleanupDirs.clear();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("lists skills without exposing markdown content", async () => {
    const companyId = randomUUID();
    const skillId = randomUUID();
    const skillDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-heavy-skill-"));
    cleanupDirs.add(skillDir);
    await fs.writeFile(path.join(skillDir, "SKILL.md"), "# Heavy Skill\n", "utf8");

    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(companySkills).values({
      id: skillId,
      companyId,
      key: `company/${companyId}/heavy-skill`,
      slug: "heavy-skill",
      name: "Heavy Skill",
      description: "Large skill used for list projection regression coverage.",
      markdown: `# Heavy Skill\n\n${"x".repeat(250_000)}`,
      sourceType: "local_path",
      sourceLocator: skillDir,
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      metadata: { sourceKind: "local_path" },
    });

    const listed = await svc.list(companyId);
    const skill = listed.find((entry) => entry.id === skillId);

    expect(skill).toBeDefined();
    expect(skill).not.toHaveProperty("markdown");
    expect(skill).toMatchObject({
      id: skillId,
      key: `company/${companyId}/heavy-skill`,
      slug: "heavy-skill",
      name: "Heavy Skill",
      sourceType: "local_path",
      sourceLocator: skillDir,
      attachedAgentCount: 0,
      sourceBadge: "local",
      editable: true,
    });
  });

  it("rejects skill inventory refresh for a missing company", async () => {
    await expect(svc.list(randomUUID())).rejects.toMatchObject({
      status: 404,
      message: "Company not found",
    });
  });

  it("resolves canonical slugs and deprecated aliases to the same skill key", async () => {
    const companyId = randomUUID();
    const skillKey = `company/${companyId}/legacy-legal-research`;
    await db.insert(companies).values({
      id: companyId,
      name: "Legal Team",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companySkills).values({
      companyId,
      key: skillKey,
      slug: "legal-research",
      name: "Legal Research",
      markdown: "# Legal Research\n",
      sourceType: "catalog",
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      metadata: {
        sourceKind: "catalog",
        aliases: ["lexis-browseros-legal-research"],
      },
    });

    await expect(svc.resolveRequestedSkillKeys(companyId, ["legal-research"]))
      .resolves.toEqual([skillKey]);
    await expect(svc.resolveRequestedSkillKeys(companyId, ["lexis-browseros-legal-research"]))
      .resolves.toEqual([skillKey]);
  });

  it("upgrades an aliased skill in place during package import", async () => {
    const companyId = randomUUID();
    const skillId = randomUUID();
    const legacyKey = `company/${companyId}/lexis-browseros-legal-research`;
    await db.insert(companies).values({
      id: companyId,
      name: "Legal Team",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companySkills).values({
      id: skillId,
      companyId,
      key: legacyKey,
      slug: "lexis-browseros-legal-research",
      name: "Legacy Research",
      markdown: "# Legacy Research\n",
      sourceType: "catalog",
      trustLevel: "markdown_only",
      compatibility: "compatible",
      fileInventory: [{ path: "SKILL.md", kind: "skill" }],
      metadata: { sourceKind: "catalog", skillKey: legacyKey },
    });

    const result = await svc.importPackageFiles(companyId, {
      "skills/legal-research/SKILL.md": [
        "---",
        "slug: legal-research",
        "name: Legal Research",
        "description: Source-backed legal research and authority analysis.",
        "aliases:",
        "  - lexis-browseros-legal-research",
        "---",
        "",
        "# Legal Research",
        "",
      ].join("\n"),
    }, { onConflict: "replace" });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      action: "updated",
      originalSlug: "legal-research",
      requestedRefs: expect.arrayContaining([
        "legal-research",
        "lexis-browseros-legal-research",
      ]),
      skill: {
        id: skillId,
        key: legacyKey,
        slug: "legal-research",
        name: "Legal Research",
      },
    });
    expect(result[0]?.skill.metadata).toMatchObject({
      aliases: ["lexis-browseros-legal-research"],
      skillKey: legacyKey,
    });
    await expect(svc.resolveRequestedSkillKeys(companyId, ["lexis-browseros-legal-research"]))
      .resolves.toEqual([legacyKey]);
  });

  it("rejects an alias that resolves to multiple installed skills", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Legal Team",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companySkills).values([
      {
        companyId,
        key: `company/${companyId}/research-one`,
        slug: "research-one",
        name: "Research One",
        markdown: "# Research One\n",
        sourceType: "catalog",
        metadata: { sourceKind: "catalog", aliases: ["legacy-research"] },
      },
      {
        companyId,
        key: `company/${companyId}/research-two`,
        slug: "research-two",
        name: "Research Two",
        markdown: "# Research Two\n",
        sourceType: "catalog",
        metadata: { sourceKind: "catalog", aliases: ["legacy-research"] },
      },
    ]);

    await expect(svc.resolveRequestedSkillKeys(companyId, ["legacy-research"]))
      .rejects.toMatchObject({
        status: 422,
        message: "Invalid company skill selection (ambiguous references: legacy-research).",
      });
  });

  it("rejects an in-place upgrade when canonical and alias references match different skills", async () => {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Legal Team",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(companySkills).values([
      {
        companyId,
        key: `company/${companyId}/legal-research`,
        slug: "legal-research",
        name: "Canonical Research",
        markdown: "# Canonical Research\n",
        sourceType: "catalog",
      },
      {
        companyId,
        key: `company/${companyId}/legacy-research`,
        slug: "lexis-browseros-legal-research",
        name: "Legacy Research",
        markdown: "# Legacy Research\n",
        sourceType: "catalog",
      },
    ]);

    await expect(svc.importPackageFiles(companyId, {
      "skills/legal-research/SKILL.md": [
        "---",
        "slug: legal-research",
        "name: Legal Research",
        "aliases:",
        "  - lexis-browseros-legal-research",
        "---",
        "",
        "# Legal Research",
        "",
      ].join("\n"),
    }, { onConflict: "replace" })).rejects.toMatchObject({
      status: 422,
      message: "Skill legal-research references match different installed skills.",
    });
  });
});
