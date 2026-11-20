import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import { ProjectInfoForm, type ProjectFormValues } from "./ProjectInfoForm";

const api = () => window.thesisWorkbench;

/** 第 0 项：与新建项目共用同一张表单，新建时填写的全部信息都能在这里查看与修改。 */
export function EstablishPanel({ detail, onUpdated }: { detail: ProjectDetail; onUpdated: () => void }) {
  const p = detail.project;
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [showKnowledge, setShowKnowledge] = useState(false);

  const refreshKnowledge = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setKnowledge(await a.aiProjectKnowledge(detail.project.id)); } catch { /* ignore */ }
  }, [detail.project.id]);

  useEffect(() => { void refreshKnowledge(); }, [refreshKnowledge]);

  const save = async (values: ProjectFormValues) => {
    const a = api();
    if (!a) return;
    setError("");
    try {
      await a.updateProject(detail.project.id, {
        name: values.name,
        disciplines: values.disciplines,
        methods: values.methods,
        researchMethod: values.researchMethod,
        educationLevel: values.education,
        deadline: values.deadline,
        materials: values.materials,
      });
      setMessage("第 0 项信息已保存");
      onUpdated();
      void refreshKnowledge();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">项目信息（与新建项目共用，随时可改）</h2>
      </div>
      <ProjectInfoForm
        mode="edit"
        initial={{
          name: p.name,
          disciplines: p.disciplines,
          methods: p.methods ?? (p.researchMethod ? [p.researchMethod] : []),
          researchMethod: p.researchMethod,
          education: p.educationLevel,
          deadline: p.deadline,
          materials: p.materials,
        }}
        onSubmit={(values) => void save(values)}
        submitLabel="保存修改"
      />
      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      <details className="lit-log" open={showKnowledge} onToggle={(e) => setShowKnowledge((e.target as HTMLDetailsElement).open)}>
        <summary>项目知识汇总（AI 调用时读取的完整上下文，随时更新）</summary>
        <pre className="knowledge-pre">{knowledge || "（暂无内容）"}</pre>
      </details>
    </section>
  );
}
