export type LiteratureSource = "crossref" | "openalex" | "arxiv" | "pubmed" | "manual" | "ris-import" | "manual-platform" | "ai-suggested";

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
  openalex: "OpenAlex",
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

/** 学术术语词典（同义词扩词；人工维护，可按需扩展） */
export const ACADEMIC_SYNONYMS: Record<string, string[]> = {
  "虚拟主播": ["虚拟数字人", "数字人主播", "AI主播", "智能主播", "虚拟形象"],
  "AI虚拟主播": ["虚拟主播", "虚拟数字人", "数字人主播", "AI数字人"],
  "催化剂活性": ["催化活性", "催化剂性能"],
  "反应产率": ["产率", "合成产率", "收率"],
  "课程互动性": ["课堂互动", "师生互动", "生生互动", "在线互动"],
  "学习满意度": ["学习满意", "课程满意度", "学习体验"],
  "数字人": ["虚拟人", "虚拟数字人", "虚拟主播", "数智人"],
  "购买意愿": ["购买意向", "购买行为", "消费意愿", "购买决策", "消费行为"],
  "直播电商": ["电商直播", "直播带货", "网络直播", "直播商务"],
  "互动性": ["交互性", "互动行为", "双向互动", "人际互动"],
  "社会临场感": ["社会存在感", "临场感", "在场感"],
  "个性化推荐": ["个性化服务", "推荐系统", "智能推荐", "定制化推荐"],
  "消费者行为": ["消费者决策", "购买决策", "消费心理"],
  "感知信任": ["信任", "消费者信任", "信任机制"],
  "感知价值": ["感知收益", "价值感知", "消费者感知价值"],
  "冲动购买": ["冲动性购买", "冲动消费", "非计划购买"],
  "品牌忠诚": ["品牌忠诚度", "顾客忠诚", "重复购买意愿"],
  "用户生成内容": ["UGC", "用户原创内容", "消费者生成内容"],
  "短视频": ["短视频平台", "抖音", "短视频营销"],
  "满意度": ["顾客满意", "用户满意度", "满意程度"],
  "S-O-R": ["刺激机体反应", "刺激-有机体-反应", "SOR模型"],
  "计划行为理论": ["TPB", "计划行为模型"],
  "技术接受模型": ["TAM", "技术采纳模型"],
  "期望确认模型": ["ECM", "期望确认理论"],
  "中介效应": ["中介作用", "中介机制", "传导机制"],
  "调节效应": ["调节作用", "调节机制", "边界条件"],
  "结构方程": ["结构方程模型", "SEM", "路径分析"],
  "拟人化": ["类人化", "人格化", "拟人特征"],
  "在线购物": ["网络购物", "线上消费", "网购"],
  "社交媒体": ["社会化媒体", "社交平台", "新媒体"],
};

/** 结果词（因变量类概念）词典：用于「主体词/结果词」自动拆分；结果词为必选词，扩容永不触碰 */
export const RESULT_WORD_DICT: string[] = [
  "购买意愿", "购买意向", "购买行为", "消费意愿", "消费行为", "购买决策", "冲动购买",
  "使用意愿", "采纳意愿", "持续使用意愿", "付费意愿", "满意度", "忠诚度", "品牌忠诚",
  "信任", "绩效", "工作绩效", "学习效果", "使用行为", "参与意愿", "捐赠意愿",
  "幸福感", "主观幸福感", "生活质量", "依从行为", "采纳行为", "购买倾向",
];

/** 结果词后缀判定（词典未命中时的兜底启发式） */
export const RESULT_WORD_SUFFIX = ["意愿", "行为", "满意度", "忠诚", "绩效", "效果", "影响", "倾向", "采纳", "信任"];

/** 主体词禁止放宽边界：某些主体概念的上义泛词会导致主题跑偏，扩容时绝对禁止使用 */
export const FORBIDDEN_SUBJECT_EXPANSIONS: Record<string, string[]> = {
  "虚拟主播": ["主播", "直播", "网络主播", "网红"],
  "AI虚拟主播": ["主播", "直播", "AI", "人工智能"],
  "数字人": ["人", "数字", "虚拟"],
  "虚拟数字人": ["数字人", "虚拟"],
  "直播互动性": ["直播", "互动"],
  "个性化推荐": ["推荐", "个性化"],
  "社会临场感": ["临场感", "社会"],
};

/** 中文文献主检索源（跳转官网检索；合规：不爬取中文闭源平台，只提供元数据检索入口） */
export const CN_SEARCH_PLATFORMS: Array<{ key: string; name: string; searchTemplate: string | null; note: string }> = [
  { key: "baidu-xueshu", name: "百度学术", searchTemplate: "https://xueshu.baidu.com/s?wd=%s", note: "中文文献发现入口（官方检索，需在浏览器完成）" },
  { key: "cnki", name: "中国知网 CNKI", searchTemplate: "https://kns.cnki.net/kns8s/defaultresult/index?kw=%s", note: "中文期刊/硕博/会议最大库（订阅/混合）" },
  { key: "wanfang", name: "万方数据", searchTemplate: "https://s.wanfangdata.com.cn/paper?q=%s", note: "中文期刊/学位/会议" },
  { key: "vip", name: "维普网", searchTemplate: "http://qikan.cqvip.com/Qikan/Search/Index?key=%s", note: "中文科技期刊" },
  { key: "nssd", name: "国家哲学社会科学文献中心", searchTemplate: null, note: "免费中文社科开放文献（无稳定检索 URL，打开首页手动检索）" },
];

/** 中英学术术语硬词典（词典硬匹配 → 布尔检索式基底；模型只做补全与逻辑组合） */
export const CN_EN_TERM_DICT: Record<string, string> = {
  "购买意愿": "purchase intention",
  "购买意向": "purchase intention",
  "购买行为": "purchase behavior",
  "消费意愿": "consumption willingness",
  "消费者行为": "consumer behavior",
  "购买决策": "purchase decision",
  "冲动购买": "impulse buying",
  "冲动消费": "impulse buying",
  "直播电商": "live streaming e-commerce",
  "电商直播": "e-commerce live streaming",
  "直播带货": "livestream selling",
  "网络直播": "webcast",
  "互动性": "interactivity",
  "交互性": "interactivity",
  "社会临场感": "social presence",
  "临场感": "presence",
  "虚拟主播": "virtual streamer",
  "虚拟数字人": "virtual digital human",
  "数字人": "digital human",
  "AI主播": "AI anchor",
  "AI虚拟主播": "AI virtual streamer",
  "个性化推荐": "personalized recommendation",
  "推荐系统": "recommendation system",
  "智能推荐": "intelligent recommendation",
  "信任": "trust",
  "感知信任": "perceived trust",
  "感知价值": "perceived value",
  "消费者": "consumer",
  "电子商务": "e-commerce",
  "在线购物": "online shopping",
  "用户生成内容": "user-generated content",
  "短视频": "short video",
  "社交媒体": "social media",
  "满意度": "satisfaction",
  "品牌忠诚": "brand loyalty",
  "中介效应": "mediation effect",
  "调节效应": "moderation effect",
  "结构方程模型": "structural equation model",
  "影响因素": "influencing factors",
  "实证研究": "empirical study",
  "拟人化": "anthropomorphism",
  "大学生": "college students",
  "消费者信任": "consumer trust",
  "感知控制感": "perceived control",
  "感知质量": "perceived quality",
  "催化剂": "catalyst",
  "催化剂活性": "catalyst activity",
  "活性": "activity",
  "反应产率": "reaction yield",
  "产率": "yield",
  "合成": "synthesis",
  "材料": "material",
  "性能": "performance",
  "学习满意度": "learning satisfaction",
  "课程互动性": "course interactivity",
  "在线课程": "online course",
  "在线学习": "online learning",
  "学习投入": "learning engagement",
  "学业成绩": "academic performance",
  "教学效果": "teaching effectiveness",
  "学习效果": "learning outcomes",
  "工作满意度": "job satisfaction",
  "员工": "employee",
  "组织": "organization",
  "用户满意度": "user satisfaction",
  "服务质量": "service quality",
  "旅游意愿": "travel intention",
  "绿色消费": "green consumption",
  "环保行为": "pro-environmental behavior",
};

/** 第一层：中文核心期刊名录加权（按学科分组，人工维护的常见核心/权威期刊；用于排序权重，非官方接口） */
export const CORE_CN_JOURNALS: string[] = [
  // 经济管理 / 市场营销 / 电子商务
  "经济与管理", "商业经济研究", "企业经济", "管理评论", "管理世界", "南开管理评论",
  "北京理工大学学报", "东华理工大学学报", "时代经贸", "现代商业", "商业观察",
  "营销界", "电子商务评论", "运筹与模糊学", "管理科学学报", "中国管理科学",
  "外国经济与管理", "软科学", "经济管理", "当代财经", "财经理论与实践",
  "中国流通经济", "商业研究", "价格理论与实践", "宏观经济研究", "经济学家",
  // 新闻传播 / 新媒体
  "新闻与传播研究", "国际新闻界", "现代传播", "新闻大学", "新闻记者", "新闻界",
  "当代传播", "编辑之友", "出版发行研究", "中国出版", "新闻与写作",
  // 心理 / 教育
  "心理学报", "心理科学", "心理科学进展", "心理发展与教育", "应用心理学",
  "教育研究", "高等教育研究", "电化教育研究", "中国电化教育", "现代教育技术",
  "开放教育研究", "远程教育杂志",
  // 计算机 / 信息
  "计算机学报", "软件学报", "计算机研究与发展", "中文信息学报", "图书情报工作",
  "情报学报", "情报理论与实践", "数据分析与知识发现",
  // 社会科学综合
  "社会学研究", "社会", "中国工业经济", "数量经济技术经济研究", "统计研究",
  "调研世界", "消费经济", "市场研究",
  // 学报类（高校学报人文社科版常见核心）
  "中国人民大学学报", "北京大学学报", "清华大学学报", "武汉大学学报", "中山大学学报",
  "厦门大学学报", "山东大学学报", "四川大学学报", "华中师范大学学报", "陕西师范大学学报",
];

/** 第二层：领域标杆文献种子库（按领域组织；电子商务/消费者行为域以真实固定文献清单为种子锚点）
 *  用途：1) 抽取领域核心术语用于相关度加权；2) 种子文献本身作为该领域的标杆锚点（真实题录，不编造）。 */
export interface SeedRef { title: string; authors: string; year: string; venue: string; }
export interface SeedDomain {
  key: string;
  label: string;
  /** 从种子文献中提炼的领域核心术语（用于相关度加权与扩词） */
  terms: string[];
  /** 该领域的标杆文献锚点（真实题录） */
  refs: SeedRef[];
}
export const SEED_LIBRARY: SeedDomain[] = [
  {
    key: "ecommerce-virtual-streamer",
    label: "电子商务 · AI虚拟主播/直播互动性/消费者购买意愿",
    terms: ["虚拟主播", "数字人", "AI主播", "直播电商", "电商直播", "互动性", "购买意愿", "购买行为", "个性化推荐", "感知信任", "社会临场感", "感知价值", "拟人化", "消费者行为", "购买决策", "冲动购买", "virtual streamer", "AI virtual streamer", "social presence", "perceived value", "anthropomorphism", "interactivity", "presence", "purchase intention", "e-commerce live streaming", "live streaming commerce", "personalized recommendation", "AI anchor"],
    refs: [
      { title: "电商直播中虚拟主播互动性对消费者购买行为的影响", authors: "王翠翠, 徐静, 尚倩", year: "2023", venue: "经济与管理" },
      { title: "基于情景实验的数字人主播互动性对消费者购买意愿的影响研究", authors: "陈瑞华", year: "2024", venue: "商业经济研究" },
      { title: "电商AI主播特征影响消费者购买意愿的机制——基于技术感知与社会互动双重视角", authors: "李茸, 马宝龙, 张鹏, 等", year: "2025", venue: "北京理工大学学报(社会科学版)" },
      { title: "AI虚拟主播对消费者购买意愿的影响研究", authors: "秦芬, 郭海玲", year: "2025", venue: "企业经济" },
      { title: "电商直播中虚拟主播特征对消费者购买意愿的影响研究", authors: "侯萍, 林慧琳", year: "2025", venue: "电子商务评论" },
      { title: "数字消费视域下AI主播特征对直播观众购买意愿的影响", authors: "张启尧, 孔媛媛", year: "2026", venue: "东华理工大学学报(社会科学版)" },
      { title: "从\u201c被看见\u201d到\u201c被计算\u201d：AI数字人直播电商中的消费者感知控制感与购买意愿", authors: "张世超", year: "2026", venue: "商业观察" },
      { title: "智能驱动型虚拟数字人电商主播对消费者购买意愿的影响", authors: "秦雪冰, 魏羽笛", year: "2025", venue: "新媒体与社会" },
      { title: "直播商务中虚拟主播对消费者购买意愿的影响研究", authors: "乔飞燕", year: "2023", venue: "运筹与模糊学" },
      { title: "AI虚拟主播对消费者购买意愿的影响", authors: "原宇", year: "2026", venue: "哈尔滨学院学报" },
      { title: "虚拟主播特征对消费者购买意愿的影响——基于感知信任视角", authors: "钱晓傲, 刘家国", year: "2025", venue: "时代经贸" },
      { title: "虚拟主播类型对大学生服装消费购买意愿的影响机制", authors: "宋宜诺", year: "2026", venue: "纺织科技进展" },
      { title: "AI驱动下电商平台个性化推荐对消费者决策的影响机理及其优化策略", authors: "王诗淇", year: "2025", venue: "营销界" },
      { title: "电商平台个性化推荐服务对大学生购买意愿的影响因素研究", authors: "董金金, 齐歌祺", year: "2026", venue: "现代商业" },
      { title: "个性化推荐系统对消费者购买行为的影响机制研究", authors: "胡淑瑞", year: "2025", venue: "商业观察" },
      { title: "人工智能推荐对消费者在线购买意愿的影响——基于顾客感知质量的中介效应", authors: "陈土霞, 张帆", year: "2023", venue: "时代经贸" },
      { title: "直播电商平台个性化推荐对消费者决策行为的影响研究", authors: "邓琳佳", year: "2025", venue: "中小企业管理与科技" },
      { title: "个性化智能推荐对消费者在线冲动购买意愿的影响研究", authors: "范文芳, 王千", year: "2022", venue: "管理评论" },
      { title: "Impact of AI-generated virtual streamer interaction on consumer purchase intention: A focus on social presence and perceived value", authors: "Liu H, Zhang P, Cheng H, et al", year: "2025", venue: "Journal of Retailing and Consumer Services" },
      { title: "Virtual streamers, real purchases: the roles of anthropomorphism, interactivity, and presence in e-commerce live streaming", authors: "Yu T, Zeng Z, Liu T, et al", year: "2026", venue: "International Journal of Contemporary Hospitality Management" },
    ],
  },
];
/** 分级扩容标签（1/2 级可计入学术文献；3/4 级只是背景引用，不计入配额） */
export const EXPANSION_LEVELS = {
  core: { label: "核心主题", cite: "文献综述·核心变量研究，正常引用" },
  l1: { label: "1级扩容（同概念·不同场景，相关度≈90%）", cite: "文献综述·核心变量研究，可正常引用" },
  l2: { label: "2级扩容（同理论框架·不同研究对象，相关度≈70%）", cite: "文献综述·理论基础与模型应用，支撑模型合理性" },
  l3: { label: "3级：行业报告/白皮书（仅背景引用）", cite: "开题报告与引言背景，不算学术文献" },
  l4: { label: "4级：权威媒体/政策文件（仅背景引用）", cite: "只能作为背景引用，不计入学术文献配额" },
} as const;
