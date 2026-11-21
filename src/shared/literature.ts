export type LiteratureSource = "crossref" | "arxiv" | "pubmed" | "manual" | "ris-import" | "manual-platform" | "ai-suggested";

export type VerifiedStatus = "verified" | "unverified" | "conflict";

export type FulltextStatus = "none" | "abstract_only" | "pdf_linked";

export interface LiteratureItem {
  id: string;
  projectId: string;
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  url: string;
  abstract: string;
  source: LiteratureSource;
  verifiedStatus: VerifiedStatus;
  verifiedNote: string;
  fulltextStatus: FulltextStatus;
  pdfName: string;
  preprint: boolean;
  /** 参考文献形式（期刊论文/学位论文/会议论文/专著/预印本/工作论文/其他） */
  refType: RefTypeKey;
  /** 国内外区分（按作者单位与出版地判定；题名语言仅初判） */
  region: RegionKey;
  createdAt: number;
  updatedAt: number;
}

export interface EvidenceCard {
  id: string;
  literatureId: string;
  projectId: string;
  claim: string;
  location: string;
  createdAt: number;
}

export interface SearchLogEntry {
  id: number;
  projectId: string;
  source: string;
  query: string;
  resultCount: number;
  status: "ok" | "no_results" | "error";
  message: string;
  createdAt: number;
}

/** 候选来源的检索返回（真实调用记录原始检索式与时间） */
export interface SearchOutcome {
  source: LiteratureSource;
  query: string;
  searchedAt: number;
  status: "ok" | "no_results" | "error";
  message: string;
  items: Array<Omit<LiteratureItem, "id" | "projectId" | "verifiedStatus" | "verifiedNote" | "fulltextStatus" | "pdfName" | "createdAt" | "updatedAt">>;
}

/** 国内平台：只提供官方入口与可复制检索式，人工核验记录，不虚构 API */
export const CN_PLATFORMS = [
  { name: "中国知网 CNKI", url: "https://www.cnki.net", searchHint: "进入官网 → 高级检索 → 选择文献类型与字段" },
  { name: "万方数据", url: "https://www.wanfangdata.com.cn", searchHint: "进入官网 → 高级检索" },
  { name: "维普期刊", url: "https://www.cqvip.com", searchHint: "进入官网 → 高级检索" },
];

export const LITERATURE_SOURCE_LABEL: Record<LiteratureSource, string> = {
  crossref: "Crossref",
  arxiv: "arXiv",
  pubmed: "PubMed",
  manual: "手动录入",
  "ris-import": "RIS/BibTeX 导入",
  "manual-platform": "国内平台人工核验",
  "ai-suggested": "AI 建议（未核验）",
};

export const VERIFIED_STATUS_LABEL: Record<VerifiedStatus, string> = {
  verified: "已核验",
  unverified: "待核验",
  conflict: "来源冲突（保留）",
};

/** 参考文献形式与引用优先级（期刊最高，预印本/工作论文仅作补充） */
export type RefTypeKey = "journal" | "thesis" | "conference" | "book" | "preprint" | "working-paper" | "other";

export const REF_TYPES: Array<{ key: RefTypeKey; label: string; priority: string }> = [
  { key: "journal", label: "期刊论文", priority: "最高" },
  { key: "thesis", label: "学位论文", priority: "高" },
  { key: "conference", label: "会议论文", priority: "中等（顶会除外）" },
  { key: "book", label: "学术专著与图书章节", priority: "中等" },
  { key: "preprint", label: "预印本论文", priority: "低（仅作补充）" },
  { key: "working-paper", label: "工作论文 / 讨论稿", priority: "低" },
  { key: "other", label: "其他", priority: "—" },
];

export const REF_TYPE_LABEL: Record<string, string> = Object.fromEntries(REF_TYPES.map((t) => [t.key, t.label]));
export const REF_TYPE_PRIORITY: Record<string, string> = Object.fromEntries(REF_TYPES.map((t) => [t.key, t.priority]));

/** 国内外文献判定口径（用户提供）：按第一/通讯作者单位与出版地，题名语言仅作初判 */
export type RegionKey = "domestic" | "foreign" | "unknown";

export const REGION_RULES: Record<RegionKey, string> = {
  domestic: "国内文献：第一作者/通讯作者单位为中国境内高校或科研院所；成果发表于国内拥有 CN 刊号的正式期刊、国内学术会议或国内正规出版社专著",
  foreign: "国外文献：第一作者/通讯作者单位为境外科研机构；成果发表于境外正式出版的期刊、国际会议或境外出版社著作",
  unknown: "尚未区分（需人工确认作者单位与出版地）",
};

export const REGION_LABEL: Record<RegionKey, string> = { domestic: "国内", foreign: "国外", unknown: "待区分" };

/** 主要论文检索平台（抓主要平台，不追求穷尽；内置 API 直接检索，其余跳转官网检索） */
export interface PlatformEntry {
  key: string;
  name: string;
  tag: string;
  /** null = 没有稳定的检索地址，打开首页 */
  searchTemplate: string | null;
  note?: string;
}

export const BUILTIN_SEARCH_PLATFORMS: Array<PlatformEntry & { kind: "builtin" }> = [
  { kind: "builtin", key: "crossref", name: "Crossref（内置检索）", tag: "免费 API · 直接返回结果", searchTemplate: null, note: "国际期刊/会议题录与 DOI 核验" },
  { kind: "builtin", key: "arxiv", name: "arXiv（内置检索）", tag: "预印本 · 直接返回结果", searchTemplate: null },
  { kind: "builtin", key: "pubmed", name: "PubMed（内置检索）", tag: "医学生命科学 · 直接返回结果", searchTemplate: null },
];

export const MAJOR_PLATFORM_GROUPS: Array<{ title: string; items: PlatformEntry[] }> = [
  {
    title: "免费开放平台（免费优先，01–12）",
    items: [
      { key: "google-scholar", name: "Google Scholar 谷歌学术", tag: "免费 · 国外", searchTemplate: "https://scholar.google.com/scholar?q=%s" },
      { key: "semantic-scholar", name: "Semantic Scholar", tag: "免费 · AI 检索 · 国外", searchTemplate: "https://www.semanticscholar.org/search?q=%s" },
      { key: "openalex", name: "OpenAlex", tag: "免费 · 开放索引 · 国外", searchTemplate: "https://openalex.org/works?search=%s" },
      { key: "core", name: "CORE", tag: "免费全文 · 国外", searchTemplate: "https://core.ac.uk/search?q=%s" },
      { key: "doaj", name: "DOAJ", tag: "OA 期刊目录 · 国外", searchTemplate: "https://doaj.org/search/articles?source=%s" },
      { key: "base", name: "BASE", tag: "免费 · 机构库 · 国外", searchTemplate: "https://www.base-search.net/Search/Results?lookfor=%s" },
      { key: "unpaywall", name: "Unpaywall", tag: "工具 · 找合法开放版", searchTemplate: null, note: "浏览器扩展/API，用于回溯付费论文的合法开放版本" },
    ],
  },
  {
    title: "全球综合权威平台（正式发表版本，13–28，多为订阅）",
    items: [
      { key: "wos", name: "Web of Science 核心合集", tag: "订阅 · 引文索引", searchTemplate: "https://www.webofscience.com/wos/woscc/basic-search" },
      { key: "scopus", name: "Scopus", tag: "订阅 · 文摘引文", searchTemplate: "https://www.scopus.com/search/form.uri" },
      { key: "sciencedirect", name: "ScienceDirect", tag: "订阅/混合", searchTemplate: "https://www.sciencedirect.com/search?qs=%s" },
      { key: "springer", name: "SpringerLink", tag: "订阅/混合 · OA 较多", searchTemplate: "https://link.springer.com/search?query=%s" },
      { key: "wiley", name: "Wiley Online Library", tag: "订阅/混合", searchTemplate: "https://onlinelibrary.wiley.com/action/doSearch?AllField=%s" },
      { key: "tandf", name: "Taylor & Francis Online", tag: "订阅/混合", searchTemplate: "https://www.tandfonline.com/action/doSearch?AllField=%s" },
      { key: "sage", name: "SAGE Journals", tag: "订阅/混合 · 社科", searchTemplate: "https://journals.sagepub.com/action/doSearch?AllField=%s" },
      { key: "oxford", name: "Oxford Academic", tag: "订阅/混合", searchTemplate: "https://academic.oup.com/journals/search-results?q=%s" },
      { key: "jstor", name: "JSTOR", tag: "订阅/混合 · 人文社科", searchTemplate: "https://www.jstor.org/action/doBasicSearch?Query=%s" },
    ],
  },
  {
    title: "中文主要平台（中国大陆，68–78）",
    items: [
      { key: "cnki", name: "中国知网 CNKI", tag: "订阅/混合 · 中文首选", searchTemplate: "https://kns.cnki.net/kns8s/defaultresult/index?kw=%s" },
      { key: "wanfang", name: "万方数据", tag: "订阅/混合", searchTemplate: "https://s.wanfangdata.com.cn/paper?q=%s" },
      { key: "vip", name: "维普网", tag: "订阅/混合", searchTemplate: "http://qikan.cqvip.com/Qikan/Search/Index?key=%s" },
      { key: "nssd", name: "国家哲学社会科学文献中心 NSSD", tag: "免费", searchTemplate: null, note: "免费中文社科开放文献平台" },
      { key: "nstl", name: "国家科技图书文献中心 NSTL", tag: "免费/混合", searchTemplate: "https://www.nstl.gov.cn/search.html?word=%s" },
      { key: "chaoxing", name: "超星期刊", tag: "订阅", searchTemplate: "https://qikan.chaoxing.com/searchjour?sw=%s" },
      { key: "duxiu", name: "读秀学术搜索", tag: "订阅 · 图书发现", searchTemplate: "https://www.duxiu.com/search?channel=search&gt=&sw=%s" },
      { key: "hans", name: "汉斯出版社（OA）", tag: "免费全文 · 质量需逐刊核验", searchTemplate: "https://www.hanspub.org/journal/PaperInformation.aspx?searchType=1&searchWord=%s" },
    ],
  },
  {
    title: "预印本与工作论文（54–61，引用优先级低，仅作补充）",
    items: [
      { key: "arxiv-ext", name: "arXiv", tag: "免费全文 · 预印本", searchTemplate: "https://arxiv.org/search/?query=%s" },
      { key: "ssrn", name: "SSRN", tag: "免费 · 社科工作论文", searchTemplate: "https://papers.ssrn.com/sol3/results.cfm?txtKey_Words=%s" },
      { key: "biorxiv", name: "bioRxiv", tag: "免费 · 生命科学预印本", searchTemplate: "https://www.biorxiv.org/search/%s" },
      { key: "medrxiv", name: "medRxiv", tag: "免费 · 医学预印本", searchTemplate: "https://www.medrxiv.org/search/%s" },
      { key: "chinaxiv", name: "ChinaXiv", tag: "免费 · 中文预印本", searchTemplate: "https://chinaxiv.org/abs/search?searchText=%s" },
    ],
  },
  {
    title: "学位论文（62–67）",
    items: [
      { key: "pqdt", name: "ProQuest 学位论文 PQDT", tag: "订阅/混合 · 权威", searchTemplate: "https://www.proquest.com/results/%s" },
      { key: "oatd", name: "OATD", tag: "免费 · 开放学位论文", searchTemplate: "https://oatd.org/oatd/search?q=%s" },
      { key: "nstl-thesis", name: "NSTL 学位论文", tag: "免费/混合 · 国内", searchTemplate: "https://www.nstl.gov.cn/search.html?word=%s" },
      { key: "cnki-thesis", name: "知网博硕士论文", tag: "订阅/混合 · 国内", searchTemplate: "https://kns.cnki.net/kns8s/defaultresult/index?kw=%s" },
    ],
  },
];

/** 按题名/出版地语言初判国内外（作者单位与出版地需人工复核，本判断只是初判） */
export function guessRegion(title: string, venue: string): RegionKey {
  const text = (title ?? "") + (venue ?? "");
  if (!text.trim()) return "unknown";
  return /[\u4e00-\u9fa5]/.test(text) ? "domestic" : "foreign";
}

/** Crossref 作品类型 → 参考文献形式 */
export function refTypeFromCrossrefType(type: string): RefTypeKey {
  const t = String(type ?? "").toLowerCase();
  if (t.includes("posted-content") || t.includes("preprint")) return "preprint";
  if (t.includes("proceedings")) return "conference";
  if (t.includes("dissertation")) return "thesis";
  if (t.includes("book") || t.includes("monograph") || t.includes("reference-entry")) return "book";
  if (t.includes("report") || t.includes("working-paper")) return "working-paper";
  if (t.includes("journal")) return "journal";
  return "other";
}
