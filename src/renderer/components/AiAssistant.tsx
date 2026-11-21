import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import { STAGES, type StageDef } from "../../shared/stages";

const api = () => window.thesisWorkbench;

/* ================= 全局 AI 助手（建议不自动填入 + 实时对话带记忆） ================= */

export interface AiTarget {
  key: string;
  label: string;
  kind?: "text" | "variables" | "hypotheses";
}

export function AiAssistant({ detail, stageKey, targets, onFill }: {
  detail: ProjectDetail;
  stageKey: string;
  targets: AiTarget[];
  onFill: (key: string, content: string) => void;
}) {
  const projectId = detail.project.id;
  const [history, setHistory] = useState<Array<{ role: string; content: string }>>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<Array<{ key: string; label: string; content: string; note: string }>>([]);
  const [advice, setAdvice] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [filled, setFilled] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setHistory(await a.aiListConversations(projectId, stageKey)); } catch { /* ignore */ }
  }, [projectId, stageKey]);

  useEffect(() => {
    setSuggestions([]);
    setAdvice("");
    setFilled({});
    setMessage("");
    setError("");
    void loadHistory();
  }, [stageKey, loadHistory]);

  const send = async () => {
    const a = api();
    if (!a || !question.trim() || busy) return;
    const q = question.trim();
    setQuestion("");
    setBusy(true);
    setError("");
    setHistory((prev) => [...prev, { role: "user", content: q }]);
    try {
      const r = await a.aiChat(projectId, stageKey, q);
      if (r.ok && r.reply) {
        setHistory((prev) => [...prev, { role: "assistant", content: r.reply as string }]);
      } else {
        setError(r.message || "对话失败");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const suggest = async () => {
    const a = api();
    if (!a || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await a.aiSuggest(projectId, stageKey, targets);
      if (r.ok && r.suggestions) {
        setSuggestions(r.suggestions);
        setAdvice(r.advice ?? "");
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

  const fill = (key: string, label: string, content: string) => {
    onFill(key, content);
    setFilled((prev) => ({ ...prev, [key]: true }));
    setMessage("已填入「" + label + "」，可继续编辑");
  };

  return (
    <div className="ai-assist">
      <div className="card-head-row">
        <h3 className="ai-title">AI 助手（建议不自动填入；对话有记忆，可随时重新提问）</h3>
      </div>

      {targets.length > 0 && (
        <div className="ai-suggest">
          <button className="btn btn-primary" disabled={busy} onClick={() => void suggest()}>为当前阶段生成建议</button>
          {suggestions.map((s) => (
            <div key={s.key} className="ai-suggest-item">
              <div className="ai-suggest-head">
                <strong>{s.label}</strong>
                <button className="btn btn-sm" disabled={filled[s.key]} onClick={() => fill(s.key, s.label, s.content)}>{filled[s.key] ? "已填入" : "填入此内容"}</button>
              </div>
              <div className="write-content">{s.content}</div>
              {s.note && <div className="muted">说明：{s.note}</div>}
            </div>
          ))}
          {advice && (
            <div className="ai-advice">
              <strong>整体建议：</strong>
              <div className="write-content">{advice}</div>
            </div>
          )}
        </div>
      )}

      <div className="ai-chat">
        <div className="ai-chat-list">
          {history.length === 0 && <p className="muted">还没有对话。可以问：这个阶段下一步该做什么？某个字段怎么写更合适？</p>}
          {history.map((h, i) => (
            <div key={i} className={"ai-bubble " + (h.role === "user" ? "ai-user" : "ai-bot")}>
              <span className="ai-role">{h.role === "user" ? "你" : "AI"}</span>
              <div className="write-content">{h.content}</div>
            </div>
          ))}
          {busy && <div className="ai-bubble ai-bot"><span className="ai-role">AI</span><div className="muted">思考中…</div></div>}
        </div>
        <div className="lit-search-row">
          <textarea className="textarea ai-input" ref={inputRef} aria-label="AI 提问" placeholder="输入问题，回车区域发送…" value={question} onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void send(); }} />
        </div>
        <div className="lit-actions">
          <button className="btn btn-primary" disabled={busy || !question.trim()} onClick={() => void send()}>发送</button>
          <button className="btn" onClick={() => { setQuestion(""); inputRef.current?.focus(); }}>重新提问</button>
          <button className="btn" onClick={async () => { const a = api(); if (!a) return; await a.aiClearConversations(projectId, stageKey); setHistory([]); setMessage("对话已清空（记忆已清除）"); }}>清空对话</button>
        </div>
      </div>

      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}
    </div>
  );
}

/* ================= 研究对象变量编辑器（自变量/因变量/中介变量/自定义） ================= */

const VARIABLE_GROUPS: Array<{ key: "iv" | "dv" | "mediator" | "custom"; label: string; hint: string }> = [
  { key: "iv", label: "自变量（IV）", hint: "影响其他变量的变量" },
  { key: "dv", label: "因变量（DV）", hint: "被影响的结果变量" },
  { key: "mediator", label: "中介变量", hint: "解释作用路径的变量（选填）" },
  { key: "custom", label: "自定义变量", hint: "调节变量/控制变量等（选填）" },
];

export function VariableEditor({ value, onChange }: { value: string; onChange: (json: string) => void }) {
  let parsed: Record<string, string[]> = { iv: [], dv: [], mediator: [], custom: [] };
  try {
    const p = JSON.parse(value) as Record<string, unknown>;
    parsed = { iv: [], dv: [], mediator: [], custom: [], ...p } as Record<string, string[]>;
  } catch { /* 使用默认 */ }

  const setGroup = (key: string, items: string[]) => {
    onChange(JSON.stringify({ ...parsed, [key]: items }));
  };

  const setItem = (key: string, index: number, text: string) => {
    const items = [...(parsed[key] ?? [])];
    items[index] = text;
    setGroup(key, items);
  };

  const removeItem = (key: string, index: number) => {
    setGroup(key, (parsed[key] ?? []).filter((_, i) => i !== index));
  };

  return (
    <div className="var-editor">
      <p className="muted">研究对象与场景：把变量分成自变量、因变量、中介变量；可自定义添加其他变量。</p>
      {VARIABLE_GROUPS.map((g) => (
        <div key={g.key} className="var-group">
          <div className="var-group-head">
            <strong>{g.label}</strong>
            <span className="muted">{g.hint}</span>
            <button className="btn btn-sm" onClick={() => setGroup(g.key, [...(parsed[g.key] ?? []), ""])}>+ 添加</button>
          </div>
          {(() => {
            const items = parsed[g.key] ?? [];
            const displayItems = items.length > 0 ? items : [""];
            return displayItems.map((item, i) => (
              <div key={i} className="lit-search-row var-row">
                <input className="input" aria-label={g.label + "变量" + (i + 1)} placeholder="变量名" value={item} onChange={(e) => setItem(g.key, i, e.target.value)} />
                <button className="btn btn-sm btn-danger" onClick={() => removeItem(g.key, i)}>移除</button>
              </div>
            ));
          })()}
        </div>
      ))}
    </div>
  );
}

/* ================= 阶段导航可视化（全局） ================= */

export function StageGuide({ stageDef, index, variant }: { stageDef: StageDef; index: number; variant: "flow" | "table" }) {
  const nextStage = index >= 0 && index < STAGES.length - 1 ? STAGES[index + 1] : null;

  if (variant === "table") {
    return (
      <section className="card">
        <h2 className="card-title">这一阶段做什么（第 0 阶段 · 建立项目与要求）</h2>
        <table className="data-table stage-table">
          <tbody>
            <tr><th className="stage-th">目标</th><td>{stageDef.goal}</td></tr>
            <tr><th className="stage-th">需要什么材料</th><td>{stageDef.inputs.join("；") || "无"}</td></tr>
            <tr><th className="stage-th">你要做什么</th><td>{stageDef.actions.join("；")}</td></tr>
            <tr><th className="stage-th">会得到什么</th><td>{stageDef.outputs.join("；")}</td></tr>
            {nextStage && <tr><th className="stage-th">下一步</th><td>{nextStage.name}</td></tr>}
          </tbody>
        </table>
        <p className="muted stage-brief">整体流程：建立项目（本页）→ 检索选题 → 研究设计 → 文献与开题 → 工具与资料 → 分析 → 写作与审阅 → 答辩归档。内容随阶段推进逐步保存，可随时返回修改。</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2 className="card-title">这一阶段做什么</h2>
      <div className="stage-goal">{stageDef.goal}</div>
      <div className="stage-flow">
        <div className="stage-step"><span className="stage-step-n">1</span><strong>需要材料</strong><span className="muted">{stageDef.inputs.join("、") || "无"}</span></div>
        <span className="stage-arrow">→</span>
        <div className="stage-step"><span className="stage-step-n">2</span><strong>你要做什么</strong><span className="muted">{stageDef.actions.join("、")}</span></div>
        <span className="stage-arrow">→</span>
        <div className="stage-step"><span className="stage-step-n">3</span><strong>会得到什么</strong><span className="muted">{stageDef.outputs.join("、")}</span></div>
      </div>
      <div className="stage-checklist">
        <strong>检查清单：</strong>
        {stageDef.checklist.map((c, i) => <span key={i} className="chip">{c}</span>)}
      </div>
      {nextStage && <div className="muted stage-next">下一步：{nextStage.name}</div>}
    </section>
  );
}
