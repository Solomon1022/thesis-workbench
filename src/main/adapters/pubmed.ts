import { fetch } from "undici";
import { guessRegion } from "../../shared/literature";
import type { SearchOutcome } from "../../shared/literature";

const REAL_BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";

export function pubmedBase(): string {
  if (process.env.NODE_ENV === "test" && process.env.TWB_PUBMED_BASE) return process.env.TWB_PUBMED_BASE;
  return REAL_BASE;
}

export async function pubmedSearch(query: string, signal?: AbortSignal): Promise<SearchOutcome> {
  const esearchUrl = pubmedBase() + "/esearch.fcgi?db=pubmed&term=" + encodeURIComponent(query) + "&retmax=10&retmode=json";
  const r1 = await fetch(esearchUrl, { signal });
  if (!r1.ok) throw new Error("PubMed 服务返回错误（HTTP " + r1.status + "）");
  const data1 = (await r1.json()) as { esearchresult?: { idlist?: string[] } };
  const ids = data1.esearchresult?.idlist ?? [];
  if (ids.length === 0) {
    return { source: "pubmed", query, searchedAt: Date.now(), status: "no_results", message: "该检索式在 PubMed 中未返回结果（真实返回 0 条）", items: [] };
  }
  const esummaryUrl = pubmedBase() + "/esummary.fcgi?db=pubmed&id=" + ids.join(",") + "&retmode=json";
  const r2 = await fetch(esummaryUrl, { signal });
  if (!r2.ok) throw new Error("PubMed 服务返回错误（HTTP " + r2.status + "）");
  const data2 = (await r2.json()) as { result?: Record<string, Record<string, unknown>> };
  const items = ids.map((uid) => {
    const row = data2.result?.[uid] ?? {};
    const authorsRaw = row.authors;
    const authorList = Array.isArray(authorsRaw) ? authorsRaw : authorsRaw ? [authorsRaw] : [];
    const authors = authorList.map((a) => String((a as Record<string, unknown>).name ?? "")).filter((s) => s.trim()).join("; ");
    const articleIds = Array.isArray(row.articleids) ? row.articleids : [];
    const doi = String((articleIds.find((a) => (a as Record<string, unknown>).idtype === "doi") as Record<string, unknown> | undefined)?.value ?? "");
    return {
      title: String(row.title ?? "").trim(),
      authors,
      year: String(row.pubdate ?? "").slice(0, 4),
      venue: String(row.fulljournalname ?? ""),
      doi,
      url: "https://pubmed.ncbi.nlm.nih.gov/" + uid + "/",
      abstract: "",
      source: "pubmed" as const,
      preprint: false,
      refType: "journal" as const,
      region: guessRegion(String(row.title ?? ""), String(row.fulljournalname ?? "")),
    };
  }).filter((i) => i.title);
  return {
    source: "pubmed",
    query,
    searchedAt: Date.now(),
    status: items.length > 0 ? "ok" : "no_results",
    message: items.length > 0 ? "" : "esummary 未返回题录（真实返回 0 条）",
    items,
  };
}
