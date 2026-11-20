import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import type { EvidenceCard, LiteratureItem, SearchLogEntry, SearchOutcome } from "../../shared/literature";
import { CN_PLATFORMS, LITERATURE_SOURCE_LABEL, VERIFIED_STATUS_LABEL } from "../../shared/literature";
import { parseBibTeX, parseRIS, type ParsedReference } from "../../shared/bibparse";

const api = () => window.thesisWorkbench;

type Candidate = SearchOutcome["items"][number];

const SOURCES = [
  { key: "crossref", label: "Crossref（书目 / DOI 核验）" },
  { key: "arxiv", label: "arXiv（预印本）" },
  { key: "pubmed", label: "PubMed（生物医学）" },
];

const SOURCE_STATUS_LABEL: Record<string, string> = { ok: "返回结果", no_results: "无结果", error: "失败" };

export function LiteraturePanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [items, setItems] = useState<LiteratureItem[]>([]);
  const [log, setLog] = useState<SearchLogEntry[]>([]);
  const [source, setSource] = useState("crossref");
  const [query, setQuery] = useState("");
  const [suggested, setSuggested] = useState<string[]>([]);
  const [doiInput, setDoiInput] = useState("");
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [outcomeMeta, setOutcomeMeta] = useState<{ source: string; query: string; status: string; message: string; time: string } | null>(null);
  const [manual, setManual] = useState({ title: "", authors: "", year: "", venue: "", doi: "", url: "", abstract: "", note: "" });
  const [manualVerify, setManualVerify] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<ParsedReference[]>([]);
  const [evidenceFor, setEvidenceFor] = useState<LiteratureItem | null>(null);
  const [evidenceCards, setEvidenceCards] = useState<EvidenceCard[]>([]);
  const [claim, setClaim] = useState("");
  const [location, setLocation] = useState("");
  const [showCN, setShowCN] = useState(false);
  const [autoState, setAutoState] = useState<{ ok: boolean; message: string; queryUsed: string[]; results: Candidate[] } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try {
      const [list, slog] = await Promise.all([a.literatureList(projectId), a.literatureSearchLog(projectId)]);
      setItems(list);
      setLog(slog);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const runSearch = async (q: string) => {
    const a = api();
    if (!a || !q.trim()) return;
    setSearching(true);
    setError("");
    setMessage("");
    setCandidates([]);
    setOutcomeMeta(null);
    try {
      const { outcome } = await a.literatureSearch(projectId, source, q);
      setCandidates(outcome.items);
      setOutcomeMeta({
        source: LITERATURE_SOURCE_LABEL[outcome.source],
        query: outcome.query,
        status: outcome.status,
        message: outcome.message,
        time: new Date(outcome.searchedAt).toLocaleTimeString("zh-CN", { hour12: false }),
      });
      if (outcome.status === "no_results") setMessage(outcome.message);
      if (outcome.status === "error") setError(outcome.message);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const runDoiLookup = async () => {
    const a = api();
    if (!a || !doiInput.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await a.literatureLookupDoi(doiInput);
      if (r.found && r.item) {
        setCandidates([r.item]);
        setOutcomeMeta({ source: "Crossref（DOI 核验）", query: doiInput.trim(), status: "ok", message: r.message, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
        setMessage(r.message);
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runAutoSearch = async () => {
    const a = api();
    if (!a || autoBusy) return;
    setAutoBusy(true);
    setError("");
    try {
      const r = await a.literatureAutoSearch(projectId);
      setAutoState(r);
      if (r.ok) {
        setCandidates(r.results);
        setOutcomeMeta({ source: "Crossref（一键自动检索）", query: r.queryUsed.join(" / "), status: "ok", message: r.message, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
        setMessage(r.message);
        void refresh();
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoBusy(false);
    }
  };

  const saveCandidate = async (c: Candidate, note?: string) => {
    const a = api();
    if (!a) return;
    const r = await a.literatureSave(projectId, c, { note });
    if (r.saved) { setMessage("已保存：" + (r.item?.title ?? "").slice(0, 40)); void refresh(); }
    else setMessage(r.message);
  };

  const saveManual = async () => {
    const a = api();
    if (!a) return;
    if (!manual.title.trim() && !manual.doi.trim()) { setError("请至少填写标题或 DOI"); return; }
    setBusy(true);
    try {
      const r = await a.literatureSave(projectId, {
        title: manual.title.trim(), authors: manual.authors.trim(), year: manual.year.trim(), venue: manual.venue.trim(),
        doi: manual.doi.trim(), url: manual.url.trim(), abstract: manual.abstract.trim(), source: "manual", preprint: false,
      }, { manuallyVerified: manualVerify, note: manual.note.trim() });
      setMessage(r.message);
      if (r.saved) { setManual({ title: "", authors: "", year: "", venue: "", doi: "", url: "", abstract: "", note: "" }); setManualVerify(false); void refresh(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = () => {
    const refs = [...parseRIS(importText), ...parseBibTeX(importText)];
    setImportPreview(refs);
    if (refs.length === 0) setError("未解析出条目：请粘贴 RIS 或 BibTeX 文本");
  };

  const saveImported = async (p: ParsedReference) => {
    const a = api();
    if (!a) return;
    const r = await a.literatureSave(projectId, {
      title: p.title, authors: p.authors, year: p.year, venue: p.venue, doi: p.doi, url: p.url, abstract: p.abstract,
      source: "ris-import", preprint: false,
    }, {});
    setMessage(r.message);
    if (r.saved) void refresh();
  };

  const attachPdf = async (id: string) => {
    const a = api();
    if (!a) return;
    const r = await a.literatureAttachPdf(projectId, id);
    if (r.pdfName) { setMessage("已关联 PDF：" + r.pdfName + "（仅记录文件名，未解析全文）"); void refresh(); }
  };

  const openEvidence = async (lit: LiteratureItem) => {
    setEvidenceFor(lit);
    setClaim("");
    setLocation("");
    const a = api();
    if (!a) { setEvidenceCards([]); return; }
    try { setEvidenceCards(await a.literatureListEvidence(lit.id)); } catch { setEvidenceCards([]); }
  };

  const addEvidence = async () => {
    const a = api();
    if (!a || !evidenceFor || !claim.trim()) return;
    await a.literatureAddEvidence(projectId, evidenceFor.id, claim, location);
    setEvidenceCards(await a.literatureListEvidence(evidenceFor.id));
    setClaim("");
    setLocation("");
  };

  const removeEvidence = async (id: string) => {
    const a = api();
    if (!a || !evidenceFor) return;
    await a.literatureDeleteEvidence(id);
    setEvidenceCards(await a.literatureListEvidence(evidenceFor.id));
  };

  const verifyManualItem = async (lit: LiteratureItem) => {
    const a = api();
    if (!a) return;
    await a.literatureVerifyManual(lit.id, "");
    setMessage("已人工核验：" + lit.title.slice(0, 40));
    void refresh();
  };

  const genQueries = async () => {
    const a = api();
    if (!a) return;
    setBusy(true);
    setError("");
    try {
      const r = await a.literatureGenQueries(detail.project.name || "我的研究主题");
      if (r.ok && r.queries && r.queries.length > 0) {
        setSuggested(r.queries);
        setQuery(r.queries[0]);
        setMessage(r.message + "（已填入第一条，可点击其余切换）");
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const copyQuery = async () => {
    try { await navigator.clipboard.writeText(query); setMessage("检索式已复制到剪贴板（可粘贴到国内平台官网检索）"); }
    catch { setError("复制失败，请手动复制"); }
  };

  const openUrl = (url: string) => { if (url) void api()?.openExternal(url); };

  return (
    <div className="literature-panel">
      <section className="card">
        <div className="card-head-row">
          <h3 className="ai-title">一键自动找文献（基于已确定的选题、变量与摘要）</h3>
          <button className="btn btn-primary" disabled={autoBusy} onClick={() => void runAutoSearch()}>{autoBusy ? "检索中…" : "自动找文献（含地址）"}</button>
        </div>
        <p className="muted">根据「前期检索与选题」「研究问题与设计」里已填的方向、变量与摘要自动推导检索式，直接检索真实 Crossref 数据源；每条文献的地址在下方结果中直接给出，可一键保存入库。</p>
        {autoState && autoState.ok && <p className="muted">本次检索式：{autoState.queryUsed.join("；")}</p>}
      </section>
      <section className="card">
        <h2 className="card-title">检索与核验（真实学术数据源）</h2>
        <p className="muted">检索与 DOI 核验均直接调用公开学术数据源，不生成、不虚构文献。真实检索式、来源与时间会记入检索记录。</p>
        <div className="lit-search-row">
          <select className="select" aria-label="检索来源" value={source} onChange={(e) => setSource(e.target.value)}>
            {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <input className="input lit-query" aria-label="检索式" placeholder="输入检索式，如：deep learning protein structure prediction" value={query} onChange={(e) => setQuery(e.target.value)} />
          <button className="btn btn-primary" disabled={searching || !query.trim()} onClick={() => void runSearch(query)}>检索</button>
          <button className="btn" disabled={busy} onClick={() => void genQueries()}>AI 生成检索式</button>
        </div>
        {suggested.length > 1 && (
          <div className="lit-suggest">
            {suggested.map((s, i) => (
              <button key={i} className="chip" onClick={() => setQuery(s)}>{s}</button>
            ))}
          </div>
        )}
        <div className="lit-search-row">
          <input className="input" aria-label="DOI 核验" placeholder="DOI 核验，如：10.1038/s41586-024-08218-7" value={doiInput} onChange={(e) => setDoiInput(e.target.value)} />
          <button className="btn" disabled={busy || !doiInput.trim()} onClick={() => void runDoiLookup()}>按 DOI 核验</button>
        </div>
        {outcomeMeta && (
          <div className="lit-outcome">
            <strong>{outcomeMeta.source}</strong> · {SOURCE_STATUS_LABEL[outcomeMeta.status]}
            {outcomeMeta.status === "ok" && " · " + candidates.length + " 条"}
            {" · 检索式：" + outcomeMeta.query + " · 时间：" + outcomeMeta.time}
            {outcomeMeta.message && <div className="muted">{outcomeMeta.message}</div>}
          </div>
        )}
        {candidates.length > 0 && (
          <div className="lit-candidates">
            {candidates.map((c, i) => (
              <div key={i} className="lit-candidate">
                <div className="lit-candidate-main">
                  <div className="lit-title">{c.title}{c.preprint && <span className="badge badge-warn">预印本</span>}</div>
                  <div className="muted">{c.authors}{c.year ? "（" + c.year + "）" : ""}{c.venue ? " · " + c.venue : ""}</div>
                  <div className="muted">DOI: {c.doi || "无"}</div>
                  {c.url && <div className="muted lit-url">来源地址：<a href={c.url} onClick={(e) => { e.preventDefault(); openUrl(c.url); }}>{c.url}</a></div>}
                </div>
                <div className="lit-candidate-actions">
                  {c.url && <button className="btn btn-sm" onClick={() => openUrl(c.url)}>打开来源</button>}
                  <button className="btn btn-sm btn-primary" onClick={() => void saveCandidate(c, outcomeMeta?.query)}>保存</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">手动录入</h2>
        <p className="muted">手动录入默认标记为「待核验」；勾选人工核验后标记为「已核验」并记录说明。无 DOI 的记录允许人工核验。</p>
        <div className="form-grid">
          <div className="field"><label>标题</label><input className="input" aria-label="手动标题" value={manual.title} onChange={(e) => setManual((m) => ({ ...m, title: e.target.value }))} /></div>
          <div className="field"><label>作者</label><input className="input" aria-label="手动作者" value={manual.authors} onChange={(e) => setManual((m) => ({ ...m, authors: e.target.value }))} /></div>
          <div className="field"><label>年份</label><input className="input" aria-label="手动年份" value={manual.year} onChange={(e) => setManual((m) => ({ ...m, year: e.target.value }))} /></div>
          <div className="field"><label>期刊 / 来源</label><input className="input" aria-label="手动期刊" value={manual.venue} onChange={(e) => setManual((m) => ({ ...m, venue: e.target.value }))} /></div>
          <div className="field"><label>DOI</label><input className="input" aria-label="手动DOI" value={manual.doi} onChange={(e) => setManual((m) => ({ ...m, doi: e.target.value }))} /></div>
          <div className="field"><label>链接</label><input className="input" aria-label="手动链接" value={manual.url} onChange={(e) => setManual((m) => ({ ...m, url: e.target.value }))} /></div>
        </div>
        <div className="field"><label>摘要</label><textarea className="textarea" aria-label="手动摘要" value={manual.abstract} onChange={(e) => setManual((m) => ({ ...m, abstract: e.target.value }))} /></div>
        <label className="check-row"><input type="checkbox" checked={manualVerify} onChange={(e) => setManualVerify(e.target.checked)} />人工核验（我已在官方来源确认该题录信息）</label>
        <div className="field"><label>核验 / 备注说明</label><input className="input" aria-label="核验说明" placeholder="如：已在知网官网确认 / 检索式与时间" value={manual.note} onChange={(e) => setManual((m) => ({ ...m, note: e.target.value }))} /></div>
        <div className="lit-actions">
          <button className="btn btn-primary" disabled={busy} onClick={() => void saveManual()}>保存记录</button>
        </div>
      </section>

      <section className="card">
        <h2 className="card-title">RIS / BibTeX 导入</h2>
        <p className="muted">粘贴 RIS 或 BibTeX 文本；导入的题录默认标记为「待核验」，可用上方 DOI 核验或人工核验确认。</p>
        <textarea className="textarea" aria-label="导入文本" placeholder="粘贴 RIS（TY - ... ER -）或 BibTeX（@article{...}）内容" value={importText} onChange={(e) => setImportText(e.target.value)} />
        <div className="lit-actions">
          <button className="btn" onClick={doImport}>解析预览</button>
        </div>
        {importPreview.length > 0 && (
          <div className="lit-candidates">
            {importPreview.map((p, i) => (
              <div key={i} className="lit-candidate">
                <div className="lit-candidate-main">
                  <div className="lit-title">{p.title}</div>
                  <div className="muted">{p.authors}{p.year ? "（" + p.year + "）" : ""}{p.venue ? " · " + p.venue : ""}{p.doi ? " · DOI: " + p.doi : ""}</div>
                </div>
                <div className="lit-candidate-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => void saveImported(p)}>保存</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head-row">
          <h2 className="card-title">国内平台入口</h2>
          <button className="btn btn-sm" onClick={() => setShowCN(!showCN)}>{showCN ? "收起" : "展开"}</button>
        </div>
        <p className="muted">国内平台不提供可核实的免费全文 API；这里只提供官方入口、可复制检索式与人工核验记录，不虚构 API、不绕过登录或验证码。</p>
        {showCN && (
          <div className="lit-cn">
            {CN_PLATFORMS.map((p) => (
              <div key={p.name} className="lit-cn-row">
                <strong>{p.name}</strong>
                <span className="muted">{p.searchHint}</span>
                <button className="btn btn-sm" onClick={() => openUrl(p.url)}>打开官网</button>
              </div>
            ))}
            <div className="lit-cn-row">
              <span className="muted">将下方检索式复制到官网使用：</span>
              <button className="btn btn-sm" onClick={() => void copyQuery()}>复制检索式</button>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card-title">文献库（{items.length} 条）</h2>
        {items.length === 0 ? (
          <p className="empty-hint">还没有文献。可从上方的真实检索、DOI 核验、手动录入或导入开始。所有候选都来自真实数据源或你的输入，AI 不会代编文献。</p>
        ) : (
          <div className="lit-list">
            {items.map((lit) => (
              <div key={lit.id} className="lit-item">
                <div className="lit-item-main">
                  <div className="lit-title">
                    {lit.title}
                    {lit.preprint && <span className="badge badge-warn">预印本</span>}
                    <span className={"badge badge-" + (lit.verifiedStatus === "verified" ? "done" : lit.verifiedStatus === "conflict" ? "warn" : "muted")}>{VERIFIED_STATUS_LABEL[lit.verifiedStatus]}</span>
                    <span className="badge">{LITERATURE_SOURCE_LABEL[lit.source]}</span>
                    {lit.pdfName && <span className="badge badge-done">已关联 PDF</span>}
                  </div>
                  <div className="muted">{lit.authors}{lit.year ? "（" + lit.year + "）" : ""}{lit.venue ? " · " + lit.venue : ""}{lit.doi ? " · DOI: " + lit.doi : ""}</div>
                  {lit.verifiedNote && <div className="lit-note">核验记录：{lit.verifiedNote}</div>}
                </div>
                <div className="lit-item-actions">
                  {lit.url && <button className="btn btn-sm" onClick={() => openUrl(lit.url)}>打开来源</button>}
                  <button className="btn btn-sm" onClick={() => void openEvidence(lit)}>证据卡片</button>
                  <button className="btn btn-sm" onClick={() => void attachPdf(lit.id)}>关联 PDF</button>
                  {lit.verifiedStatus === "unverified" && <button className="btn btn-sm" onClick={() => void verifyManualItem(lit)}>人工核验</button>}
                  <button className="btn btn-sm btn-danger" onClick={async () => { await api()?.literatureDelete(lit.id); void refresh(); }}>删除</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {log.length > 0 && (
          <details className="lit-log">
            <summary>检索记录（{log.length} 条，最近优先）</summary>
            {log.map((l) => (
              <div key={l.id} className="lit-log-row">
                {new Date(l.createdAt).toLocaleString("zh-CN")} · {LITERATURE_SOURCE_LABEL[l.source as keyof typeof LITERATURE_SOURCE_LABEL] ?? l.source} · {SOURCE_STATUS_LABEL[l.status]} · {l.resultCount} 条 · 检索式：{l.query}
                {l.message && <div className="muted">{l.message}</div>}
              </div>
            ))}
          </details>
        )}
      </section>

      {message && <p className="banner banner-info">{message}</p>}
      {error && <p className="banner banner-error">{error}</p>}

      {evidenceFor && (
        <div className="modal-backdrop">
          <div className="modal">
            <div className="modal-head">
              <h3>证据卡片 · {evidenceFor.title.slice(0, 30)}</h3>
              <button className="btn btn-sm" onClick={() => setEvidenceFor(null)}>关闭</button>
            </div>
            <p className="muted">记录该文献支持某一观点的原文位置。页码 / 章节请以你实际查阅的原文为准；未定位的不要填写页码。</p>
            <div className="field"><label>观点 / 引用内容</label><textarea className="textarea" aria-label="证据观点" value={claim} onChange={(e) => setClaim(e.target.value)} placeholder="如：该研究在……条件下观察到……" /></div>
            <div className="field"><label>原文定位（页码 / 章节 / 段落，可留空）</label><input className="input" aria-label="原文定位" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="如：第 3 页，方法部分" /></div>
            <div className="lit-actions">
              <button className="btn btn-primary" disabled={!claim.trim()} onClick={() => void addEvidence()}>添加证据卡片</button>
            </div>
            {evidenceCards.length > 0 && (
              <div className="lit-evidence-list">
                {evidenceCards.map((c) => (
                  <div key={c.id} className="lit-evidence">
                    <div>{c.claim}</div>
                    <div className="muted">{c.location ? "定位：" + c.location : "未定位原文"} · {new Date(c.createdAt).toLocaleString("zh-CN")}</div>
                    <button className="btn btn-sm btn-danger" onClick={() => void removeEvidence(c.id)}>删除</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
