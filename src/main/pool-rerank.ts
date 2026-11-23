import type { SearchOutcome } from "../shared/literature";
import { extractJson } from "./stage4-service";
import { ALLOWED_PLAN_SOURCES, PER_SOURCE_CAP, RERANK_BATCH, RERANK_BATCH_MIN, RERANK_MAX_TOKENS, RERANK_SCORE_MAX, RERANK_SCORE_MIN } from "./search-guards";

export type ModelResolver = { generate(system: string, user: string, maxTokens: number, temperature: number): Promise<string> } | null;

/** 池内条目：pool_id 仅用于 LLM 定位，元数据一律取池内原值 */
export type PoolItem = SearchOutcome["items"][number] & { poolId: string; citedBy?: number };

export interface RerankOutcome {
  /** 重排后的池内条目（元数据为 API/浏览器返回的原值；附 aiScore/relevanceReason） */
  ranked: Array<SearchOutcome["items"][number] & { poolId: string; aiScore?: number; relevanceReason?: string }>;
  /** 池外 pool_id 被白名单丢弃的数量（已告警） */
  droppedForeignIds: number;
  /** LLM 备注（如「候选不足，建议改写查询」） */
  note: string;
  /** 是否真正走了 LLM 重排；false = 无模型或池为空，保持规则预排顺序 */
  usedAi: boolean;
  /** LLM 失败原因（回退时） */
  error?: string;
}

/** pool_id 规则：有 DOI 用 doi:xxx，否则 标题|作者（与去重键一致） */
export function makePoolId(item: SearchOutcome["items"][number]): string {
  return item.doi ? "doi:" + item.doi : "t:" + item.title + "|" + item.authors;
}

export interface PlanQuery {
  zh: string;
  en: string | null;
  label: string;
  level: string;
  pair: { sub: string; res: string };
  fields?: string[];
  sources?: string[];
  yearFrom?: number;
  yearTo?: number;
  capPerSource?: number;
}

/** 清洗 LLM 检索计划：只留白名单源/字段，年限与每源上限钳制，去重，丢弃句子式检索式 */
export function sanitizePlanQueries(raw: Array<Record<string, unknown>> | undefined): PlanQuery[] {
  if (!Array.isArray(raw)) return [];
  const currentYear = new Date().getFullYear();
  const seen = new Set<string>();
  const out: PlanQuery[] = [];
  for (const q of raw.slice(0, 16)) {
    const zh = String(q?.zh ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (!zh || zh.length > 60 || seen.has(zh)) continue;
    // 句子式检索式丢弃（标点或句子标志词或过长；词与词的拼接不误伤）
    if (/[。；;.!！？?]/.test(zh) || /这|那|该|的|了|是|本文|如何|是否|探讨|提出|影响|对策|一个|一种|研究现状/.test(zh) || zh.length > 30) continue;
    const enRaw = String(q?.en ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    const en = enRaw && !/[。；;！？?]/.test(enRaw) ? enRaw : null;
    const sources = (Array.isArray(q?.sources) ? q.sources : []).map(String).filter((s) => (ALLOWED_PLAN_SOURCES as readonly string[]).includes(s));
    const fields = (Array.isArray(q?.fields) ? q.fields : []).map(String).filter((s2) => ["title", "topic", "keyword"].includes(s2));
    const yearFrom = Number(q?.yearFrom);
    const yearTo = Number(q?.yearTo);
    const capPerSource = Number(q?.capPerSource);
    seen.add(zh);
    out.push({
      zh,
      en,
      label: String(q?.label ?? "").slice(0, 40) || zh,
      level: "L1",
      pair: { sub: "", res: "" },
      fields: fields.length > 0 ? fields : undefined,
      sources: sources.length > 0 ? sources : undefined,
      yearFrom: Number.isFinite(yearFrom) ? Math.max(1950, Math.min(currentYear, Math.round(yearFrom))) : undefined,
      yearTo: Number.isFinite(yearTo) ? Math.max(1950, Math.min(currentYear, Math.round(yearTo))) : undefined,
      capPerSource: Number.isFinite(capPerSource) ? Math.max(1, Math.min(PER_SOURCE_CAP, Math.round(capPerSource))) : undefined,
    });
  }
  return out.slice(0, 14);
}

const RERANK_SYSTEM = [
  "你是学术文献相关性裁判，只做「池内重排」，绝不生成文献。",
  "输入：论文原始信息（Markdown）与候选文献池（每条含 pool_id 与真实元数据）。",
  "要求：",
  "1. 只对池内 pool_id 排序，按与论文主题的相关性从高到低输出（尽量覆盖池内全部条目）。",
  "2. 每条输出 score（0-10 整数）与 reason（一句话，20 字以内，说明相关点）。",
  "3. 禁止输出池外 pool_id；禁止新增任何文献；禁止修改或编造任何元数据（标题/作者/年份/期刊/DOI）。",
  "4. 候选数量明显少于检索目标时，在 note 中写「候选不足，建议改写查询」；严禁虚构文献补数。",
  "5. 相关性相当时：当年文献（与当前年份相同）优先，其次近两年；期刊论文优先于学位/会议论文。",
  "5. 只输出 JSON：{\"ranked\":[{\"pool_id\":\"...\",\"score\":9,\"reason\":\"...\"}],\"note\":\"\"}",
].join("\n");

function poolLine(item: PoolItem): string {
  const parts = [
    "[" + item.poolId + "]",
    item.title,
    item.authors,
    item.year,
    item.venue,
    (item.abstract ?? "").slice(0, 120),
    (item as { keywords?: string }).keywords ?? "",
  ].map((s) => String(s ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join(" | ");
  return parts.slice(0, 260);
}

export function buildRerankMessages(md: string, pool: PoolItem[], targetNote: string): { system: string; user: string } {
  const lines = ["论文信息：", md, "", "检索目标：" + targetNote, "", "候选池："];
  for (const item of pool) lines.push(poolLine(item));
  return { system: RERANK_SYSTEM, user: lines.join("\n") };
}

export interface ParsedRerank {
  rankedIds: string[];
  scores: Map<string, number>;
  reasons: Map<string, string>;
  note: string;
  dropped: number;
}

/** 解析 LLM 输出并做 pool_id 白名单校验：池外 id 直接丢弃并计数（代码级护栏，不靠模型自觉） */
export function parseRerankOutput(raw: string, whitelist: Set<string>): ParsedRerank {
  const data = (extractJson(raw) ?? {}) as { ranked?: Array<{ pool_id?: unknown; score?: unknown; reason?: unknown }>; note?: unknown };
  const rankedIds: string[] = [];
  const scores = new Map<string, number>();
  const reasons = new Map<string, string>();
  let dropped = 0;
  for (const entry of Array.isArray(data.ranked) ? data.ranked : []) {
    const id = String(entry?.pool_id ?? "").trim();
    if (!id) continue;
    if (!whitelist.has(id)) { dropped++; continue; }
    if (scores.has(id)) continue; // 重复 id 只取第一次
    const n = Number(entry?.score);
    const score = Number.isFinite(n) ? Math.max(RERANK_SCORE_MIN, Math.min(RERANK_SCORE_MAX, Math.round(n))) : 0;
    scores.set(id, score);
    reasons.set(id, String(entry?.reason ?? "").trim().slice(0, 60));
    rankedIds.push(id);
  }
  // 兜底：JSON 不可解析/无 ranked 时，按输出原文中池内 id 的出现顺序恢复排序（id 必须仍在白名单内，不产生池外条目）
  if (rankedIds.length === 0) {
    for (const id of whitelist) {
      if (raw.includes(id) && !scores.has(id)) {
        scores.set(id, 0);
        reasons.set(id, "");
        rankedIds.push(id);
      }
    }
    rankedIds.sort((a, b) => raw.indexOf(a) - raw.indexOf(b));
  }
  return { rankedIds, scores, reasons, note: String(data?.note ?? "").trim().slice(0, 200), dropped };
}

/** 池内重排：LLM 只做排序；元数据一律取池内原值；模型不可用/池为空时保持规则预排顺序 */
export async function rerankPool(opts: {
  md: string;
  pool: PoolItem[];
  targetNote: string;
  resolver: ModelResolver;
  onWarn?: (msg: string) => void;
  onProgress?: (msg: string) => void;
}): Promise<RerankOutcome> {
  const { md, pool, targetNote, resolver, onWarn, onProgress } = opts;
  if (!resolver || pool.length === 0) {
    return { ranked: pool.map((i) => ({ ...i })), droppedForeignIds: 0, note: "", usedAi: false };
  }
  const poolIds = new Set(pool.map((i) => i.poolId));

  const attempt = async (batchSize: number): Promise<ParsedRerank[]> => {
    const out: ParsedRerank[] = [];
    for (let i = 0; i < pool.length; i += batchSize) {
      const chunk = pool.slice(i, i + batchSize);
      const chunkIds = new Set(chunk.map((c) => c.poolId));
      onProgress?.("池内重排 " + Math.min(i + batchSize, pool.length) + "/" + pool.length + " 条…");
      const t0 = Date.now();
      const { system, user } = buildRerankMessages(md, chunk, targetNote);
      const raw = await resolver.generate(system, user, RERANK_MAX_TOKENS, 0.1);
      onProgress?.("池内重排 " + Math.min(i + batchSize, pool.length) + "/" + pool.length + " 条完成（本批 " + Math.round((Date.now() - t0) / 1000) + "s）");
      const parsed = parseRerankOutput(raw, chunkIds);
      if (parsed.rankedIds.length === 0) throw new Error("重排输出为空或不可解析");
      if (parsed.dropped > 0) onWarn?.("重排输出含池外 pool_id，已丢弃 " + parsed.dropped + " 条（白名单护栏）");
      out.push(parsed);
    }
    return out;
  };

  let batchResults: ParsedRerank[] | null = null;
  let fallbackError = "";
  try {
    const firstSize = Math.min(RERANK_BATCH, pool.length);
    batchResults = await attempt(firstSize);
  } catch (e) {
    // 单批触发模型上下文/token 上限 → 自动降级为每批 25 条分批重排（不截断候选池）
    onWarn?.("池内重排单批失败（可能触发上下文/token 上限），已自动降级为每批 " + RERANK_BATCH_MIN + " 条：" + (e instanceof Error ? e.message.slice(0, 80) : String(e)));
    try {
      batchResults = await attempt(RERANK_BATCH_MIN);
    } catch (e2) {
      // 两次尝试都失败 → 回退规则预排顺序，绝不中断整次检索、绝不编造
      fallbackError = e2 instanceof Error ? e2.message.slice(0, 120) : String(e2);
      onWarn?.("池内重排失败，已回退规则排序（检索不中断）：" + fallbackError);
      return { ranked: pool.map((i) => ({ ...i })), droppedForeignIds: 0, note: "", usedAi: false, error: fallbackError };
    }
  }
  if (!batchResults) {
    return { ranked: pool.map((i) => ({ ...i })), droppedForeignIds: 0, note: "", usedAi: false, error: fallbackError };
  }

  const scores = new Map<string, number>();
  const reasons = new Map<string, string>();
  const orderIndex = new Map<string, number>();
  const notes: string[] = [];
  let dropped = 0;
  let counter = 0;
  for (const r of batchResults) {
    for (const id of r.rankedIds) {
      if (!poolIds.has(id)) { dropped++; onWarn?.("重排输出含池外 pool_id，已丢弃：" + id.slice(0, 80)); continue; }
      if (!scores.has(id)) { scores.set(id, r.scores.get(id) ?? 0); reasons.set(id, r.reasons.get(id) ?? ""); orderIndex.set(id, counter++); }
    }
    dropped += r.dropped;
    if (r.note) notes.push(r.note);
  }

  const ranked = pool
    .slice()
    .sort((a, b) => {
      const sa = scores.get(a.poolId) ?? 0;
      const sb = scores.get(b.poolId) ?? 0;
      if (sa !== sb) return sb - sa;
      // 同分时保持模型给出的列表顺序（兜底扫描恢复也依赖此顺序）
      return (orderIndex.get(a.poolId) ?? 1e9) - (orderIndex.get(b.poolId) ?? 1e9);
    })
    .map((item) => ({
      ...item,
      aiScore: scores.get(item.poolId),
      relevanceReason: reasons.get(item.poolId) ?? "",
    }));

  return { ranked, droppedForeignIds: dropped, note: notes.join("；"), usedAi: true };
}
