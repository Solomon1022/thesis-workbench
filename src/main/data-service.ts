import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import * as XLSX from "xlsx";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { parseCsv } from "../shared/csv";
import { cronbachAlpha, descriptive, linearRegression, pearsonMatrix } from "../shared/stats";

export interface VariableInfo {
  name: string;
  type: "numeric" | "categorical" | "text";
  n: number;
  missing: number;
  invalid: number;
  distinct: number;
}

/** 类型推断：全数字→numeric；非空去重 ≤ 20 且值较短→categorical；否则 text。缺失=空串，非法=数值列中的非数字非空。 */
export function inferVariables(headers: string[], rows: string[][]): { variables: VariableInfo[]; numericColumns: Record<string, Array<number | null>> } {
  const variables: VariableInfo[] = [];
  const numericColumns: Record<string, Array<number | null>> = {};
  for (let c = 0; c < headers.length; c++) {
    const name = headers[c];
    let missing = 0;
    let invalid = 0;
    const values: Array<number | null> = [];
    const nonEmpty: string[] = [];
    for (const row of rows) {
      const raw = (row[c] ?? "").trim();
      if (raw === "") { missing++; values.push(null); continue; }
      nonEmpty.push(raw);
      const num = Number(raw.replace(/,/g, ""));
      if (raw !== "" && Number.isFinite(num) && raw.replace(/,/g, "").trim() !== "") {
        values.push(num);
      } else {
        invalid++;
        values.push(null);
      }
    }
    const distinct = new Set(nonEmpty.map((s) => s.slice(0, 40))).size;
    const type: VariableInfo["type"] = invalid === 0 && nonEmpty.length > 0 ? "numeric" : distinct <= 20 && nonEmpty.length > 0 ? "categorical" : "text";
    if (type === "numeric") {
      numericColumns[name] = values;
      // 数值列也不应存在 invalid
      invalid = 0;
    }
    variables.push({ name, type, n: rows.length, missing, invalid, distinct });
  }
  return { variables, numericColumns };
}

/** 把 xlsx 首个工作表转成 CSV 文本（供导入与单测使用） */
export function parseXlsxBuffer(buffer: Buffer): string {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  if (json.length === 0) throw new Error("工作表为空");
  const headers = Object.keys(json[0]);
  const rows = json.map((r) => headers.map((h) => String(r[h] ?? "")));
  return [headers.join(","), ...rows.map((r) => r.map((c) => "\"" + String(c).replace(/"/g, "\"\"") + "\"").join(","))].join("\n");
}

export interface AnalysisRunResult {
  runId: string;
  method: string;
  status: "ok" | "error";
  message: string;
  formula: string;
  params: unknown;
  results: unknown;
}

const METHOD_LABEL: Record<string, string> = {
  descriptive: "描述统计",
  pearson: "Pearson 相关矩阵",
  cronbach: "内部一致性（Cronbach α）",
  regression: "线性回归（OLS）",
  spss_guide: "SPSS 步骤（未实际执行）",
};

/** 阶段 5 服务：导入与本地计算；AI 只解释真实结果。 */
export class DataService {
  constructor(
    private db: ThesisDB,
    private settings: SettingsService,
    private userDataDir: string,
  ) {}

  private storeDir(projectId: string): string {
    const dir = path.join(this.userDataDir, "attachments", "data", projectId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** 从文本导入（CSV），原始内容原样落盘（保留原始文件），推断变量字典。 */
  importText(projectId: string, name: string, text: string, kind: "csv" | "xlsx" = "csv") {
    if (kind === "xlsx") throw new Error("xlsx 请通过文件导入");
    const { headers, rows } = parseCsv(text);
    if (headers.length === 0 || rows.length === 0) throw new Error("CSV 内容为空或只有表头");
    const { variables } = inferVariables(headers, rows);
    const id = this.db.insertDataFile({
      projectId,
      name: name.trim() || "导入数据",
      kind: "csv",
      originalName: name.trim() || "粘贴导入",
      rowCount: rows.length,
      columnCount: headers.length,
      variablesJson: JSON.stringify(variables),
      storedPath: "",
    });
    const filePath = path.join(this.storeDir(projectId), id + ".csv");
    writeFileSync(filePath, text, "utf8");
    this.db.updateDataFileStoredPath(id, filePath);
    return { id, variables, rowCount: rows.length, columnCount: headers.length };
  }

  /** 从文件导入（csv/xlsx），原始文件复制到应用数据目录。 */
  async importFile(projectId: string) {
    const result = await dialog.showOpenDialog({
      title: "选择数据文件（CSV 或 XLSX）",
      filters: [
        { name: "数据文件", extensions: ["csv", "xlsx"] },
        { name: "CSV", extensions: ["csv"] },
        { name: "Excel", extensions: ["xlsx"] },
      ],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true as const };
    const src = result.filePaths[0];
    const ext = path.extname(src).toLowerCase();
    const buffer = readFileSync(src);
    let text: string;
    let kind: "csv" | "xlsx";
    let originalName = path.basename(src);
    if (ext === ".xlsx") {
      kind = "xlsx";
      text = parseXlsxBuffer(buffer);
    } else {
      kind = "csv";
      text = buffer.toString("utf8");
    }
    const { headers, rows } = parseCsv(text);
    if (headers.length === 0 || rows.length === 0) throw new Error("数据文件为空或只有表头");
    const { variables } = inferVariables(headers, rows);
    const id = this.db.insertDataFile({
      projectId,
      name: path.basename(src, path.extname(src)),
      kind,
      originalName,
      rowCount: rows.length,
      columnCount: headers.length,
      variablesJson: JSON.stringify(variables),
      storedPath: "",
    });
    const dest = path.join(this.storeDir(projectId), id + ext);
    copyFileSync(src, dest);
    this.db.updateDataFileStoredPath(id, dest);
    return { id, variables, rowCount: rows.length, columnCount: headers.length, kind };
  }

  /** 读取数据文件内容（原始 CSV 文本重解析；xlsx 同 pipeline 生成的副本）。 */
  private loadData(dataFileId: string): { headers: string[]; rows: string[][]; variables: VariableInfo[] } | null {
    const file = this.db.getDataFile(dataFileId);
    if (!file || !file.storedPath) return null;
    try {
      const text = readFileSync(file.storedPath, "utf8");
      const { headers, rows } = parseCsv(text);
      const variables = JSON.parse(file.variablesJson) as VariableInfo[];
      return { headers, rows, variables };
    } catch {
      return null;
    }
  }

  /** 执行分析：本地计算，方法、参数、公式与缺失策略全部落库。 */
  analyze(projectId: string, dataFileId: string, method: string, params: unknown): AnalysisRunResult {
    const loaded = this.loadData(dataFileId);
    if (!loaded) {
      return { runId: "", method, status: "error", message: "数据文件不存在或无法读取", formula: "", params, results: null };
    }
    const { headers, rows, variables } = loaded;
    const { numericColumns } = inferVariables(headers, rows);
    const file = this.db.getDataFile(dataFileId) as NonNullable<ReturnType<ThesisDB["getDataFile"]>>;
    try {
      let results: unknown;
      let formula = "";
      let message = "";
      const paramsJson = JSON.stringify(params ?? {});
      if (method === "descriptive") {
        const cols = (params as { columns?: string[] } | null)?.columns ?? variables.filter((v) => v.type === "numeric").map((v) => v.name);
        const table: Record<string, unknown> = {};
        for (const c of cols) {
          if (!(c in numericColumns)) continue;
          table[c] = descriptive(numericColumns[c]);
        }
        results = { table, missingStrategy: "列表删除（逐列统计，缺失计数）" };
        formula = "mean / sd / median / min / max / n / missing";
      } else if (method === "pearson") {
        const cols = (params as { columns?: string[] } | null)?.columns ?? variables.filter((v) => v.type === "numeric").map((v) => v.name).slice(0, 10);
        results = pearsonMatrix(cols, numericColumns);
        formula = "r = Σ(x-x̄)(y-ȳ) / √(Σ(x-x̄)²·Σ(y-ȳ)²)";
        message = "成对完整观测（pairwise）；适用条件：数值变量、线性关系、无明显离群值";
      } else if (method === "cronbach") {
        const p = params as { items?: string[]; columns?: string[] } | null;
        const items = p?.items ?? p?.columns ?? variables.filter((v) => v.type === "numeric").map((v) => v.name);
        results = cronbachAlpha(items, numericColumns);
        formula = "α = k/(k-1) · (1 - ΣVar_i / Var_total)";
        message = "适用条件：多题项量表、题目同向计分（反向题需先转置）；本版按成对完整观测计算";
      } else if (method === "regression") {
        const p = params as { dv?: string; predictors?: string[] } | null;
        if (!p?.dv || !p.predictors || p.predictors.length === 0) throw new Error("线性回归需要指定因变量与至少一个自变量");
        results = linearRegression(p.dv, p.predictors, numericColumns);
        formula = "β = (XᵀX)⁻¹Xᵀy；缺失策略：列表删除；p 值基于 t 分布";
        message = "适用条件：连续因变量、线性关系、残差独立（本版不做诊断图与多重共线性检验）";
      } else if (method === "spss_guide") {
        results = {
          steps: [
            "1. 文件 → 导入数据 → 选择 CSV（或直接打开 Excel）",
            "2. 变量视图：按下方变量字典设置类型/标签；反向题先「转换 → 重新编码为相同变量」",
            "3. 描述统计：分析 → 描述统计 → 频率/描述",
            "4. 信度：分析 → 标度 → 可靠性分析（勾选项统计）",
            "5. 相关：分析 → 相关 → 双变量（Pearson）",
            "6. 回归：分析 → 回归 → 线性（设置因变量/自变量）",
          ],
          variableDictionary: variables.map((v) => ({ name: v.name, type: v.type, missing: v.missing, invalid: v.invalid })),
          note: "本应用不实际调用 SPSS；以上为可复制执行的官方菜单路径",
        };
        formula = "";
        message = "SPSS 步骤（未实际执行）";
      } else if (method === "mediation" || method === "sem") {
        throw new Error("中介分析 / 结构方程模型本版本未支持，不生成任何虚构结果");
      } else {
        throw new Error("未知分析方法：" + method);
      }
      const runId = this.db.insertAnalysisRun({
        projectId,
        dataFileId,
        method,
        paramsJson,
        resultsJson: JSON.stringify(results),
        formula,
        status: "ok",
        message,
      });
      return { runId, method, status: "ok", message, formula, params, results };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const runId = this.db.insertAnalysisRun({
        projectId,
        dataFileId,
        method,
        paramsJson: JSON.stringify(params ?? {}),
        resultsJson: JSON.stringify(null),
        formula: "",
        status: "error",
        message,
      });
      return { runId, method, status: "error", message, formula: "", params, results: null };
    }
  }

  /** AI 解释已存在的真实结果（只解释，不生成新数字）。 */
  async explain(runId: string): Promise<{ ok: boolean; message: string; explanation?: string; provider?: string; model?: string }> {
    const run = this.db.getAnalysisRun(runId);
    if (!run) return { ok: false, message: "分析运行不存在" };
    if (run.status !== "ok") return { ok: false, message: "该运行没有成功结果，无法解释" };
    const role = this.settings.resolveRole("analysis");
    if (!role) return { ok: false, message: "未配置「分析解释」角色模型：请先在「服务与模型设置 → 任务角色」中分配服务商与模型" };
    const file = this.db.getDataFile(run.dataFileId);
    const system = [
      "你是统计分析解释助手。基于给定的真实计算结果进行解释。",
      "严格禁止：编造或修改任何数字；解释只能引用给出的数字；对数值的适用条件与局限必须如实说明。",
      "用中文，简洁、学术、克制。",
    ].join("\n");
    const user = "方法：" + (METHOD_LABEL[run.method] ?? run.method) + "\n参数：" + run.paramsJson + "\n公式：" + run.formula + "\n数据文件：" + (file?.name ?? "未知") + "\n真实结果（JSON）：\n" + run.resultsJson + "\n\n请解释这些结果的含义、适用条件与局限。";
    const content = await chat({
      channel: role.channel,
      apiKey: role.apiKey,

      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 8000,
      signal: AbortSignal.timeout(240_000),
    });
    return { ok: true, message: "AI 解释基于真实计算结果生成", explanation: content, provider: role.channel.name, model: role.channel.model };
  }

  listFiles(projectId: string) {
    return this.db.listDataFiles(projectId).map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind,
      originalName: f.originalName,
      rowCount: f.rowCount,
      columnCount: f.columnCount,
      variables: JSON.parse(f.variablesJson) as VariableInfo[],
      createdAt: f.createdAt,
    }));
  }

  listRuns(projectId: string) {
    return this.db.listAnalysisRuns(projectId).map((r) => ({
      id: r.id,
      dataFileId: r.dataFileId,
      method: r.method,
      params: JSON.parse(r.paramsJson) as unknown,
      results: JSON.parse(r.resultsJson) as unknown,
      formula: r.formula,
      status: r.status,
      message: r.message,
      createdAt: r.createdAt,
    }));
  }
}
