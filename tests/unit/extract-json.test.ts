import { describe, expect, it } from "vitest";
import { extractJson } from "../../src/main/stage4-service";

const F = String.fromCharCode(96); // 反引号

describe("extractJson 容错解析（模型输出稳定性）", () => {
  it("纯 JSON 直接解析", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("markdown 代码块包裹", () => {
    const text = F + F + F + "json" + "\n" + '{"a":1}' + "\n" + F + F + F;
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it("JSON 前后有说明文字（取最后一个平衡块）", () => {
    const text = "这是回答：" + "\n" + '{"a":1}' + "\n" + "希望有帮助";
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it("尾逗号容忍（模型常见错误，且不进入死循环）", () => {
    expect(extractJson('{"fields":[{"key":"a","content":"x",},],}')).toEqual({ fields: [{ key: "a", content: "x" }] });
  });

  it("字符串包裹的 JSON", () => {
    expect(extractJson('"{"a":1}"')).toEqual({ a: 1 });
  });

  it("截断数组：返回已完成的完整对象数组", () => {
    const truncated = '{"fields":[{"key":"a","content":"x"},{"key":"b","content":"y';
    const parsed = extractJson(truncated) as unknown;
    expect(Array.isArray(parsed)).toBe(true);
    expect((parsed as Array<{ key: string }>).length).toBeGreaterThanOrEqual(1);
    expect((parsed as Array<{ key: string }>)[0].key).toBe("a");
  });
});
