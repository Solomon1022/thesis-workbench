import { describe, expect, it } from "vitest";
import { parseAiLiterature } from "../../src/main/ai-import";

describe("parseAiLiterature（直聊 AI 结果解析）", () => {
  it("解析 GB/T 7714 期刊/学位论文行（含 Markdown 加粗与编号）", () => {
    const text = [
      "**1. 王翠翠, 徐静, 尚倩. 电商直播中虚拟主播互动性对消费者购买行为的影响[J]. 商业经济研究, 2021, (12): 82-85.**",
      "2、张三. 基于深度学习的图像识别研究[D]. 清华大学, 2020.",
    ].join("\n");
    const out = parseAiLiterature(text);
    expect(out.length).toBe(2);
    expect(out[0].title).toContain("虚拟主播互动性对消费者购买行为");
    expect(out[0].authors).toContain("王翠翠");
    expect(out[0].year).toBe("2021");
    expect(out[0].venue).toContain("商业经济研究");
    expect(out[0].refType).toBe("journal");
    expect(out[1].refType).toBe("thesis");
    expect(out[1].year).toBe("2020");
  });

  it("解析带 DOI 的行与管道分隔行", () => {
    const text = [
      "Attention is all you need 10.1038/nature14539 (2015)",
      "直播购物研究综述 | 李四 | 2022 | 新闻与传播研究 | DOI: 10.1234/abcd",
    ].join("\n");
    const out = parseAiLiterature(text);
    expect(out.length).toBe(2);
    expect(out[0].doi).toBe("10.1038/nature14539");
    expect(out[1].title).toBe("直播购物研究综述");
    expect(out[1].year).toBe("2022");
    expect(out[1].venue).toBe("新闻与传播研究");
  });

  it("忽略解释文字与非文献行；重复标题去重", () => {
    const text = [
      "以下是为您检索到的文献：",
      "王翠翠. 虚拟主播互动性研究[J]. 商业经济研究, 2021.",
      "王翠翠. 虚拟主播互动性研究[J]. 商业经济研究, 2021.",
      "这只是一个普通句子。",
    ].join("\n");
    const out = parseAiLiterature(text);
    expect(out.length).toBe(1);
  });

  it("自由文本行兜底提取（低置信度）", () => {
    const out = parseAiLiterature("Deep Learning for Recommendation Systems 2019");
    expect(out.length).toBe(1);
    expect(out[0].confidence).toBe("low");
    expect(out[0].year).toBe("2019");
  });

  it("空文本与无法解析返回空数组", () => {
    expect(parseAiLiterature("")).toEqual([]);
    expect(parseAiLiterature("好的，请告诉我你的研究主题。")).toEqual([]);
  });
});
