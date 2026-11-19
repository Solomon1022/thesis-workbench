import { XMLParser } from "fast-xml-parser";
import { fetch } from "undici";
import type { SearchOutcome } from "../../shared/literature";

const REAL_BASE = "https://export.arxiv.org";

export function arxivBase(): string {
  if (process.env.NODE_ENV === "test" && process.env.TWB_ARXIV_BASE) return process.env.TWB_ARXIV_BASE;
  return REAL_BASE;
}

export async function arxivSearch(query: string, signal?: AbortSignal): Promise<SearchOutcome> {
  const url = arxivBase() + "/api/query?search_query=all:" + encodeURIComponent(query) + "&start=0&max_results=10";
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("arXiv 服务返回错误（HTTP " + response.status + "）");
  const xml = await response.text();
  const doc = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: false }).parse(xml) as Record<string, unknown>;
  const feed = doc.feed as Record<string, unknown> | undefined;
  const rawEntries = feed?.entry;
  const entries = Array.isArray(rawEntries) ? rawEntries : rawEntries ? [rawEntries] : [];
  const items = entries.map((entryRaw) => {
    const entry = entryRaw as Record<string, unknown>;
    const authorsRaw = entry.author;
    const authorList = Array.isArray(authorsRaw) ? authorsRaw : authorsRaw ? [authorsRaw] : [];
    const authors = authorList.map((a) => String((a as Record<string, unknown>).name ?? "")).filter((s) => s.trim()).join("; ");
    const journalRef = entry["arxiv:journal_ref"] as { "#text"?: string } | undefined;
    const venue = journalRef?.["#text"] ? String(journalRef["#text"]) : "arXiv 预印本";
    const published = String(entry.published ?? "");
    const doiRef = entry["arxiv:doi"] as { "#text"?: string } | undefined;
    const doi = doiRef?.["#text"] ? String(doiRef["#text"]) : "";
    const id = String(entry.id ?? "");
    return {
      title: String(entry.title ?? "").replace(/\s+/g, " ").trim(),
      authors,
      year: published.slice(0, 4),
      venue,
      doi,
      url: id,
      abstract: String(entry.summary ?? "").replace(/\s+/g, " ").trim(),
      source: "arxiv" as const,
      preprint: true,
    };
  }).filter((i) => i.title);
  return {
    source: "arxiv",
    query,
    searchedAt: Date.now(),
    status: items.length > 0 ? "ok" : "no_results",
    message: items.length > 0 ? "" : "该检索式在 arXiv 中未返回结果（真实返回 0 条）",
    items,
  };
}
