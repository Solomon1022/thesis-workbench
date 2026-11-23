import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import type { LiteratureItem } from "../../shared/literature";
import { mdit } from "./mdlite";

const api = () => window.thesisWorkbench;

interface GeneratedDirection {
  question: string;
  basisLitIds: string[];
  basis: LiteratureItem[];
  missingBasis: boolean;
  dataPath: string;
  feasibility: string;
  limitations: string;
}

interface SavedDirection {
  id: string;
  question: string;
  basisLitIds: string[];
  dataPath: string;
  feasibility: string;
  limitations: string;
  aiGenerated: boolean;
  createdAt: number;
}

interface HypothesisCard {
  id?: string;
  number: string;
  statement: string;
  iv: string;
  dv: string;
  basis: string;
}

function openUrl(url: string) {
  if (url) void api()?.openExternal(url);
}

/** 依据文献行（真实文献库条目；缺失时明确标注） */
function BasisLine({ ids, basis }: { ids: string[]; basis: LiteratureItem[] }) {
  if (basis.length === 0) return <span className="badge badge-warn">来源待核验</span>;
  return (
    <span className="lit-basis">
      {basis.map((l) => (
        <button key={l.id} className="chip chip-link" onClick={() => openUrl(l.url)} title={l.authors + " " + l.year}>
          {l.title.slice(0, 40)}
        </button>
      ))}
    </span>
  );
}

/* ============ 选题工作台（前期检索与选题阶段） ============ */

export function TopicPanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [inputs, setInputs] = useState({ object: "", interests: "", timeCondition: "", dataCondition: "" });
  const [directions, setDirections] = useState<GeneratedDirection[]>([]);
  const [saved, setSaved] = useState<SavedDirection[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setSaved(await a.stage4ListDirections(projectId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const generate = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await a.stage4GenerateDirections(projectId, {
        discipline: detail.project.disciplines.join("、"),
        interests: inputs.interests,
        object: inputs.object,
        timeCondition: inputs.timeCondition,
        dataCondition: inputs.dataCondition,
      });
      if (r.ok && r.directions) {
        setDirections(r.directions);
        setMessage(r.message + (r.provider ? "（" + r.provider + " / " + r.model + "）" : ""));
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveDirection = async (d: GeneratedDirection) => {
    const a = api();
    if (!a) return;
    await a.stage4SaveDirection(projectId, d);
    setMessage("候选方向已保存");
    void refresh();
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">选题工作台（AI 辅助，依据真实文献库）</h2>
      </div>
      <p className="muted">AI 生成候选方向时只能引用本项目的文献库条目；引用不了的内容会标注「来源待核验」。生成结果需你判断与修改，不是结论。</p>
      <div className="form-grid">
        <div className="field"><label>研究对象 / 场景</label><input className="input" aria-label="研究对象" value={inputs.object} onChange={(e) => setInputs((p) => ({ ...p, object: e.target.value }))} placeholder="如：直播电商消费者 / 钙钛矿薄膜稳定性" /></div>
        <div className="field"><label>兴趣 / 背景</label><input className="input" aria-label="兴趣背景" value={inputs.interests} onChange={(e) => setInputs((p) => ({ ...p, interests: e.target.value }))} placeholder="你已有的知识、偏好或前置工作" /></div>
        <div className="field"><label>时间条件</label><input className="input" aria-label="时间条件" value={inputs.timeCondition} onChange={(e) => setInputs((p) => ({ ...p, timeCondition: e.target.value }))} placeholder="如：一学期 / 三个月" /></div>
        <div className="field"><label>数据 / 资源条件</label><input className="input" aria-label="数据条件" value={inputs.dataCondition} onChange={(e) => setInputs((p) => ({ ...p, dataCondition: e.target.value }))} placeholder="如：可发问卷 / 有 GPU / 实验室条件" /></div>
      </div>
      <div className="lit-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => void generate()}>AI 生成候选方向</button>
      </div>
      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {directions.length > 0 && (
        <div className="lit-candidates">
          {directions.map((d, i) => (
            <div key={i} className="lit-candidate">
              <div className="lit-candidate-main">
                <div className="lit-title">{d.question}<span className="badge badge-warn">AI 生成</span></div>
                <div className="muted">依据：<BasisLine ids={d.basisLitIds} basis={d.basis} /></div>
                <div className="muted">数据路径：{d.dataPath || "未说明"}</div>
                <div className="muted">可行性：{d.feasibility || "未说明"}</div>
                <div className="muted">限制与风险：{d.limitations || "未说明"}</div>
              </div>
              <div className="lit-candidate-actions">
                <button className="btn btn-sm btn-primary" onClick={() => void saveDirection(d)}>保存方向</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {saved.length > 0 && (
        <div className="lit-list">
          {saved.map((d) => (
            <div key={d.id} className="lit-item">
              <div className="lit-item-main">
                <div className="lit-title">{d.question}{d.aiGenerated && <span className="badge badge-warn">AI 生成</span>}</div>
                <div className="muted">数据路径：{d.dataPath || "未说明"} · 可行性：{d.feasibility || "未说明"} · 限制：{d.limitations || "未说明"}</div>
              </div>
              <div className="lit-item-actions">
                <button className="btn btn-sm btn-danger" onClick={async () => { await api()?.stage4DeleteDirection(d.id); void refresh(); }}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ============ 版本管理（设计 / 开题阶段共用） ============ */

export function VersionSection({ projectId, stageKey, buildContent, onRestore }: {
  projectId: string;
  stageKey: string;
  buildContent: () => string;
  onRestore: (contentJson: string, warning: string) => void;
}) {
  const [versions, setVersions] = useState<Array<{ id: number; versionNo: number; note: string; name: string; createdAt: number }>>([]);
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    const list = await a.stage4ListVersions(projectId, stageKey);
    setVersions(list.map((v) => ({ id: v.id, versionNo: v.versionNo, note: v.note, name: v.name ?? "", createdAt: v.createdAt })));
  }, [projectId, stageKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    const a = api();
    if (!a) return;
    await a.stage4SaveVersion(projectId, stageKey, buildContent(), note.trim(), name.trim());
    setNote("");
    setName("");
    setMessage("版本已保存");
    void refresh();
  };

  const rename = async (id: number, currentName: string) => {
    const a = api();
    if (!a) return;
    const newName = window.prompt("给这个版本起个名字：", currentName);
    if (newName === null) return;
    await a.stage4RenameVersion(id, newName.trim());
    setMessage("版本名称已更新");
    void refresh();
  };

  const restore = async (id: number) => {
    const a = api();
    if (!a) return;
    const r = await a.stage4RestoreVersion(id);
    if (r) {
      onRestore(r.contentJson, r.warning);
      setMessage(r.warning);
    }
  };

  return (
    <section className="card">
      <h2 className="card-title">版本管理</h2>
      <p className="muted">关键产物（研究设计 / 开题）可保存版本快照；恢复旧版本会提示下游内容需人工复核，不会自动覆盖或删除旧版本。</p>
      <div className="lit-search-row">
        <input className="input" aria-label="版本名称" placeholder="自定义版本名（如：开题定稿 / AI 初稿，可选）" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" aria-label="版本备注" placeholder="版本备注（如：初稿 / 修改变量后）" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="btn btn-primary" onClick={() => void save()}>保存版本</button>
      </div>
      {message && <p className="banner banner-info">{message}</p>}
      {versions.length > 0 && (
        <div className="lit-list">
          {versions.map((v) => (
            <div key={v.id} className="lit-item">
              <div className="lit-item-main">
                <div className="lit-title">{v.name ? v.name + " " : ""}v{v.versionNo} <span className="muted">· {new Date(v.createdAt).toLocaleString("zh-CN")}</span></div>
                <div className="muted">{v.note || "无备注"}</div>
              </div>
              <div className="lit-item-actions">
                <button className="btn btn-sm" onClick={() => void rename(v.id, v.name)}>改名</button>
                <button className="btn btn-sm" onClick={() => void restore(v.id)}>恢复此版本</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ============ 研究设计 AI 起草 + 假设卡片（研究问题与设计阶段） ============ */

export function DesignAssist({ detail, values, onDraft, onRestoreFields }: {
  detail: ProjectDetail;
  values: Record<string, string>;
  onDraft: (drafts: Record<string, string>) => void;
  onRestoreFields: (fields: Record<string, string>) => void;
}) {
  const projectId = detail.project.id;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [hypotheses, setHypotheses] = useState<HypothesisCard[]>([]);

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setHypotheses(await a.stage4ListHypotheses(projectId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const generate = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await a.stage4GenerateDesignDraft(projectId);
      if (r.ok && r.draft) {
        const draft = r.draft;
        onDraft(draft.fields);
        if (draft.hypotheses.length > 0) {
          setHypotheses((prev) => [...prev, ...draft.hypotheses]);
        }
        setMessage(r.message + (r.provider ? "（" + r.provider + " / " + r.model + "）" : "") + "；假设卡片请复核后保存");
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const updateCard = (i: number, patch: Partial<HypothesisCard>) => {
    setHypotheses((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const saveHypotheses = async () => {
    const a = api();
    if (!a) return;
    await a.stage4ReplaceHypotheses(projectId, hypotheses.filter((h) => h.statement.trim()));
    setMessage("假设卡片已保存");
    void refresh();
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">研究设计 AI 辅助（草稿，需人工复核）</h2>
        <button className="btn btn-primary" disabled={busy} onClick={() => void generate()}>AI 起草设计内容</button>
      </div>
      <p className="muted">按本方法模板字段起草，字段内容会填入上方对应输入框并自动保存；问卷方法同时生成假设卡片。AI 不编造数据与文献，不确定处写「待核验」。</p>
      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {hypotheses.length > 0 && (
        <div className="hypo-list">
          {hypotheses.map((h, i) => (
            <div key={i} className="hypo-card">
              <div className="lit-search-row">
                <input className="input hypo-num" aria-label="假设编号" value={h.number} onChange={(e) => updateCard(i, { number: e.target.value })} />
                <input className="input" aria-label="假设陈述" placeholder="假设陈述" value={h.statement} onChange={(e) => updateCard(i, { statement: e.target.value })} />
              </div>
              <div className="lit-search-row">
                <input className="input" aria-label="自变量" placeholder="自变量（IV）" value={h.iv} onChange={(e) => updateCard(i, { iv: e.target.value })} />
                <input className="input" aria-label="因变量" placeholder="因变量（DV）" value={h.dv} onChange={(e) => updateCard(i, { dv: e.target.value })} />
              </div>
              <div className="lit-search-row">
                <input className="input" aria-label="假设依据" placeholder="依据（文献或待核验）" value={h.basis} onChange={(e) => updateCard(i, { basis: e.target.value })} />
                <button className="btn btn-sm btn-danger" onClick={() => setHypotheses((prev) => prev.filter((_, idx) => idx !== i))}>移除</button>
              </div>
            </div>
          ))}
          <div className="lit-actions">
            <button className="btn" onClick={() => setHypotheses((prev) => [...prev, { number: "H" + (prev.length + 1), statement: "", iv: "", dv: "", basis: "" }])}>添加空白卡片</button>
            <button className="btn btn-primary" onClick={() => void saveHypotheses()}>保存假设卡片</button>
          </div>
        </div>
      )}

      <VersionSection
        projectId={projectId}
        stageKey="design"
        buildContent={() => JSON.stringify({ fields: values, hypotheses })}
        onRestore={(contentJson, warning) => {
          try {
            const parsed = JSON.parse(contentJson) as { fields?: Record<string, string>; hypotheses?: HypothesisCard[] };
            if (parsed.fields) onRestoreFields(parsed.fields);
            if (parsed.hypotheses) setHypotheses(parsed.hypotheses);
            setMessage(warning);
          } catch { setError("版本内容解析失败"); }
        }}
      />
    </section>
  );
}

/* ============ 开题报告框架（开题报告阶段：MD 分节流式生成、实时预览、可编辑、导出 Word） ============ */

export function ProposalPanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [md, setMd] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");

  useEffect(() => {
    const a = api();
    if (!a) return;
    const off = a.onProposalSection((s) => {
      setProgress("正在生成第 " + (s.index + 1) + "/" + s.total + " 节：" + s.title);
    });
    return () => off();
  }, []);

  const generate = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    setMessage("");
    setProgress("");
    try {
      const r = await a.stage4GenerateProposal(projectId);
      if (r.ok && r.md) {
        setMd(r.md);
        setMessage(r.message + (r.provider ? "（" + r.provider + " / " + r.model + "）" : ""));
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  const exportWord = async () => {
    const a = api();
    if (!a || !md.trim()) return;
    try {
      const r = await a.stage4ExportProposalDocx(projectId, md);
      if (r.ok) setMessage(r.message);
      else setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">开题报告框架（AI 草稿 · MD 实时生成，可编辑）</h2>
        <span>
          <button className="btn btn-primary" disabled={busy} onClick={() => void generate()}>{busy ? "生成中…" : "生成开题框架"}</button>{" "}
          <button className="btn" disabled={!md.trim()} onClick={() => void exportWord()}>导出 Word（按模板样式）</button>
        </span>
      </div>
      <p className="muted">严格按学校《开题报告》表格架构生成：AI 只写「研究目的、意义（价值）及相关领域研究现状」「拟研究的主要问题、新颖性及拟采用的研究方法」两大块（按主研究方向，不包含候选研究方向）；主要参考文献与整体进度安排由程序按文献库与项目截止时间自动生成（真实、不编造）。生成过程逐节实时显示，左侧编辑 MD、右侧实时预览；正式提交用「导出 Word」按设置里的页面/字体/行距排版。</p>
      {busy && progress && <p className="muted search-progress">生成进度：{progress}</p>}
      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {md.trim() ? (
        <div className="proposal-md">
          <textarea className="textarea proposal-md-edit" aria-label="开题报告 Markdown 编辑器" value={md} onChange={(e) => setMd(e.target.value)} spellCheck={false} />
          <div className="proposal-md-preview md-body" dangerouslySetInnerHTML={{ __html: mdit(md) }} />
        </div>
      ) : (
        <p className="empty-hint">尚未生成。点击「生成开题框架」，AI 会逐节生成并实时显示。</p>
      )}

      <VersionSection
        projectId={projectId}
        stageKey="proposal"
        buildContent={() => JSON.stringify({ md })}
        onRestore={(contentJson, warning) => {
          try {
            const parsed = JSON.parse(contentJson) as { md?: string; sections?: Array<{ title: string; content: string }> };
            if (typeof parsed.md === "string") {
              setMd(parsed.md);
            } else if (Array.isArray(parsed.sections)) {
              // 旧版本（分节结构）兼容：转成 MD
              setMd(parsed.sections.map((s) => "## " + s.title + "\n\n" + s.content).join("\n\n"));
            }
            setMessage(warning);
          } catch { setError("版本内容解析失败"); }
        }}
      />
    </section>
  );
}
