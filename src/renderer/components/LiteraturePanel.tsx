import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import type { EvidenceCard, LiteratureItem, SearchLogEntry, SearchOutcome } from "../../shared/literature";
import { CN_PLATFORMS, LITERATURE_SOURCE_LABEL, MAJOR_PLATFORM_GROUPS, REF_TYPES, REF_TYPE_LABEL, REF_TYPE_PRIORITY, REGION_LABEL, VERIFIED_STATUS_LABEL } from "../../shared/literature";
import { parseBibTeX, parseRIS, type ParsedReference } from "../../shared/bibparse";
import { PlatformPreferenceModal, type PlatformPrefs } from "./PlatformPreferenceModal";

const api = () => window.thesisWorkbench;

type Candidate = SearchOutcome["items"][number];

const SOURCES = [
  { key: "crossref", label: "Crossref（书目 / DOI 核验）" },
  { key: "arxiv", label: "arXiv（预印本）" },
  { key: "pubmed", label: "PubMed（生物医学）" },
];

const SOURCE_STATUS_LABEL: Record<string, string> = { ok: "返回结果", no_results: "无结果", error: "失败" };

const LANG_LABEL: Record<string, string> = { zh: "中文", en: "外文" };

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
  const [autoState, setAutoState] = useState<{ ok: boolean; message: string; queryUsed: string[]; results: Candidate[]; counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number }; cnNote?: string; backgroundLinks?: Array<{ name: string; url: string }>; cnJumpLinks?: Array<{ name: string; url: string; query: string }> } | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [autoTotal, setAutoTotal] = useState(15);
  const [autoCn, setAutoCn] = useState(0);
  const [autoRangeWarn, setAutoRangeWarn] = useState("");
  const [autoHistory, setAutoHistory] = useState<Array<{ at: string; queryUsed: string[]; results: Candidate[]; counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number } }>>([]);
  const [platformPrefs, setPlatformPrefs] = useState<PlatformPrefs>(() => {
    try {
      const raw = localStorage.getItem("tw-platform-prefs");
      if (raw) return { platformKeys: [], openAccessOnly: false, globalLibraries: false, ...(JSON.parse(raw) as Partial<PlatformPrefs>) };
    } catch { /* 忽略 */ }
    return { platformKeys: [], openAccessOnly: false, globalLibraries: false };
  });
  const [keywordPlan, setKeywordPlan] = useState<{ subject: string[]; result: string[]; extra: string[]; queries: Array<{ zh: string; en: string | null; label: string; level: string; pair: { sub: string; res: string } }>; note: string; aiGenerated: boolean } | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [reactBusy, setReactBusy] = useState(false);
  const [reactOutcome, setReactOutcome] = useState<{ message: string; counts: { cnRequested: number; enRequested: number; cnFound: number; enFound: number }; verifyNote: string; needMore: boolean } | null>(null);
  const [researchedDois, setResearchedDois] = useState<string[]>([]);
  const [kwHistory, setKwHistory] = useState<Array<{ subject: string[]; result: string[]; extra: string[]; queries: Array<{ zh: string; en: string | null; label: string; level: string; pair: { sub: string; res: string } }>; note: string; aiGenerated: boolean }>>([]);
  const [kwHistIdx, setKwHistIdx] = useState(-1);
  const [kwAddText, setKwAddText] = useState("");
  const [kwAddKind, setKwAddKind] = useState<"subject" | "result" | "extra">("subject");
  const [prefModalOpen, setPrefModalOpen] = useState(false);
  const [preferredLinks, setPreferredLinks] = useState<Array<{ key: string; name: string; url: string }>>([]);

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

  const runPlanKeywords = async () => {
    const a = api();
    if (!a || planBusy) return;
    setPlanBusy(true);
    setError("");
    try {
      const plan = await a.reactPlanKeywords(projectId);
      setKeywordPlan(plan);
      setKwHistory((prev) => [...prev.slice(0, kwHistIdx + 1), plan]);
      setKwHistIdx((i) => i + 1);
      setMessage("关键词方案已生成（" + (plan.aiGenerated ? "AI 三步规划" : "词典确定性生成") + "）。确认后点「② AI 搜寻论文」逐个关键词检索");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPlanBusy(false);
    }
  };

  const commitPlan = (p: NonNullable<typeof keywordPlan>) => {
    setKeywordPlan(p);
    setKwHistory((prev) => [...prev.slice(0, kwHistIdx + 1), p]);
    setKwHistIdx((i) => i + 1);
  };

  const removeKw = (term: string) => {
    if (!keywordPlan) return;
    commitPlan({
      ...keywordPlan,
      subject: keywordPlan.subject.filter((s) => s !== term),
      result: keywordPlan.result.filter((s) => s !== term),
      extra: keywordPlan.extra.filter((s) => s !== term),
      queries: keywordPlan.queries.filter((q) => q.pair.sub !== term && q.pair.res !== term),
    });
  };

  const addKw = () => {
    const term = kwAddText.trim();
    if (!term || !keywordPlan) return;
    const kindLabel = kwAddKind === "subject" ? "主体「" + term + "」" : kwAddKind === "result" ? "结果「" + term + "」" : "背景「" + term + "」";
    commitPlan({
      ...keywordPlan,
      [kwAddKind]: [...new Set([...(keywordPlan[kwAddKind] ?? []), term])],
      queries: [...keywordPlan.queries, { zh: term, en: null, label: kindLabel, level: "L1", pair: { sub: kwAddKind === "subject" ? term : "", res: kwAddKind === "result" ? term : "" } }],
    });
    setKwAddText("");
  };

  const undoKw = () => {
    if (kwHistIdx <= 0) return;
    const target = kwHistory[kwHistIdx - 1];
    setKwHistIdx(kwHistIdx - 1);
    if (target) setKeywordPlan(target);
  };

  const redoKw = () => {
    if (kwHistIdx >= kwHistory.length - 1) return;
    const target = kwHistory[kwHistIdx + 1];
    setKwHistIdx(kwHistIdx + 1);
    if (target) setKeywordPlan(target);
  };

  const runReactSearch = async (extraExcludes: string[] = []) => {
    const a = api();
    if (!a || reactBusy || !keywordPlan) return;
    const totalNum = Number(autoTotal);
    if (!Number.isFinite(totalNum) || totalNum < 15 || totalNum > 30) {
      setAutoRangeWarn(totalNum > 30 ? "⚠ 最多 30 篇，请将总数调整到 30 以内（15–30）" : "⚠ 建议总数不少于 15 篇（范围 15–30）");
      if (totalNum > 30) return;
    } else {
      setAutoRangeWarn("");
    }
    setReactBusy(true);
    setError("");
    try {
      const excludeDois = [
        ...items.map((i) => i.doi).filter(Boolean),
        ...autoHistory.flatMap((h) => h.results.map((c) => c.doi).filter(Boolean)),
        ...researchedDois,
        ...extraExcludes,
      ];
      const r = await a.reactExecuteSearch(projectId, keywordPlan, { cn: Number(autoCn) || 0, en: Math.max(0, totalNum - (Number(autoCn) || 0)), excludeDois });
      setCandidates(r.results);
      setOutcomeMeta({ source: "ReAct 逐关键词检索", query: r.queriesUsed.join(" / "), status: "ok", message: r.message, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
      setAutoHistory((prev) => [{ at: new Date().toLocaleString("zh-CN"), queryUsed: r.queriesUsed, results: r.results, counts: r.counts }, ...prev].slice(0, 5));
      setResearchedDois((prev) => [...new Set([...prev, ...r.results.map((c) => c.doi).filter(Boolean)])]);
      const v = await a.reactVerifyResults(projectId, r);
      setReactOutcome({ message: r.message, counts: r.counts, verifyNote: v.verifyNote, needMore: r.needMore });
      setMessage(r.message + "。核验：" + v.verifyNote);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReactBusy(false);
    }
  };

  const runAutoSearch = async () => {
    const a = api();
    if (!a || autoBusy) return;
    const totalNum = Number(autoTotal);
    if (!Number.isFinite(totalNum) || totalNum < 15 || totalNum > 30) {
      setAutoRangeWarn(totalNum > 30 ? "⚠ 最多 30 篇，请将总数调整到 30 以内（15–30）" : "⚠ 建议总数不少于 15 篇（范围 15–30），过少会影响文献综述的充分性");
      if (totalNum > 30) return;
    } else {
      setAutoRangeWarn("");
    }
    setAutoBusy(true);
    setError("");
    setPreferredLinks([]);
    setCandidates([]);
    setAutoState(null);
    try {
      const excludeDois = [
        ...items.map((i) => i.doi).filter(Boolean),
        ...autoHistory.flatMap((h) => h.results.map((c) => c.doi).filter(Boolean)),
      ];
      const r = await a.literatureAutoSearch(projectId, {
        total: Math.min(30, Math.max(15, totalNum)),
        cn: Math.max(0, Math.min(totalNum, Number(autoCn) || 0)),
        en: Math.max(0, totalNum - (Number(autoCn) || 0)),
        excludeDois,
        preferredPlatforms: platformPrefs.platformKeys,
        openAccessOnly: platformPrefs.openAccessOnly,
        globalLibraries: platformPrefs.globalLibraries,
      });
      setAutoState({ ...r, results: r.results as Candidate[] });
      if (r.preferredLinks) setPreferredLinks(r.preferredLinks);
      if (r.ok) {
        setCandidates(r.results);
        setAutoHistory((prev) => [{ at: new Date().toLocaleString("zh-CN"), queryUsed: r.queryUsed, results: r.results, counts: r.counts }, ...prev].slice(0, 5));
        setOutcomeMeta({ source: "OpenAlex + Crossref（一键自动检索）", query: r.queryUsed.join(" / "), status: "ok", message: r.message, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
        setMessage(r.message + (r.cnNote ? "。注意：" + r.cnNote : ""));
        void refresh();
      } else {
        setCandidates([]);
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
          <h3 className="ai-title">一键自动找文献（ReAct 三步：优化关键词 → 逐关键词检索 → 核验）</h3>
        </div>
        {/* ① 关键词规划框 */}
        <div className="react-box">
          <div className="react-box-head">
            <h4>① 关键词规划（AI 生成额外关键词，保留原有关键词与选题关键词）</h4>
            <button className="btn" disabled={planBusy || reactBusy} onClick={() => void runPlanKeywords()}>{planBusy ? "规划中…" : "生成关键词方案"}</button>
          </div>
          <p className="muted">{keywordPlan ? keywordPlan.note : "点击上方按钮：读取第 0/1/2 阶段内容，提取关键词并延申同义词，结果输出到下方关键词输出框。"}</p>
          <div className="kw-output">
            <div className="kw-output-head">
              <span className="kw-output-title">关键词输出框（从左到右摊开，点击标签可删除）</span>
              <span className="kw-tools">
                <button className="btn btn-sm" disabled={kwHistIdx <= 0} onClick={undoKw} title="撤销上一次增删">↩ 回退</button>
                <button className="btn btn-sm" disabled={kwHistIdx >= kwHistory.length - 1} onClick={redoKw} title="重做">↪ 前进</button>
              </span>
            </div>
            <div className="kw-chips">
              {keywordPlan && (
                <>
                  {keywordPlan.subject.map((s) => (
                    <button key={"s" + s} className="kw-tag" onClick={() => removeKw(s)}>主体词：{s}<span className="kw-x">✕</span></button>
                  ))}
                  {keywordPlan.result.map((s) => (
                    <button key={"r" + s} className="kw-tag kw-tag-result" onClick={() => removeKw(s)}>结果词：{s}<span className="kw-x">✕</span></button>
                  ))}
                  {keywordPlan.extra.map((s) => (
                    <button key={"e" + s} className="kw-tag kw-tag-extra" onClick={() => removeKw(s)}>背景词：{s}<span className="kw-x">✕</span></button>
                  ))}
                </>
              )}
              {(!keywordPlan || keywordPlan.subject.length + keywordPlan.result.length + keywordPlan.extra.length === 0) && (
                <span className="muted">暂无关键词：点上方「生成关键词方案」，或在下方输入框手动添加。</span>
              )}
            </div>
            <div className="kw-add-row">
              <input className="input" aria-label="新增关键词" placeholder="输入要补充的关键词（2-10 字）" value={kwAddText} onChange={(e) => setKwAddText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addKw(); }} />
              <select className="input" aria-label="关键词类别" value={kwAddKind} onChange={(e) => setKwAddKind(e.target.value as "subject" | "result" | "extra")}>
                <option value="subject">主体词</option>
                <option value="result">结果词</option>
                <option value="extra">背景词</option>
              </select>
              <button className="btn btn-sm" disabled={!kwAddText.trim() || !keywordPlan} onClick={addKw}>添加</button>
            </div>
            {keywordPlan && keywordPlan.queries.length > 0 && (
              <div className="muted kw-queries">逐个检索计划（每次只用一组关键词）：{keywordPlan.queries.map((q) => q.label).join("；")}</div>
            )}
          </div>
        </div>

        {/* ② AI 检索框 */}
        <div className="react-box">
          <div className="react-box-head">
            <h4>② AI 检索论文（按关键词方案逐个检索，结果输出到下方）</h4>
            <button className="btn btn-primary" disabled={reactBusy || !keywordPlan} onClick={() => void runReactSearch()}>{reactBusy ? "检索中…" : "开始检索"}</button>
          </div>
          {reactOutcome ? (
            <div className="react-output">
              <div className="banner banner-info">国内 {reactOutcome.counts.cnFound}/{reactOutcome.counts.cnRequested}、国外 {reactOutcome.counts.enFound}/{reactOutcome.counts.enRequested} · 核验：{reactOutcome.verifyNote}</div>
              <div className="muted">本次逐关键词检索式：{keywordPlan ? keywordPlan.queries.map((q) => q.zh).filter(Boolean).join("；") : ""}</div>
            </div>
          ) : (
            <p className="muted">完成①后执行；检索数量与核验结论将显示在此框内。</p>
          )}
        </div>

        {/* AI 再次查询框 */}
        <div className="react-box">
          <div className="react-box-head">
            <h4>AI 再次查询（数量或主题不符时补充检索）</h4>
            <button className="btn" disabled={reactBusy || !reactOutcome || (!reactOutcome.needMore && !/未通过|再次/.test(reactOutcome.verifyNote))} onClick={() => void runReactSearch([])}>再次查询</button>
          </div>
          <p className="muted">排除已保存与已搜寻文献后重新检索，避免重复；未完成首次检索时不可用。</p>
        </div>
        <p className="muted">根据「前期检索与选题」「研究问题与设计」里已填的方向、变量与摘要自动推导检索式，直接检索真实 OpenAlex 与 Crossref 数据源；每条文献的地址直接给出，可一键保存入库。再次检索会自动排除已保存与历史推荐的文献，得到不同的结果。语言只标记「中文/外文」，国内外归属需人工确认作者单位与出版地。</p>
        <div className="lit-search-row auto-counts-row">
          <label className="row-label">总数</label>
          <input className="input input-num" aria-label="自动检索总数" type="number" min={15} max={30} step={1} value={autoTotal} onChange={(e) => setAutoTotal(Number(e.target.value) || 15)} />
          <label className="row-label">中文篇数</label>
          <input className="input input-num" aria-label="中文篇数" type="number" min={0} max={autoTotal} step={1} value={autoCn} onChange={(e) => setAutoCn(Number(e.target.value) || 0)} />
          <span className="muted">外文自动为 {Math.max(0, Number(autoTotal) - Number(autoCn))} 篇</span>
          <span className="muted range-hint">总数范围：大于等于 15 篇、小于等于 30 篇</span>
          <button className="btn btn-sm" onClick={() => setPrefModalOpen(true)}>选择偏好论文库{platformPrefs.platformKeys.length > 0 ? "（已选 " + platformPrefs.platformKeys.length + "）" : ""}</button>
        </div>
        {autoRangeWarn && <p className="banner banner-error">{autoRangeWarn}</p>}
        {autoState && autoState.ok && <p className="muted">本次检索式：{autoState.queryUsed.join("；")}</p>}
        {autoState?.cnJumpLinks && autoState.cnJumpLinks.length > 0 && (
          <div className="preferred-links cn-jump">
            <span className="muted">中文文献主检索源（带必选词约束的检索式，点击跳转官网检索后导入本库）：{autoState.cnJumpLinks[0]?.query ?? ""}</span>
            <div className="lit-suggest">
              {autoState.cnJumpLinks.map((l) => (
                <button key={l.name + l.query} className="chip chip-on" title={"检索式：" + l.query} onClick={() => openUrl(l.url)}>{l.name} · {l.query}</button>
              ))}
            </div>
          </div>
        )}
        {autoState && <p className="muted">说明：{autoState.cnNote ?? ""}</p>}
        {autoState?.backgroundLinks && autoState.backgroundLinks.length > 0 && (
          <div className="preferred-links">
            <span className="muted">背景引用与补充检索（行业报告/政策文件不计入学术文献配额）：</span>
            <div className="lit-suggest">
              {autoState.backgroundLinks.map((l) => (
                <button key={l.name} className="chip" onClick={() => openUrl(l.url)}>{l.name}</button>
              ))}
            </div>
          </div>
        )}
        {preferredLinks.length > 0 && (
          <div className="preferred-links">
            <span className="muted">偏向检索（非绝对，点击用本次检索式跳转官网）：</span>
            <div className="lit-suggest">
              {preferredLinks.map((l) => (
                <button key={l.key} className="chip" onClick={() => openUrl(l.url)}>{l.name}</button>
              ))}
            </div>
          </div>
        )}
        {autoHistory.length > 0 && (
          <details className="lit-log">
            <summary>历史推荐（折叠，共 {autoHistory.length} 批）</summary>
            {autoHistory.map((h, i) => (
              <div key={i} className="auto-history-batch">
                <div className="muted">{h.at} · 检索式：{h.queryUsed.join("；")}{h.counts ? " · 中文 " + h.counts.cnFound + "/" + h.counts.cnRequested + "，外文 " + h.counts.enFound + "/" + h.counts.enRequested : ""}</div>
                <ul className="auto-history-list">
                  {h.results.slice(0, 8).map((c) => (
                    <li key={c.doi || c.title}>{c.title}（{c.year}）{c.url && <a href={c.url} onClick={(e) => { e.preventDefault(); openUrl(c.url); }}>打开链接</a>}</li>
                  ))}
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
                    {(c as Candidate & { level?: string }).level && (c as Candidate & { level?: string }).level !== "core" && <span className="badge badge-warn">{(c as Candidate & { level?: string }).level === "l1" ? "1级扩容·同概念不同场景" : (c as Candidate & { level?: string }).level === "l2" ? "2级扩容·同理论不同对象" : (c as Candidate & { level?: string }).level}</span>}
                    {(c as Candidate & { refType?: string }).refType && <span className="badge badge-done">{REF_TYPE_LABEL[(c as Candidate & { refType?: string }).refType as string] ?? "其他"}·{REF_TYPE_PRIORITY[(c as Candidate & { refType?: string }).refType as string] ?? "—"}</span>}
                    {(c as Candidate & { region?: string }).region && <span className="badge">{REGION_LABEL[(c as Candidate & { region?: string }).region as "domestic" | "foreign" | "unknown"] ?? "待区分"}</span>}
                    {(c as Candidate & { language?: string }).language && <span className="badge badge-muted">{LANG_LABEL[(c as Candidate & { language?: string }).language as string] ?? (c as Candidate & { language?: string }).language}</span>}
                    {c.preprint && <span className="badge badge-warn">预印本</span>}
                    {(c as Candidate & { citedBy?: number }).citedBy !== undefined && <span className="badge">被引 {(c as Candidate & { citedBy?: number }).citedBy}</span>}
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
                    {(c as Candidate & { language?: string }).language && <span className="badge badge-muted">{LANG_LABEL[(c as Candidate & { language?: string }).language as string] ?? (c as Candidate & { language?: string }).language}</span>}
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
                    {lit.language && <span className="badge badge-muted">{LANG_LABEL[lit.language] ?? lit.language}</span>}
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
        {prefModalOpen && (
        <PlatformPreferenceModal
          initial={platformPrefs}
          onConfirm={(prefs) => { setPlatformPrefs(prefs); try { localStorage.setItem("tw-platform-prefs", JSON.stringify(prefs)); } catch { /* 忽略 */ } setPrefModalOpen(false); setMessage("已保存论文库偏好（偏向，非绝对）：" + (prefs.platformKeys.length > 0 ? "已选 " + prefs.platformKeys.length + " 个库" : "未选具体库") + "；" + (prefs.openAccessOnly ? "只偏向开放资料" : "可接受订阅资料") + (prefs.globalLibraries ? "；含全球通用库" : "")); }}
          onCancel={() => setPrefModalOpen(false)}
        />
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
