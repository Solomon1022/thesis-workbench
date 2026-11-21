import { describe, expect, it } from "vitest";
import { expandQueries, segmentKeywords } from "../../src/main/literature-service";

describe("中文关键词多层扩词映射", () => {
  it("核心检索式 + 1级同义词替换 + 2级理论词组合", () => {
    const out = expandQueries(["虚拟主播", "购买意愿"]);
    expect(out.length).toBeGreaterThanOrEqual(3);
    expect(out[0].query).toBe("虚拟主播 购买意愿");
    expect(out[0].level).toBe("core");
    expect(out.some((q) => q.level === "l1" && /虚拟数字人|数字人主播|AI主播/.test(q.query))).toBe(true);
    expect(out.some((q) => q.level === "l2" && /社会临场感|S-O-R|中介效应/.test(q.query))).toBe(true);
  });

  it("同义替换不重复生成", () => {
    const out = expandQueries(["直播电商", "互动性"]);
    const queries = out.map((q) => q.query);
    expect(new Set(queries).size).toBe(queries.length);
    expect(queries[0]).toBe("直播电商 互动性");
  });

  it("无有效关键词时返回空（不编造检索式）", () => {
    expect(expandQueries([])).toEqual([]);
    expect(expandQueries(["a"])).toEqual([]);
  });
});

describe("中文术语切词（词典最长匹配，避免整句跑偏）", () => {
  it("整句选题被切成学术术语", () => {
    const terms = segmentKeywords("AI虚拟主播的直播互动性对消费者购买意愿影响分析");
    expect(terms.some((t) => t === "虚拟主播" || t === "AI虚拟主播")).toBe(true);
    expect(terms).toContain("互动性");
    expect(terms).toContain("购买意愿");
    expect(terms.length).toBeLessThan(6);
    expect(terms.join("").length).toBeLessThan("AI虚拟主播的直播互动性对消费者购买意愿影响分析".length);
  });
});
