import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { crossrefSearch } from "./adapters/crossref";
import { openalexSearch } from "./adapters/openalex";
import { normalizeTitle } from "../shared/bibparse";
import type { SearchOutcome } from "../shared/literature";
import {
  classifyTerms, englishTerm, expandSubject, hardFilterPass, isResultWord, ngramSimilarity, type TermClassification,
} from "./query-planner";
import { segmentKeywords } from "./literature-service";

type ModelResolver = { generate(system: string, user: string, maxTokens: number, temperature: number): Promise<string> } | null;

export interface KeywordPlan {
  subject: string[];
  result: string[];
  extra: string[];
  /** 逐个关键词的检索计划（每个计划一组关键词，不合并搜索框） */
  queries: Array<{ zh: string; en: string | null; label: string; level: string; pair: { sub: string; res: string } }>;
  note: string;
  aiGenerated: boolean;
}

export interface SearchOutcome2 {
  ok: boolean;
  message: string;
  queriesUsed: string[];
  results: SearchOutcome["items"];
  counts: { cnRequested: number; enRequested: number; cnFound: number; enFound: number };
  verifyNote: string;
  needMore: boolean;
  excludedCount: number;
}

/**
 * ReAct 检索框架：3 个高级 ReAct 功能
 *  ReAct-1 关键词规划器：读第 0/1/2 阶段内容 → 提取 → 延申同义 → 自检（多步推理）
 *  ReAct-2 检索执行器：按计划逐个关键词检索 → 每步核对数量与国内外 → 不足则换下一关键词
 *  ReAct-3 结果核验器：输出前核对数量与关键词踩点 → 不合格提示「AI 再次查询」
 */
export class ReactSearchService {
  constructor(private db: ThesisDB, private settings: SettingsService) {}

  private resolver(): ModelResolver {
    const role = this.settings.resolveRole("search_assist");
    if (!role) return null;
    return {
      generate: async (system, user, maxTokens, temperature) => {
        const raw = await chat({
          channel: role.channel,
          apiKey: role.apiKey,
          messages: [{ role: "system", content: system }, { role: "user", content: user }],
          maxTokens,
          temperature,
          signal: AbortSignal.timeout(240_000),
        });
        return raw;
      },
    };
  }

  /** 收集第 0/1/2 阶段内容（选题/摘要关键词为主，背景为辅） */
  private collectContext(projectId: string): string {
    const detail = this.db.getProjectDetail(projectId);
    const p0 = detail.project;
    const topic = detail.content["topic"] ?? {};
    const design = detail.content["design"] ?? {};
    const writing = detail.content["writing"] ?? {};
    const parts: string[] = [];
    parts.push("选题/项目名：" + p0.name);
    parts.push("学科：" + p0.disciplines.join("、") + "；学历：" + p0.educationLevel);
    const m = p0.materials as unknown as Record<string, string>;
    if (m && String(m.title ?? "").trim()) parts.push("已有题目：" + String(m.title));
    if (String(topic["direction"] ?? "").trim()) parts.push("研究方向：" + String(topic["direction"]));
    if (String(topic["candidates"] ?? "").trim()) parts.push("候选研究问题：" + String(topic["candidates"]));
    if (String(topic["variables"] ?? "").trim()) parts.push("变量：" + String(topic["variables"]));
    if (String(design["abstract"] ?? "").trim()) parts.push("摘要：" + String(design["abstract"]).slice(0, 400));
    if (String(writing["keywords"] ?? "").trim()) parts.push("论文关键词：" + String(writing["keywords"]));
    if (!String(writing["keywords"] ?? "").trim() && String(design["abstract_keywords"] ?? "").trim()) {
      parts.push("摘要与关键词：" + String(design["abstract_keywords"]));
    }
    if (String(design["research_question"] ?? "").trim()) parts.push("研究问题：" + String(design["research_question"]));
    for (const h of this.db.listHypotheses(projectId)) {
      parts.push("假设：" + h.number + " " + h.statement + "（IV:" + h.iv + " DV:" + h.dv + "）");
    }
    return parts.join("\n");
  }

  /** 关键词清洗：必须是「词」（2-10 字），句子式输出会被拆分或丢弃，杜绝把研究问题当关键词 */
  private sanitizeTerms(terms: string[]): string[] {
    const out: string[] = [];
    for (const raw of terms) {
      const t = String(raw ?? "").trim().replace(/[。.；;，,！!？?\s]+$/g, "");
      if (!t) continue;
      const sentenceLike = t.length > 10 || /是否|影响|研究|分析|作用|通过|显著|正向|负向|如何|提出|本文/.test(t);
      if (!sentenceLike) {
        if (!out.includes(t)) out.push(t);
        continue;
      }
      // 句子式输出：尝试词典切词提取其中的术语
      for (const piece of segmentKeywords(t)) {
        if (piece.length >= 2 && piece.length <= 10 && !out.includes(piece)) out.push(piece);
      }
    }
    return out.slice(0, 8);
  }

  private parseJsonSafe(text: string): unknown {
    const { extractJson } = require("./stage4-service") as { extractJson: (t: string) => unknown };
    return extractJson(text);
  }

  /** ReAct-1：关键词规划器（提取 → 延申 → 自检；无模型时走确定性规则） */
  async planKeywords(projectId: string): Promise<KeywordPlan> {
    const context = this.collectContext(projectId);
    const detail = this.db.getProjectDetail(projectId);
    const topicContent = detail.content["topic"] ?? {};
    const designContent = detail.content["design"] ?? {};
    const writingContent = detail.content["writing"] ?? {};
    const topicText = [String(topicContent["direction"] ?? ""), String(topicContent["candidates"] ?? ""), String(designContent["abstract"] ?? ""), String(writingContent["keywords"] ?? "")].filter((s) => s.trim()).join(" ");
    const variablesJson = String(topicContent["variables"] ?? "");
    const topicSeg = segmentKeywords(topicText);
    const segmented = topicSeg.length > 0 ? topicSeg : segmentKeywords(context);
    const clsBase = classifyTerms(context, variablesJson, segmented);
    const topicTokens = topicText.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter((t) => t.length >= 2).slice(0, 4);
    const hasTopicHit = topicTokens.some((t) => clsBase.subject.includes(t) || clsBase.result.includes(t));
    let cls = clsBase;
    if (topicTokens.length > 0 && ((clsBase.subject.length === 0 && clsBase.result.length === 0) || !hasTopicHit)) {
      cls = {
        ...clsBase,
        subject: topicTokens.filter((t) => !isResultWord(t)).slice(0, 3),
        result: topicTokens.filter((t) => isResultWord(t)).slice(0, 2),
      };
    }
    // 强制关键词返回：分类为空时兜底选题文本词 → 项目名；仍为空则明确提示
    if (cls.subject.length === 0 && cls.result.length === 0) {
      const fallbackTokens = topicText.split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter((t) => t.length >= 2).slice(0, 6);
      if (fallbackTokens.length > 0) {
        cls = { ...cls, subject: fallbackTokens.filter((t) => !isResultWord(t)).slice(0, 4), result: fallbackTokens.filter((t) => isResultWord(t)).slice(0, 2) };
      } else {
        const nameTokens = String(detail.project.name ?? "").split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter((t) => t.length >= 2).slice(0, 4);
        cls = { ...cls, subject: nameTokens };
      }
    }

    const model = this.resolver();

    /* AI 步骤返回的某类关键词为空时，回退到上一步/词典结果（推理模型常因思考耗 token 返回空数组） */
    const pickArr = (ai: string[] | undefined, prev: string[]): string[] => {
      const cleaned = (Array.isArray(ai) ? ai : []).filter((s) => String(s ?? "").trim().length > 0);
      return cleaned.length > 0 ? cleaned : prev;
    };

    let plan: KeywordPlan | null = null;
    if (model) {
      try {
        const extractSystem = [
          "你是学术检索关键词规划器（ReAct）。第 1 步：从给定论文信息中提取检索关键词。",
          "只输出 JSON：{\"subject\":[\"主体词（研究对象/自变量）\"],\"result\":[\"结果词（因变量/结局）\"],\"extra\":[\"背景补充词\"]}",
          "规则：以选题与摘要的关键词为主、背景为辅；每个词 2-8 字；禁止输出泛词（如「研究」「分析」「影响」）。",
        ].join("\n");
        const step1 = await model.generate(extractSystem, context, 4000, 0.3);
        const ex1 = this.parseJsonSafe(step1) as { subject?: string[]; result?: string[]; extra?: string[] } | null;
        const base = {
          subject: pickArr(ex1?.subject, cls.subject),
          result: pickArr(ex1?.result, cls.result),
          extra: pickArr(ex1?.extra, []),
        };
        const extendSystem = [
          "你是学术检索关键词规划器（ReAct）。第 2 步：为给定关键词延申同义词与相似相关关键词（保持同概念层级，禁止上义泛词）。",
          "只输出 JSON：{\"subject\":[\"原词\",\"同义1\",\"同义2\"],\"result\":[\"原词\",\"同义1\"],\"extra\":[\"补充词\"]}",
          "每个原词延申 2-3 个；每类总量不超过 6 个。",
        ].join("\n");
        const step2 = await model.generate(extendSystem, JSON.stringify(base), 4000, 0.4);
        const ex2 = this.parseJsonSafe(step2) as { subject?: string[]; result?: string[]; extra?: string[] } | null;
        const merged = {
          subject: [...new Set([...base.subject, ...pickArr(ex2?.subject, [])])].slice(0, 6),
          result: [...new Set([...base.result, ...pickArr(ex2?.result, [])])].slice(0, 4),
          extra: [...new Set([...base.extra, ...pickArr(ex2?.extra, [])])].slice(0, 6),
        };
        const checkSystem = [
          "你是学术检索关键词规划器（ReAct）。第 3 步自检：删除上义泛词（主播、直播、消费者、用户、网络这类过度宽泛词），保留与选题同概念层级的词。",
          "只输出 JSON：{\"subject\":[],\"result\":[],\"extra\":[]}（修正后的列表）",
        ].join("\n");
        const step3 = await model.generate(checkSystem, JSON.stringify(merged), 2000, 0.2);
        const ex3 = this.parseJsonSafe(step3) as { subject?: string[]; result?: string[]; extra?: string[] } | null;
        const final = {
          subject: pickArr(ex3?.subject, merged.subject),
          result: pickArr(ex3?.result, merged.result),
          extra: pickArr(ex3?.extra, merged.extra),
        };
        plan = this.buildPlan(this.sanitizeTerms(final.subject), this.sanitizeTerms(final.result), this.sanitizeTerms(final.extra), cls, true);
      } catch { plan = null; }
    }
    if (!plan) {
      plan = this.buildPlan(this.sanitizeTerms(cls.subject), this.sanitizeTerms(cls.result), [], cls, false);
    }
    return plan;
  }

  private buildPlan(subject: string[], result: string[], extra: string[], cls: TermClassification, aiGenerated: boolean): KeywordPlan {
    const queries: Array<KeywordPlan["queries"][number]> = [];
    const subs = subject.length > 0 ? subject : (cls.object?.length ? cls.object : cls.subject.length ? cls.subject : [""]);
    const ress = result.length > 0 ? result : (cls.result.length > 0 ? cls.result : [""]);
    for (const sub of subs) {
      for (const res of ress) {
        const zh = [sub, res].filter(Boolean).join(" ");
        const enSub = englishTerm(sub, cls);
        const enRes = englishTerm(res, cls);
        const en = [enSub, enRes].filter(Boolean).join(" ") || null;
        queries.push({ zh, en, label: "主体「" + sub + "」× 结果「" + res + "」", level: "L1", pair: { sub, res } });
      }
    }
    for (const ex of extra.slice(0, 4)) {
      queries.push({ zh: ex, en: null, label: "背景补充「" + ex + "」", level: "extra", pair: { sub: ex, res: "" } });
    }
    const note = aiGenerated
      ? "关键词由 AI 规划器三步生成（提取→延申→自检），检索前请确认"
      : "未配置检索辅助模型，关键词由内置术语词典确定性生成";
    return { subject, result, extra, queries, note, aiGenerated };
  }

  /** ReAct-2：检索执行器——按计划逐个关键词检索；每步核对数量与国内外；不足则继续下一关键词 */
  async executeSearch(projectId: string, plan: KeywordPlan, opts: { cn: number; en: number; excludeDois?: string[] }): Promise<SearchOutcome2> {
    const cnRequested = Math.max(0, opts.cn);
    const enRequested = Math.max(0, opts.en);
    const exclude = new Set((opts.excludeDois ?? []).map((d) => d.trim()).filter(Boolean));
    const excludedCount = exclude.size;
    const seenKeys = new Set<string>();
    const seenTitles = new Set<string>();
    const cnPool: Array<SearchOutcome["items"][number] & { level: string; citedBy?: number }> = [];
    const enPool: Array<SearchOutcome["items"][number] & { level: string; citedBy?: number }> = [];
    const queriesUsed: string[] = [];
    const topicText = this.collectContext(projectId);

    const pushUnique = (pool: typeof cnPool, item: SearchOutcome["items"][number], level: string, citedBy: number) => {
      const key = item.doi || (item.title + "|" + item.authors);
      const normTitle = normalizeTitle(item.title);
      if (!key || seenKeys.has(key) || (normTitle && seenTitles.has(normTitle)) || exclude.has(item.doi)) return;
      seenKeys.add(key);
      if (normTitle) seenTitles.add(normTitle);
      pool.push({ ...item, level, citedBy });
    };

    const clsPair = (q: KeywordPlan["queries"][number]): TermClassification => ({
      object: q.pair.sub ? [q.pair.sub] : undefined,
      subject: q.pair.sub ? [q.pair.sub] : [],
      result: q.pair.res ? [q.pair.res] : [],
      mediator: [],
      subjectExpansions: expandSubject(q.pair.sub),
      resultExpansions: [],
    });

    for (const q of plan.queries) {
      const cnNeed = cnRequested > 0 && cnPool.length < cnRequested;
      const enNeed = enRequested > 0 && enPool.length < enRequested;
      if (!cnNeed && !enNeed) break;
      queriesUsed.push(q.zh);
      const pairCls = clsPair(q);
      if (cnNeed && /[\u4e00-\u9fa5]/.test(q.zh)) {
        try {
          const outcome = await openalexSearch(q.zh, { language: "zh", rows: 25, signal: AbortSignal.timeout(30_000) });
          for (const item of outcome.items) {
            if (!hardFilterPass(item.title, pairCls, "zh", q.level)) continue;
            pushUnique(cnPool, { ...item, region: "domestic" as const }, q.level, Number((item as { citedBy?: number }).citedBy ?? 0));
          }
        } catch { /* 单源失败继续下一关键词 */ }
      }
      if (enNeed && q.en) {
        try {
          const [oa, cr] = await Promise.allSettled([
            openalexSearch(q.en, { language: "en", rows: 25, signal: AbortSignal.timeout(30_000) }),
            crossrefSearch(q.en, this.settings.getContactEmail(), AbortSignal.timeout(30_000), { rows: 25 }),
          ]);
          if (oa.status === "fulfilled" && oa.value.status !== "error") {
            for (const item of oa.value.items) {
              if (!hardFilterPass(item.title, pairCls, "en", q.level)) continue;
              pushUnique(enPool, { ...item, region: "foreign" as const }, q.level, Number((item as { citedBy?: number }).citedBy ?? 0));
            }
          }
          if (cr.status === "fulfilled" && cr.value.status !== "error") {
            for (const item of cr.value.items) {
              if (!hardFilterPass(item.title, pairCls, "en", q.level)) continue;
              pushUnique(enPool, { ...item, region: "foreign" as const }, q.level, Number((item as { citedBy?: number }).citedBy ?? 0));
            }
          }
        } catch { /* 继续下一关键词 */ }
      }
    }

    const cnFiltered = cnPool.filter((i) => ngramSimilarity(i.title + " " + i.abstract, topicText) >= 0.2);
    const enFiltered = enPool.filter((i) => ngramSimilarity(i.title + " " + i.abstract, topicText) >= 0.2);
    let cnFound = Math.min(cnRequested, cnFiltered.length);
    let enFound = Math.min(enRequested, enFiltered.length);

    // 放宽二次检索：严格命中不足时，放宽为「主体或结果至少命中其一」并标注需核验（不编造，只是降低门槛）
    const loosePool = (pool: typeof cnPool, seen: Set<string>) => {
      const loose: typeof cnPool = [];
      for (const item of pool) {
        const key = item.doi || (item.title + "|" + item.authors);
        if (seen.has(key)) continue;
        const anyHit = /[\u4e00-\u9fa5]/.test(item.title)
          ? plan.subject.some((s) => item.title.includes(s)) || plan.result.some((s) => item.title.includes(s))
          : plan.subject.some((s) => item.title.toLowerCase().includes(String(s).toLowerCase())) || plan.result.some((s) => item.title.toLowerCase().includes(String(s).toLowerCase()));
        if (!anyHit) continue;
        if (ngramSimilarity(item.title + " " + item.abstract, topicText) < 0.15) continue;
        seen.add(key);
        loose.push({ ...item, level: "loose" });
      }
      return loose;
    };
    const strictKeys = new Set([...cnFiltered, ...enFiltered].map((i) => i.doi || (i.title + "|" + i.authors)));
    if (cnFound < cnRequested) {
      const looseCn = loosePool(cnPool, strictKeys).slice(0, cnRequested - cnFound);
      cnFiltered.push(...looseCn);
      cnFound = Math.min(cnRequested, cnFiltered.length);
    }
    if (enFound < enRequested) {
      const looseEn = loosePool(enPool, strictKeys).slice(0, enRequested - enFound);
      enFiltered.push(...looseEn);
      enFound = Math.min(enRequested, enFiltered.length);
    }
    const results = [...cnFiltered.slice(0, cnFound), ...enFiltered.slice(0, enFound)];
    const needMore = cnFound < cnRequested || enFound < enRequested;
    const counts = { cnRequested, enRequested, cnFound, enFound };
    const parts = ["检索完成：国内 " + cnFound + "/" + cnRequested + "、国外 " + enFound + "/" + enRequested + "（已排除 " + excludedCount + " 篇已搜寻文献）"];
    if (needMore) parts.push("数量未达标（真实数据源尽力检索，未编造）；可点「AI 再次查询」补充");
    return {
      ok: results.length > 0 || !needMore,
      message: parts.join("；"),
      queriesUsed,
      results,
      counts,
      verifyNote: "",
      needMore,
      excludedCount,
    };
  }

  /** ReAct-3：结果核验器——输出前核对数量与关键词踩点；不达标给「再次查询」建议 */
  async verifyResults(projectId: string, outcome: SearchOutcome2): Promise<{ verifyNote: string; pass: boolean }> {
    const context = this.collectContext(projectId);
    const model = this.resolver();
    if (!model) {
      const pass = !outcome.needMore;
      if (outcome.results.length === 0) return { verifyNote: "未检索到任何文献（国内外均为 0）：请删除部分关键词标签后重新检索，或点「AI 再次查询」", pass: false };
      return { verifyNote: pass ? "规则核验：数量与关键词踩点符合设定" : "规则核验：数量未达标，建议「AI 再次查询」", pass };
    }
    try {
      const titles = outcome.results.map((r) => r.title).join("\n");
      const system = [
        "你是文献检索结果核验器（ReAct）。核对返回文献是否：1) 数量达到 n 国内/y 国外；2) 标题是否踩中选题核心关键词（主体词+结果词）；3) 主题是否与选题一致。",
        "只输出 JSON：{\"pass\":true,\"note\":\"一句话结论\"}（pass 为 true 或 false）",
        "禁止编造文献；只做核验判断。",
      ].join("\n");
      const user = "选题信息：\n" + context.slice(0, 800) + "\n\n数量要求：国内" + outcome.counts.cnRequested + "/国外" + outcome.counts.enRequested + "；实际：国内" + outcome.counts.cnFound + "/国外" + outcome.counts.enFound + "\n\n返回文献标题：\n" + titles.slice(0, 3000);
      const raw = await model.generate(system, user, 600, 0.1);
      const parsed = this.parseJsonSafe(raw) as { pass?: boolean; note?: string } | null;
      const pass = parsed?.pass ?? !outcome.needMore;
      return { verifyNote: parsed?.note ?? (pass ? "AI 核验通过" : "AI 核验未通过，建议「AI 再次查询」"), pass };
    } catch {
      return { verifyNote: "核验器暂不可用，按规则核验", pass: !outcome.needMore };
    }
  }
}
