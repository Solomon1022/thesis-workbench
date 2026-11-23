import { fetch } from "undici";
import { guessRegion, refTypeFromCrossrefType } from "../../shared/literature";
import type { SearchOutcome } from "../../shared/literature";
import { rankJournal } from "../../shared/journal-rank";
import { crossrefBase } from "./crossref";

/**
 * 汉斯出版社（Hans Publishers，OA，DOI 前缀 10.12677）真实取回。
 * 汉斯为境外注册出版商、以中文刊为主：官网检索页有 WAF 反爬，但其论文 DOI 均注册在 Crossref，
 * 因此经 Crossref 前缀过滤真实取回其题录（标题/作者/年份/刊名/摘要/语言），地址为 doi.org 真实链接。
 * 中文检索式与英文检索式均支持（境外源按需求优先英文检索式，中文作为补充）。
 */
export async function hanspubSearch(query: string, signal?: AbortSignal, rows = 20): Promise<SearchOutcome> {
  const cleaned = query.replace(/\s+(AND|OR|NOT)\s+/gi, " ").replace(/\s+/g, " ").trim();
  const url = crossrefBase() + "/works?query.bibliographic=" + encodeURIComponent(cleaned) + "&filter=prefix:10.12677&rows=" + rows + "&select=DOI,title,author,issued,URL,container-title,abstract,type,language";
  const response = await fetch(url, { headers: { "User-Agent": "thesis-workbench/0.1 (local desktop app; mailto:research@example.com)" }, signal });
  if (!response.ok) throw new Error("汉斯出版社（10.12677/Crossref）返回错误（HTTP " + response.status + "）");
  const data = (await response.json()) as { message?: { items?: Record<string, unknown>[] } };
  const items = (data.message?.items ?? []).map((w) => {
    const title = Array.isArray(w.title) ? String(w.title[0] ?? "") : String(w.title ?? "");
    const authors = Array.isArray(w.author)
      ? (w.author as Array<{ given?: string; family?: string }>).map((a) => (a.given ? a.given + " " : "") + (a.family ?? "")).filter((s) => s.trim()).join("; ")
      : "";
    const issued = w.issued as { "date-parts"?: number[][] } | undefined;
    const year = issued?.["date-parts"]?.[0]?.[0] ? String(issued["date-parts"][0][0]) : "";
    const container = w["container-title"];
    const venue = Array.isArray(container) ? String(container[0] ?? "") : "";
    const doi = String(w.DOI ?? "");
    const url = typeof w.URL === "string" && w.URL ? w.URL : (doi ? "https://doi.org/" + doi : "");
    const abstract = typeof w.abstract === "string" ? w.abstract.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "";
    const type = String(w.type ?? "");
    const language = /[\u4e00-\u9fa5]/.test(title.trim()) ? "中文" : (/[a-z]/i.test(title.trim()) ? "外文" : String(w.language ?? ""));
    return {
      title: title.trim(),
      authors,
      year,
      venue,
      doi,
      url,
      abstract,
      source: "hanspub" as const,
      preprint: type === "posted-content",
      refType: refTypeFromCrossrefType(type),
      region: guessRegion(title.trim(), venue),
      language,
      journalRank: rankJournal(venue),
    };
  }).filter((i) => i.title);
  return {
    source: "hanspub",
    query,
    searchedAt: Date.now(),
    status: items.length > 0 ? "ok" : "no_results",
    message: items.length > 0 ? "" : "该检索式在汉斯出版社（Crossref 前缀 10.12677）未返回结果（真实返回 0 条）",
    items,
  };
}
