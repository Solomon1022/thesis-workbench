import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectDetail, StageStatus } from "../../shared/types";
import { STAGES } from "../../shared/stages";
import { fieldsFor, METHOD_TEMPLATES } from "../../shared/templates";
import { STATUS_LABEL } from "./StageNav";
import { LiteraturePanel } from "./LiteraturePanel";
import { ProposalPanel, VersionSection } from "./Stage4Panels";
import { WritingPanel } from "./WritingPanel";
import { AnalysisPanel, DataPanel } from "./DataPanels";
import { ReviewPanel } from "./ReviewPanel";
import { ExportPanel } from "./ExportPanel";
import { AiAssistant, StageGuide, VariableEditor, type AiTarget } from "./AiAssistant";
import { EstablishPanel } from "./EstablishPanel";

const api = () => window.thesisWorkbench;

interface HypothesisCard {
  number: string;
  statement: string;
  iv: string;
  dv: string;
  basis: string;
}

const AI_STAGES = ["topic", "design", "writing", "proposal"];

export function StageWorkspace({ detail, stageKey, onStatus, onContent, onProjectRestored }: {
  detail: ProjectDetail;
  stageKey: string;
  onStatus: (stageKey: string, status: StageStatus, skipReason: string) => void;
  onContent: (stageKey: string, fieldKey: string, value: string) => Promise<boolean>;
  onProjectRestored: () => void;
}) {
  const stageDef = STAGES.find((s) => s.key === stageKey);
  const stageIndex = STAGES.findIndex((s) => s.key === stageKey);
  const nextStage = stageIndex >= 0 && stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;
  const record = detail.stages.find((s) => s.stageKey === stageKey);
  const status = record?.status ?? "not_started";
  const { fields, isGeneric } = fieldsFor(detail.project.researchMethod, stageKey);
  const methodLabel = METHOD_TEMPLATES[detail.project.researchMethod]?.label ?? "未选方法";

  const [values, setValues] = useState<Record<string, string>>(detail.content[stageKey] ?? {});
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedAt, setSavedAt] = useState("");
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const pendingRef = useRef(0);
  const failedRef = useRef<Set<string>>(new Set());
  const stageRef = useRef(stageKey);
  const projectRef = useRef(detail.project.id);

  // 假设卡片（设计阶段）
  const [hypotheses, setHypotheses] = useState<HypothesisCard[]>([]);
  const [savedDirections, setSavedDirections] = useState<Array<{ id: string; question: string; dataPath: string; feasibility: string; limitations: string }>>([]);

  useEffect(() => {
    stageRef.current = stageKey;
    projectRef.current = detail.project.id;
    setValues(detail.content[stageKey] ?? {});
    setSaveState("idle");
    setSavedAt("");
    failedRef.current = new Set();
    pendingRef.current = 0;
    setSkipOpen(false);
    setSkipReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, detail.project.id]);

  const loadStageExtras = useCallback(async () => {
    const a = api();
    if (!a) return;
    if (stageKey === "design") {
      try { setHypotheses(await a.stage4ListHypotheses(detail.project.id)); } catch { /* ignore */ }
    }
    if (stageKey === "topic") {
      try {
        const list = await a.stage4ListDirections(detail.project.id);
        setSavedDirections(list.map((d) => ({ id: d.id, question: d.question, dataPath: d.dataPath, feasibility: d.feasibility, limitations: d.limitations })));
      } catch { /* ignore */ }
    }
  }, [stageKey, detail.project.id]);

  useEffect(() => { void loadStageExtras(); }, [loadStageExtras]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (pendingRef.current > 0 || failedRef.current.size > 0) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  if (!stageDef) return <div className="empty-hint">未知阶段</div>;

  const sendValue = (fieldKey: string, value: string) => {
    const requestStage = stageRef.current;
    const requestProject = projectRef.current;
    pendingRef.current += 1;
    setSaveState("saving");
    void onContent(requestStage, fieldKey, value).then((ok) => {
      if (stageRef.current !== requestStage || projectRef.current !== requestProject) return;
      if (ok) failedRef.current.delete(fieldKey); else failedRef.current.add(fieldKey);
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      if (pendingRef.current === 0) {
        if (failedRef.current.size > 0) {
          setSaveState("failed");
        } else {
          setSaveState("saved");
          setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
        }
      }
    });
  };

  const setValue = (fieldKey: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldKey]: value }));
    sendValue(fieldKey, value);
  };

  const retryFailed = () => {
    for (const fieldKey of failedRef.current) {
      sendValue(fieldKey, values[fieldKey] ?? "");
    }
  };

  const statusAction = (next: StageStatus, reason = "") => {
    onStatus(stageKey, next, reason);
  };

  // 问卷方法的选题阶段：研究对象与场景用变量编辑器替代 direction 字段
  const hideDirectionField = stageKey === "topic" && detail.project.researchMethod === "questionnaire";
  const visibleFields = hideDirectionField ? fields.filter((f) => f.key !== "direction") : fields;

  const variablesJson = values["variables"] ?? "";
  const setVariables = (json: string) => {
    setValues((prev) => ({ ...prev, variables: json }));
    sendValue("variables", json);
  };

  const aiTargets: AiTarget[] = (() => {
    if (stageKey === "topic") {
      const t: AiTarget[] = [];
      if (detail.project.researchMethod === "questionnaire") {
        t.push({ key: "variables", label: "研究对象变量（自变量/因变量/中介变量）", kind: "variables" });
      } else {
        t.push({ key: "direction", label: "研究方向与关键词" });
      }
      t.push({ key: "candidates", label: "候选研究问题" });
      t.push({ key: "sample_access", label: "样本可获得性（能否接触研究对象）" });
      return t;
    }
    if (stageKey === "design") {
      return [...fields.filter((f) => f.key !== "hypotheses").map((f) => ({ key: f.key, label: f.label })), { key: "hypotheses", label: "研究假设卡片", kind: "hypotheses" as const }];
    }
    if (stageKey === "writing") {
      return [
        { key: "title", label: "论文标题" },
        { key: "abstract", label: "摘要" },
        { key: "keywords", label: "关键词" },
      ];
    }
    return [];
  })();

  const handleAiFill = (key: string, content: string) => {
    const a = api();
    if (key === "variables") {
      try {
        const parsed = JSON.parse(content) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          setVariables(JSON.stringify(parsed));
          return;
        }
      } catch { /* 原样保存 */ }
      setVariables(content);
      return;
    }
    if (key === "hypotheses") {
      try {
        const arr = JSON.parse(content);
        if (Array.isArray(arr)) {
          const cards: HypothesisCard[] = arr.map((h) => {
            const r = (h ?? {}) as Record<string, unknown>;
            return { number: String(r.number ?? "H"), statement: String(r.statement ?? ""), iv: String(r.iv ?? ""), dv: String(r.dv ?? ""), basis: String(r.basis ?? "") };
          }).filter((h) => h.statement.trim());
          if (cards.length > 0 && a) {
            const merged = [...hypotheses, ...cards];
            setHypotheses(merged);
            void a.stage4ReplaceHypotheses(detail.project.id, merged);
          }
          return;
        }
      } catch { /* 非 JSON：回退写入字段文本，不静默丢弃 */ }
      setValues((prev) => ({ ...prev, hypotheses: content }));
      sendValue("hypotheses", content);
      return;
    }
    setValues((prev) => ({ ...prev, [key]: content }));
    sendValue(key, content);
  };

  const updateCard = (i: number, patch: Partial<HypothesisCard>) => {
    setHypotheses((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  };

  const saveHypotheses = async () => {
    const a = api();
    if (!a) return;
    await a.stage4ReplaceHypotheses(detail.project.id, hypotheses.filter((h) => h.statement.trim()));
    void loadStageExtras();
  };

  return (
    <div className="workspace-inner">
      <div className="ws-head">
        <div>
          <h1>{stageDef.name}</h1>
          <div className="ws-meta">
            方法模板：{methodLabel}
            {isGeneric && fields.length > 0 && <span className="badge badge-warn">通用字段（该方法的专门模板待补充）</span>}
          </div>
        </div>
        <div className="ws-save">
          {saveState === "saving" && <span>保存中…</span>}
          {saveState === "failed" && (
            <>
              <span className="save-failed">保存失败（部分内容未写入）</span>
              <button className="btn btn-sm" onClick={retryFailed}>重试</button>
            </>
          )}
          {saveState === "saved" && savedAt && <span>已自动保存 {savedAt}</span>}
        </div>
      </div>

      <StageGuide stageDef={stageDef} index={stageIndex} variant={stageKey === "establish" ? "table" : "flow"} />

      {stageKey === "establish" ? (
        <EstablishPanel detail={detail} onUpdated={() => onProjectRestored()} />
      ) : (
        <section className="card">
          <div className="card-head-row">
            <h2 className="card-title">本阶段内容</h2>
            <div className="ws-actions">
              <span className={"badge badge-" + status}>{STATUS_LABEL[status]}</span>
              {record?.skipReason && <span className="muted" style={{ fontSize: 12 }}>{record.skipReason}</span>}
              {status === "not_started" && <button className="btn btn-sm btn-primary" onClick={() => statusAction("in_progress")}>开始此阶段</button>}
              {status === "in_progress" && (
                <>
                  <button className="btn btn-sm" onClick={() => statusAction("done")}>标记完成</button>
                  <button className="btn btn-sm" onClick={() => statusAction("needs_review")}>需复核</button>
                </>
              )}
              {status === "needs_review" && (
                <>
                  <button className="btn btn-sm" onClick={() => statusAction("done")}>标记完成</button>
                  <button className="btn btn-sm" onClick={() => statusAction("in_progress")}>继续修改</button>
                </>
              )}
              {status === "done" && <button className="btn btn-sm" onClick={() => statusAction("in_progress")}>重新打开</button>}
              {status === "skipped" ? (
                <button className="btn btn-sm" onClick={() => statusAction("not_started")}>恢复此阶段</button>
              ) : (
                <button className="btn btn-sm" onClick={() => setSkipOpen(!skipOpen)}>跳过此阶段</button>
              )}
              {skipOpen && (
                <span className="skip-row">
                  <input className="input input-inline" placeholder="跳过原因（必填）" value={skipReason} onChange={(e) => setSkipReason(e.target.value)} />
                  <button className="btn btn-sm" disabled={!skipReason.trim()} onClick={() => { statusAction("skipped", skipReason.trim()); setSkipOpen(false); }}>确认跳过</button>
                </span>
              )}
            </div>
          </div>

          {visibleFields.length > 0 && (
            <div className="fields">
              {visibleFields.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={"field-" + f.key}>{f.label}{f.placeholder?.includes("选填") ? <span className="optional-tag">选填</span> : null}</label>
                  {f.kind === "textarea" ? (
                    <textarea id={"field-" + f.key} className="textarea" placeholder={f.placeholder}
                      value={values[f.key] ?? ""} onChange={(e) => setValue(f.key, e.target.value)} />
                  ) : (
                    <input id={"field-" + f.key} className="input" placeholder={f.placeholder}
                      value={values[f.key] ?? ""} onChange={(e) => setValue(f.key, e.target.value)} />
                  )}
                  {f.help && <span className="hint">{f.help}</span>}
                </div>
              ))}
            </div>
          )}

          {stageKey === "topic" && detail.project.researchMethod === "questionnaire" && (
            <div className="var-editor-wrap">
              <VariableEditor value={variablesJson} onChange={setVariables} />
            </div>
          )}

          {stageKey === "design" && hypotheses.length > 0 && (
            <div className="hypo-list-saved">
              <div className="card-head-row">
                <h3 className="ai-title">已保存研究假设（{hypotheses.length} 条，AI 生成后自动保存）</h3>
              </div>
              {hypotheses.map((h, i) => (
                <div key={i} className="lit-item">
                  <div className="lit-item-main">
                    <div className="lit-title">{h.number} {h.statement}</div>
                    <div className="muted">自变量：{h.iv || "未填"} · 因变量：{h.dv || "未填"} · 依据：{h.basis || "待核验"}</div>
                  </div>
                  <div className="lit-item-actions">
                    <button className="btn btn-sm btn-danger" onClick={() => {
                      const next = hypotheses.filter((_, idx) => idx !== i);
                      setHypotheses(next);
                      const a = api();
                      if (a) void a.stage4ReplaceHypotheses(detail.project.id, next);
                    }}>移除</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {AI_STAGES.includes(stageKey) && (
            <AiAssistant detail={detail} stageKey={stageKey} targets={aiTargets} onFill={handleAiFill} />
          )}

          {stageKey === "topic" && savedDirections.length > 0 && (
            <div className="lit-list">
              {savedDirections.map((d) => (
                <div key={d.id} className="lit-item">
                  <div className="lit-item-main">
                    <div className="lit-title">{d.question}<span className="badge badge-warn">AI 生成</span></div>
                    <div className="muted">数据路径：{d.dataPath || "未说明"} · 可行性：{d.feasibility || "未说明"} · 限制：{d.limitations || "未说明"}</div>
                  </div>
                  <div className="lit-item-actions">
                    <button className="btn btn-sm btn-danger" onClick={async () => { const a = api(); if (!a) return; await a.stage4DeleteDirection(d.id); void loadStageExtras(); }}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {stageKey === "design" && (
        <VersionSection
          projectId={detail.project.id}
          stageKey="design"
          buildContent={() => JSON.stringify({ fields: values, hypotheses })}
          onRestore={(contentJson, warning) => {
            try {
              const parsed = JSON.parse(contentJson) as { fields?: Record<string, string>; hypotheses?: HypothesisCard[] };
              if (parsed.fields) {
                setValues((prev) => ({ ...prev, ...parsed.fields }));
                for (const [fieldKey, value] of Object.entries(parsed.fields)) sendValue(fieldKey, value);
              }
              if (parsed.hypotheses) {
                setHypotheses(parsed.hypotheses);
                const a = api();
                if (a) void a.stage4ReplaceHypotheses(detail.project.id, parsed.hypotheses);
              }
              // 提示由 VersionSection 内部展示
              void warning;
            } catch { /* 版本内容解析失败（由 VersionSection 提示） */ }
          }}
        />
      )}

      {stageDef.pending && (
        <div className="banner banner-info">未接入提示：{stageDef.pending}</div>
      )}

      {stageKey === "literature" && <LiteraturePanel detail={detail} />}

      {stageKey === "proposal" && <ProposalPanel detail={detail} />}

      {stageKey === "writing" && (
        <WritingPanel
          detail={detail}
          onSaveDraft={(content) => {
            setValues((prev) => ({ ...prev, draft: content }));
            sendValue("draft", content);
          }}
        />
      )}

      {stageKey === "data" && <DataPanel detail={detail} />}

      {stageKey === "analysis" && <AnalysisPanel detail={detail} />}

      {stageKey === "revision" && <ReviewPanel detail={detail} />}

      {stageKey === "archive" && <ExportPanel detail={detail} onRestored={() => onProjectRestored()} />}
    </div>
  );
}
