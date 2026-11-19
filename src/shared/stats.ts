/** 本地统计计算模块：纯函数、无依赖。所有数值可用独立实现（numpy/pandas）交叉验证。 */

export interface DescriptiveStats {
  n: number;
  missing: number;
  mean: number;
  sd: number;
  median: number;
  min: number;
  max: number;
}

export interface CorrelationResult {
  columns: string[];
  matrix: number[][];
  pairN: number[][];
  method: "pearson";
}

export interface CronbachResult {
  alpha: number;
  nItems: number;
  nCases: number;
  itemMeans: number[];
  itemSds: number[];
  note: string;
}

export interface RegressionResult {
  dv: string;
  predictors: string[];
  n: number;
  coefficients: Array<{ term: string; estimate: number; se: number; t: number; p: number }>;
  rSquared: number;
  adjRSquared: number;
  residualSd: number;
  formula: string;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function mean(values: number[]): number {
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

export function sd(values: number[]): number {
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 描述统计（数值列；缺失剔除并计数） */
export function descriptive(values: Array<number | null>): DescriptiveStats {
  const numeric = values.filter(isFiniteNumber);
  return {
    n: numeric.length,
    missing: values.length - numeric.length,
    mean: mean(numeric),
    sd: numeric.length > 1 ? sd(numeric) : 0,
    median: median(numeric),
    min: Math.min(...numeric),
    max: Math.max(...numeric),
  };
}

/** Pearson 相关矩阵（成对完整观测） */
export function pearsonMatrix(columns: string[], data: Record<string, Array<number | null>>): CorrelationResult {
  const k = columns.length;
  const matrix: number[][] = [];
  const pairN: number[][] = [];
  for (let i = 0; i < k; i++) {
    matrix.push(new Array<number>(k).fill(1));
    pairN.push(new Array<number>(k).fill(0));
  }
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const a = data[columns[i]];
      const b = data[columns[j]];
      const xs: number[] = [];
      const ys: number[] = [];
      for (let r = 0; r < Math.min(a.length, b.length); r++) {
        if (isFiniteNumber(a[r]) && isFiniteNumber(b[r])) {
          xs.push(a[r] as number);
          ys.push(b[r] as number);
        }
      }
      pairN[i][j] = pairN[j][i] = xs.length;
      const r = pearson(xs, ys);
      matrix[i][j] = r;
      matrix[j][i] = r;
    }
  }
  for (let i = 0; i < k; i++) {
    pairN[i][i] = data[columns[i]].filter(isFiniteNumber).length;
  }
  return { columns, matrix, pairN, method: "pearson" };
}

export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return NaN;
  return sxy / Math.sqrt(sxx * syy);
}

/** Cronbach α（量表内部一致性；逐题成对完整观测，题目方差贡献公式） */
export function cronbachAlpha(items: string[], data: Record<string, Array<number | null>>): CronbachResult {
  const k = items.length;
  const cols = items.map((name) => data[name].map((v) => (isFiniteNumber(v) ? (v as number) : null)));
  const n = cols[0].length;
  // 成对完整（pairwise）：每道题与其余题联合非缺失的样本
  const validFlags: boolean[] = new Array<boolean>(n).fill(true);
  const itemVars: number[] = [];
  const itemMeans: number[] = [];
  const itemSds: number[] = [];
  for (let i = 0; i < k; i++) {
    const vals = cols[i].filter(isFiniteNumber) as number[];
    itemMeans.push(mean(vals));
    itemSds.push(vals.length > 1 ? sd(vals) : 0);
    itemVars.push(vals.length > 1 ? sd(vals) * sd(vals) : 0);
    for (let r = 0; r < n; r++) if (!isFiniteNumber(cols[i][r])) validFlags[r] = false;
  }
  const totals: number[] = [];
  let nCases = 0;
  for (let r = 0; r < n; r++) {
    if (!validFlags[r]) continue;
    const row: number[] = [];
    for (let i = 0; i < k; i++) row.push(cols[i][r] as number);
    totals.push(row.reduce((a, b) => a + b, 0));
    nCases++;
  }
  if (nCases < 3 || k < 2) {
    return { alpha: NaN, nItems: k, nCases, itemMeans, itemSds, note: "样本或题项不足：α 需要至少 3 个完整观测与 2 道题" };
  }
  // 总分方差跨样本计算（样本方差，与 numpy var(ddof=1) 一致）
  const totalVar = sd(totals) * sd(totals);
  const sumItemVars = itemVars.reduce((a, b) => a + b, 0);
  const alpha = (k / (k - 1)) * (1 - sumItemVars / totalVar);
  return { alpha, nItems: k, nCases, itemMeans, itemSds, note: "" };
}

// ---- 线性回归（正规方程 + 高斯消元；SE/t/p 来自 t 分布） ----

/** 高斯消元解线性方程组（列主元） */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** 矩阵求逆（高斯-约当） */
function invert(A: number[][]): number[][] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, ...(new Array<number>(n).fill(0).map((_, j) => (i === j ? 1 : 0)))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-12) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const d = M[col][col];
    for (let c = 0; c < 2 * n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = 0; c < 2 * n; c++) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

// t 分布累积分布（不完全 beta，Numerical Recipes 数值方案）
function lgamma(x: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * x)) - lgamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  let qab = a + b;
  let qap = a + 1;
  let qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = -((a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** P(T ≤ t)，df 自由度（双尾 p = 2*(1 - tCdf(|t|))） */
export function tCdf(t: number, df: number): number {
  const x = df / (df + t * t);
  const half = 0.5 * betai(df / 2, 0.5, x);
  return t >= 0 ? 1 - half : half;
}

/** OLS：y ~ x1 + ... + xk（列表删除缺失；返回系数/SE/t/p/R²） */
export function linearRegression(dv: string, predictors: string[], data: Record<string, Array<number | null>>): RegressionResult {
  const n0 = data[dv].length;
  const rows: number[][] = [];
  for (let r = 0; r < n0; r++) {
    const y = data[dv][r];
    if (!isFiniteNumber(y)) continue;
    const xs: number[] = [];
    let ok = true;
    for (const p of predictors) {
      const v = data[p][r];
      if (!isFiniteNumber(v)) { ok = false; break; }
      xs.push(v as number);
    }
    if (ok) rows.push([1, ...xs, y as number]);
  }
  const n = rows.length;
  const k = predictors.length;
  if (n <= k + 1) {
    return { dv, predictors, n, coefficients: [], rSquared: NaN, adjRSquared: NaN, residualSd: NaN, formula: "y ~ " + predictors.join(" + ") };
  }
  const X: number[][] = rows.map((r) => r.slice(0, k + 1));
  const y: number[] = rows.map((r) => r[k + 1]);
  const XtX: number[][] = [];
  for (let i = 0; i <= k; i++) {
    XtX.push([]);
    for (let j = 0; j <= k; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += X[r][i] * X[r][j];
      XtX[i].push(s);
    }
  }
  const Xty: number[] = [];
  for (let i = 0; i <= k; i++) {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r][i] * y[r];
    Xty.push(s);
  }
  const beta = solveLinear(XtX, Xty);
  if (!beta) {
    return { dv, predictors, n, coefficients: [], rSquared: NaN, adjRSquared: NaN, residualSd: NaN, formula: "y ~ " + predictors.join(" + ") + "（设计矩阵奇异，无法求解）" };
  }
  const fitted = X.map((row) => row.reduce((s, v, i) => s + v * beta[i], 0));
  const residuals = y.map((v, i) => v - fitted[i]);
  let rss = 0;
  for (const e of residuals) rss += e * e;
  const yMean = mean(y);
  let tss = 0;
  for (const v of y) tss += (v - yMean) * (v - yMean);
  const rSquared = tss > 0 ? 1 - rss / tss : NaN;
  const dfResid = n - k - 1;
  const sigma2 = rss / dfResid;
  const residualSd = Math.sqrt(sigma2);
  const inv = invert(XtX);
  const terms = ["(截距)", ...predictors];
  const coefficients = terms.map((term, i) => {
    const estimate = beta[i];
    const se = inv ? Math.sqrt(Math.max(sigma2 * inv[i][i], 0)) : NaN;
    const t = se > 0 ? estimate / se : NaN;
    const p = Number.isFinite(t) ? 2 * (1 - tCdf(Math.abs(t), dfResid)) : NaN;
    return { term, estimate, se, t, p };
  });
  const adjRSquared = dfResid > 0 ? 1 - (1 - rSquared) * ((n - 1) / dfResid) : NaN;
  return { dv, predictors, n, coefficients, rSquared, adjRSquared, residualSd, formula: dv + " ~ " + predictors.join(" + ") };
}
