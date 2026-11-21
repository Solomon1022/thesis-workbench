import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { crossrefByDoi, crossrefSearch } from "./adapters/crossref";
import { openalexSearch } from "./adapters/openalex";
import { arxivSearch } from "./adapters/arxiv";
import { pubmedSearch } from "./adapters/pubmed";
import { normalizeDoi, normalizeTitle } from "../shared/bibparse";
import { ACADEMIC_SYNONYMS, CN_EN_TERM_DICT, CN_SEARCH_PLATFORMS, CORE_CN_JOURNALS, MAJOR_PLATFORM_GROUPS, SEED_LIBRARY } from "../shared/literature";
import { buildForeignQuery, type ForeignQueryResolver } from "./query-builder";
import { classifyTerms, compositeScore, hardFilterPass, ngramSimilarity, planLevels, SIMILARITY_THRESHOLD_EN } from "./query-planner";
import type { EvidenceCard, LiteratureItem, LiteratureSource, SearchLogEntry, SearchOutcome } from "../shared/literature";

export type LiteratureInput = Omit<LiteratureItem, "id" | "projectId" | "verifiedStatus" | "verifiedNote" | "fulltextStatus" | "pdfName" | "createdAt" | "updatedAt" | "refType" | "region"> & Partial<Pick<LiteratureItem, "refType" | "region">>;

export interface SaveOutcome {
  saved: boolean;
  message: string;
  item?: LiteratureItem;
  existing?: LiteratureItem;
}

const REAL_SOURCES: LiteratureSource[] = ["crossref", "openalex", "arxiv", "pubmed"];

/** 词典词表（同义词键值 + 中英词典键 + 种子术语），按长度降序供最长匹配 */
const DICT_TERMS: string[] = (() => {
  const terms = new Set<string>();
  for (const k of Object.keys(ACADEMIC_SYNONYMS)) { terms.add(k); for (const s of ACADEMIC_SYNONYMS[k]) terms.add(s); }
  for (const k of Object.keys(CN_EN_TERM_DICT)) terms.add(k);
  for (const d of SEED_LIBRARY) for (const t of d.terms) if (/[\u4e00-\u9fa5]/.test(t)) terms.add(t);
  return [...terms].sort((a, b) => b.length - a.length);
})();

/** 中文文本 → 学术术语切词（词典最长匹配；整句不再被当成一个关键词，避免模糊检索跑偏） */
export function segmentKeywords(text: string, maxTerms = 6): string[] {
  let remaining = String(text ?? "");
  const out: string[] = [];
  while (remaining.length > 0 && out.length < maxTerms) {
    let matched = false;
    for (const t of DICT_TERMS) {
      if (remaining.startsWith(t)) {
        out.push(t);
        remaining = remaining.slice(t.length);
        matched = true;
        break;
      }
    }
    if (!matched) remaining = remaining.slice(1);
  }
  return [...new Set(out)];
}

/** 中文关键词多层扩词映射：用户输入 → 学术同义词组合（人工维护词库；不编造文献） */
export function expandQueries(rawKeywords: string[]): Array<{ query: string; level: "core" | "l1" | "l2" }> {
  const base = rawKeywords.map((k) => k.trim()).filter((k) => k.length >= 2);
  if (base.length === 0) return [];
  const core = base.join(" ");
  const out: Array<{ query: string; level: "core" | "l1" | "l2" }> = [{ query: core, level: "core" }];
  const seen = new Set([core]);
  // 1级：同核心概念不同表述（同义词替换关键概念）
  for (const kw of base) {
    const synonyms = ACADEMIC_SYNONYMS[kw] ?? [];
    for (const syn of synonyms.slice(0, 2)) {
      const q = base.map((k) => (k === kw ? syn : k)).join(" ");
      if (!seen.has(q)) { seen.add(q); out.push({ query: q, level: "l1" }); }
    }
  }
  // 2级：同理论框架组合（换研究对象表述：加理论/机制词）
  const theoryTerms = ["社会临场感", "S-O-R", "中介效应", "消费者行为"];
  for (const t of theoryTerms.slice(0, 2)) {
    const q = core + " " + t;
    if (!seen.has(q)) { seen.add(q); out.push({ query: q, level: "l2" }); }
  }
  return out;
}



/** 文献库服务：检索走真实学术数据源；AI 只生成检索式，不产出文献记录。 */
export class LiteratureService {
  constructor(
    private db: ThesisDB,
    private settings: SettingsService,
    private userDataDir: string,
  ) {}

  private signalWithTimeout(): AbortSignal {
    return AbortSignal.timeout(30_000);
  }

  async search(projectId: string, source: string, query: string): Promise<{ outcome: SearchOutcome; log: SearchLogEntry }> {
    const q = query.trim();
    let outcome: SearchOutcome;
    try {
      if (source === "crossref") outcome = await crossrefSearch(q, this.settings.getContactEmail(), this.signalWithTimeout());
      else if (source === "arxiv") outcome = await arxivSearch(q, this.signalWithTimeout());
      else if (source === "pubmed") outcome = await pubmedSearch(q, this.signalWithTimeout());
      else throw new Error("未知检索来源：" + source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.db.appendSearchLog(projectId, source, q, 0, "error", message);
      return { outcome: { source: source as LiteratureSource, query: q, searchedAt: Date.now(), status: "error", message: "检索失败：" + message, items: [] }, log: this.db.listSearchLog(projectId)[0] };
    }
    this.db.appendSearchLog(projectId, source, q, outcome.items.length, outcome.status, outcome.message);
    return { outcome, log: this.db.listSearchLog(projectId)[0] };
  }

  async lookupDoi(doi: string): Promise<{ found: boolean; message: string; item?: SearchOutcome["items"][number] }> {
    const d = normalizeDoi(doi);
    if (!d) return { found: false, message: "DOI 为空或格式无法识别" };
    try {
      const item = await crossrefByDoi(d, this.signalWithTimeout());
      if (!item) return { found: false, message: "Crossref 中未找到该 DOI（真实返回 404）" };
      return { found: true, item, message: "Crossref 已返回该 DOI 的题录信息" };
    } catch (error) {
      return { found: false, message: "核验失败：" + (error instanceof Error ? error.message : String(error)) };
    }
  }

  /** 一键自动找文献（双池彻底拆分 + 必选词约束 + 扩容熔断 + 两层过滤 + 多维评分）：
   *  中文池：不再用外文平台当主检索源；生成带必选词约束的检索式 → 中文平台（百度学术/知网/万方/维普/NSSD）跳转检索，
   *           中文文献由用户在中文平台检索后导入本库（合规：不爬取中文闭源平台）。
   *  外文池：OpenAlex + Crossref 真实检索，L0-L2 分级扩容、L3 理论补充（不计核心配额）；
   *           结果过两道过滤闸（规则硬过滤 + 本地轻量语义相似度），再按多维权重排序。
   *  真实不足如实报告缺口，绝不编造、绝不硬塞。 */
  async autoSearch(projectId: string, opts?: { total?: number; cn?: number; en?: number; excludeDois?: string[]; preferredPlatforms?: string[]; openAccessOnly?: boolean; globalLibraries?: boolean }): Promise<{
    ok: boolean;
    message: string;
    queryUsed: string[];
    results: SearchOutcome["items"];
    counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number };
    cnNote?: string;
    preferredLinks?: Array<{ key: string; name: string; url: string }>;
    backgroundLinks?: Array<{ name: string; url: string }>;
    cnJumpLinks?: Array<{ name: string; url: string; query: string }>;
  }> {
    const total = Math.min(30, Math.max(15, opts?.total ?? 15));
    const cnRequested = Math.min(total, Math.max(0, opts?.cn ?? 0));
    const enRequested = total - cnRequested;
    const exclude = new Set((opts?.excludeDois ?? []).map((d) => d.trim()).filter(Boolean));
    const detail = this.db.getProjectDetail(projectId);
    const topic = detail.content["topic"] ?? {};
    const design = detail.content["design"] ?? {};
    const direction = String(topic["direction"] ?? "").trim();
    const candidatesField = String(topic["candidates"] ?? "").trim();
    const abstract = String(design["abstract"] ?? "").trim();
    const variablesJson = String(topic["variables"] ?? "").trim();
    const topicText = [direction, candidatesField, abstract].filter(Boolean).join(" ");

    // 关键词切词 + 主体/结果词分类（变量优先，词典兜底）
    const cnKeywords: string[] = [];
    for (const text of [direction, candidatesField, abstract]) {
      for (const k of segmentKeywords(text)) if (!cnKeywords.includes(k)) cnKeywords.push(k);
    }
    const clsBase = classifyTerms(topicText, variablesJson, cnKeywords);
    // 兜底：词典分类为空（如纯英文短选题）时，用选题文本的前几个词作主体词
    const cls = clsBase.subject.length === 0 && clsBase.result.length === 0
      ? { ...clsBase, subject: topicText.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter((t) => t.length >= 3).slice(0, 4) }
      : clsBase;
    const plans = planLevels(cls);

    // 中文池：多组必选词检索式 → 中文平台跳转（不爬取，用户检索后导入）
    const cnJumpLinks: Array<{ name: string; url: string; query: string }> = [];
    if (cnRequested > 0) {
      const jumpQueries: string[] = [];
      const allQ = [...cls.subject, ...cls.result].join(" ");
      if (allQ) jumpQueries.push(allQ);
      for (const sub of [...cls.subjectExpansions].slice(0, 2)) {
        const q = [sub, ...cls.result].join(" ");
        if (q && !jumpQueries.includes(q)) jumpQueries.push(q);
      }
      for (const q of jumpQueries.slice(0, 2)) {
        for (const pf of CN_SEARCH_PLATFORMS) {
          const url = pf.searchTemplate ? pf.searchTemplate.replace("%s", encodeURIComponent(q)) : "https://www.nssd.cn";
          cnJumpLinks.push({ name: pf.name, url, query: q });
        }
      }
    }

    // 外文池：L0-L2 核心 + L3 理论补充（熔断，禁止继续放宽）
    const used: string[] = [];
    const seenKeys = new Set<string>();
    const seenTitles = new Set<string>();
    const rawPool: Array<SearchOutcome["items"][number] & { level: string; citedBy?: number; isOa?: boolean; queryText?: string }> = [];

    const pushUnique = (item: SearchOutcome["items"][number], level: string, citedBy: number, query: string) => {
      const key = item.doi || (item.title + "|" + item.authors);
      const normTitle = normalizeTitle(item.title);
      if (!key || seenKeys.has(key) || (normTitle && seenTitles.has(normTitle)) || exclude.has(item.doi)) return;
      seenKeys.add(key);
      if (normTitle) seenTitles.add(normTitle);
      rawPool.push({ ...item, level, citedBy, queryText: query });
    };

    const fetchEn = async (query: string, level: string) => {
      used.push(query);
      try {
        const [oa, cr] = await Promise.allSettled([
          openalexSearch(query.replace(/\s+AND\s+/gi, " "), { language: "en", rows: 20, signal: this.signalWithTimeout() }),
          crossrefSearch(query, this.settings.getContactEmail(), this.signalWithTimeout(), { rows: 20 }),
        ]);
        if (oa.status === "fulfilled" && oa.value.status !== "error") {
          for (const item of oa.value.items) {
            const typed = item as SearchOutcome["items"][number] & { citedBy: number; isOa?: boolean };
            pushUnique(item, level, Number(typed.citedBy ?? 0), query);
          }
        }
        if (cr.status === "fulfilled" && cr.value.status !== "error") {
          for (const item of cr.value.items) pushUnique(item, level, Number((item as { citedBy?: number }).citedBy ?? 0), query);
        }
        this.db.appendSearchLog(projectId, "crossref+openalex", query, rawPool.length, "ok", "双池自动检索（外文池）");
      } catch { /* 单源失败不阻塞 */ }
    };

    for (const p of plans) {
      if (rawPool.length >= enRequested + 8) break;
      let enQ = p.enQuery;
      if (!enQ) {
        // 词典缺英文对应词时：词典硬匹配 + 可插拔模型布尔检索式兜底
        const role = this.settings.resolveRole("search_assist");
        const resolver: ForeignQueryResolver | null = role
          ? {
              generate: async (kws: string[]) => {
                const raw = await chat({
                  channel: role.channel,
                  apiKey: role.apiKey,
                  messages: [
                    { role: "system", content: "你是学术检索助手。把中文研究关键词转换为学术数据库布尔检索式：用引号短语与 AND/OR 连接词；只输出检索式本身（不超过 100 字符），禁止输出句子、解释或翻译。" },
                    { role: "user", content: "中文关键词：" + kws.join("、") },
                  ],
                  maxTokens: 120,
                  temperature: 0.1,
                  signal: this.signalWithTimeout(),
                });
                return raw;
              },
            }
          : null;
        const built = await buildForeignQuery([...cls.subject, ...cls.result], resolver);
        if (built) enQ = built.query;
      }
      if (!enQ) continue;
      await fetchEn(enQ, p.level);
    }

    // 中文池自动检索（补充发现：OpenAlex 中文子集；权威中文库请用跳转检索后导入）
    // 检索式 = 主体词逐个 × 结果词（全文检索对单主体词+结果词的组合更精准）
    const cnQueryList: Array<{ q: string; level: string }> = [];
    const cnAll = [...cls.subject, ...cls.result].join(" ");
    cnQueryList.push({ q: cnAll, level: "L0" });
    for (const sub of [...cls.subject.slice(1), ...cls.subjectExpansions].slice(0, 5)) {
      const q = [sub, ...cls.result].join(" ");
      if (!cnQueryList.some((x) => x.q === q)) cnQueryList.push({ q, level: "L2" });
    }
    const cnRaw: Array<SearchOutcome["items"][number] & { level: string; citedBy?: number }> = [];
    if (cnRequested > 0) {
      for (const cq of cnQueryList) {
        if (cnRaw.length >= cnRequested + 8) break;
        used.push(cq.q);
        const oaQ = cq.q.replace(/\s*AND\s*/g, " ").replace(/\s*OR\s*/g, " ");
        try {
          const outcome = await openalexSearch(oaQ, { language: "zh", rows: 30, signal: this.signalWithTimeout() });
          for (const item of outcome.items) {
            const typed = item as SearchOutcome["items"][number] & { citedBy?: number };
            const key = item.doi || (item.title + "|" + item.authors);
            const normTitle = normalizeTitle(item.title);
            if (!key || seenKeys.has(key) || (normTitle && seenTitles.has(normTitle)) || exclude.has(item.doi)) continue;
            seenKeys.add(key);
            if (normTitle) seenTitles.add(normTitle);
            cnRaw.push({ ...item, level: cq.level, citedBy: Number(typed.citedBy ?? 0) });
          }
          this.db.appendSearchLog(projectId, "openalex-zh", cq.q, cnRaw.length, "ok", "中文池自动检索（补充发现）");
        } catch { /* 单源失败不阻塞 */ }
      }
    }

    // P1 两层过滤
    const filtered: typeof rawPool = [];
    let hardDropped = 0;
    let simDropped = 0;
    for (const item of rawPool) {
      if (!hardFilterPass(item.title, cls, "en", item.level)) { hardDropped++; continue; }
      const sim = ngramSimilarity(item.title + " " + item.abstract, (item as typeof item & { queryText?: string }).queryText ?? topicText);
      if (sim < SIMILARITY_THRESHOLD_EN) { simDropped++; continue; }
      (item as typeof item & { similarity: number }).similarity = sim;
      filtered.push(item);
    }

    // P2 多维评分排序（相关度 60% + 质量 30% + 引用 10%）
    const preferOpen = Boolean(opts?.openAccessOnly);
    filtered.sort((a, b) => {
      const scoreOf = (item: typeof rawPool[number]) => {
        const sim = (item as typeof item & { similarity: number }).similarity ?? 0;
        const isCore = CORE_CN_JOURNALS.some((j) => (item.venue ?? "").includes(j));
        let s = compositeScore({ similarity: sim, subjectHitInTitle: true, resultHitInTitle: true, isCoreJournal: isCore, citedBy: item.citedBy });
        if (preferOpen && item.isOa === true) s += 6;
        if (preferOpen && item.isOa === false) s -= 6;
        return s;
      };
      return scoreOf(b) - scoreOf(a);
    });

    // 中文池两道过滤（zh 硬过滤 + 相似度）
    const cnFiltered: typeof cnRaw = [];
    let cnHardDropped = 0;
    let cnSimDropped = 0;
    for (const item of cnRaw) {
      if (!hardFilterPass(item.title, cls, "zh", item.level)) { cnHardDropped++; continue; }
      const sim = ngramSimilarity(item.title + " " + item.abstract, topicText);
      if (sim < 0.25) { cnSimDropped++; continue; }
      (item as typeof item & { similarity: number }).similarity = sim;
      cnFiltered.push(item);
    }
    cnFiltered.sort((a, b) => {
      const scoreOf = (item: typeof cnRaw[number]) => {
        const sim = (item as typeof item & { similarity: number }).similarity ?? 0;
        const isCore = CORE_CN_JOURNALS.some((j) => (item.venue ?? "").includes(j));
        return compositeScore({ similarity: sim, subjectHitInTitle: true, resultHitInTitle: true, isCoreJournal: isCore, citedBy: item.citedBy });
      };
      return scoreOf(b) - scoreOf(a);
    });
    const cnFound = Math.min(cnRequested, cnFiltered.length);

    const corePool = filtered.filter((i) => i.level !== "L3");
    const theoryPool = filtered.filter((i) => i.level === "L3");
    const enFound = Math.min(enRequested, corePool.length);
    const enSelected = corePool.slice(0, enFound);
    const enTheory = theoryPool.slice(0, Math.min(4, Math.max(0, enRequested - enFound)));
    const results = [...cnFiltered.slice(0, cnFound), ...enSelected, ...enTheory].map((i) => {
      const r = { ...i } as SearchOutcome["items"][number] & { level?: string; citedBy?: number; similarity?: number };
      return r;
    });

    const counts = { cnRequested, enRequested, cnFound, enFound };
    const cnNote = "国内自动检索为 OpenAlex 中文子集「补充发现」（已过必选词硬过滤与相似度过滤，缺 " + Math.max(0, cnRequested - cnFound) + " 篇未硬凑）；权威中文库（知网/万方/维普/NSSD）请用下方跳转检索后导入本库，导入后计入国内配额";

    // 偏好平台跳转（偏向，非绝对）
    const preferredLinks: Array<{ key: string; name: string; url: string }> = [];
    const globalGroup = MAJOR_PLATFORM_GROUPS.find((g) => g.title.includes("全球综合权威平台"));
    for (const group of MAJOR_PLATFORM_GROUPS) {
      for (const p of group.items) {
        const inGlobal = Boolean(opts?.globalLibraries && globalGroup?.items.some((i) => i.key === p.key));
        const selected = (opts?.preferredPlatforms ?? []).includes(p.key);
        if (!selected && !inGlobal) continue;
        if (opts?.openAccessOnly && !inGlobal && !/免费|OA|开放/.test(p.tag)) continue;
        if (!p.searchTemplate) continue;
        preferredLinks.push({ key: p.key, name: p.name, url: p.searchTemplate.replace("%s", encodeURIComponent(used[0] ?? "")) });
      }
    }

    // 3/4 级背景引用跳转（不计入配额）
    const bgQ = encodeURIComponent(cnKeywords.slice(0, 2).join(" ") || direction.slice(0, 30));
    const backgroundLinks = [
      { name: "行业报告·艾瑞咨询", url: "https://www.iresearch.com.cn/search/?keyword=" + bgQ },
      { name: "行业报告·QuestMobile", url: "https://www.questmobile.com.cn/search?keyword=" + bgQ },
    ];

    const filterNote = hardDropped + simDropped + cnHardDropped + cnSimDropped > 0 ? "；已过两道过滤闸：规则剔除 " + (hardDropped + cnHardDropped) + " 篇、语义相似度剔除 " + (simDropped + cnSimDropped) + " 篇" : "";
    const levelNote = theoryPool.length > 0 ? "；L3 理论补充文献不计入核心配额（已标注）" : "";
    const parts: string[] = ["双池检索完成：国内 " + cnFound + "/" + cnRequested + "（OpenAlex 中文子集补充发现）、国外 " + enFound + "/" + enRequested + levelNote + filterNote];
    if (results.length === 0) {
      return { ok: false, message: parts.join("，") + "（真实检索 0 条）", queryUsed: used, results, counts, cnNote, preferredLinks, backgroundLinks, cnJumpLinks };
    }
    return { ok: true, message: parts.join("，"), queryUsed: used, results, counts, cnNote, preferredLinks, backgroundLinks, cnJumpLinks };
  }
  /** 更新文献形式与国内外区分（初判可被用户修正）。 */
  updateMeta(projectId: string, literatureId: string, patch: { refType?: string; region?: string }): void {
    const item = this.db.listLiterature(projectId).find((l) => l.id === literatureId);
    if (!item) return;
    this.db.updateLiterature(literatureId, {
      refType: (patch.refType ?? item.refType) as LiteratureItem["refType"],
      region: (patch.region ?? item.region) as LiteratureItem["region"],
    });
  }

  /** 手动录入辅助：AI 检索——从参考文献引用中提取检索式并跑真实 Crossref，返回可核验候选题录。 */
  async manualAiSearch(projectId: string, citation: string): Promise<{ ok: boolean; message: string; queryUsed: string; results: SearchOutcome["items"] }> {
    const text = citation.trim();
    if (!text) return { ok: false, message: "请先填写参考文献引用", queryUsed: "", results: [] };
    let query = "";
    const role = this.settings.resolveRole("search_assist");
    if (role) {
      try {
        const content = await chat({
          channel: role.channel,
          apiKey: role.apiKey,
          messages: [
            { role: "system", content: "你是学术检索助手。从给定的参考文献引用中提取最适合学术数据库检索的检索式（通常是论文标题，或标题+第一作者）。只输出检索式本身，不要解释、不要引号。" },
            { role: "user", content: "参考文献引用：" + text.slice(0, 600) },
          ],
          maxTokens: 200,
          temperature: 0.1,
          signal: this.signalWithTimeout(),
        });
        query = content.trim().slice(0, 200);
      } catch { /* 退化到直接检索 */ }
    }
    if (!query) {
      const m = text.match(/[。.]\s*([^\[\]；;]{6,200}?)\s*\[[JDCMR]/);
      query = (m?.[1] ?? text.slice(0, 200)).trim();
    }
    if (!query) return { ok: false, message: "无法从引用中提取检索式", queryUsed: "", results: [] };
    const outcome = await crossrefSearch(query, this.settings.getContactEmail(), this.signalWithTimeout(), { rows: 5 });
    this.db.appendSearchLog(projectId, "crossref", query, outcome.items.length, outcome.status, "手动录入 AI 检索");
    if (outcome.status === "error") return { ok: false, message: outcome.message, queryUsed: query, results: [] };
    if (outcome.items.length === 0) return { ok: false, message: "Crossref 未找到匹配题录（真实返回 0 条），请核对引文或改用其他平台", queryUsed: query, results: [] };
    return { ok: true, message: "AI 检索完成：找到 " + outcome.items.length + " 条候选题录（真实 Crossref，可核验）", queryUsed: query, results: outcome.items };
  }

  /** 保存文献：DOI 与归一化标题去重；真实来源自动标「已核验」，其余默认「待核验」。 */  /** 保存文献：DOI 与归一化标题去重；真实来源自动标「已核验」，其余默认「待核验」。 */  /** 保存文献：DOI 与归一化标题去重；真实来源自动标「已核验」，其余默认「待核验」。 */
  saveItem(projectId: string, input: LiteratureInput, opts: { note?: string; manuallyVerified?: boolean }): SaveOutcome {
    const doi = normalizeDoi(input.doi ?? "");
    if (doi) {
      const existing = this.db.findLiteratureByDoi(projectId, doi);
      if (existing) return { saved: false, existing, message: "已存在相同 DOI 的文献记录（保留原记录，未覆盖）" };
    }
    const titleNorm = normalizeTitle(input.title ?? "");
    if (titleNorm) {
      const existingTitle = this.db.listLiterature(projectId).find((l) => normalizeTitle(l.title) === titleNorm);
      if (existingTitle) return { saved: false, existing: existingTitle, message: "已存在同标题文献（保留原记录，未覆盖）" };
    }
    const fromRealSource = REAL_SOURCES.includes(input.source);
    const verifiedStatus = fromRealSource || opts.manuallyVerified ? "verified" : "unverified";
    const verifiedNote = fromRealSource
      ? ((opts.note ?? "") + (opts.note ? "；" : "") + "题录来自 " + input.source + " 真实数据源")
      : opts.manuallyVerified
        ? "人工核验" + (opts.note ? "：" + opts.note : "")
        : "";
    const saved = this.db.insertLiterature({
      projectId,
      title: (input.title ?? "").trim(),
      authors: input.authors ?? "",
      year: input.year ?? "",
      venue: input.venue ?? "",
      doi,
      url: input.url ?? "",
      abstract: input.abstract ?? "",
      source: input.source,
      verifiedStatus,
      verifiedNote,
      fulltextStatus: (input.abstract ?? "").trim() ? "abstract_only" : "none",
      pdfName: "",
      preprint: !!input.preprint,
      refType: input.refType ?? "other",
      region: input.region ?? "unknown",
    });
    return { saved: true, item: saved, message: "已保存" };
  }

  verifyManual(id: string, note: string): void {
    this.db.updateLiterature(id, {
      verifiedStatus: "verified",
      verifiedNote: "人工核验" + (note.trim() ? "：" + note.trim() : "：用户确认题录信息与来源一致") + "（" + new Date().toLocaleString("zh-CN") + "）",
    });
  }

  /** 关联用户提供的 PDF：复制到应用数据目录的 attachments 下，仅记录文件名，不声称解析全文。 */
  async attachPdf(projectId: string, literatureId: string): Promise<{ pdfName?: string; canceled?: boolean }> {
    const result = await dialog.showOpenDialog({
      title: "选择文献 PDF（文件将复制到本应用数据目录）",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const src = result.filePaths[0];
    const dir = path.join(this.userDataDir, "attachments", projectId);
    mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, literatureId + ".pdf");
    copyFileSync(src, dest);
    const name = path.basename(src);
    this.db.setLiteraturePdf(literatureId, name);
    return { pdfName: name };
  }

  addEvidence(projectId: string, literatureId: string, claim: string, location: string): EvidenceCard {
    return this.db.insertEvidence(projectId, literatureId, claim.trim(), location.trim());
  }

  deleteEvidence(id: string): void {
    this.db.deleteEvidence(id);
  }

  /** AI 生成检索式（使用「检索辅助」角色模型）；只生成检索式，不产出文献记录。 */
  async genQueries(topic: string): Promise<{ ok: boolean; message: string; queries?: string[]; provider?: string; model?: string }> {
    const role = this.settings.resolveRole("search_assist");
    if (!role) return { ok: false, message: "未配置「检索辅助」角色模型：请先在「服务与模型设置 → 任务角色」中分配服务商与模型" };
    try {
      const content = await chat({
        channel: role.channel,
        apiKey: role.apiKey,

        messages: [
          { role: "system", content: "你是学术检索助手。根据研究主题生成 3-5 条适合学术数据库（如 Crossref、arXiv、PubMed）检索的检索式。只输出检索式，每条一行，不要编号，不要解释。" },
          { role: "user", content: "研究主题：" + topic.trim() },
        ],
        maxTokens: 300,
        signal: this.signalWithTimeout(),
      });
      const queries = content
        .split(/\r?\n/)
        .map((s) => s.replace(/^[\d.\-*•]+/, "").trim())
        .filter((s) => s.length > 1 && s.length < 200);
      if (queries.length === 0) return { ok: false, message: "模型未返回有效检索式（未保存任何内容）" };
      return { ok: true, message: "AI 生成的检索式（未经检索验证），请选择一条实际执行检索", queries: queries.slice(0, 5), provider: role.channel.name, model: role.channel.model };
    } catch (error) {
      return { ok: false, message: "检索式生成失败：" + (error instanceof Error ? error.message : String(error)) };
    }
  }
}
