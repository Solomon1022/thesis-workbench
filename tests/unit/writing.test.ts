import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThesisDB } from "../../src/main/db";
import { buildMaterials, retrieve, WRITING_SYSTEM_PROMPT } from "../../src/main/writing-service";

describe("写作管线：提示词与精准检索", () => {
  it("系统提示词包含正文/引用/gap 约束且禁止「待核验」占位", () => {
    expect(WRITING_SYSTEM_PROMPT).toContain("接地，而非编造；写出，而非回避");
    expect(WRITING_SYSTEM_PROMPT).toContain("句末用 [@source_id] 标注来源");
    expect(WRITING_SYSTEM_PROMPT).toContain("gaps 数组");
    expect(WRITING_SYSTEM_PROMPT).toContain("禁止写「待核验」「需进一步验证」这类占位废话");
    expect(WRITING_SYSTEM_PROMPT).toContain("不得伪造 source_id");
  });

  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-write-"));
    dbPath = path.join(dir, "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("检索：标题命中优先于无关文献；证据卡片命中可入材料清单", () => {
    const db = new ThesisDB(dbPath);
    const p = db.createProject({ name: "p", disciplines: ["电子商务"], researchMethod: "questionnaire", educationLevel: "本科", deadline: "", materials: { title: "", literature: "", data: "", draft: "", notes: "" } });
    const pid = p.project.id;
    db.insertLiterature({ projectId: pid, title: "Live Streaming Commerce and Consumer Purchase Intention", authors: "Li, W.", year: "2023", venue: "J. Retail", doi: "10.1/a", url: "https://example.org/a", abstract: "This paper examines how live streaming interaction affects purchase intention.", source: "crossref", verifiedStatus: "verified", verifiedNote: "", fulltextStatus: "abstract_only", pdfName: "", preprint: false });
    const lit2 = db.insertLiterature({ projectId: pid, title: "Quantum Chromodynamics", authors: "X", year: "2000", venue: "Phys.", doi: "10.1/b", url: "https://example.org/b", abstract: "Quarks and gluons.", source: "crossref", verifiedStatus: "verified", verifiedNote: "", fulltextStatus: "abstract_only", pdfName: "", preprint: false });
    db.insertEvidence(pid, lit2.id, "直播互动显著影响购买意愿", "第 3 页");

    // 中文查询：命中文标题（中文滑窗）与证据卡片
    const hits1 = retrieve(pid, "直播互动 购买意愿", 5, db);
    expect(hits1.length).toBeGreaterThan(0);

    // 英文查询：命中直播文献而非量子色动力学
    const hits2 = retrieve(pid, "live streaming purchase intention", 5, db);
    expect(hits2.length).toBeGreaterThan(0);
    expect(hits2[0].title).toContain("Live Streaming Commerce");
    for (const h of hits2) expect(h.title).not.toContain("Quantum");

    // refId 连续
    expect(hits2[0].refId).toBe("ref_1");
    db.close();
  });

  it("buildMaterials：拼出【材料清单】且包含真实标题", () => {
    const db = new ThesisDB(dbPath);
    const p = db.createProject({ name: "p", disciplines: ["电子商务"], researchMethod: "questionnaire", educationLevel: "本科", deadline: "", materials: { title: "", literature: "", data: "", draft: "", notes: "" } });
    const pid = p.project.id;
    db.insertLiterature({ projectId: pid, title: "Attention is all you need", authors: "Vaswani et al.", year: "2017", venue: "NeurIPS", doi: "10.5555/x", url: "https://example.org/x", abstract: "The Transformer architecture.", source: "crossref", verifiedStatus: "verified", verifiedNote: "", fulltextStatus: "abstract_only", pdfName: "", preprint: false });
    const hits = retrieve(pid, "attention transformer", 5, db);
    const materials = buildMaterials(hits);
    expect(materials).toContain("【材料清单】");
    expect(materials).toContain("Attention is all you need");
    expect(materials).toContain("[ref_1]");
    expect(buildMaterials([])).toContain("文献库为空");
    db.close();
  });
});
