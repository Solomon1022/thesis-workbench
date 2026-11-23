import { describe, expect, it } from "vitest";
import { makePoolId, parseRerankOutput, rerankPool, sanitizePlanQueries, type PoolItem } from "../../src/main/pool-rerank";

const item = (over: Partial<PoolItem> = {}): PoolItem => ({
  title: "虚拟主播互动性研究",
  authors: "张三",
  year: "2025",
  venue: "经济与管理",
  doi: "",
  url: "https://example.org/a",
  abstract: "摘要",
  source: "openalex",
  preprint: false,
  refType: "journal",
  region: "domestic",
  language: "中文",
  poolId: "t:虚拟主播互动性研究|张三",
  ...over,
});

describe("pool-rerank：白名单校验与元数据原值（幻觉=0 的结构护栏）", () => {
  it("makePoolId：DOI 优先，否则 标题|作者", () => {
    expect(makePoolId(item({ doi: "10.1000/x" }))).toBe("doi:10.1000/x");
    expect(makePoolId(item())).toBe("t:虚拟主播互动性研究|张三");
  });

  it("parseRerankOutput：池外 id 丢弃计数、重复 id 去重、分数钳制、理由截断", () => {
    const whitelist = new Set(["doi:a", "doi:b"]);
    const raw = JSON.stringify({
      ranked: [
        { pool_id: "doi:a", score: 99, reason: "很相关" },
        { pool_id: "doi:evil", score: 10, reason: "幻觉" },
        { pool_id: "doi:b", score: -3, reason: "相关".repeat(80) },
        { pool_id: "doi:a", score: 5, reason: "重复" },
      ],
      note: "候选不足，建议改写查询",
    });
    const p = parseRerankOutput(raw, whitelist);
    expect(p.rankedIds).toEqual(["doi:a", "doi:b"]);
    expect(p.dropped).toBe(1);
    expect(p.scores.get("doi:a")).toBe(10); // 99 → 钳制到 10
    expect(p.scores.get("doi:b")).toBe(0); // -3 → 钳制到 0
    expect((p.reasons.get("doi:b") ?? "").length).toBeLessThanOrEqual(60);
    expect(p.note).toContain("候选不足");
  });

  it("rerankPool：LLM 只影响排序，元数据一律取池内原值；池外 id 丢弃并告警", async () => {
    const pool = [item({ title: "A 研究", poolId: "doi:a" }), item({ title: "B 研究", poolId: "doi:b" }), item({ title: "C 研究", poolId: "doi:c" })];
    const warns: string[] = [];
    const resolver = {
      generate: async () => JSON.stringify({
        ranked: [
          { pool_id: "doi:b", score: 9, reason: "b 最相关" },
          { pool_id: "doi:ghost", score: 10, reason: "池外" },
          { pool_id: "doi:a", score: 7, reason: "a 次之" },
        ],
        note: "",
      }),
    };
    const r = await rerankPool({ md: "论文信息", pool, targetNote: "国内 3 篇", resolver, onWarn: (m) => warns.push(m) });
    expect(r.usedAi).toBe(true);
    expect(r.droppedForeignIds).toBe(1);
    expect(warns.some((w) => w.includes("池外"))).toBe(true);
    expect(r.ranked.map((x) => x.title)).toEqual(["B 研究", "A 研究", "C 研究"]);
    // 元数据必须还是池内原值（LLM 输出的任何字段都不被采用）
    expect(r.ranked[0].venue).toBe("经济与管理");
    expect(r.ranked[0].doi).toBe("");
    expect(r.ranked[0].aiScore).toBe(9);
  });

  it("rerankPool：单批失败自动降级为每批 25 条；两次都失败则回退规则排序、检索不中断", async () => {
    const pool = Array.from({ length: 60 }, (_, i) => item({ title: "P" + i, poolId: "doi:" + i }));
    let calls = 0;
    const resolver = {
      generate: async () => {
        calls++;
        if (calls === 1) throw new Error("context length exceeded");
        return JSON.stringify({ ranked: [], note: "" }); // 空输出
      },
    };
    const warns: string[] = [];
    const r = await rerankPool({ md: "m", pool, targetNote: "t", resolver, onWarn: (m) => warns.push(m) });
    expect(calls).toBeGreaterThanOrEqual(2); // 首批失败后确实降级重试了
    expect(r.usedAi).toBe(false); // 最终回退规则排序
    expect(r.error).toBeTruthy();
    expect(r.ranked.length).toBe(60); // 不截断候选池
    expect(warns.some((w) => w.includes("回退规则排序"))).toBe(true);
  });

  it("rerankPool：模型输出非 JSON 文本时按池内 id 出现顺序兜底恢复排序", async () => {
    const pool = [item({ title: "A", poolId: "doi:a" }), item({ title: "B", poolId: "doi:b" }), item({ title: "C", poolId: "doi:c" })];
    const resolver = { generate: async () => "推荐顺序：doi:b 最相关，其次 doi:a。" };
    const r = await rerankPool({ md: "m", pool, targetNote: "t", resolver });
    expect(r.usedAi).toBe(true);
    expect(r.ranked.map((x) => x.title)).toEqual(["B", "A", "C"]);
    expect(r.droppedForeignIds).toBe(0);
  });

  it("rerankPool：无模型回退规则顺序，usedAi=false", async () => {
    const pool = [item({ title: "A", poolId: "doi:a" }), item({ title: "B", poolId: "doi:b" })];
    const r = await rerankPool({ md: "m", pool, targetNote: "t", resolver: null });
    expect(r.usedAi).toBe(false);
    expect(r.ranked.map((x) => x.title)).toEqual(["A", "B"]);
  });
});

describe("sanitizePlanQueries：检索计划清洗（护栏可配置且实际拦截）", () => {
  it("丢弃句子式/空白/重复，过滤非白名单源与字段，钳制年限与每源上限", () => {
    const raw = [
      { zh: "虚拟主播 购买意愿", en: "virtual streamer purchase intention", label: "组合", sources: ["cnki", "bad-source"], fields: ["title", "bad-field"], yearFrom: 1800, yearTo: 2999, capPerSource: 99 },
      { zh: "虚拟主播 购买意愿", en: "", label: "重复" },
      { zh: "这是一个完整的句子式检索式", en: "", label: "句子" },
      { zh: "", en: "", label: "空" },
      { zh: "社会临场感", en: "social presence。句子", label: "en句子" },
    ];
    const out = sanitizePlanQueries(raw as Array<Record<string, unknown>>);
    expect(out.length).toBe(2);
    expect(out[0].zh).toBe("虚拟主播 购买意愿");
    expect(out[0].sources).toEqual(["cnki"]);
    expect(out[0].fields).toEqual(["title"]);
    expect(out[0].yearFrom).toBeGreaterThanOrEqual(1950);
    expect(out[0].yearTo).toBeLessThanOrEqual(new Date().getFullYear());
    expect(out[0].capPerSource).toBeLessThanOrEqual(30);
    expect(out[1].en).toBeNull(); // 含句号的英文式丢弃
  });

  it("超过 14 组截断", () => {
    const raw = Array.from({ length: 20 }, (_, i) => ({ zh: "词" + i, en: "" }));
    expect(sanitizePlanQueries(raw as Array<Record<string, unknown>>).length).toBe(14);
  });
});
