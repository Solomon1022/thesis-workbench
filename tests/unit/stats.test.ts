import { describe, expect, it } from "vitest";
import { parseCsv } from "../../src/shared/csv";
import { cronbachAlpha, descriptive, linearRegression, pearson, pearsonMatrix, tCdf } from "../../src/shared/stats";

const X1 = [4, 4, 3, 5, 4, 2, 4, 5, 3, 4, 4, 3];
const X2 = [3, 4, 4, 4, 3, 3, 4, 4, 4, 3, 4, 3];
const X3 = [4, 3, 4, 5, 4, 3, 4, 5, 3, 4, 5, 4];
const X4 = [5, 5, 4, 5, 5, 2, 5, 4, 4, 5, 4, 4];
const X5 = [4, 4, 3, 4, 4, 3, 5, 5, 3, 4, 4, 4];
const Y = [4.2, 3.9, 4.4, 4.9, 4.1, 3.5, 4.6, 5.0, 3.7, 4.3, 4.5, 4.0];
// 第 5 行（index 4）x1 缺失
const X1M: Array<number | null> = [4, 4, 3, 5, null, 2, 4, 5, 3, 4, 4, 3];

describe("CSV 解析", () => {
  it("处理引号、逗号、换行与 BOM", () => {
    const text = "\uFEFFname,age,note\n\"Zhang, San\",21,\"hello\nworld\"\nLi Si,,plain";
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(["name", "age", "note"]);
    expect(rows.length).toBe(2);
    expect(rows[0][0]).toBe("Zhang, San");
    expect(rows[0][2]).toBe("hello\nworld");
    expect(rows[1][1]).toBe("");
  });
});

describe("描述统计（与 numpy 独立参考值对照）", () => {
  it("x1（含 1 缺失）", () => {
    const d = descriptive(X1M);
    expect(d.n).toBe(11);
    expect(d.missing).toBe(1);
    expect(d.mean).toBeCloseTo(3.727273, 5);
    expect(d.sd).toBeCloseTo(0.904534, 5);
    expect(d.median).toBe(4);
    expect(d.min).toBe(2);
    expect(d.max).toBe(5);
  });
});

describe("Pearson 相关（与 numpy 独立参考值对照）", () => {
  it("r(x1,x2) = 0.356753", () => {
    expect(pearson(X1, X2)).toBeCloseTo(0.356753, 5);
  });
  it("矩阵对称且对角线为 1", () => {
    const data: Record<string, Array<number | null>> = { x1: X1, x2: X2 };
    const m = pearsonMatrix(["x1", "x2"], data);
    expect(m.matrix[0][1]).toBeCloseTo(0.356753, 5);
    expect(m.matrix[0][0]).toBe(1);
  });
});

describe("Cronbach α（与 numpy 独立参考值对照）", () => {
  it("5 题 12 例 = 0.807766", () => {
    const data: Record<string, Array<number | null>> = { x1: X1, x2: X2, x3: X3, x4: X4, x5: X5 };
    const r = cronbachAlpha(["x1", "x2", "x3", "x4", "x5"], data);
    expect(r.alpha).toBeCloseTo(0.807766, 5);
    expect(r.nCases).toBe(12);
  });

  it("含 1 缺失（成对完整 11 例）= 0.837264", () => {
    const data: Record<string, Array<number | null>> = { x1: X1M, x2: X2, x3: X3, x4: X4, x5: X5 };
    const r = cronbachAlpha(["x1", "x2", "x3", "x4", "x5"], data);
    expect(r.alpha).toBeCloseTo(0.837264, 5);
    expect(r.nCases).toBe(11);
  });
});

describe("线性回归（与 numpy 独立参考值对照）", () => {
  it("y ~ x1 + x2（列表删除 1 缺失行）", () => {
    const data: Record<string, Array<number | null>> = { y: Y, x1: X1M, x2: X2 };
    const r = linearRegression("y", ["x1", "x2"], data);
    expect(r.n).toBe(11);
    expect(r.coefficients[0].estimate).toBeCloseTo(2.299471, 4);
    expect(r.coefficients[1].estimate).toBeCloseTo(0.414815, 4);
    expect(r.coefficients[2].estimate).toBeCloseTo(0.11746, 4);
    expect(r.coefficients[0].se).toBeCloseTo(0.645164, 4);
    expect(r.coefficients[1].se).toBeCloseTo(0.106528, 4);
    expect(r.rSquared).toBeCloseTo(0.726649, 4);
    expect(r.adjRSquared).toBeCloseTo(0.658311, 4);
    expect(r.residualSd).toBeCloseTo(0.276768, 4);
  });
});

describe("t 分布 CDF（与 t 表对照）", () => {
  it("t=2, df=10 → 单尾 ≈ 0.9633", () => {
    expect(tCdf(2, 10)).toBeCloseTo(0.9633, 3);
  });
  it("t=1.96, df=1000 → ≈ 0.9750", () => {
    expect(tCdf(1.96, 1000)).toBeCloseTo(0.975, 3);
  });
});
