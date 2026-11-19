import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import { DISCIPLINES, METHOD_ORDER } from "../../shared/templates";

const api = () => window.thesisWorkbench;

interface MaterialsForm {
  title: string;
  literature: string;
  data: string;
  draft: string;
  notes: string;
}

const MATERIAL_KEYS: Array<{ key: keyof MaterialsForm; label: string; placeholder: string }> = [
  { key: "title", label: "已有题目", placeholder: "已确定的论文题目" },
  { key: "literature", label: "已有文献", placeholder: "已收集的文献列表或说明" },
  { key: "data", label: "已有数据", placeholder: "已有数据/材料说明" },
  { key: "draft", label: "已有初稿", placeholder: "初稿内容或文件说明" },
  { key: "notes", label: "备注", placeholder: "导师要求、学校规范、其他说明" },
];

/** 第 0 项：新建项目时填写的全部信息都可以在这里查看与修改。 */
export function EstablishPanel({ detail, onUpdated }: { detail: ProjectDetail; onUpdated: () => void }) {
  const p = detail.project;
  const [name, setName] = useState(p.name);
  const [disciplines, setDisciplines] = useState<string[]>(p.disciplines);
  const [method, setMethod] = useState(p.researchMethod);
  const [education, setEducation] = useState(p.educationLevel);
  const [deadline, setDeadline] = useState(p.deadline);
  const [materials, setMaterials] = useState<MaterialsForm>(() => {
    const m = (p.materials ?? {}) as Partial<MaterialsForm>;
    return { title: m.title ?? "", literature: m.literature ?? "", data: m.data ?? "", draft: m.draft ?? "", notes: m.notes ?? "" };
  });
  const [enabled, setEnabled] = useState<Record<keyof MaterialsForm, boolean>>(() => {
    const m = p.materials ?? ({} as Record<string, string>);
    return {
      title: Boolean(m.title && m.title.trim()),
      literature: Boolean(m.literature && m.literature.trim()),
      data: Boolean(m.data && m.data.trim()),
      draft: Boolean(m.draft && m.draft.trim()),
      notes: Boolean(m.notes && m.notes.trim()),
    };
  });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [showKnowledge, setShowKnowledge] = useState(false);

  const refreshKnowledge = useCallback(async () => {
    const a = api();
    if (!a) return;
    try { setKnowledge(await a.aiProjectKnowledge(detail.project.id)); } catch { /* ignore */ }
  }, [detail.project.id]);

  useEffect(() => {
    void refreshKnowledge();
  }, [refreshKnowledge]);

  const save = async () => {
    const a = api();
    if (!a) return;
    setError("");
    try {
      await a.updateProject(detail.project.id, {
        name: name.trim() || detail.project.name,
        disciplines,
        researchMethod: method,
        educationLevel: education,
        deadline,
        materials: {
          title: enabled.title ? materials.title : "",
          literature: enabled.literature ? materials.literature : "",
          data: enabled.data ? materials.data : "",
          draft: enabled.draft ? materials.draft : "",
          notes: enabled.notes ? materials.notes : "",
        },
      });
      setMessage("第 0 项信息已保存");
      onUpdated();
      void refreshKnowledge();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const toggleDiscipline = (d: string) => {
    setDisciplines((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  };

  return (
    <section className="card">
      <div className="card-head-row">
        <h2 className="card-title">项目信息（新建项目时填写的内容，这里可以随时修改）</h2>
        <button className="btn btn-primary" onClick={() => void save()}>保存修改</button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="ep-name">项目名称</label>
          <input id="ep-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ep-deadline">截止日期</label>
          <input id="ep-deadline" className="input" value={deadline} onChange={(e) => setDeadline(e.target.value)} placeholder="如：2027-05-30" />
        </div>
        <div className="field">
          <label htmlFor="ep-education">学历</label>
          <select id="ep-education" className="select" value={education} onChange={(e) => setEducation(e.target.value)}>
            <option value="本科">本科</option>
            <option value="硕士">硕士</option>
            <option value="博士">博士</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="ep-method">研究方法</label>
          <select id="ep-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHOD_ORDER.map((m) => <option key={m.key} value={m.key}>{m.label}{m.note ? "（" + m.note + "）" : ""}</option>)}
          </select>
        </div>
      </div>
      <div className="field">
        <label>学科（多选）</label>
        <div className="lit-suggest">
          {DISCIPLINES.map((d) => (
            <button key={d} className={"chip" + (disciplines.includes(d) ? " chip-on" : "")} onClick={() => toggleDiscipline(d)}>{d}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>已有材料（勾选后填写）</label>
        {MATERIAL_KEYS.map((m) => (
          <div key={m.key}>
            <label className="check-row">
              <input type="checkbox" checked={enabled[m.key]} onChange={(e) => {
                const on = e.target.checked;
                setEnabled((prev) => ({ ...prev, [m.key]: on }));
                if (!on) setMaterials((prev) => ({ ...prev, [m.key]: "" }));
              }} />
              {m.label}
            </label>
            {enabled[m.key] && (
              <textarea className="textarea" placeholder={m.placeholder} value={materials[m.key]} onChange={(e) => setMaterials((prev) => ({ ...prev, [m.key]: e.target.value }))} />
            )}
          </div>
        ))}
      </div>

      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      <details className="lit-log" open={showKnowledge} onToggle={(e) => setShowKnowledge((e.target as HTMLDetailsElement).open)}>
        <summary>项目知识汇总（AI 调用时读取的完整上下文，随时更新）</summary>
        <pre className="knowledge-pre">{knowledge || "（暂无内容）"}</pre>
      </details>
    </section>
  );
}
