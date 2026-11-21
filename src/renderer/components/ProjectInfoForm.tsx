import { useState } from "react";
import type { ExistingMaterials } from "../../shared/types";
import { DISCIPLINES, METHOD_ORDER } from "../../shared/templates";

const api = () => window.thesisWorkbench;

const EMPTY: ExistingMaterials = { title: "", literature: "", data: "", draft: "", notes: "" };

const EDUCATION_OPTIONS = ["大专", "本科", "硕士", "博士", "其他"];

const MATERIAL_LABELS: Record<keyof ExistingMaterials, string> = {
  title: "已有题目",
  literature: "已有文献",
  data: "已有数据",
  draft: "已有初稿",
  notes: "备注",
};

export interface ProjectFormValues {
  name: string;
  disciplines: string[];
  /** 全部研究方法（含自定义） */
  methods: string[];
  /** 驱动阶段模板的主要方法（第一个标准方法） */
  researchMethod: string;
  education: string;
  deadline: string;
  materials: ExistingMaterials;
}

/** 新建项目与第 0 项共用的项目信息表单：
 * ① 学科（必选，可自定义）→ ② 学历（必选）→ ③ 选题（可 AI 生成）→ ④ 研究方法（多选，可 AI 推荐，可自定义）→ ⑤ 截止日期与已有材料 */
export function ProjectInfoForm({ mode, initial, onSubmit, submitLabel, busy }: {
  mode: "create" | "edit";
  initial?: ProjectFormValues;
  onSubmit: (values: ProjectFormValues) => void;
  submitLabel: string;
  busy?: boolean;
}) {
  const [disciplines, setDisciplines] = useState<string[]>(initial?.disciplines ?? []);
  const [customDiscipline, setCustomDiscipline] = useState("");
  const [education, setEducation] = useState(initial?.education || "本科");
  const [name, setName] = useState(initial?.name ?? "");
  const [methods, setMethods] = useState<string[]>(initial?.methods ?? []);
  const [customMethod, setCustomMethod] = useState("");
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [materials, setMaterials] = useState<ExistingMaterials>({ ...EMPTY, ...(initial?.materials ?? {}) });
  const [materialEnabled, setMaterialEnabled] = useState<Record<keyof ExistingMaterials, boolean>>(() => {
    const m = initial?.materials ?? ({} as ExistingMaterials);
    return {
      title: Boolean(m.title && m.title.trim()),
      literature: Boolean(m.literature && m.literature.trim()),
      data: Boolean(m.data && m.data.trim()),
      draft: Boolean(m.draft && m.draft.trim()),
      notes: Boolean(m.notes && m.notes.trim()),
    };
  });
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<Array<{ title: string; rationale: string; risk: string }>>([]);
  const [methodBusy, setMethodBusy] = useState(false);
  const [methodSuggestions, setMethodSuggestions] = useState<Array<{ method: string; reason: string; methodKey?: string }>>([]);

  const infoReady = disciplines.length > 0 && education.length > 0;
  const topicReady = infoReady && name.trim().length > 0;
  const stepClass = (ready: boolean) => "form-step" + (ready ? "" : " form-step-disabled");

  const toggleDiscipline = (d: string) =>
    setDisciplines((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));

  const addCustomDiscipline = () => {
    const d = customDiscipline.trim();
    if (!d) return;
    if (!disciplines.includes(d)) setDisciplines((prev) => [...prev, d]);
    setCustomDiscipline("");
  };

  const toggleMethod = (m: string) =>
    setMethods((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const addCustomMethod = () => {
    const m = customMethod.trim();
    if (!m) return;
    if (!methods.includes(m)) setMethods((prev) => [...prev, m]);
    setCustomMethod("");
  };

  const generateTitles = async () => {
    const a = api();
    if (!a || titleBusy || !infoReady) return;
    setTitleBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await a.aiSuggestTitles({ education, disciplines, methods, materials: materials as unknown as Record<string, string>, deadline });
      if (r.ok && r.titles) {
        setTitleSuggestions(r.titles);
        setMsg(r.message + "（点击「采用此选题」填入项目名称）");
      } else {
        setErr(r.message);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTitleBusy(false);
    }
  };

  const generateMethods = async () => {
    const a = api();
    if (!a || methodBusy || !topicReady) return;
    setMethodBusy(true);
    setErr("");
    setMsg("");
    try {
      const r = await a.aiSuggestMethods({ education, disciplines, topic: name.trim() });
      if (r.ok && r.suggestions) {
        setMethodSuggestions(r.suggestions);
        setMsg(r.message);
      } else {
        setErr(r.message);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setMethodBusy(false);
    }
  };

  const toggleMaterial = (k: keyof ExistingMaterials) => {
    const enabled = !materialEnabled[k];
    setMaterialEnabled((prev) => ({ ...prev, [k]: enabled }));
    if (!enabled) setMaterials((current) => ({ ...current, [k]: "" }));
  };

  const submit = () => {
    if (disciplines.length === 0) return setErr("请先选择学科（专业）");
    if (!education) return setErr("请先选择学历");
    if (!name.trim()) return setErr("请先填写项目名称（选题），可点右侧 AI 生成");
    const standardKeys = new Set(METHOD_ORDER.map((m) => m.key));
    const researchMethod = methods.find((m) => standardKeys.has(m)) ?? "";
    onSubmit({ name: name.trim(), disciplines, methods, researchMethod, education, deadline, materials });
  };

  return (
    <div>
      <div className={stepClass(infoReady)}>
        <h3 className="ai-title">① 学科 / 专业（必选，多选）</h3>
        <div className="lit-suggest">
          {DISCIPLINES.map((d) => (
            <button key={d} className={"chip" + (disciplines.includes(d) ? " chip-on" : "")} onClick={() => toggleDiscipline(d)}>{d}</button>
          ))}
          {disciplines.filter((d) => !DISCIPLINES.includes(d as (typeof DISCIPLINES)[number])).map((d) => (
            <button key={"c-" + d} className="chip chip-on" onClick={() => toggleDiscipline(d)}>{d} ✕</button>
          ))}
        </div>
        <div className="lit-search-row">
          <input className="input input-inline" aria-label="自定义学科" placeholder="自定义学科 / 专业，如：数字经济" value={customDiscipline} onChange={(e) => setCustomDiscipline(e.target.value)} />
          <button className="btn btn-sm" onClick={addCustomDiscipline}>添加自定义学科</button>
        </div>
      </div>

      <div className={stepClass(infoReady)}>
        <h3 className="ai-title">② 学历（必选，与学科同层级）</h3>
        <select className="select" aria-label="学历" value={education} onChange={(e) => setEducation(e.target.value)}>
          {EDUCATION_OPTIONS.map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
        <span className="hint" style={{ marginLeft: 8 }}>学历决定选题难度与研究假设的模型复杂度（AI 生成时自动遵循）</span>
      </div>

      <div className={stepClass(topicReady)}>
        <h3 className="ai-title">③ 选题（项目名称，必选）</h3>
        <div className="lit-search-row">
          <input className="input" aria-label="项目名称 *" placeholder="确定好学科与学历后，可点右侧 AI 生成选题" disabled={!infoReady} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn" disabled={titleBusy || !infoReady} onClick={() => void generateTitles()}>{titleBusy ? "生成中…" : "AI 生成"}</button>
        </div>
        {titleSuggestions.map((t) => (
          <div key={t.title} className="ai-suggest-item">
            <div className="ai-suggest-head">
              <strong>{t.title}</strong>
              <button className="btn btn-sm" onClick={() => setName(t.title)}>采用此选题</button>
            </div>
            <div className="muted">推荐理由：{t.rationale}{t.risk ? "。风险/收窄：" + t.risk : ""}</div>
          </div>
        ))}
      </div>

      <div className={stepClass(topicReady)}>
        <h3 className="ai-title">④ 研究方法（多选，可 AI 推荐，可自定义）</h3>
        <p className="muted">固定方法不匹配时：AI 推荐会生成在下方，点「加入选择」即可把建议直接作为自定义方法添加，不限上面的固定列表。</p>
        <div className="lit-suggest">
          {METHOD_ORDER.map((m) => (
            <button key={m.key} className={"chip" + (methods.includes(m.key) ? " chip-on" : "")} onClick={() => toggleMethod(m.key)} title={m.note ?? m.label}>{m.label}</button>
          ))}
          {methods.filter((m) => !METHOD_ORDER.some((x) => x.key === m)).map((m) => (
            <button key={"cm-" + m} className="chip chip-on" onClick={() => toggleMethod(m)}>{m} ✕</button>
          ))}
        </div>
        <div className="lit-search-row">
          <input className="input input-inline" aria-label="自定义研究方法" placeholder="自定义研究方法，如：扎根理论" value={customMethod} onChange={(e) => setCustomMethod(e.target.value)} />
          <button className="btn btn-sm" onClick={addCustomMethod}>添加自定义方法</button>
          <button className="btn" disabled={methodBusy || !topicReady} onClick={() => void generateMethods()}>{methodBusy ? "推荐中…" : "AI 推荐研究方法"}</button>
        </div>
        {methodSuggestions.map((s) => (
          <div key={s.method} className="ai-suggest-item">
            <div className="ai-suggest-head">
              <strong>{s.method}{!s.methodKey && <span className="badge">自定义方法</span>}</strong>
              <button className="btn btn-sm" onClick={() => { if (!methods.includes(s.methodKey ?? s.method)) setMethods((prev) => [...prev, s.methodKey ?? s.method]); }}>加入选择</button>
            </div>
            <div className="muted">{s.reason}</div>
          </div>
        ))}
      </div>

      <div className={stepClass(topicReady)}>
        <h3 className="ai-title">⑤ 截止日期与已有材料（选题确定后可填）</h3>
        <div className="field">
          <label htmlFor="pf-deadline">截止日期（可选）</label>
          <input id="pf-deadline" className="input" type="date" disabled={!topicReady} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </div>
        <div className="field">
          <label>已有材料（可选，可稍后补充）</label>
          {(Object.keys(MATERIAL_LABELS) as Array<keyof ExistingMaterials>).map((k) => (
            <div key={k}>
              <label className="check-row">
                <input type="checkbox" disabled={!topicReady} checked={materialEnabled[k]} onChange={() => toggleMaterial(k)} />
                {MATERIAL_LABELS[k]}
              </label>
              {materialEnabled[k] && (
                <textarea className="textarea" disabled={!topicReady} placeholder="粘贴或简要描述内容" value={materials[k]} onChange={(e) => setMaterials((prev) => ({ ...prev, [k]: e.target.value }))} />
              )}
            </div>
          ))}
          <span className="hint">填写已有材料后，系统会建议从哪个阶段开始，并把前面阶段标记为「已有材料」。</span>
        </div>
      </div>

      {err && <p className="banner banner-error">{err}</p>}
      {msg && <p className="banner banner-info">{msg}</p>}
      <div className="modal-actions">
        <button className="btn btn-primary" disabled={busy} onClick={submit}>{submitLabel}</button>
      </div>
    </div>
  );
}
