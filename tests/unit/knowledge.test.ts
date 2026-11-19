import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThesisDB } from "../../src/main/db";
import { AiAssistService } from "../../src/main/ai-assist-service";

describe("项目知识汇总（AI 统一上下文）", () => {
  let dir: string;
  let dbPath: string;
  let db: ThesisDB;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-know-"));
    dbPath = path.join(dir, "test.db");
    db = new ThesisDB(dbPath);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("汇总包含第 0 项信息、各阶段内容、假设与文献", () => {
    const service = new AiAssistService(db, undefined as never);
    const p = db.createProject({ name: "汇总测试", disciplines: ["电子商务"], researchMethod: "questionnaire", educationLevel: "硕士", deadline: "2027-06-30", materials: { title: "已有题目A", literature: "", data: "", draft: "", notes: "" } });
    const pid = p.project.id;
    db.setStageContent(pid, "design", "research_question", "互动性如何影响购买意愿？");
    db.replaceHypotheses(pid, [{ number: "H1", statement: "互动性正向影响购买意愿", iv: "互动性", dv: "购买意愿", basis: "待核验" }]);
    db.insertLiterature({ projectId: pid, title: "Live Streaming Commerce", authors: "Li", year: "2023", venue: "J.", doi: "10.1/x", url: "https://example.org", abstract: "摘要", source: "crossref", verifiedStatus: "verified", verifiedNote: "", fulltextStatus: "abstract_only", pdfName: "", preprint: false });

    const text = service.buildProjectKnowledge(pid);
    expect(text).toContain("汇总测试");
    expect(text).toContain("电子商务");
    expect(text).toContain("硕士");
    expect(text).toContain("已有题目A");
    expect(text).toContain("互动性如何影响购买意愿？");
    expect(text).toContain("H1：互动性正向影响购买意愿");
    expect(text).toContain("Live Streaming Commerce");
  });
});
