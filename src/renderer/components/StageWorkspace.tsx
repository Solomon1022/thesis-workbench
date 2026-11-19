import { useEffect, useRef, useState } from "react";
import type { ProjectDetail, StageStatus } from "../../shared/types";
import { STAGES } from "../../shared/stages";
import { fieldsFor, METHOD_TEMPLATES } from "../../shared/templates";
import { STATUS_LABEL } from "./StageNav";
import { LiteraturePanel } from "./LiteraturePanel";

export function StageWorkspace({ detail, stageKey, onStatus, onContent }: {
  detail: ProjectDetail;
  stageKey: string;
  onStatus: (stageKey: string, status: StageStatus, skipReason: string) => void;
  onContent: (stageKey: string, fieldKey: string, value: string) => Promise<boolean>;
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

  // 阶段或项目切换时，从最新内容初始化，并丢弃旧请求的界面影响
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

  // 关闭保护：有未完成写入或保存失败时提示，避免内容丢失
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

  // 立即发送保存（本地 SQLite 写入为毫秒级，不需要防抖）：
  // 1) 消息发出后主进程按序写入，窗口即使立刻关闭，已发出的写入仍会完成；
  // 2) 无定时器，不存在跨阶段/跨项目的字段名冲突；
  // 3) 响应仅在仍处于同一阶段与项目时更新界面，避免旧响应污染新状态。
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

      {stageKey === "literature" && <LiteraturePanel detail={detail} />}
    </div>
  );
}
