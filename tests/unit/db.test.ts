import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThesisDB } from "../../src/main/db";
import type { ExistingMaterials } from "../../src/shared/types";
import { STAGES } from "../../src/shared/stages";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "tw-test-"));
  dbPath = path.join(dir, "test.db");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const materials = (): ExistingMaterials => ({ title: "", literature: "", data: "", draft: "", notes: "" });

describe("SQLite 持久化层", () => {
  it("创建项目后生成全部 13 个阶段，建立阶段已完成", () => {
    const db = new ThesisDB(dbPath);
    const d = db.createProject({ name: "测试项目", disciplines: ["化学与材料"], researchMethod: "chemistry-experiment", educationLevel: "本科", deadline: "", materials: materials() });
    expect(d.stages.length).toBe(13);
    expect(d.stages.find((s) => s.stageKey === "establish")?.status).toBe("done");
    db.close();
  });

  it("带题目进入：选题阶段标记跳过，从研究设计开始", () => {
    const db = new ThesisDB(dbPath);
    const d = db.createProject({ name: "带题进入", disciplines: ["电子商务"], researchMethod: "questionnaire", educationLevel: "本科", deadline: "", materials: { ...materials(), title: "直播互动性对购买意愿的影响" } });
    expect(d.stages.find((s) => s.stageKey === "topic")?.status).toBe("skipped");
    expect(d.stages.find((s) => s.stageKey === "design")?.status).toBe("in_progress");
    db.close();
  });

  it("内容保存后，关闭并重新打开数据库仍能恢复（持久化验证）", () => {
    const db = new ThesisDB(dbPath);
    const created = db.createProject({ name: "持久化验证", disciplines: ["人工智能与计算机"], researchMethod: "ai-algorithm", educationLevel: "本科", deadline: "", materials: materials() });
    db.setStageContent(created.project.id, "design", "task", "图像分类");
    db.setStageContent(created.project.id, "design", "baselines", "ResNet-50");
    db.setStageStatus(created.project.id, "design", "done", "");
    db.close();

    // 重新打开同一个数据库文件
    const db2 = new ThesisDB(dbPath);
    const loaded = db2.getProjectDetail(created.project.id);
    expect(loaded.content.design.task).toBe("图像分类");
    expect(loaded.content.design.baselines).toBe("ResNet-50");
    expect(loaded.stages.find((s) => s.stageKey === "design")?.status).toBe("done");
    expect(loaded.project.name).toBe("持久化验证");
    db2.close();
  });

  it("删除项目会级联清理阶段与内容", () => {
    const db = new ThesisDB(dbPath);
    const d = db.createProject({ name: "待删除", disciplines: ["化学与材料"], researchMethod: "chemistry-experiment", educationLevel: "本科", deadline: "", materials: materials() });
    db.deleteProject(d.project.id);
    expect(db.listProjects().length).toBe(0);
    // 阶段与内容表应无残留（通过重建 detail 抛错验证项目不存在）
    expect(() => db.getProjectDetail(d.project.id)).toThrow();
    db.close();
  });

  it("阶段状态可跳过并恢复", () => {
    const db = new ThesisDB(dbPath);
    const d = db.createProject({ name: "跳过恢复", disciplines: ["化学与材料"], researchMethod: "chemistry-experiment", educationLevel: "本科", deadline: "", materials: materials() });
    db.setStageStatus(d.project.id, "proposal", "skipped", "学校不要求开题");
    let detail = db.getProjectDetail(d.project.id);
    expect(detail.stages.find((s) => s.stageKey === "proposal")?.skipReason).toBe("学校不要求开题");
    db.setStageStatus(d.project.id, "proposal", "not_started", "");
    detail = db.getProjectDetail(d.project.id);
    expect(detail.stages.find((s) => s.stageKey === "proposal")?.status).toBe("not_started");
    db.close();
  });
});
