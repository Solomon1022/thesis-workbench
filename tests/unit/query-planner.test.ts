import { describe, expect, it } from "vitest";
import { classifyTerms, expandSubject, hardFilterPass, planLevels } from "../../src/main/query-planner";

describe("必选词拆分与扩容熔断", () => {
  it("变量优先：IV 为主体、DV 为结果、中介为变量词", () => {
    const cls = classifyTerms("AI虚拟主播的直播互动性对消费者购买意愿影响", JSON.stringify({ iv: ["直播互动性"], dv: ["购买意愿"], mediator: ["社会临场感"] }), ["AI虚拟主播", "互动性", "购买意愿"]);
    expect(cls.subject).toContain("直播互动性");
    expect(cls.result).toContain("购买意愿");
    expect(cls.mediator).toContain("社会临场感");
  });

  it("主体同义扩展剔除禁止放宽的泛词（虚拟主播 → 不含主播）", () => {
    const ex = expandSubject("虚拟主播");
    expect(ex.some((t) => t === "主播" || t === "直播")).toBe(false);
    expect(ex.length).toBeGreaterThanOrEqual(2);
  });

  it("planLevels：L0-L3 且熔断不再放宽；L3 不计核心配额", () => {
    const cls = classifyTerms("", JSON.stringify({ iv: ["虚拟主播"], dv: ["购买意愿"] }), []);
    const plans = planLevels(cls);
    const levels = plans.map((p) => p.level);
    expect(levels).toContain("L0");
    expect(levels).toContain("L1");
    expect(levels).toContain("L2");
    expect(levels).toContain("L3");
    expect(levels.filter((l) => l !== "L0" && l !== "L1" && l !== "L2" && l !== "L3")).toEqual([]);
    const l3 = plans.find((p) => p.level === "L3");
    expect(l3?.countAsCore).toBe(false);
    // L1 必选词：主体 AND 结果
    const l1 = plans.find((p) => p.level === "L1");
    expect(l1?.cnQuery).toContain("AND");
    expect(l1?.cnQuery).toContain("购买意愿");
  });

  it("硬过滤：只有主体或只有结果的标题一律剔除", () => {
    const cls = classifyTerms("", JSON.stringify({ iv: ["AI虚拟主播"], dv: ["购买意愿"] }), []);
    expect(hardFilterPass("新华社AI主播在国际传播中的社会关注分析", cls, "zh", "L1")).toBe(false);
    expect(hardFilterPass("绿色直播对消费者购买意愿的影响", cls, "zh", "L1")).toBe(false);
    expect(hardFilterPass("AI虚拟主播互动性对消费者购买意愿的影响", cls, "zh", "L1")).toBe(true);
  });

  it("L3 理论补充：主体放宽为理论场景词，结果词仍必中", () => {
    const cls = classifyTerms("", JSON.stringify({ iv: ["AI虚拟主播"], dv: ["购买意愿"] }), []);
    expect(hardFilterPass("直播电商SOR模型下消费者购买意愿研究", cls, "zh", "L3")).toBe(true);
    expect(hardFilterPass("直播电商用户行为分析", cls, "zh", "L3")).toBe(false);
  });
});
