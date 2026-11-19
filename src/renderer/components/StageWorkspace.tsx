import { useEffect, useRef, useState } from "react";
import type { ProjectDetail, StageStatus } from "../../shared/types";
import { STAGES } from "../../shared/stages";
import { fieldsFor, METHOD_TEMPLATES } from "../../shared/templates";
import { STATUS_LABEL } from "./StageNav";

export function StageWorkspace({ detail, stageKey, onStatus, onContent }: {
  detail: ProjectDetail;
  stageKey: string;
  onStatus: (stageKey: string, status: StageStatus, skipReason: string) => void;
  onContent: (stageKey: string, fieldKey: string, value: string) => void;
}) {
  const stageDef = STAGES.find((s) => s.key === stageKey);
  const stageIndex = STAGES.findIndex((s) => s.key === stageKey);
  const nextStage = stageIndex >= 0 && stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : null;
  const record = detail.stages.find((s) => s.stageKey === stageKey);
  const status = record?.status ?? "not_started";
  const { fields, isGeneric } = fieldsFor(detail.project.researchMethod, stageKey);
  const methodLabel = METHOD_TEMPLATES[detail.project.researchMethod]?.label ?? "未选方法";

  const [values, setValues] = useState<Record<string, string>>(detail.content[stageKey] ?? {});
  const [savedAt, setSavedAt] = useState("");
  const [dirty, setDirty] = useState(false);
  const [skipOpen, setSkipOpen] = useState(false);
  const [skipReason, setSkipReason] = useState("");
  const timers = useRef<Map<string, number>>(new Map());

  // 阶段或项目切换时，从最新内容初始化
  useEffect(() => {
    setValues(detail.content[stageKey] ?? {});
    setSavedAt("");
    setDirty(false);
    setSkipOpen(false);
    setSkipReason("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, detail.project.id]);

  if (!stageDef) return <div className="empty-hint">未知阶段</div>;

  const setValue = (fieldKey: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldKey]: value }));
    setDirty(true);
    const t = timers.current.get(fieldKey);
    if (t) window.clearTimeout(t);
    timers.current.set(fieldKey, window.setTimeout(() => {
      onContent(stageKey, fieldKey, value);
      setDirty(false);
      setSavedAt(new Date().toLocaleTimeString("zh-CN", { hour12: false }));
    }, 500));
  };

  const statusAction = (next: StageStatus, reason = "") => {
    onStatus(stageKey, next, reason);
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
          {dirty ? "保存中…" : savedAt ? "已自动保存 " + savedAt : ""}
        </div>
      </div>

      <section className="card">
        <h2 className="card-title">这一阶段做什么</h2>
        <div className="stage-guide">
          <div><strong>目标：</strong><span>{stageDef.goal}</span></div>
          <div><strong>需要什么材料：</strong><span>{stageDef.inputs.join("；")}</span></div>
          <div><strong>你要做什么：</strong><span>{stageDef.actions.join("；")}</span></div>
          <div><strong>会得到什么：</strong><span>{stageDef.outputs.join("；")}</span></div>
          <div><strong>检查清单：</strong>
            <ul className="check-list">{stageDef.checklist.map((c, i) => <li key={i}>{c}</li>)}</ul>
          </div>
          {nextStage && <div><strong>下一步：</strong><span>{nextStage.name}</span></div>}
        </div>
      </section>

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

        {fields.length === 0 ? (
          <p className="muted">该阶段暂无专门输入字段；可先查看「这一阶段做什么」，完成后再标记状态。</p>
        ) : (
          <div className="fields">
            {fields.map((f) => (
              <div className="field" key={f.key}>
                <label htmlFor={"field-" + f.key}>{f.label}</label>
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
      </section>

      {stageDef.pending && (
        <div className="banner banner-info">未接入提示：{stageDef.pending}</div>
      )}
    </div>
  );
}
