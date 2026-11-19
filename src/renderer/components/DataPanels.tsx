import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";

const api = () => window.thesisWorkbench;

interface VariableInfo {
  name: string;
  type: string;
  n: number;
  missing: number;
  invalid: number;
  distinct: number;
}

interface DataFileInfo {
  id: string;
  name: string;
  kind: string;
  originalName: string;
  rowCount: number;
  columnCount: number;
  variables: VariableInfo[];
  createdAt: number;
}

interface RunInfo {
  id: string;
  dataFileId: string;
  method: string;
  params: unknown;
  results: unknown;
  formula: string;
  status: string;
  message: string;
  createdAt: number;
}

const TYPE_LABEL: Record<string, string> = { numeric: "数值", categorical: "分类", text: "文本" };
const METHOD_LABEL: Record<string, string> = {
  descriptive: "描述统计",
  pearson: "Pearson 相关矩阵",
  cronbach: "内部一致性（Cronbach α）",
  regression: "线性回归（OLS）",
  spss_guide: "SPSS 步骤（未实际执行）",
};

/* ============ 数据导入（资料收集阶段） ============ */

export function DataPanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [files, setFiles] = useState<DataFileInfo[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [pasteName, setPasteName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setFiles(await a.dataList(projectId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const importFile = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.dataImportFile(projectId);
      if (!("canceled" in r)) {
        setMessage("已导入：" + r.rowCount + " 行 × " + r.columnCount + " 列；原始文件已复制到应用数据目录");
        void refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const importText = async () => {
    const a = api();
    if (!a || !pasteText.trim()) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.dataImportText(projectId, pasteName.trim() || "粘贴导入", pasteText);
      setMessage("已导入：" + r.rowCount + " 行 × " + r.columnCount + " 列（原始内容已保存）");
      setPasteText("");
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="literature-panel">
      <section className="card">
        <div className="card-head-row">
          <h2 className="card-title">数据导入（保留原始文件，清洗为派生版本）</h2>
          <button className="btn btn-primary" disabled={busy} onClick={() => void importFile()}>导入 CSV / XLSX 文件</button>
        </div>
        <p className="muted">导入时自动做类型推断（数值/分类/文本）与缺失、非法值检查；原始文件原样保存，任何分析都基于原始数据并记录缺失策略，不覆盖原文件。</p>
        <div className="field">
          <label>或粘贴 CSV 文本（首行为表头）</label>
          <textarea className="textarea" aria-label="粘贴CSV" placeholder={"名称,题项1,题项2\n张三,4,3\n李四,5,4"} value={pasteText} onChange={(e) => setPasteText(e.target.value)} />
          <div className="lit-search-row">
            <input className="input" aria-label="数据名称" placeholder="数据名称（可选）" value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
            <button className="btn" disabled={busy || !pasteText.trim()} onClick={() => void importText()}>导入文本</button>
          </div>
        </div>
        {message && <p className="banner banner-info">{message}</p>}
        {error && <p className="banner banner-error">{error}</p>}
      </section>

      {files.length > 0 && (
        <section className="card">
          <h2 className="card-title">数据文件（{files.length}）与变量字典</h2>
          {files.map((f) => (
            <div key={f.id} className="lit-item">
              <div className="lit-item-main">
                <div className="lit-title">{f.name} <span className="badge">{f.kind.toUpperCase()}</span></div>
                <div className="muted">{f.rowCount} 行 × {f.columnCount} 列 · 原始名：{f.originalName} · 导入于 {new Date(f.createdAt).toLocaleString("zh-CN")}</div>
                <table className="data-table">
                  <thead><tr><th>变量</th><th>类型</th><th>缺失</th><th>非法值</th><th>去重值数</th></tr></thead>
                  <tbody>
                    {f.variables.map((v) => (
                      <tr key={v.name}>
                        <td>{v.name}</td>
                        <td>{TYPE_LABEL[v.type] ?? v.type}</td>
                        <td>{v.missing}</td>
                        <td>{v.invalid}</td>
                        <td>{v.distinct}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="lit-item-actions">
                <button className="btn btn-sm btn-danger" onClick={async () => { await api()?.dataDelete(f.id); void refresh(); }}>删除</button>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="card">
        <h2 className="card-title">SPSS 说明与未支持方法</h2>
        <p className="muted">本应用不实际调用 SPSS；以下为可复制执行的官方菜单路径：</p>
        <ol className="muted">
          <li>文件 → 导入数据 → 选择 CSV（或直接打开 Excel）</li>
          <li>变量视图：按变量字典设置类型/标签；反向题先「转换 → 重新编码为相同变量」</li>
          <li>描述统计：分析 → 描述统计 → 频率/描述</li>
          <li>信度：分析 → 标度 → 可靠性分析（勾选项统计）</li>
          <li>相关：分析 → 相关 → 双变量（Pearson）</li>
          <li>回归：分析 → 回归 → 线性（设置因变量/自变量）</li>
        </ol>
        <p className="muted">中介分析、结构方程模型：本版本未支持，不生成任何虚构结果。</p>
      </section>
    </div>
  );
}

/* ============ 分析（整理与分析阶段） ============ */

export function AnalysisPanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [files, setFiles] = useState<DataFileInfo[]>([]);
  const [runs, setRuns] = useState<RunInfo[]>([]);
  const [fileId, setFileId] = useState("");
  const [method, setMethod] = useState("descriptive");
  const [columns, setColumns] = useState<string[]>([]);
  const [dv, setDv] = useState("");
  const [predictors, setPredictors] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [explaining, setExplaining] = useState("");
  const [explanation, setExplanation] = useState("");

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try {
      const [f, r] = await Promise.all([a.dataList(projectId), a.dataRuns(projectId)]);
      setFiles(f);
      setRuns(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const currentFile = files.find((f) => f.id === fileId);
  const numericVars = currentFile?.variables.filter((v) => v.type === "numeric").map((v) => v.name) ?? [];

  const run = async () => {
    const a = api();
    if (!a || !fileId) return;
    setError("");
    setMessage("");
    try {
      const params = method === "regression"
        ? { dv, predictors }
        : method === "spss_guide"
          ? {}
          : { columns: columns.length > 0 ? columns : undefined };
      const r = await a.dataAnalyze(projectId, fileId, method, params);
      if (r.status === "error") setError(r.message);
      else setMessage("分析完成（" + METHOD_LABEL[method] + "），公式与参数已记录");
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const explain = async (runId: string) => {
    const a = api();
    if (!a) return;
    setExplaining(runId);
    setExplanation("");
    try {
      const r = await a.dataExplain(runId);
      if (r.ok && r.explanation) {
        setExplanation("（" + r.provider + " / " + r.model + "）\n" + r.explanation);
        setMessage(r.message);
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExplaining("");
    }
  };

  const toggleCol = (name: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
  };

  const renderResults = (r: RunInfo) => {
    if (r.status === "error") return <p className="muted">状态：{r.message}</p>;
    const res = r.results as Record<string, unknown>;
    if (r.method === "descriptive") {
      const table = res.table as Record<string, { n: number; missing: number; mean: number; sd: number; median: number; min: number; max: number }>;
      return (
        <table className="data-table">
          <thead><tr><th>变量</th><th>n</th><th>缺失</th><th>均值</th><th>标准差</th><th>中位数</th><th>最小值</th><th>最大值</th></tr></thead>
          <tbody>
            {Object.entries(table).map(([name, d]) => (
              <tr key={name}>
                <td>{name}</td><td>{d.n}</td><td>{d.missing}</td><td>{d.mean.toFixed(3)}</td><td>{d.sd.toFixed(3)}</td><td>{d.median}</td><td>{d.min}</td><td>{d.max}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (r.method === "pearson") {
      const m = res as { columns: string[]; matrix: number[][] };
      return (
        <table className="data-table">
          <thead><tr><th></th>{m.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {m.columns.map((c, i) => (
              <tr key={c}><td>{c}</td>{m.matrix[i].map((v, j) => <td key={j}>{v.toFixed(3)}</td>)}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (r.method === "cronbach") {
      const a = res as { alpha: number; nItems: number; nCases: number; itemMeans: number[]; itemSds: number[]; note: string };
      return (
        <div>
          <p><strong>Cronbach α = {Number.isFinite(a.alpha) ? a.alpha.toFixed(4) : "无法计算"} </strong>（题项 {a.nItems}，完整观测 {a.nCases}）{a.note && <span className="muted"> · {a.note}</span>}</p>
        </div>
      );
    }
    if (r.method === "regression") {
      const rg = res as { dv: string; predictors: string[]; n: number; coefficients: Array<{ term: string; estimate: number; se: number; t: number; p: number }>; rSquared: number; adjRSquared: number; residualSd: number };
      return (
        <div>
          <p className="muted">公式：{rg.dv} ~ {rg.predictors.join(" + ")} · n = {rg.n} · R² = {rg.rSquared.toFixed(4)} · 调整 R² = {rg.adjRSquared.toFixed(4)} · 残差标准差 = {rg.residualSd.toFixed(4)}</p>
          <table className="data-table">
            <thead><tr><th>项</th><th>估计值</th><th>标准误</th><th>t</th><th>p</th></tr></thead>
            <tbody>
              {rg.coefficients.map((c) => (
                <tr key={c.term}><td>{c.term}</td><td>{c.estimate.toFixed(4)}</td><td>{c.se.toFixed(4)}</td><td>{c.t.toFixed(3)}</td><td>{Number.isFinite(c.p) ? c.p.toFixed(4) : "—"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    if (r.method === "spss_guide") {
      const g = res as { steps: string[]; variableDictionary: Array<{ name: string; type: string; missing: number; invalid: number }>; note: string };
      return (
        <div>
          <ol className="muted">{g.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="muted">{g.note}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="literature-panel">
      <section className="card">
        <h2 className="card-title">本地分析（受控计算模块，AI 只解释真实结果）</h2>
        <p className="muted">每种方法明确显示输入条件、参数、公式与解释限制；缺失策略随结果记录。数值由本地计算，不使用模型生成。</p>
        <div className="lit-search-row">
          <select className="select" aria-label="数据文件" value={fileId} onChange={(e) => { setFileId(e.target.value); setColumns([]); setPredictors([]); setDv(""); }}>
            <option value="">— 选择数据文件 —</option>
            {files.map((f) => <option key={f.id} value={f.id}>{f.name}（{f.rowCount} 行）</option>)}
          </select>
          <select className="select" aria-label="分析方法" value={method} onChange={(e) => setMethod(e.target.value)}>
            <option value="descriptive">描述统计</option>
            <option value="pearson">Pearson 相关矩阵</option>
            <option value="cronbach">内部一致性（Cronbach α）</option>
            <option value="regression">线性回归（OLS）</option>
            <option value="spss_guide">SPSS 步骤（未实际执行）</option>
          </select>
          <button className="btn btn-primary" disabled={!fileId} onClick={() => void run()}>运行分析</button>
        </div>

        {currentFile && method !== "spss_guide" && method !== "regression" && numericVars.length > 0 && (
          <div className="lit-suggest">
            {numericVars.map((name) => (
              <button key={name} className={"chip" + (columns.includes(name) ? " chip-on" : "")} onClick={() => toggleCol(name, columns, setColumns)}>
                {name}
              </button>
            ))}
            <span className="muted">（不选则使用全部数值列）</span>
          </div>
        )}

        {currentFile && method === "regression" && numericVars.length > 0 && (
          <div className="lit-search-row">
            <label className="muted">因变量：</label>
            <select className="select" aria-label="因变量" value={dv} onChange={(e) => setDv(e.target.value)}>
              <option value="">— 选择因变量 —</option>
              {numericVars.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <span className="muted">自变量：</span>
            <div className="lit-suggest">
              {numericVars.filter((n) => n !== dv).map((name) => (
                <button key={name} className={"chip" + (predictors.includes(name) ? " chip-on" : "")} onClick={() => toggleCol(name, predictors, setPredictors)}>
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {message && <p className="banner banner-info">{message}</p>}
        {error && <p className="banner banner-error">{error}</p>}
      </section>

      {explanation && (
        <section className="card">
          <h2 className="card-title">AI 解释（仅基于上述真实计算结果）</h2>
          <div className="write-content">{explanation}</div>
        </section>
      )}

      {runs.length > 0 && (
        <section className="card">
          <h2 className="card-title">分析记录（{runs.length}）</h2>
          {runs.map((r) => {
            const file = files.find((f) => f.id === r.dataFileId);
            return (
              <div key={r.id} className="lit-item">
                <div className="lit-item-main">
                  <div className="lit-title">
                    {METHOD_LABEL[r.method] ?? r.method}
                    <span className={"badge badge-" + (r.status === "ok" ? "done" : "warn")}>{r.status === "ok" ? "已完成" : "失败"}</span>
                    <span className="muted">{new Date(r.createdAt).toLocaleString("zh-CN")} · {file?.name ?? ""}</span>
                  </div>
                  {r.formula && <div className="muted">公式：{r.formula}</div>}
                  {r.message && <div className="muted">说明：{r.message}</div>}
                  <div className="data-params muted">参数：{JSON.stringify(r.params)}</div>
                  {r.status === "ok" && renderResults(r)}
                </div>
                {r.status === "ok" && (
                  <div className="lit-item-actions">
                    <button className="btn btn-sm" disabled={explaining === r.id} onClick={() => void explain(r.id)}>
                      {explaining === r.id ? "解释中…" : "AI 解释"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
