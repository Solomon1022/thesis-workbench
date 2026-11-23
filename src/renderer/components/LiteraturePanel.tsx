import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../shared/types";
import type { EvidenceCard, LiteratureItem, SearchLogEntry, SearchOutcome } from "../../shared/literature";
import { CN_PLATFORMS, LITERATURE_SOURCE_LABEL, MAJOR_PLATFORM_GROUPS, REF_TYPES, REF_TYPE_LABEL, REF_TYPE_PRIORITY, REGION_LABEL, VERIFIED_STATUS_LABEL } from "../../shared/literature";
import { parseBibTeX, parseRIS, type ParsedReference } from "../../shared/bibparse";
import { toast } from "./Toast";


const api = () => window.thesisWorkbench;

type Candidate = SearchOutcome["items"][number];

const SOURCES = [
  { key: "crossref", label: "Crossref（书目 / DOI 核验）" },
  { key: "hanspub", label: "汉斯出版社（OA）" },
  { key: "arxiv", label: "arXiv（预印本）" },
  { key: "pubmed", label: "PubMed（生物医学）" },
  { key: "cnki", label: "中国知网 CNKI（校园网题录直抓，失败提示官网检索）" },
  { key: "wanfang", label: "万方数据（官网跳转检索）" },
  { key: "vip", label: "维普网（官网跳转检索）" },
];

const SOURCE_STATUS_LABEL: Record<string, string> = { ok: "返回结果", no_results: "无结果", error: "失败" };

const LANG_LABEL: Record<string, string> = { zh: "中文", en: "外文" };

export function LiteraturePanel({ detail }: { detail: ProjectDetail }) {
  const projectId = detail.project.id;
  const [items, setItems] = useState<LiteratureItem[]>([]);
  const [log, setLog] = useState<SearchLogEntry[]>([]);
  const [justSavedId, setJustSavedId] = useState("");
  const markSaved = (id: string, title: string) => {
    setJustSavedId(id);
    toast("已保存到文献库", "Saved to library · " + title.slice(0, 40));
    setTimeout(() => setJustSavedId(""), 3200);
  };
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
  const [autoState, setAutoState] = useState<{ ok: boolean; message: string; queryUsed: string[]; results: Candidate[]; counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number }; cnNote?: string; backgroundLinks?: Array<{ name: string; url: string }>; cnJumpLinks?: Array<{ name: string; url: string; query: string }>; foreignLinks?: Array<{ key: string; name: string; url: string; query: string }> } | null>(null);
  const [autoCn, setAutoCn] = useState(15);
  const [autoRangeWarn, setAutoRangeWarn] = useState("");
  const [autoHistory, setAutoHistory] = useState<Array<{ at: string; queryUsed: string[]; results: Candidate[]; counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number } }>>([]);
  const [reactBusy, setReactBusy] = useState(false);
  const [reactOutcome, setReactOutcome] = useState<{ message: string; counts: { cnRequested: number; enRequested: number; cnFound: number; enFound: number }; verifyNote: string; needMore: boolean } | null>(null);
  const [researchedDois, setResearchedDois] = useState<string[]>([]);
  const [autoEn, setAutoEn] = useState(2);
  const [searchProgress, setSearchProgress] = useState("");


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

  /** 把后台任务的结果 JSON 恢复成界面状态（返回本页时不丢内容） */
  const applySearchResult = (json: string) => {
    try {
      const r = JSON.parse(json) as {
        outcome?: {
          ok: boolean; message: string; queriesUsed: string[]; results: Candidate[];
          counts: { cnRequested: number; enRequested: number; cnFound: number; enFound: number };
          needMore: boolean; cnNote?: string;
          cnJumpLinks?: Array<{ name: string; url: string; query: string }>;
          foreignLinks?: Array<{ key: string; name: string; url: string; query: string }>;
        };
        verify?: { verifyNote: string; pass: boolean };
      };
      if (!r?.outcome) return;
      setCandidates(r.outcome.results ?? []);
      setOutcomeMeta({
        source: "AI 检索（第 0/1/2 阶段内容 → MD → AI 规划 → 知网/汉斯出版社/Google Scholar/BASE 检索）",
        query: (r.outcome.queriesUsed ?? []).join(" / "),
        status: "ok",
        message: r.outcome.message,
        time: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
      });
      setReactOutcome({ message: r.outcome.message, counts: r.outcome.counts, verifyNote: r.verify?.verifyNote ?? "", needMore: r.outcome.needMore });
      setAutoState({
        ok: true,
        message: r.outcome.message,
        queryUsed: r.outcome.queriesUsed ?? [],
        results: [],
        counts: r.outcome.counts,
        cnNote: r.outcome.cnNote ?? "",
        cnJumpLinks: r.outcome.cnJumpLinks ?? [],
        foreignLinks: r.outcome.foreignLinks ?? [],
        backgroundLinks: [],
      });
      setMessage(r.outcome.message);
    } catch { /* 忽略损坏的结果 */ }
  };

  useEffect(() => {
    const a = api();
    if (!a) return;
    const off = a.onReactSearchProgress((msg) => setSearchProgress(msg));
    let cancelled = false;
    const restore = async () => {
      try {
        const jobs = await a.aiJobsList(projectId);
        const latest = jobs.find((j) => j.kind === "literature_search");
        if (!latest) return;
        if (latest.status === "running") {
          setReactBusy(true);
          setSearchProgress(latest.message);
          const timer = setInterval(async () => {
            if (cancelled) { clearInterval(timer); return; }
            const js = await a.aiJobsList(projectId);
            const j = js.find((x) => x.id === latest.id);
            if (!j) { clearInterval(timer); setReactBusy(false); return; }
            setSearchProgress(j.message);
            if (j.status !== "running") {
              clearInterval(timer);
              setReactBusy(false);
              if (j.status === "done" && j.resultJson) applySearchResult(j.resultJson);
            }
          }, 3000);
          return () => clearInterval(timer);
        } else if (latest.status === "done" && latest.resultJson) {
          applySearchResult(latest.resultJson);
        }
      } catch { /* 忽略 */ }
    };
    void restore();
    return () => { cancelled = true; off(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const runReactSearch = async (extraExcludes: string[] = []) => {
    const a = api();
    if (!a || reactBusy) return;
    const cnNum = Number(autoCn) || 0;
    const enNum = Number(autoEn) || 0;
    const totalNum = cnNum + enNum;
    if (!Number.isFinite(totalNum) || totalNum < 15 || totalNum > 30) {
      setAutoRangeWarn(totalNum > 30 ? "⚠ 国内+国外合计最多 30 篇，请调整（15–30）" : "⚠ 国内+国外合计建议不少于 15 篇（范围 15–30）");
      if (totalNum > 30) return;
    } else {
      setAutoRangeWarn("");
    }
    setReactBusy(true);
    setSearchProgress("");
    setError("");
    setAutoState(null);
    try {
      const excludeDois = [
        ...items.map((i) => i.doi).filter(Boolean),
        ...autoHistory.flatMap((h) => h.results.map((c) => c.doi).filter(Boolean)),
        ...researchedDois,
        ...extraExcludes,
      ];
      const r = await a.reactSearchAll(projectId, { cn: cnNum, en: enNum, excludeDois });
      setCandidates(r.outcome.results);
      setOutcomeMeta({ source: "AI 检索（第 0/1/2 阶段内容 → MD → AI 规划 → 知网/汉斯出版社/Google Scholar/BASE 检索）", query: r.outcome.queriesUsed.join(" / "), status: "ok", message: r.outcome.message, time: new Date().toLocaleTimeString("zh-CN", { hour12: false }) });
      setAutoHistory((prev) => [{ at: new Date().toLocaleString("zh-CN"), queryUsed: r.outcome.queriesUsed, results: r.outcome.results, counts: r.outcome.counts }, ...prev].slice(0, 5));
      setResearchedDois((prev) => [...new Set([...prev, ...r.outcome.results.map((c) => c.doi).filter(Boolean)])]);
      setReactOutcome({ message: r.outcome.message, counts: r.outcome.counts, verifyNote: r.verify.verifyNote, needMore: r.outcome.needMore });
      setAutoState({ ok: true, message: r.outcome.message, queryUsed: r.outcome.queriesUsed, results: [], counts: r.outcome.counts, cnNote: r.outcome.cnNote ?? "", cnJumpLinks: r.outcome.cnJumpLinks ?? [], foreignLinks: r.outcome.foreignLinks ?? [], backgroundLinks: [] });
      setMessage(r.outcome.message + "。核验：" + r.verify.verifyNote);
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/abort|已取消/i.test(msg)) setMessage("检索已取消（已取回的内容不入库，可调整数量后重试）");
      else setError(msg);
    } finally {
      setReactBusy(false);
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
    if (r.saved) {
      setMessage("已保存：" + (r.item?.title ?? "").slice(0, 40));
      markSaved(r.item?.id ?? "", r.item?.title ?? "");
      void refresh();
    } else {
      setMessage(r.message);
      toast("未重复保存", "Already in library · 已存在相同文献", "info");
    }
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
      if (r.saved) { setManual({ citation: "", abstract: "", note: "" }); setManualVerify(false); markSaved(r.item?.id ?? "", r.item?.title ?? ""); void refresh(); }
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
    if (r.saved) { markSaved(r.item?.id ?? "", r.item?.title ?? ""); void refresh(); }
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
      const r = await a.literatureGenQueries(projectId, detail.project.name || "我的研究主题");
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

  const mdRefTypes = [
    { key: "期刊论文", label: "期刊论文" },
    { key: "学位论文", label: "学位论文" },
    { key: "会议论文", label: "会议论文" },
    { key: "综述", label: "综述" },
  ];
  const mdPlatforms = [
    { key: "中国知网", label: "中国知网" },
    { key: "万方数据", label: "万方数据" },
    { key: "维普网", label: "维普网" },
    { key: "汉斯出版社", label: "汉斯出版社" },
    { key: "Google Scholar", label: "Google Scholar" },
    { key: "BASE", label: "BASE" },
  ];
  const [mdRefSel, setMdRefSel] = useState<string[]>([]);
  const [mdPlatSel, setMdPlatSel] = useState<string[]>([]);
  const toggleMdRef = (k: string) => setMdRefSel((p) => {
    const next = p.includes(k) ? p.filter((x) => x !== k) : [...p, k];
    void api()?.settingsSaveApp({ md_ref_prefs: JSON.stringify(next) });
    return next;
  });
  const toggleMdPlat = (k: string) => setMdPlatSel((p) => {
    const next = p.includes(k) ? p.filter((x) => x !== k) : [...p, k];
    void api()?.settingsSaveApp({ md_plat_prefs: JSON.stringify(next) });
    return next;
  });
  // 记住上次导出的偏好（全局设置）
  useEffect(() => {
    const a = api();
    if (!a) return;
    void a.settingsGetApp().then((s) => {
      try {
        const rp = JSON.parse((s as unknown as Record<string, string>).md_ref_prefs ?? "[]") as string[];
        const pp = JSON.parse((s as unknown as Record<string, string>).md_plat_prefs ?? "[]") as string[];
        if (Array.isArray(rp)) setMdRefSel(rp);
        if (Array.isArray(pp)) setMdPlatSel(pp);
      } catch { /* 忽略 */ }
    }).catch(() => { /* 忽略 */ });
  }, []);
  const exportMd = async () => {
    const a = api();
    if (!a) return;
    try {
      const r = await a.literatureExportMd(projectId, { refTypes: mdRefSel, platforms: mdPlatSel });
      setMessage(r.message);
      if (r.ok && r.path) setMessage(r.message + "（发送给 AI 后，把标题/参考文献粘贴到下方「AI 结果回填」批量导入即可）");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [aiImportText, setAiImportText] = useState("");
  const [aiImportBusy, setAiImportBusy] = useState(false);
  const runAiImport = async () => {
    const a = api();
    if (!a || aiImportBusy) return;
    setAiImportBusy(true);
    setError("");
    try {
      const r = await a.literatureImportAiText(projectId, aiImportText);
      if (r.ok) {
        setMessage(r.message);
        toast("AI 结果已回填", "Imported · 已核验 " + r.verified + " 条 / 待核验 " + r.unverified + " 条");
        setAiImportText("");
        void refresh();
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiImportBusy(false);
    }
  };

  // 浏览器扩展导入事件：刷新并提示
  useEffect(() => {
    const a = api();
    if (!a) return;
    const off = a.onBridgeImported((p) => {
      if (p.projectId !== projectId) return;
      setMessage("浏览器扩展已回填：已核验入库 " + p.summary.verified + " 条，待人工核验 " + p.summary.unverified + " 条" + (p.summary.skipped > 0 ? "，重复跳过 " + p.summary.skipped + " 条" : ""));
      void refresh();
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /** GB/T 7714 单条引用（缺卷期页码时按期刊原文补全；不编造信息） */
  const citeGbt = (c: { authors: string; title: string; venue: string; year: string; doi: string; url: string; refType?: string }): string => {
    const type = c.refType ?? "other";
    const letter = type === "journal" ? "J" : type === "thesis" ? "D" : type === "conference" ? "C" : type === "book" ? "M" : type === "preprint" ? "A" : "Z";
    const all = (c.authors || "").split(";").map((s) => s.trim()).filter(Boolean);
    const authorPart = all.length > 0 ? all.slice(0, 3).join(", ") + (all.length > 3 ? ", 等" : "") + ". " : "";
    const titlePart = c.title + (c.title.endsWith(".") ? "" : ".");
    const venuePart = c.venue ? c.venue + ", " : "";
    const yearPart = c.year ? c.year + "." : "";
    const doiPart = c.doi ? " DOI:" + c.doi + "." : "";
    return authorPart + titlePart + "[" + letter + "]." + (venuePart ? " " + venuePart : " ") + yearPart + doiPart;
  };
  const copyCitation = async (c: { authors: string; title: string; venue: string; year: string; doi: string; url: string; refType?: string }) => {
    try {
      await navigator.clipboard.writeText(citeGbt(c));
      setMessage("已复制 GB/T 7714 引用（缺卷期页码，请按期刊原文补全）");
    } catch {
      setMessage("复制失败，请手动复制");
    }
  };

  return (
    <div className="literature-panel">
      <section className="card">
        <div className="card-head-row">
          <h3 className="ai-title">一键自动找文献</h3>
        </div>
        {/* AI 检索论文：第 0/1/2 阶段内容 → MD → 一次性发送 AI → 真实数据源检索 */}
        <div className="react-box">
          <div className="react-box-head">
            <h4>AI 检索论文（把第 0/1/2 阶段的全部内容整理成 Markdown 发送给 AI，由 AI 抓取信息并生成检索计划，然后在真实数据源检索）</h4>
            <button className="btn btn-primary" disabled={reactBusy} onClick={() => void runReactSearch()}>{reactBusy ? "检索中…" : "AI 检索论文"}</button>
            {reactBusy && <button className="btn btn-warn" onClick={() => void api()?.reactCancelSearch(projectId)}>取消检索</button>}
          </div>
          <div className="lit-search-row auto-counts-row">
            <label className="row-label">国内篇数（默认）</label>
            <input className="input input-num" aria-label="国内篇数" type="number" min={0} max={30} step={1} value={autoCn} onChange={(e) => setAutoCn(Number(e.target.value) || 0)} />
            <label className="row-label">国外篇数（自填）</label>
            <input className="input input-num" aria-label="国外篇数" type="number" min={0} max={30} step={1} value={autoEn} onChange={(e) => setAutoEn(Number(e.target.value) || 0)} />
            <span className="muted range-hint">合计范围：15–30 篇（国内 + 国外）</span>
          </div>
          {autoRangeWarn && <p className="banner banner-error">{autoRangeWarn}</p>}
          {reactBusy && <p className="muted">正在整理第 0/1/2 阶段内容并发送给 AI 规划检索（推理模型较慢属正常，请稍候；实测预计 4–9 分钟：AI 计划与重排约 3–4 分钟 + 真实数据源检索约 2–5 分钟，校园网环境知网直抓可再省 1–2 分钟）…</p>}
          {reactBusy && searchProgress && <p className="muted search-progress">检索进度：{searchProgress}</p>}
          {reactOutcome ? (
            <div className="react-output">
              <div className="banner banner-info">国内 {reactOutcome.counts.cnFound}/{reactOutcome.counts.cnRequested}、国外 {reactOutcome.counts.enFound}/{reactOutcome.counts.enRequested} · 核验：{reactOutcome.verifyNote}</div>
              <div className="lit-search-row">
                <button className="btn" disabled={reactBusy || (!reactOutcome.needMore && !/未通过|再次/.test(reactOutcome.verifyNote))} onClick={() => void runReactSearch([])}>AI 再次查询（排除已搜文献）</button>
                <span className="muted">数量或主题不符时可补充检索；已保存与已搜寻文献自动屏蔽。</span>
              </div>
            </div>
          ) : (
            <p className="muted">设置国内外篇数后点击「AI 检索论文」；检索数量与核验结论将显示在此框内。</p>
          )}
        </div>

        <p className="muted">根据「建立项目与要求」「前期检索与选题」「研究问题与设计」里已填的方向、变量与摘要自动推导检索式，直接检索真实论文数据库数据源（着重中国知网数据，汉斯出版社，Google scholar，base）；每条文献的地址直接给出，可一键保存入库。再次检索会自动排除已保存与历史推荐的文献，得到不同的结果。语言只标记「中文/外文」，国内外归属需人工确认作者单位与出版地。</p>

        <div className="md-export-box">
          <div className="md-export-head">
            <strong>导出第 0/1/2 阶段内容（MD）</strong>
            <button className="btn btn-sm btn-primary" onClick={() => void exportMd()}>导出 MD（发给 AI 找文献）</button>
          </div>
          <p className="muted">建议：把导出的 MD 直接发送给 AI 平台（DeepSeek/ChatGPT 等），让 AI 按你的偏好查找适配文献；拿到标题或完整参考文献后，粘贴到下方「AI 结果回填」即可批量导入——链接或参考文献给得准，查找就准。导出内容始终是第 0/1/2 阶段的最新内容，改完再导即可。</p>
          <div className="md-prompt-hint">
            <p className="md-prompt-line">💡 可以直接将 MD 文件和下面这句话一起发给 AI 查询，效果最优！！！o(*￣▽￣*)ブ</p>
            <p className="md-prompt-quote">"根据md文件内容寻找相匹配的文献，输出形式只要：[序号/排序]＋文献引用格式＋论文摘要（没有或者无法直接获取摘要就提炼论文信息，或者外部介绍），注意不要加入其他内容和标注，文献之间要分开。"</p>
            <p className="md-prompt-en">💡 Tip: send the MD file together with the quote above to the AI for the best results. "Find matching literature based on the MD content. Output ONLY: [number/rank] + citation format + abstract (or a distilled summary/external description if the abstract is unavailable). No extra text or annotations; separate each reference."</p>
          </div>
          <div className="lit-search-row">
            <span className="muted">文献类型偏好：</span>
            {mdRefTypes.map((t) => (
              <button key={t.key} className={"chip " + (mdRefSel.includes(t.key) ? "chip-on" : "")} onClick={() => toggleMdRef(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="lit-search-row">
            <span className="muted">平台偏好：</span>
            {mdPlatforms.map((t) => (
              <button key={t.key} className={"chip " + (mdPlatSel.includes(t.key) ? "chip-on" : "")} onClick={() => toggleMdPlat(t.key)}>{t.label}</button>
            ))}
          </div>
        </div>

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
        {autoState?.foreignLinks && autoState.foreignLinks.length > 0 && (
          <div className="preferred-links cn-jump">
            <span className="muted">外文数据库主检索源（英文检索式，点击跳转官网检索；Google Scholar 与 BASE 需在官网完成人机验证）：</span>
            <div className="lit-suggest">
              {autoState.foreignLinks.map((l) => (
                <button key={l.key} className="chip" title={"英文检索式：" + l.query} onClick={() => openUrl(l.url)}>{l.name} · {l.query}</button>
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
        <p className="muted">内置 Crossref / arXiv / PubMed 直接返回结果；知网在校园网/VPN 环境可直抓题录，万方/维普为闭源订阅库（结果由页面脚本异步加载/有反爬验证），提供官网跳转检索后手动导入。其余主要平台点击「去检索」用当前检索式跳转官网检索（检索式为空时打开平台首页）。平台知名度不等于论文质量，引用前请核对期刊、作者、年份、DOI 与同行评审状态；预印本仅作补充。</p>
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
                    {(c as Candidate & { journalRank?: string }).journalRank && (c as Candidate & { journalRank?: string }).journalRank !== "未标定" && <span className="badge badge-done">{(c as Candidate & { journalRank?: string }).journalRank}</span>}
                    {(c as Candidate & { aiScore?: number }).aiScore !== undefined && <span className="badge badge-done">AI 相关 {(c as Candidate & { aiScore?: number }).aiScore}/10</span>}
                  </div>
                  <div className="muted">{c.authors}{c.year ? "（" + c.year + "）" : ""}{c.venue ? " · " + c.venue : ""}</div>
                  {(c as Candidate & { relevanceReason?: string }).relevanceReason && <div className="muted">AI 相关理由：{(c as Candidate & { relevanceReason?: string }).relevanceReason}</div>}
                  {(c as Candidate & { keywords?: string }).keywords && <div className="muted">关键词：{(c as Candidate & { keywords?: string }).keywords}</div>}
                  <div className="muted">DOI: {c.doi || "无"}</div>
                  {c.url && <div className="muted lit-url">来源地址：<a href={c.url} onClick={(e) => { e.preventDefault(); openUrl(c.url); }}>{c.url}</a></div>}
                </div>
                <div className="lit-candidate-actions">
                  {c.url && <button className="btn btn-sm" onClick={() => openUrl(c.url)}>打开来源</button>}
                  <button className="btn btn-sm" onClick={() => void copyCitation(c)}>复制引用</button>
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
        <div className="field">
          <label>参考文献引用</label>
          <div className="lit-actions" style={{ marginBottom: 6 }}>
            <button className="btn btn-primary" disabled={busy} onClick={() => void saveManual()}>保存记录</button>
          </div>
          <textarea className="textarea" aria-label="参考文献引用" placeholder="如：王翠翠, 徐静, 尚倩. 电商直播中虚拟主播互动性对消费者购买行为的影响[J]. 经济与管理, 2023, 37(2): 84-92." value={manual.citation} onChange={(e) => setManual((m) => ({ ...m, citation: e.target.value }))} /></div>
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
      </section>

      <section className="card">
        <h2 className="card-title">AI 结果回填（直聊 AI 文献批量导入）</h2>
        <p className="muted">在豆包 / DeepSeek / Kimi 等直聊 AI 里拿到文献回复后，全选复制粘贴到这里：程序自动解析文献条目，并逐条在真实数据源核验后入库——真实源命中的标「已核验」，未命中或核验请求失败（如 Crossref 限流 429）的保留你提供的题录标「待核验」（零丢失、绝不编造）。实测：15 条混合文献约 30–90 秒（每条 250ms 礼貌间隔 + 核验请求时间；解析 15/15 全部识别）。浏览器扩展导入与这里共用同一条核验通道。</p>
        <div className="field">
          <label>粘贴 AI 回复文本</label>
          <textarea className="textarea" rows={7} aria-label="AI 回复文本" placeholder="把 AI 回复的文献列表整体粘贴到这里（支持 GB/T 7714、编号列表、DOI 行、「标题 | 作者 | 年份 | 期刊」等格式）" value={aiImportText} onChange={(e) => setAiImportText(e.target.value)} />
        </div>
        <div className="lit-actions">
          <button className="btn btn-primary" disabled={aiImportBusy || !aiImportText.trim()} onClick={() => void runAiImport()}>{aiImportBusy ? "解析核验中…" : "解析并核验入库"}</button>
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
              <div key={lit.id} className={"lit-item" + (lit.id === justSavedId ? " lit-item-new" : "")}>
                <div className="lit-item-main">
                  <div className="lit-title">
                    {lit.title}
                    <span className="badge badge-done">{REF_TYPE_LABEL[lit.refType] ?? "其他"}·{REF_TYPE_PRIORITY[lit.refType] ?? "—"}</span>
                    <span className="badge">{REGION_LABEL[lit.region] ?? "待区分"}</span>
                    {lit.language && <span className="badge badge-muted">{LANG_LABEL[lit.language] ?? lit.language}</span>}
                    {lit.preprint && <span className="badge badge-warn">预印本</span>}
                    {lit.citedBy !== undefined && lit.citedBy > 0 && <span className="badge">被引 {lit.citedBy}</span>}
                    {lit.journalRank && lit.journalRank !== "未标定" && <span className="badge badge-done">{lit.journalRank}</span>}
                    <span className={"badge badge-" + (lit.verifiedStatus === "verified" ? "done" : lit.verifiedStatus === "conflict" ? "warn" : "muted")}>{VERIFIED_STATUS_LABEL[lit.verifiedStatus]}</span>
                    <span className="badge">{LITERATURE_SOURCE_LABEL[lit.source]}</span>
                    {lit.pdfName && <span className="badge badge-done">已关联 PDF</span>}
                  </div>
                  <div className="muted">{lit.authors}{lit.year ? "（" + lit.year + "）" : ""}{lit.venue ? " · " + lit.venue : ""}{lit.doi ? " · DOI: " + lit.doi : ""}</div>
                  {lit.keywords && <div className="muted">关键词：{lit.keywords}</div>}
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
                  <button className="btn btn-sm" onClick={() => void copyCitation(lit)}>复制引用</button>
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
