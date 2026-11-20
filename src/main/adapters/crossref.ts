import { fetch } from "undici";
import type { SearchOutcome } from "../../shared/literature";

const REAL_BASE = "https://api.crossref.org";

/** 测试环境可用 TWB_CROSSREF_BASE 指向本地模拟服务；正常环境固定官方地址。 */
export function crossrefBase(): string {
  if (process.env.NODE_ENV === "test" && process.env.TWB_CROSSREF_BASE) return process.env.TWB_CROSSREF_BASE;
  return REAL_BASE;
}

const USER_AGENT = "thesis-workbench/0.1 (local desktop app; mailto:research@example.com)";

type CrossrefAuthor = { given?: string; family?: string };
type CrossrefWork = Record<string, unknown>;

function workToItem(work: CrossrefWork, source: "crossref") {
  const title = Array.isArray(work.title) ? String(work.title[0] ?? "") : String(work.title ?? "");
  const authors = Array.isArray(work.author)
    ? (work.author as CrossrefAuthor[]).map((a) => (a.given ? a.given + " " : "") + (a.family ?? "")).filter((s) => s.trim()).join("; ")
    : "";
  const issued = work.issued as { "date-parts"?: number[][] } | undefined;
  const year = issued?.["date-parts"]?.[0]?.[0] ? String(issued["date-parts"][0][0]) : "";
  const container = work["container-title"];
  const venue = Array.isArray(container) ? String(container[0] ?? "") : (typeof work.publisher === "string" ? work.publisher : "");
  const doi = String(work.DOI ?? "");
  const url = typeof work.URL === "string" && work.URL ? work.URL : (doi ? "https://doi.org/" + doi : "");
  const abstract = typeof work.abstract === "string" ? work.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
  const type = String(work.type ?? "");
  return {
    title: title.trim(),
    authors,
    year,
    venue,
    doi,
    url,
    abstract,
    source,
    preprint: type === "posted-content",
  };
}

export async function crossrefSearch(query: string, mailto: string, signal?: AbortSignal, opts?: { rows?: number; offset?: number }): Promise<SearchOutcome> {
  // Crossref 礼貌池：mailto 必须为真实邮箱，示例域名会被拒绝（HTTP 429）
  const contact = mailto && mailto.includes("@") && !/@example\.(com|org|net)$/i.test(mailto) ? mailto : "research@example.com";
  const rows = Math.min(50, Math.max(1, opts?.rows ?? 10));
  const offset = Math.max(0, opts?.offset ?? 0);
  const url = crossrefBase() + "/works?query.bibliographic=" + encodeURIComponent(query) + "&rows=" + rows + "&offset=" + offset + "&mailto=" + encodeURIComponent(contact);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
  if (!response.ok) throw new Error("Crossref 服务返回错误（HTTP " + response.status + "）");
  const data = (await response.json()) as { message?: { items?: CrossrefWork[] } };
  const items = (data.message?.items ?? []).map((w) => workToItem(w, "crossref")).filter((i) => i.title);
  return {
    source: "crossref",
    query,
    searchedAt: Date.now(),
    status: items.length > 0 ? "ok" : "no_results",
    message: items.length > 0 ? "" : "该检索式在 Crossref 中未返回结果（真实返回 0 条）",
    items,
  };
}

export async function crossrefByDoi(doi: string, signal?: AbortSignal): Promise<SearchOutcome["items"][number] | null> {
  const url = crossrefBase() + "/works/" + encodeURIComponent(doi);
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("Crossref 服务返回错误（HTTP " + response.status + "）");
  const data = (await response.json()) as { message?: CrossrefWork };
  if (!data.message) return null;
  const item = workToItem(data.message, "crossref");
  return item.title ? item : null;
}
