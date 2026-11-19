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
