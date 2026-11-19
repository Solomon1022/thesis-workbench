import { describe, expect, it } from "vitest";
import { STAGES } from "../../src/shared/stages";
import { DISCIPLINES, METHOD_TEMPLATES, fieldsFor, suggestStartStage, materialGaps } from "../../src/shared/templates";

describe("论文阶段定义", () => {
  it("包含 13 个阶段且 key 唯一", () => {
    expect(STAGES.length).toBe(13);
    expect(new Set(STAGES.map((s) => s.key)).size).toBe(13);
  });
  it("每个阶段都有目标、输入、操作、产物与检查清单", () => {
    for (const s of STAGES) {
      expect(s.goal.length).toBeGreaterThan(0);
      expect(s.inputs.length).toBeGreaterThan(0);
      expect(s.actions.length).toBeGreaterThan(0);
      expect(s.outputs.length).toBeGreaterThan(0);
      expect(s.checklist.length).toBeGreaterThan(0);
    }
  });
  it("未接入能力有明确 pending 标注（分析/文献/检索/导出等）", () => {
    const pendingKeys = STAGES.filter((s) => s.pending).map((s) => s.key);
    expect(pendingKeys).toContain("analysis");
    expect(pendingKeys).toContain("literature");
    expect(pendingKeys).toContain("topic");
  });
});

describe("研究方法模板差异", () => {
  it("三个模板在研究设计阶段的字段集不同", () => {
    const chem = fieldsFor("chemistry-experiment", "design").fields.map((f) => f.key);
    const ai = fieldsFor("ai-algorithm", "design").fields.map((f) => f.key);
    const q = fieldsFor("questionnaire", "design").fields.map((f) => f.key);
    expect(chem).toContain("samples");       // 化学：样品
    expect(chem).toContain("replicates");    // 化学：重复层级
    expect(ai).toContain("dataset_source");  // AI：数据集
    expect(ai).toContain("baselines");       // AI：基线
    expect(q).toContain("constructs");       // 问卷：理论构念
    expect(q).toContain("hypotheses");       // 问卷：假设卡片
    // 三者字段集互不完全相同
    const union = new Set([...chem, ...ai, ...q]);
    expect(union.size).toBeGreaterThan(chem.length);
    expect(union.size).toBeGreaterThan(ai.length);
    expect(union.size).toBeGreaterThan(q.length);
  });
  it("未实现方法使用通用字段并标记 isGeneric", () => {
    const r = fieldsFor("public-data", "design");
    expect(r.isGeneric).toBe(true);
    expect(r.fields.length).toBeGreaterThan(0);
  });
  it("学科列表包含理工科与电商经济", () => {
    expect(DISCIPLINES).toContain("化学与材料");
    expect(DISCIPLINES).toContain("电子商务");
    expect(DISCIPLINES).toContain("经济与管理");
  });
});

describe("已有材料进入逻辑", () => {
  it("带初稿 → 建议写作阶段；带题目 → 建议设计阶段；无材料 → 选题阶段", () => {
    expect(suggestStartStage({ title: "", literature: "", data: "", draft: "初稿内容", notes: "" }).stageKey).toBe("writing");
    expect(suggestStartStage({ title: "题目", literature: "", data: "", draft: "", notes: "" }).stageKey).toBe("design");
    expect(suggestStartStage({ title: "", literature: "", data: "", draft: "", notes: "" }).stageKey).toBe("topic");
  });
  it("缺口提示不伪造内容（有初稿时提示结果待补）", () => {
    const gaps = materialGaps({ title: "", literature: "", data: "", draft: "x", notes: "" });
    expect(gaps.join("")).toContain("待补");
  });
});
