import type { ProjectDetail } from "../../shared/types";
import { MATERIAL_SUMMARY } from "./ProjectHome.helpers";
import { METHOD_TEMPLATES, materialGaps, suggestStartStage } from "../../shared/templates";
import { STAGES } from "../../shared/stages";

export function ProjectHome({ detail, onOpenStage, onDelete }: {
  detail: ProjectDetail;
  onOpenStage: (key: string) => void;
  onDelete: () => void;
}) {
  const p = detail.project;
  const method = METHOD_TEMPLATES[p.researchMethod];
  const suggestion = suggestStartStage(p.materials);
  const suggested = detail.stages.find((s) => s.stageKey === suggestion.stageKey);
  const nextTodo = detail.stages.find((s) => s.status === "in_progress") ?? detail.stages.find((s) => s.status === "not_started");
  const gaps = materialGaps(p.materials);
  const doneCount = detail.stages.filter((s) => s.status === "done").length;
  const updated = new Date(p.updatedAt).toLocaleString("zh-CN");
  const deadlineText = p.deadline ? " · 截止 " + p.deadline : "";

  return (
    <div className="home">
      <div className="home-head">
        <div>
          <h1>{p.name}</h1>
          <div className="home-meta">
            {p.disciplines.join("、")} · {method?.label ?? "未选方法"} · {p.educationLevel}
            {deadlineText} · 最近编辑 {updated}
          </div>
        </div>
        <button className="btn btn-danger" onClick={onDelete}>删除项目</button>
      </div>

      <section className="card">
        <h2 className="card-title">下一步</h2>
        {suggested && <p className="muted">进入方式：{suggestion.reasons.join("")}</p>}
        {nextTodo ? (
          <p>
            建议先处理「{STAGES.find((s) => s.key === nextTodo.stageKey)?.name}」阶段。
            <button className="btn btn-sm" style={{ marginLeft: 8 }} onClick={() => onOpenStage(nextTodo.stageKey)}>进入此阶段</button>
          </p>
        ) : (
          <p>全部阶段已完成。</p>
        )}
        <p className="muted">进度：{doneCount} / {STAGES.length} 个阶段已完成。</p>
      </section>

      <section className="card">
        <h2 className="card-title">材料缺口提示</h2>
        <ul className="gap-list">
          {gaps.map((g, i) => <li key={i}>{g}</li>)}
        </ul>
        <p className="muted">缺口不会自动补造：文献、样本与结果必须来自真实来源与实际计算。</p>
      </section>

      <section className="card">
        <h2 className="card-title">已有材料</h2>
        <MATERIAL_SUMMARY materials={p.materials} />
      </section>
    </div>
  );
}
