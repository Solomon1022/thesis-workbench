import { useCallback, useEffect, useRef, useState } from "react";

const api = () => window.thesisWorkbench;

interface AppSettings {
  userDataDir: string;
  attachmentsDir: string;
  exportDir: string;
  uiLanguage: string;
  fontSize: string;
  proposalTemplate: string;
  docMarginTop: string;
  docMarginBottom: string;
  docMarginLeft: string;
  docMarginRight: string;
  docBodySize: string;
  docTitleSize: string;
  docBodyCn: string;
  docBodyEn: string;
  docLineSpacing: string;
}

const FONT_OPTIONS = [
  { value: "90", label: "小" },
  { value: "100", label: "标准" },
  { value: "110", label: "大" },
  { value: "125", label: "特大" },
];

/** 通用设置：本地文件位置 / 输出位置 / 语言 / 文字大小 / 开题报告模板与 Word 格式 */
export function GeneralSettingsView({ onFontSize }: { onFontSize?: (v: string) => void }) {
  const [s, setS] = useState<AppSettings | null>(null);
  const [msg, setMsg] = useState("");
  const [template, setTemplate] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const a = api();
    if (!a) return;
    try {
      const st = await a.settingsGetApp();
      setS(st);
      setTemplate(st.proposalTemplate);
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const chooseDir = async (key: "attachmentsDir" | "exportDir") => {
    const a = api();
    if (!a) return;
    const dir = await a.settingsChooseDir();
    if (!dir) return;
    await a.settingsSaveApp({ [key]: dir });
    setMsg(key === "attachmentsDir" ? "附件存放目录已更新" : "输出存放位置已更新");
    void load();
  };

  const saveField = async (key: "uiLanguage" | "fontSize", value: string) => {
    const a = api();
    if (!a) return;
    // 注意：数据库键固定为 ui_language / ui_font_size（与 settingsGetApp 读取键一致）
    await a.settingsSaveApp(key === "fontSize" ? { ui_font_size: value } : { ui_language: value });
    if (key === "fontSize") onFontSize?.(value);
    setMsg("设置已保存");
    void load();
  };

  const saveTemplate = async (reset = false) => {
    const a = api();
    if (!a) return;
    await a.settingsSaveApp({ proposal_template: reset ? "" : template });
    setMsg(reset ? "已恢复默认开题框架模板" : "开题框架模板已保存");
    void load();
  };

  const uploadTemplate = async (file: File | undefined) => {
    const a = api();
    if (!a || !file) return;
    const text = await file.text();
    if (!text.trim()) { setMsg("模板文件为空"); return; }
    setTemplate(text);
    await a.settingsSaveApp({ proposal_template: text });
    setMsg("已上传开题框架模板：" + file.name);
    void load();
  };

  const saveDocFormat = async () => {
    const a = api();
    if (!a || !s) return;
    await a.settingsSaveApp({
      doc_margin_top: s.docMarginTop, doc_margin_bottom: s.docMarginBottom, doc_margin_left: s.docMarginLeft, doc_margin_right: s.docMarginRight,
      doc_body_size: s.docBodySize, doc_title_size: s.docTitleSize, doc_body_cn: s.docBodyCn, doc_body_en: s.docBodyEn, doc_line_spacing: s.docLineSpacing,
    });
    setMsg("开题报告 Word 格式参数已保存");
  };

  if (!s) return <p className="muted">加载中…</p>;
  const num = (k: keyof AppSettings) => ({ value: s[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value }) });
  const txt = (k: keyof AppSettings) => ({ value: s[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value }) });

  return (
    <div className="card general-settings">
      <h2 className="card-title">通用设置</h2>
      <p className="muted">本地文件位置与输出位置分开设置；改动即时生效并保存。</p>

      <div className="field">
        <label>本地文件存放位置（数据库 / 密钥 / 项目数据，只读）</label>
        <input className="input" readOnly value={s.userDataDir} />
      </div>
      <div className="lit-search-row">
        <div className="field" style={{ flex: 1 }}>
          <label>附件存放目录（PDF 等）</label>
          <input className="input" readOnly value={s.attachmentsDir} />
        </div>
        <button className="btn" onClick={() => void chooseDir("attachmentsDir")}>更改目录</button>
      </div>
      <div className="lit-search-row">
        <div className="field" style={{ flex: 1 }}>
          <label>输出存放位置（导出 MD / 文档默认位置，默认桌面）</label>
          <input className="input" readOnly value={s.exportDir} />
        </div>
        <button className="btn" onClick={() => void chooseDir("exportDir")}>更改目录</button>
      </div>
      <div className="form-grid">
        <div className="field">
          <label>界面语言</label>
          <select className="select" value={s.uiLanguage} onChange={(e) => void saveField("uiLanguage", e.target.value)}>
            <option value="zh">中文（当前版本仅中文界面，预留英文切换）</option>
          </select>
        </div>
        <div className="field">
          <label>文字大小</label>
          <select className="select" value={s.fontSize} onChange={(e) => void saveField("fontSize", e.target.value)}>
            {FONT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}（{o.value}%）</option>)}
          </select>
        </div>
      </div>

      <div className="field">
        <label>开题报告框架模板（每个「# 一级标题」为一节；可直接编辑，或上传 .md/.txt 模板）</label>
        <textarea className="textarea" rows={10} value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="开题报告框架模板" />
        <div className="lit-search-row" style={{ marginTop: 6 }}>
          <button className="btn btn-primary" onClick={() => void saveTemplate(false)}>保存模板</button>
          <button className="btn" onClick={() => void saveTemplate(true)}>恢复默认</button>
          <button className="btn" onClick={() => fileRef.current?.click()}>上传模板（.md/.txt）</button>
          <input ref={fileRef} type="file" accept=".md,.txt" style={{ display: "none" }} onChange={(e) => void uploadTemplate(e.target.files?.[0])} />
        </div>
      </div>

      <div className="field">
        <label>开题报告 Word 格式（导出时按此排版）</label>
        <div className="form-grid">
          <div className="field"><label>页边距 上（cm）</label><input className="input" type="number" step="0.1" {...num("docMarginTop")} /></div>
          <div className="field"><label>页边距 下（cm）</label><input className="input" type="number" step="0.1" {...num("docMarginBottom")} /></div>
          <div className="field"><label>页边距 左（cm）</label><input className="input" type="number" step="0.1" {...num("docMarginLeft")} /></div>
          <div className="field"><label>页边距 右（cm）</label><input className="input" type="number" step="0.1" {...num("docMarginRight")} /></div>
          <div className="field"><label>正文 字号（磅）</label><input className="input" type="number" step="0.5" {...num("docBodySize")} /></div>
          <div className="field"><label>大标题 字号（磅）</label><input className="input" type="number" step="0.5" {...num("docTitleSize")} /></div>
          <div className="field"><label>正文 中文字体</label><input className="input" {...txt("docBodyCn")} /></div>
          <div className="field"><label>正文 西文字体</label><input className="input" {...txt("docBodyEn")} /></div>
          <div className="field"><label>固定行距（磅）</label><input className="input" type="number" step="0.5" {...num("docLineSpacing")} /></div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 6 }} onClick={() => void saveDocFormat()}>保存 Word 格式参数</button>
      </div>

      {msg && <p className="banner banner-info">{msg}</p>}
    </div>
  );
}
