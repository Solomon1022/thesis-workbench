import { useState } from "react";
import type { ProjectDetail } from "../../shared/types";

const api = () => window.thesisWorkbench;

interface WriteResult {
  stage: string;
  content: string;
  claims: Array<{ statement: string; source_ids: string[]; status: string }>;
  gaps: Array<{ claim: string; missing: string; action: string }>;
  nextSteps: string[];
  materials: Array<{ refId: string; title: string; url: string; kind: string }>;
  unlistedRefs: string[];
  provider?: string;
  model?: string;
}

function openUrl(url: string) {
  if (url) void api()?.openExternal(url);
}

/** 把正文里的 [@ref_N] 渲染成可点击引用标记 */
function renderContent(content: string, materials: WriteResult["materials"]) {
  const map = new Map(materials.map((m) => [m.refId, m]));
  const parts = content.split(/(\[@ref_\d+\])/g);
  return parts.map((p, i) => {
    const m2 = p.match(/^\[@(ref_\d+)\]$/);
    if (m2 && map.has(m2[1])) {
      const mat = map.get(m2[1]) as WriteResult["materials"][number];
      return (
        <button key={i} className="chip chip-link cite" title={mat.title} onClick={() => openUrl(mat.url)}>
          {p}
        </button>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

export function WritingPanel({ detail, onSaveDraft }: { detail: ProjectDetail; onSaveDraft: (content: string) => void }) {
  const projectId = detail.project.id;
  const [instruction, setInstruction] = useState("根据材料，帮我写研究背景与文献综述部分。");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<WriteResult | null>(null);

  const generate = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    setMessage("");
    setResult(null);
    try {
      const r = await a.writingGenerate(projectId, instruction, { query: query.trim() || undefined, topK: 5 });
      setResult(r);
      setMessage("生成完成（" + (r.provider ?? "") + " / " + (r.model ?? "") + "）。引用 [@ref_N] 只对应下方真实材料，可点击核对来源。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">AI 写作（接地文献库的 RAG）</h2>
        <button className="btn btn-primary" disabled={busy} onClick={() => void generate()}>AI 写作</button>
      </div>
      <p className="muted">正文只允许引用下方「材料清单」中的真实文献与证据卡片（[&#64;ref_N] 可点击核对来源）；没有依据的论断进入缺口清单，而不是写成「待核验」占位。缺口本身不隐藏，逐条列出缺什么、补什么材料。</p>
      <div className="field">
        <label>写作指令（指定阶段：文献梳理 / 开题框架 / 假设卡片 / 正文草稿 / 审稿修改）</label>
        <textarea className="textarea" aria-label="写作指令" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
      </div>
      <div className="lit-search-row">
        <input className="input" aria-label="检索词" placeholder="检索词（留空则用指令本身检索文献库）" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {result && (
        <div className="write-result">
          <div className="write-head">
            <span className="badge">阶段：{result.stage}</span>
            {result.unlistedRefs.length > 0 && (
              <span className="badge badge-warn">存在材料清单外的引用编号：{result.unlistedRefs.join("、")}（请人工核对）</span>
            )}
          </div>

          <div className="write-section">
            <h3>正文草稿</h3>
            <div className="write-content">{renderContent(result.content, result.materials)}</div>
            <button className="btn btn-sm" onClick={() => { onSaveDraft(result.content); setMessage("已保存到本阶段草稿"); }}>保存到本阶段草稿</button>
          </div>

          {result.materials.length > 0 && (
            <div className="write-section">
              <h3>材料清单（本次检索的真实来源）</h3>
              {result.materials.map((m) => (
                <div key={m.refId} className="lit-log-row">
                  <button className="chip chip-link" onClick={() => openUrl(m.url)}>[{m.refId}] {m.title.slice(0, 60)}</button>
                  <span className="muted">{m.kind === "evidence" ? " · 证据卡片" : ""}</span>
                </div>
              ))}
            </div>
          )}

          {result.claims.length > 0 && (
            <div className="write-section">
              <h3>论断清单（claims）</h3>
              {result.claims.map((c, i) => (
                <div key={i} className="lit-log-row">
                  {c.statement}
                  <span className="muted"> {c.source_ids.join(" ") + " · " + c.status}</span>
                </div>
              ))}
            </div>
          )}

          {result.gaps.length > 0 && (
            <div className="write-section">
              <h3>缺口清单（gaps）</h3>
              {result.gaps.map((g, i) => (
                <div key={i} className="gap-row">
                  <div><strong>{i + 1}. {g.claim}</strong></div>
                  <div className="muted">缺什么：{g.missing || "未说明"}</div>
                  <div className="muted">怎么补：{g.action || "未说明"}</div>
                </div>
              ))}
            </div>
          )}

          {result.nextSteps.length > 0 && (
            <div className="write-section">
              <h3>下一步</h3>
              {result.nextSteps.map((s, i) => <div key={i} className="muted">{s}</div>)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
