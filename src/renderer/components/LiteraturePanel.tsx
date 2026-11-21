import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import type { EvidenceCard, LiteratureItem, SearchLogEntry, SearchOutcome } from "../../shared/literature";
import { CN_PLATFORMS, LITERATURE_SOURCE_LABEL, MAJOR_PLATFORM_GROUPS, REF_TYPES, REF_TYPE_LABEL, REF_TYPE_PRIORITY, REGION_LABEL, VERIFIED_STATUS_LABEL } from "../../shared/literature";
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
  const [manual, setManual] = useState({ citation: "", abstract: "", note: "" });
  const [manualRefType, setManualRefType] = useState("other");
  const [manualRegion, setManualRegion] = useState<"domestic" | "foreign" | "unknown">("unknown");
  const [aiSearchBusy, setAiSearchBusy] = useState(false);
  const [aiSearchState, setAiSearchState] = useState<{ ok: boolean; message: string; queryUsed: string; results: Candidate[] } | null>(null);
  const [manualVerify, setManualVerify] = useState(false);
  const [importText, setImportText] = useState("");
  const [importPreview, setImportPreview] = useState<ParsedReference[]>([]);
  const [evidenceFor, setEvidenceFor] = useState<LiteratureItem | null>(null);
  const [evidenceCards, setEvidenceCards] = useState<EvidenceCard[]>([]);
  const [claim, setClaim] = useState("");
  const [location, setLocation] = useState("");
  const [showCN, setShowCN] = useState(false);
  const [autoState, setAutoState] = useState<{ ok: boolean; message: string; queryUsed: string[]; results: Candidate[]; counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number }; cnNote?: string } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoTotal, setAutoTotal] = useState(15);
  const [autoCn, setAutoCn] = useState(0);
  const [autoHistory, setAutoHistory] = useState<Array<{ at: string; queryUsed: string[]; results: Candidate[]; counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number } }>>([]);

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
      const excludeDois = [
        ...items.map((i) => i.doi).filter(Boolean),
        ...autoHistory.flatMap((h) => h.results.map((c) => c.doi).filter(Boolean)),
      ];
      const r = await a.literatureAutoSearch(projectId, { total: autoTotal, cn: autoCn, en: Math.max(0, autoTotal - autoCn), excludeDois });
      setAutoState(r);
      if (r.ok) {
        setCandidates(r.results);
        setAutoHistory((prev) => [{ at: new Date().toLocaleString("zh-CN"), queryUsed: r.queryUsed, results: r.results, counts: r.counts }, ...prev].slice(0, 5));
        setOutcomeMeta({ source: "Crossref（一键自动检索）", query: r.queryUsed.join(" / "), status: "ok", message: r.message, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
        setMessage(r.message + (r.cnNote ? "。注意：" + r.cnNote : ""));
        void refresh();
      } else {
        setError(r.message + (r.cnNote ? "。注意：" + r.cnNote : ""));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoBusy(false);
    }
  };

  const runManualAiSearch = async () => {
    const a = api();
    if (!a || aiSearchBusy) return;
    setAiSearchBusy(true);
    setError("");
    try {
      const r = await a.literatureManualAiSearch(projectId, manual.citation);
      setAiSearchState(r);
      setMessage(r.message);
      if (!r.ok) setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiSearchBusy(false);
    }
  };

  const adoptAiResult = (c: Candidate) => {
    const typed = c as Candidate & { refType?: string; region?: string };
    const typeLabel = typed.refType ? REF_TYPE_LABEL[typed.refType] ?? "其他" : "其他";
    const yearPart = c.year ? ", " + c.year + "." : ".";
    const venuePart = c.venue ? " " + c.venue + (c.venue.endsWith(".") ? "" : ".") : "";
    setManual({
      citation: c.authors + ". " + c.title + "[" + (typeLabel === "期刊论文" ? "J" : typeLabel === "学位论文" ? "D" : typeLabel === "会议论文" ? "C" : typeLabel === "预印本论文" ? "A" : "M") + "]." + venuePart + yearPart,
      abstract: c.abstract,
      note: "AI 检索核验：" + (c.doi ? "DOI: " + c.doi + "；" : "") + (c.url ? "链接: " + c.url : ""),
    });
    if (typed.refType) setManualRefType(typed.refType);
    if (typed.region) setManualRegion(typed.region as "domestic" | "foreign" | "unknown");
    setMessage("已采用该题录填入表单（可继续修改后保存）");
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
    const citation = manual.citation.trim();
    if (!citation) { setError("请填写完整的参考文献引用"); return; }
    setBusy(true);
    try {
      const doiMatch = citation.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
      const yearMatch = citation.match(/(?:19|20)\d{2}/);
      const r = await a.literatureSave(projectId, {
        title: citation,
        authors: "",
        year: yearMatch ? yearMatch[0] : "",
        venue: "",
        doi: doiMatch ? doiMatch[0] : "",
        url: "",
        abstract: manual.abstract.trim(),
        source: "manual",
        preprint: false,
        refType: manualRefType,
        region: manualRegion,
      }, { manuallyVerified: manualVerify, note: manual.note.trim() });
      setMessage(r.message);
      if (r.saved) { setManual({ citation: "", abstract: "", note: "" }); setManualVerify(false); void refresh(); }
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
        <p className="muted">根据「前期检索与选题」「研究问题与设计」里已填的方向、变量与摘要自动推导检索式，直接检索真实 Crossref 数据源；每条文献的地址直接给出，可一键保存入库。再次检索会自动排除已保存与历史推荐的文献，得到不同的结果。</p>
        <div className="lit-search-row">
          <label className="row-label">总数</label>
          <input className="input input-num" aria-label="自动检索总数" type="number" min={1} max={30} value={autoTotal} onChange={(e) => setAutoTotal(Math.max(1, Math.min(30, Number(e.target.value) || 15)))} />
          <label className="row-label">国内篇数</label>
          <input className="input input-num" aria-label="国内篇数" type="number" min={0} max={autoTotal} value={autoCn} onChange={(e) => setAutoCn(Math.max(0, Math.min(autoTotal, Number(e.target.value) || 0)))} />
          <span className="muted">国外自动为 {Math.max(0, autoTotal - autoCn)} 篇</span>
        </div>
        {autoState && autoState.ok && <p className="muted">本次检索式：{autoState.queryUsed.join("；")}</p>}
        {autoHistory.length > 0 && (
          <details className="lit-log">
            <summary>历史推荐（折叠，共 {autoHistory.length} 批）</summary>
            {autoHistory.map((h, i) => (
              <div key={i} className="auto-history-batch">
                <div className="muted">{h.at} · 检索式：{h.queryUsed.join("；")}{h.counts ? " · 国内 " + h.counts.cnFound + "/" + h.counts.cnRequested + "，国外 " + h.counts.enFound + "/" + h.counts.enRequested : ""}</div>
                <ul className="auto-history-list">
                  {h.results.slice(0, 8).map((c) => <li key={c.doi || c.title}>{c.title}（{c.year}）</li>)}
                  {h.results.length > 8 && <li className="muted">…共 {h.results.length} 条</li>}
                </ul>
              </div>
            ))}
          </details>
        )}
      </section>
      <details className="lit-log">
        <summary>论文检索平台导航（内置检索 + 主要平台跳转，来源于平台导航清单）</summary>
        <p className="muted">内置 Crossref / arXiv / PubMed 直接返回结果；其余主要平台点击「去检索」用当前检索式跳转官网检索（检索式为空时打开平台首页）。平台知名度不等于论文质量，引用前请核对期刊、作者、年份、DOI 与同行评审状态；预印本仅作补充。</p>
        {MAJOR_PLATFORM_GROUPS.map((g) => (
          <div key={g.title} className="platform-group">
            <div className="muted platform-title">{g.title}</div>
            <div className="lit-suggest">
              {g.items.map((p) => (
                <button key={p.key} className="chip" title={p.note ?? p.tag}
                  onClick={() => {
                    const q = query.trim();
                    const url = p.searchTemplate && q ? p.searchTemplate.replace("%s", encodeURIComponent(q)) : (p.searchTemplate ?? "https://www.google.com/search?q=" + (q ? encodeURIComponent(p.name + " " + q) : encodeURIComponent(p.name)));
                    openUrl(url);
                  }}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        ))}
        <p className="muted">完整清单共 89 个平台（含学科门类速查表与调用顺序），见「论文检索平台导航清单」；应用内收录主要平台。</p>
      </details>
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
                  <div className="lit-title">{c.title}
                    {(c as Candidate & { refType?: string }).refType && <span className="badge badge-done">{REF_TYPE_LABEL[(c as Candidate & { refType?: string }).refType as string] ?? "其他"}·{REF_TYPE_PRIORITY[(c as Candidate & { refType?: string }).refType as string] ?? "—"}</span>}
                    {(c as Candidate & { region?: string }).region && <span className="badge">{REGION_LABEL[(c as Candidate & { region?: string }).region as "domestic" | "foreign" | "unknown"] ?? "待区分"}</span>}
                    {c.preprint && <span className="badge badge-warn">预印本</span>}
                  </div>
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
        <h2 className="card-title">手动录入（参考文献引用 + 摘要）</h2>
        <p className="muted">直接粘贴完整参考文献引用（作者、标题、年份、期刊等都包含在里面即可），再补充摘要。手动录入默认标记为「待核验」；勾选人工核验后标记为「已核验」。DOI 与年份会自动从引文中识别。</p>
        <div className="field"><label>参考文献引用</label><textarea className="textarea" aria-label="参考文献引用" placeholder="如：王翠翠, 徐静, 尚倩. 电商直播中虚拟主播互动性对消费者购买行为的影响[J]. 经济与管理, 2023, 37(2): 84-92." value={manual.citation} onChange={(e) => setManual((m) => ({ ...m, citation: e.target.value }))} /></div>
        <div className="form-grid">
          <div className="field">
            <label>文献形式（引用优先级）</label>
            <select className="select" aria-label="手动文献形式" value={manualRefType} onChange={(e) => setManualRefType(e.target.value)}>
              {REF_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}（{t.priority}）</option>)}
            </select>
          </div>
          <div className="field">
            <label>国内外区分</label>
            <select className="select" aria-label="手动国内外" value={manualRegion} onChange={(e) => setManualRegion(e.target.value as "domestic" | "foreign" | "unknown")}>
              <option value="unknown">待区分（需人工确认作者单位与出版地）</option>
              <option value="domestic">国内（境内单位 · CN 刊号/国内会议/国内出版社）</option>
              <option value="foreign">国外（境外单位 · 境外期刊/国际会议/境外出版社）</option>
            </select>
          </div>
        </div>
        <div className="field"><label>摘要</label><textarea className="textarea" aria-label="手动摘要" placeholder="该文献的研究内容摘要（选填）" value={manual.abstract} onChange={(e) => setManual((m) => ({ ...m, abstract: e.target.value }))} /></div>
        <label className="check-row"><input type="checkbox" checked={manualVerify} onChange={(e) => setManualVerify(e.target.checked)} />人工核验（我已在官方来源确认该题录信息）</label>
        <div className="field"><label>核验 / 备注说明</label><input className="input" aria-label="核验说明" placeholder="如：已在知网官网确认 / 检索式与时间" value={manual.note} onChange={(e) => setManual((m) => ({ ...m, note: e.target.value }))} /></div>
        <div className="lit-actions">
          <button className="btn" disabled={aiSearchBusy || !manual.citation.trim()} onClick={() => void runManualAiSearch()}>{aiSearchBusy ? "检索中…" : "AI 检索"}</button>
        </div>
        {aiSearchState && (
          <div className="ai-search-results">
            <p className="muted">检索式：{aiSearchState.queryUsed} · {aiSearchState.message}</p>
            {aiSearchState.results.map((c) => (
              <div key={c.doi || c.title} className="lit-candidate">
                <div className="lit-candidate-main">
                  <div className="lit-title">{c.title}
                    {(c as Candidate & { refType?: string }).refType && <span className="badge badge-done">{REF_TYPE_LABEL[(c as Candidate & { refType?: string }).refType as string] ?? "其他"}</span>}
                    {(c as Candidate & { region?: string }).region && <span className="badge">{REGION_LABEL[(c as Candidate & { region?: string }).region as "domestic" | "foreign" | "unknown"] ?? "待区分"}</span>}
                  </div>
                  <div className="muted">{c.authors}{c.year ? "（" + c.year + "）" : ""}{c.venue ? " · " + c.venue : ""} · DOI: {c.doi || "无"}</div>
                  {c.url && <div className="muted lit-url">来源地址：<a href={c.url} onClick={(e) => { e.preventDefault(); openUrl(c.url); }}>{c.url}</a></div>}
                </div>
                <div className="lit-candidate-actions">
                  <button className="btn btn-sm" onClick={() => adoptAiResult(c)}>采用此记录</button>
                  <button className="btn btn-sm btn-primary" onClick={() => void saveCandidate(c, aiSearchState.queryUsed)}>直接保存</button>
                </div>
              </div>
            ))}
          </div>
        )}
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
                    <span className="badge badge-done">{REF_TYPE_LABEL[lit.refType] ?? "其他"}·{REF_TYPE_PRIORITY[lit.refType] ?? "—"}</span>
                    <span className="badge">{REGION_LABEL[lit.region] ?? "待区分"}</span>
                    {lit.preprint && <span className="badge badge-warn">预印本</span>}
                    <span className={"badge badge-" + (lit.verifiedStatus === "verified" ? "done" : lit.verifiedStatus === "conflict" ? "warn" : "muted")}>{VERIFIED_STATUS_LABEL[lit.verifiedStatus]}</span>
                    <span className="badge">{LITERATURE_SOURCE_LABEL[lit.source]}</span>
                    {lit.pdfName && <span className="badge badge-done">已关联 PDF</span>}
                  </div>
                  <div className="muted">{lit.authors}{lit.year ? "（" + lit.year + "）" : ""}{lit.venue ? " · " + lit.venue : ""}{lit.doi ? " · DOI: " + lit.doi : ""}</div>
                  {lit.verifiedNote && <div className="lit-note">核验记录：{lit.verifiedNote}</div>}
                  <div className="lit-search-row meta-row">
                    <select className="select select-sm" aria-label={"文献形式-" + lit.title.slice(0, 12)} value={lit.refType ?? "other"}
                      onChange={async (e) => { const a = api(); if (!a) return; await a.literatureUpdateMeta(projectId, lit.id, { refType: e.target.value }); void refresh(); }}>
                      {REF_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}（{t.priority}）</option>)}
                    </select>
                    <select className="select select-sm" aria-label={"国内外-" + lit.title.slice(0, 12)} value={lit.region ?? "unknown"}
                      onChange={async (e) => { const a = api(); if (!a) return; await a.literatureUpdateMeta(projectId, lit.id, { region: e.target.value }); void refresh(); }}>
                      <option value="domestic">国内</option>
                      <option value="foreign">国外</option>
                      <option value="unknown">待区分</option>
                    </select>
                  </div>
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
