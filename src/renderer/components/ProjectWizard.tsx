import { useState } from "react";
import type { ProjectInput } from "../../shared/types";
import { ProjectInfoForm, type ProjectFormValues } from "./ProjectInfoForm";

export function ProjectWizard({ busy, onCancel, onCreate }: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: ProjectInput) => void;
}) {
  const [error, setError] = useState("");

  const submit = (values: ProjectFormValues) => {
    setError("");
    try {
      onCreate({
        name: values.name,
        disciplines: values.disciplines,
        methods: values.methods,
        researchMethod: values.researchMethod,
        educationLevel: values.education,
        deadline: values.deadline,
        materials: values.materials,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="新建项目">
        <h2>新建项目</h2>
        <p className="muted">按顺序来：学科 → 学历 → 选题（可 AI 生成）→ 研究方法（多选/自定义/AI 推荐）→ 截止日期与已有材料。之后在第 0 项随时可以修改。</p>
        <ProjectInfoForm mode="create" onSubmit={submit} submitLabel={busy ? "创建中…" : "创建项目"} busy={busy} />
        {error && <p className="banner banner-error">{error}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
        </div>
      </div>
    </div>
  );
}
