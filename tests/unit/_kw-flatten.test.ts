import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThesisDB } from "../../src/main/db";
import { ReactSearchService } from "../../src/main/react-search";

describe("关键词拍平", () => {
  it("AI虚拟主播 延申出 虚拟主播/AI主播/虚拟数字人 等词并全部返回", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "tw-kw-"));
    const db = new ThesisDB(path.join(dir, "t.db"));
    const detail = db.createProject({ name: "AI虚拟主播的直播互动性对消费者购买意愿影响分析", disciplines: ["电子商务"], methods: ["questionnaire"], researchMethod: "questionnaire", educationLevel: "本科", deadline: "", materials: { title: "", literature: "", data: "", draft: "", notes: "" } });
    db.setStageContent(detail.project.id, "topic", "variables", JSON.stringify({ iv: ["AI虚拟主播直播互动性"], dv: ["购买意愿"], mediator: ["社会临场感"], custom: [] }));
    db.setStageContent(detail.project.id, "topic", "candidates", "AI虚拟主播的直播互动性是否显著正向影响消费者购买意愿");
    const svc = new ReactSearchService(db, { resolveRole: () => null, getContactEmail: () => "" } as never);
    const plan = await svc.planKeywords(detail.project.id);
    console.log("SUBJECT:", JSON.stringify(plan.subject));
    console.log("RESULT:", JSON.stringify(plan.result));
    console.log("QUERIES(前6):", JSON.stringify(plan.queries.slice(0, 6).map((q) => q.zh)));
    expect(plan.subject.length).toBeGreaterThanOrEqual(3);
    expect(plan.subject.join(",")).toContain("虚拟主播");
    expect(plan.subject.join(",")).toContain("AI数字人");
    expect(plan.result.join(",")).toContain("购买意愿");
    expect(plan.queries.length).toBeGreaterThan(3);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
