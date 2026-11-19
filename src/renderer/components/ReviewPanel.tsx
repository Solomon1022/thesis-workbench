import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import { STAGES } from "../../shared/stages";

const api = () => window.thesisWorkbench;

interface Review {
  id: string;
  stageKey: string;
  section: string;
  source: string;
  content: string;
  suggestion: string;
  status: string;
  resolution: string;
  createdAt: number;
  updatedAt: number;
}

const STATUS_OPTIONS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "待处理" },
  { key: "in_progress", label: "处理中" },
  { key: "done", label: "已完成" },
  { key: "deferred", label: "暂不处理" },
];
const STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.key, s.label]));
const SOURCE_OPTIONS = ["导师", "自己", "答辩委员会", "其他审阅者"];

export function ReviewPanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [reviews, setReviews] = useState<Review[]>([]);
  const [filterStage, setFilterStage] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState({ stageKey: "writing", section: "", source: "导师", content: "", suggestion: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setReviews(await a.reviewList(projectId)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const create = async () => {
    const a = api();
    if (!a) return;
    if (!form.content.trim()) { setError("请填写意见内容"); return; }
    try {
      await a.reviewCreate({ projectId, stageKey: form.stageKey, section: form.section.trim(), source: form.source, content: form.content.trim(), suggestion: form.suggestion.trim() });
      setForm({ stageKey: "writing", section: "", source: "导师", content: "", suggestion: "" });
      setMessage("审阅意见已记录");
      void refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const update = async (id: string, patch: Partial<Review>) => {
    const a = api();
    if (!a) return;
    await a.reviewUpdate(id, patch);
    void refresh();
  };

  const remove = async (id: string) => {
    const a = api();
    if (!a) return;
    await a.reviewDelete(id);
    void refresh();
  };

  const startEdit = (r: Review) => {
    setEditingId(r.id);
    setForm({ stageKey: r.stageKey, section: r.section, source: r.source, content: r.content, suggestion: r.suggestion });
  };

  const saveEdit = async () => {
    const a = api();
    if (!a) return;
    await a.reviewUpdate(editingId, { stageKey: form.stageKey, section: form.section, source: form.source, content: form.content, suggestion: form.suggestion });
    setEditingId("");
    setForm({ stageKey: "writing", section: "", source: "导师", content: "", suggestion: "" });
    setMessage("意见已更新");
    void refresh();
  };

  const filtered = reviews.filter((r) =>
    (filterStage === "" || r.stageKey === filterStage) &&
    (filterStatus === "" || r.status === filterStatus)
  );

  const counts = (stageKey: string) => reviews.filter((r) => r.stageKey === stageKey && r.status !== "done").length;

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">审阅与修改工作流</h2>
      </div>
      <p className="muted">记录意见来源（导师/自己/答辩委员会/其他）、意见内容与修改建议；状态可流转（待处理→处理中→已完成/暂不处理）；完成修改后填写修改说明，记录保留不删除。</p>

      <div className="field">
        <label>{editingId ? "编辑审阅意见" : "新增审阅意见"}</label>
        <div className="lit-search-row">
          <select className="select" aria-label="意见章节" value={form.stageKey} onChange={(e) => setForm((f) => ({ ...f, stageKey: e.target.value }))}>
            {STAGES.map((s) => <option key={s.key} value={s.key}>{s.name}{counts(s.key) > 0 ? "（" + counts(s.key) + "）" : ""}</option>)}
          </select>
          <input className="input" aria-label="内容区域" placeholder="章节/内容区域（可留空）" value={form.section} onChange={(e) => setForm((f) => ({ ...f, section: e.target.value }))} />
          <select className="select" aria-label="意见来源" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
            {SOURCE_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <textarea className="textarea" aria-label="意见内容" placeholder="意见内容（必填）" value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
        <textarea className="textarea" aria-label="修改建议" placeholder="修改建议（可选）" value={form.suggestion} onChange={(e) => setForm((f) => ({ ...f, suggestion: e.target.value }))} />
        <div className="lit-actions">
          {editingId ? (
            <>
              <button className="btn btn-primary" onClick={() => void saveEdit()}>保存修改</button>
              <button className="btn" onClick={() => { setEditingId(""); setForm({ stageKey: "writing", section: "", source: "导师", content: "", suggestion: "" }); }}>取消</button>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => void create()}>添加意见</button>
          )}
        </div>
      </div>

      <div className="lit-search-row">
        <select className="select" aria-label="筛选章节" value={filterStage} onChange={(e) => setFilterStage(e.target.value)}>
          <option value="">全部章节</option>
          {STAGES.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
        </select>
        <select className="select" aria-label="筛选状态" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
          <option value="">全部状态</option>
          {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <span className="muted">共 {filtered.length} 条</span>
      </div>

      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {filtered.length > 0 ? (
        <div className="lit-list">
          {filtered.map((r) => {
            const stageName = STAGES.find((s) => s.key === r.stageKey)?.name ?? r.stageKey;
            return (
              <div key={r.id} className="lit-item">
                <div className="lit-item-main">
                  <div className="lit-title">
                    <span className={"badge badge-" + (r.status === "done" ? "done" : r.status === "deferred" ? "muted" : "warn")}>{STATUS_LABEL[r.status] ?? r.status}</span>
                    <span className="muted">[{stageName}]{r.section ? " · " + r.section : ""} · 来源：{r.source} · 创建 {new Date(r.createdAt).toLocaleString("zh-CN")}</span>
                  </div>
                  <div className="review-content">{r.content}</div>
                  {r.suggestion && <div className="muted">建议：{r.suggestion}</div>}
                  <div className="lit-search-row">
                    <select className="select" aria-label="意见状态" value={r.status} onChange={(e) => void update(r.id, { status: e.target.value })}>
                      {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <input className="input" aria-label="修改说明" placeholder="修改说明（完成后填写，保留在记录中）" value={r.resolution} onChange={(e) => void update(r.id, { resolution: e.target.value })} />
                  </div>
                  {r.resolution && <div className="lit-note">修改说明：{r.resolution}</div>}
                </div>
                <div className="lit-item-actions">
                  <button className="btn btn-sm" onClick={() => startEdit(r)}>编辑</button>
                  <button className="btn btn-sm btn-danger" onClick={() => void remove(r.id)}>删除</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="empty-hint">还没有审阅意见（或没有符合筛选条件的意见）。</p>
      )}
    </section>
  );
}
