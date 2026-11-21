import { describe, expect, it } from "vitest";
import { buildForeignQuery, dictionaryBooleanQuery, sanitizeBooleanQuery } from "../../src/main/query-builder";

describe("外文检索式构建（词典硬匹配 + 可插拔模型布尔逻辑）", () => {
  it("词典硬匹配：多词引号短语 AND 组合", () => {
    const q = dictionaryBooleanQuery(["购买意愿", "直播电商"]);
    expect(q).toBe('"purchase intention" AND "live streaming e-commerce"');
  });

  it("词典无命中时返回 null（不硬造）", () => {
    expect(dictionaryBooleanQuery(["量子色动力学"] ?? [])).toBeNull();
  });

  it("句子翻译被拒绝；布尔检索式被接受", () => {
    expect(sanitizeBooleanQuery("This study examines the purchase intention of consumers")).toBeNull();
    expect(sanitizeBooleanQuery('"virtual streamer" AND "purchase intention" OR interactivity')).toBe('"virtual streamer" AND "purchase intention" OR interactivity');
  });

  it("无模型时仅用词典；模型给出布尔式则采纳模型；模型给句子则回退词典", async () => {
    const kw = ["购买意愿", "虚拟主播"];
    const none = await buildForeignQuery(kw, null);
    expect(none?.source).toBe("dictionary");
    expect(none?.query).toContain("purchase intention");

    const boolModel = await buildForeignQuery(kw, { generate: async () => '"virtual streamer" AND "purchase intention"' });
    expect(boolModel?.source).toBe("model");

    const sentenceModel = await buildForeignQuery(kw, { generate: async () => "This paper studies virtual streamers and purchase intention." });
    expect(sentenceModel?.source).toBe("dictionary");
  });
});
