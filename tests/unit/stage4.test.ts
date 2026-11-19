import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThesisDB } from "../../src/main/db";

describe("阶段 4 数据层（版本、候选方向、假设卡片）", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-stage4-"));
    dbPath = path.join(dir, "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("版本号递增且内容可恢复", () => {
    const db = new ThesisDB(dbPath);
    const v1 = db.saveStageVersion("p1", "design", JSON.stringify({ fields: { a: "1" } }), "初稿");
    const v2 = db.saveStageVersion("p1", "design", JSON.stringify({ fields: { a: "2" } }), "改变量后");
    expect(v1).toBe(1);
    expect(v2).toBe(2);
    const list = db.listStageVersions("p1", "design");
    expect(list.length).toBe(2);
    expect(list[0].versionNo).toBe(2);
    const byId = db.getStageVersion(list[1].id);
    expect(byId?.versionNo).toBe(1);
    expect(byId?.contentJson).toContain('"a":"1"');
    db.close();
  });

  it("候选方向与假设卡片持久化", () => {
    const db = new ThesisDB(dbPath);
    db.insertTopicCandidate({ projectId: "p1", question: "问题A", basisLitIds: ["lit1", "lit2"], dataPath: "问卷", feasibility: "可行", limitations: "横截面", aiGenerated: true });
    const cands = db.listTopicCandidates("p1");
    expect(cands.length).toBe(1);
    expect(cands[0].basisLitIds).toEqual(["lit1", "lit2"]);
    expect(cands[0].aiGenerated).toBe(true);

    db.replaceHypotheses("p1", [
      { number: "H1", statement: "A 正向影响 B", iv: "A", dv: "B", basis: "文献" },
      { number: "H2", statement: "C 调节 A→B", iv: "C", dv: "B", basis: "待核验" },
    ]);
    const hyps = db.listHypotheses("p1");
    expect(hyps.length).toBe(2);
    expect(hyps[0].number).toBe("H1");
    db.replaceHypotheses("p1", [{ number: "H1", statement: "新", iv: "A", dv: "B", basis: "" }]);
    expect(db.listHypotheses("p1").length).toBe(1);
    db.close();
  });

  it("删除项目级联删除阶段 4 数据", () => {
    const db = new ThesisDB(dbPath);
    const project = db.createProject({ name: "p", disciplines: ["电子商务"], researchMethod: "questionnaire", educationLevel: "本科", deadline: "", materials: { title: "", literature: "", data: "", draft: "", notes: "" } });
    db.saveStageVersion(project.project.id, "design", "{}", "");
    db.insertTopicCandidate({ projectId: project.project.id, question: "q", basisLitIds: [], dataPath: "", feasibility: "", limitations: "", aiGenerated: false });
    db.replaceHypotheses(project.project.id, [{ number: "H1", statement: "s", iv: "", dv: "", basis: "" }]);
    db.deleteProject(project.project.id);
    expect(db.listStageVersions(project.project.id, "design").length).toBe(0);
    expect(db.listTopicCandidates(project.project.id).length).toBe(0);
    expect(db.listHypotheses(project.project.id).length).toBe(0);
    db.close();
  });
});
