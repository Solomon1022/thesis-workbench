import { useState } from "react";
import type { ExistingMaterials, ProjectInput } from "../../shared/types";
import { DISCIPLINES, METHOD_ORDER, METHOD_TEMPLATES } from "../../shared/templates";

const EMPTY: ExistingMaterials = { title: "", literature: "", data: "", draft: "", notes: "" };

export function ProjectWizard({ busy, onCancel, onCreate }: {
  busy: boolean;
  onCancel: () => void;
  onCreate: (input: ProjectInput) => void;
}) {
  const [name, setName] = useState("");
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [method, setMethod] = useState("");
  const [education, setEducation] = useState("本科");
  const [deadline, setDeadline] = useState("");
  const [materials, setMaterials] = useState<ExistingMaterials>({ ...EMPTY });
  const [materialEnabled, setMaterialEnabled] = useState<Record<keyof ExistingMaterials, boolean>>({
    title: false, literature: false, data: false, draft: false, notes: false,
  });
  const [err, setErr] = useState("");

  const toggleDiscipline = (d: string) =>
    setDisciplines((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const toggleMaterial = (k: "title" | "literature" | "data" | "draft" | "notes") => {
    const enabled = !materialEnabled[k];
    setMaterialEnabled((prev) => ({ ...prev, [k]: enabled }));
    if (!enabled) setMaterials((current) => ({ ...current, [k]: "" }));
  };

  const hasMaterial = (k: keyof ExistingMaterials) => materialEnabled[k];

  const submit = () => {
    if (!name.trim()) return setErr("请填写项目名称");
    if (disciplines.length === 0) return setErr("请至少选择一个学科");
    if (!method) return setErr("请选择研究方法");
    onCreate({ name: name.trim(), disciplines, researchMethod: method, educationLevel: education, deadline, materials });
  };

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="新建项目">
        <h2>新建项目</h2>
        <div className="field">
          <label htmlFor="np-name">项目名称 *</label>
          <input id="np-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如：直播电商消费者购买意愿研究" />
        </div>

        <div className="field">
          <label>学科（可多选）*</label>
          <div className="chip-row">
            {DISCIPLINES.map((d) => (
              <label key={d} className={"chip" + (disciplines.includes(d) ? " chip-on" : "")}>
                <input type="checkbox" checked={disciplines.includes(d)} onChange={() => toggleDiscipline(d)} />
                {d}
              </label>
            ))}
          </div>
          <span className="hint">学科用于匹配术语与资料；电商、经济管理保留其学科特点，不强行归为理工科。</span>
        </div>

        <div className="form-grid">
          <div className="field">
            <label htmlFor="np-method">研究方法 *</label>
            <select id="np-method" className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">— 请选择 —</option>
              {METHOD_ORDER.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}{METHOD_TEMPLATES[m.key]?.implemented ? "" : "（" + (m.note ?? "模板待补充") + "）"}
                </option>
              ))}
            </select>
            <span className="hint">方法决定各阶段的输入与记录结构；学科与方法分开选择。</span>
          </div>
          <div className="field">
            <label htmlFor="np-edu">学历层次</label>
            <select id="np-edu" className="select" value={education} onChange={(e) => setEducation(e.target.value)}>
              <option>本科</option>
              <option>硕士</option>
              <option>博士</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="np-deadline">截止日期（可选）</label>
          <input id="np-deadline" className="input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          <span className="hint">日期只用于计划提醒；日期到了不代表阶段已完成。</span>
        </div>

        <div className="field">
          <label>已有材料（可选，可稍后补充）</label>
          {(["title", "literature", "data", "draft"] as Array<keyof ExistingMaterials>).map((k) => (
            <div key={k}>
              <label className="check-row">
                <input type="checkbox" checked={hasMaterial(k)} onChange={() => toggleMaterial(k)} />
                {k === "title" ? "已有题目" : k === "literature" ? "已有文献" : k === "data" ? "已有数据" : "已有初稿"}
              </label>
              {hasMaterial(k) && (
                <textarea
                  className="textarea"
                  placeholder="粘贴或简要描述内容"
                  value={materials[k]}
                  onChange={(e) => setMaterials((prev) => ({ ...prev, [k]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <div>
            <label className="check-row"><input type="checkbox" checked={hasMaterial("notes")} onChange={() => toggleMaterial("notes")} />备注</label>
            {hasMaterial("notes") && (
              <textarea className="textarea" placeholder="导师要求、学校规范、其他说明"
                value={materials.notes}
                onChange={(e) => setMaterials((prev) => ({ ...prev, notes: e.target.value }))} />
            )}
          </div>
          <span className="hint">填写已有材料后，系统会建议从哪个阶段开始，并把前面阶段标记为「已有材料」。</span>
        </div>

        {err && <p className="banner banner-error">{err}</p>}
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn btn-primary" disabled={busy} onClick={submit}>{busy ? "创建中…" : "创建项目"}</button>
        </div>
      </div>
    </div>
  );
}
