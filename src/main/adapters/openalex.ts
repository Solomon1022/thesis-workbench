import { fetch } from "undici";
import { guessRegion, refTypeFromCrossrefType, type RefTypeKey, type RegionKey } from "../../shared/literature";
import type { SearchOutcome } from "../../shared/literature";

const REAL_BASE = "https://api.openalex.org";

export function openalexBase(): string {
  if (process.env.NODE_ENV === "test" && process.env.TWB_OPENALEX_BASE) return process.env.TWB_OPENALEX_BASE;
  return REAL_BASE;
}

/** OpenAlex 的 abstract_inverted_index → 摘要文本（真实字段，不编造） */
export function reconstructAbstract(inverted: unknown): string {
  if (!inverted || typeof inverted !== "object") return "";
  const index = inverted as Record<string, number[]>;
  const positions: Array<[number, string]> = [];
  for (const [word, pos] of Object.entries(index)) {
    if (!Array.isArray(pos)) continue;
    for (const p of pos) positions.push([p, word]);
  }
  positions.sort((a, b) => a[0] - b[0]);
  return positions.map(([, w]) => w).join(" ").slice(0, 2000);
}

function workToItem(w: Record<string, unknown>) {
  const title = String(w.title ?? "").replace(/\s+/g, " ").trim();
  const authors = (Array.isArray(w.authorships) ? w.authorships : [])
    .map((a) => String((((a as Record<string, unknown>).author ?? {}) as Record<string, unknown>).display_name ?? "")).filter(Boolean).join("; ");
  const year = String(w.publication_year ?? "");
  const pl = (w.primary_location ?? {}) as Record<string, unknown>;
  const src = (pl.source ?? {}) as Record<string, unknown>;
  const venue = String(src.display_name ?? "").trim();
  const doi = String(w.doi ?? "").replace(/^https?:\/\/doi\.org\//, "");
  const url = typeof w.id === "string" && w.id.startsWith("https://openalex.org/") ? w.id : (doi ? "https://doi.org/" + doi : "");
  const abstract = reconstructAbstract(w.abstract_inverted_index);
  const type = String(w.type ?? "");
  const language = String(w.language ?? "");
  const citedBy = Number(w.cited_by_count ?? 0);
  return {
    title,
    authors,
    year,
    venue,
    doi,
    url,
    abstract,
    source: "openalex" as const,
    preprint: type === "preprint",
    refType: refTypeFromCrossrefType(type),
    region: (language === "zh" ? "domestic" : "foreign") as RegionKey,
    citedBy,
    isOa: Boolean((w.open_access as Record<string, unknown> | undefined)?.is_oa),
  };
}

/** OpenAlex 检索：真实公开索引（含中文子集 language=zh） */
export async function openalexSearch(query: string, opts?: { language?: "zh" | "en" | ""; rows?: number; offset?: number; mode?: "search" | "title"; signal?: AbortSignal }): Promise<SearchOutcome & { items: Array<SearchOutcome["items"][number] & { citedBy: number; isOa: boolean }> }> {
  const rows = Math.min(50, Math.max(1, opts?.rows ?? 10));
  const offset = Math.max(0, opts?.offset ?? 0);
  const params = new URLSearchParams();
  const filters: string[] = [];
  if (opts?.language) filters.push("language:" + opts.language);
  if ((opts?.mode ?? "search") === "title") {
    filters.push("title.search:" + query.trim());
  } else {
    params.set("search", query);
  }
  if (filters.length > 0) params.set("filter", filters.join(","));
  params.set("per_page", String(rows));
  params.set("page", String(Math.floor(offset / rows) + 1));
  const url = openalexBase() + "/works?" + params.toString();
  const response = await fetch(url, {
    headers: { "User-Agent": "thesis-workbench/0.1 (mailto:research@example.com)" },
    signal: opts?.signal,
  });
  if (!response.ok) throw new Error("OpenAlex 服务返回错误（HTTP " + response.status + "）");
  const data = (await response.json()) as { results?: Record<string, unknown>[] };
  const items = (data.results ?? []).map((w) => workToItem(w)).filter((i) => i.title);
  return {
    source: "openalex",
    query,
    searchedAt: Date.now(),
    status: items.length > 0 ? "ok" : "no_results",
    message: items.length > 0 ? "" : "该检索式在 OpenAlex 中未返回结果（真实返回 0 条）",
    items,
  };
}
