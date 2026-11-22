import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { crossrefSearch } from "./adapters/crossref";
import { openalexSearch } from "./adapters/openalex";
import { normalizeTitle } from "../shared/bibparse";
import type { SearchOutcome } from "../shared/literature";
import {
  classifyTerms, englishTerm, expandResult, expandSubject, hardFilterPass, isResultWord, ngramSimilarity, type TermClassification,
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
  /** 拆词：整串拆成词（词典切词；无词典命中时按虚词/连接词切） */
  /** 选题文本抽词：按标点与虚词切出 2-10 字词，保证任何主题都有词 */
  private tokensFromText(text: string): string[] {
    const stop = new Set(["方向", "选题", "题目", "项目", "研究", "分析", "问题", "论文", "摘要", "关键词", "正文", "本文", "学生", "基于", "关于", "以及", "如何", "是否", "现状"]);
    const raw = String(text ?? "");
    const parts = raw.split(/[^\u4e00-\u9fa5a-zA-Z0-9]+/).flatMap((t) => t.split(/的|与|及|和|对|在|中|下|影响|研究|分析|基于|关于|作用|是否|显著|正向|负向|通过|如何|提出|本文|以|其|等|为|了/)).map((x) => x.trim());
    return [...new Set(parts.filter((x) => x.length >= 2 && x.length <= 10 && !stop.has(x)))];
  }

  private splitWords(terms: string[]): string[] {
    const out: string[] = [];
    for (const raw of terms) {
      const t = String(raw ?? "").trim();
      if (!t) continue;
      const seg = segmentKeywords(t).filter((x) => x.length >= 2);
      if (seg.length > 0) {
        out.push(...seg);
        continue;
      }
      let parts = t.split(/的|与|及|和|对|在|中|下|影响|研究|分析|直播|互动|基于|关于|作用/).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 12);
      if (parts.length <= 1 && t.length > 4) {
        // 尾部剥壳：反复剥掉研究/策略/优化等尾缀，保留核心词
        let core = t;
        const stripRe = /(研究|分析|优化|策略|影响|问题|现状|对策|机制|模型|方法|实证|应用|设计|系统|平台|数据|因素|效应|路径|框架|方案|效果|提升|改进|构建|基于|视角|探析|研究)$/;
        let prev = "";
        while (core !== prev) { prev = core; core = core.replace(stripRe, ""); }
        if (core.length >= 2 && core.length <= 12) parts = [core];
        else parts = [t];
      }
      if (parts.length > 1) out.push(...parts);
      else if (t.length >= 2 && t.length <= 12) out.push(t);
    }
    const stop = new Set(["方向", "选题", "题目", "项目", "研究", "分析", "问题", "论文", "摘要", "关键词", "正文", "本文"]);
    return [...new Set(out)].filter((x) => x.length >= 2 && x.length <= 12 && !stop.has(x));
  }

  /** 拍平关键词：从主体∪结果∪中介∪对象全部取词，每个词同义延申，再按结果词分流。
   *  任何上游误分类都不会丢词——全部平铺输出（词，不是句子）。 */
  private flattenKeywords(cls: TermClassification): { subject: string[]; result: string[]; extra: string[] } {
    const all = [...cls.subject, ...cls.result, ...cls.mediator, ...(cls.object ?? [])];
    const words = [...new Set(this.splitWords(all).flatMap((t) => [t, ...expandSubject(t), ...expandResult(t)]))].filter((t) => t.length >= 2 && t.length <= 12);
    const subject = words.filter((t) => !isResultWord(t)).slice(0, 14);
    const result = words.filter((t) => isResultWord(t)).slice(0, 8);
    return { subject, result, extra: [] };
  }

  private sanitizeTerms(terms: string[]): string[] {
    const out: string[] = [];
    for (const raw of terms) {
      const t = String(raw ?? "").trim().replace(/[。.；;，,！!？?\s]+$/g, "");
      if (!t) continue;
      const sentenceLike = t.length > 8 || /是否|影响|研究|分析|作用|通过|显著|正向|负向|如何|提出|本文/.test(t);
      if (!sentenceLike) {
        if (!out.includes(t)) out.push(t);
        continue;
      }
      // 句子式输出：先词典切词；拆不出再按虚词/连接词切分，绝不整条丢弃
      let pieces = segmentKeywords(t).filter((x) => x.length >= 2 && x.length <= 12);
      if (pieces.length === 0) {
        pieces = t.split(/的|与|及|和|对|在|中|下|影响|研究|分析|基于|关于|作用|是否|显著|正向|负向|通过|如何|提出|本文|以及|其|等|[^a-zA-Z0-9\u4e00-\u9fa5]+/).map((x) => x.trim()).filter((x) => x.length >= 2 && x.length <= 12);
      }
      for (const piece of pieces) {
        if (piece.length >= 2 && piece.length <= 12 && !out.includes(piece)) out.push(piece);
      }
    }
    return out.slice(0, 8);
  }

  private parseJsonSafe(text: string): unknown {
    const { extractJson } = require("./stage4-service") as { extractJson: (t: string) => unknown };
    return extractJson(text);
  }

  /** 第 0/1/2 阶段全部内容 → Markdown 文档（一次性发给 AI） */
  private buildMd(projectId: string): string {
    const detail = this.db.getProjectDetail(projectId);
    const p0 = detail.project;
    const topic = detail.content["topic"] ?? {};
    const design = detail.content["design"] ?? {};
    const writing = detail.content["writing"] ?? {};
    const L: string[] = [];
    const field = (label: string, value: unknown) => {
      const v = String(value ?? "").trim();
      if (v) L.push("- " + label + "：" + v);
    };
    L.push("# 论文信息（第 0/1/2 阶段汇总）");
    L.push("## 第 0 阶段 · 建立项目");
    field("项目名称", p0.name);
    field("学科", p0.disciplines.join("、"));
    field("学历", p0.educationLevel);
    const m = p0.materials as unknown as Record<string, string>;
    if (m) {
      field("已有题目", m.title);
      field("已有文献", m.literature);
      field("已有数据", m.data);
      field("已有草稿", m.draft);
      field("备注", m.notes);
    }
    L.push("## 第 1 阶段 · 前期检索与选题");
    field("研究方向", topic["direction"]);
    field("候选研究问题", topic["candidates"]);
    field("变量（JSON）", topic["variables"]);
    field("样本可获得性", topic["sample_access"]);
    L.push("## 第 2 阶段 · 研究问题与设计");
    field("研究问题", design["research_question"]);
    field("理论构念", design["constructs"]);
    field("变量角色", design["variable_roles"]);
    field("测量方式", design["measures"]);
    field("样本与抽样设计", design["sampling"]);
    field("论文摘要", design["abstract"]);
    field("内容框架（章节提纲）", design["outline"]);
    field("摘要与关键词", design["abstract_keywords"]);
    field("写作关键词", writing["keywords"]);
    const hyps = this.db.listHypotheses(projectId);
    if (hyps.length > 0) {
      L.push("## 研究假设");
      for (const h of hyps) L.push("- " + h.number + "：" + h.statement + "（IV：" + h.iv + "；DV：" + h.dv + "；依据：" + h.basis + "）");
    }
    return L.join("\n");
  }

  /** ReAct-1：关键词规划器（提取 → 延申 → 自检；无模型时走确定性规则） */
  async planKeywords(projectId: string, counts?: { cn: number; en: number }): Promise<KeywordPlan> {
    try {
    const context = this.buildMd(projectId);
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
          "规则：以选题与摘要的关键词为主、背景为辅；subject 至少 3 个词、result 至少 2 个词（result=因变量/目标指标，如效果/绩效/满意度/意愿/转化率/自我效能/销量等，选题里没有就根据研究目标写出 2 个合理的词）；每个词 2-8 字；禁止输出泛词（研究/分析/影响/现状/问题）。" + (counts ? "检索目标数量：国内 " + counts.cn + " 篇、国外 " + counts.en + " 篇，请规划足够的检索式组合来支撑该数量。" : ""),
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
          "每个原词延申 2-3 个同义词或相近概念词（含结果词的近义指标词）；每类 4-8 个。",
        ].join("\n");
        const step2 = await model.generate(extendSystem, JSON.stringify(base), 4000, 0.4);
        const ex2 = this.parseJsonSafe(step2) as { subject?: string[]; result?: string[]; extra?: string[] } | null;
        const merged = {
          subject: [...new Set([...base.subject, ...pickArr(ex2?.subject, [])])].slice(0, 6),
          result: [...new Set([...base.result, ...pickArr(ex2?.result, [])])].slice(0, 4),
          extra: [...new Set([...base.extra, ...pickArr(ex2?.extra, [])])].slice(0, 6),
        };
        const checkSystem = [
          "你是学术检索关键词规划器（ReAct）。第 3 步自检：只删除明显的上义泛词（如「研究」「分析」「影响」「现状」这类无检索价值的词）；必须至少保留 3 个主体词与 2 个结果词，数量不足就从候选里补回。",
          "只输出 JSON：{\"subject\":[],\"result\":[],\"extra\":[]}（修正后的列表）",
        ].join("\n");
        const step3 = await model.generate(checkSystem, JSON.stringify(merged), 2000, 0.2);
        const ex3 = this.parseJsonSafe(step3) as { subject?: string[]; result?: string[]; extra?: string[] } | null;
        const final = {
          subject: pickArr(ex3?.subject, merged.subject),
          result: pickArr(ex3?.result, merged.result),
          extra: pickArr(ex3?.extra, merged.extra),
        };
        const flat = this.flattenKeywords({ ...cls, subject: this.sanitizeTerms(final.subject), result: this.sanitizeTerms(final.result), mediator: this.sanitizeTerms(final.extra) });
        plan = this.buildPlan(flat.subject, flat.result, flat.extra, cls, true);
      } catch { plan = null; }
    }
    if (!plan) {
      const flat = this.flattenKeywords(cls);
      plan = this.buildPlan(flat.subject, flat.result, flat.extra, cls, false);
    }
    return plan;
    } catch (err) {
      const detail2 = this.db.getProjectDetail(projectId);
      const tokens = String(detail2?.project?.name ?? "").split(/[^a-zA-Z0-9\u4e00-\u9fa5]+/).filter((t) => t.length >= 2 && t.length <= 12).slice(0, 8);
      const flat2 = this.flattenKeywords({ subject: tokens, result: [], mediator: [], subjectExpansions: [], resultExpansions: [] });
      const plan2 = this.buildPlan(flat2.subject.length > 0 ? flat2.subject : ["研究主题"], flat2.result, flat2.extra, { subject: [], result: [], mediator: [], subjectExpansions: [], resultExpansions: [] }, false);
      return { ...plan2, note: "关键词规划出现异常已自动兜底：" + (err instanceof Error ? err.message.slice(0, 60) : String(err)) + "；请核对下方关键词" };
    }
  }

  private buildPlan(subject: string[], result: string[], extra: string[], cls: TermClassification, aiGenerated: boolean): KeywordPlan {
    const queries: Array<KeywordPlan["queries"][number]> = [];
    const subs = subject.length > 0 ? subject : (cls.object?.length ? cls.object : cls.subject.length ? cls.subject : [""]);
    const ress = result.length > 0 ? result : (cls.result.length > 0 ? cls.result : [""]);
    const zhSeen = new Set<string>();
    const addQ = (zh: string, en: string | null, label: string, level: string, pair: { sub: string; res: string }) => {
      if (!zh.trim() || zhSeen.has(zh)) return;
      zhSeen.add(zh);
      queries.push({ zh, en, label, level, pair });
    };
    // ① 主体词 × 结果词 配对（逐词，不合并搜索框；限制组数避免触发数据源限流）
    for (const sub of subs.slice(0, 4)) {
      for (const res of ress.slice(0, 2)) {
        const zh = [sub, res].filter(Boolean).join(" ");
        const enSub = englishTerm(sub, cls);
        const enRes = englishTerm(res, cls);
        const en = [enSub, enRes].filter(Boolean).join(" ") || null;
        addQ(zh, en, "主体「" + sub + "」× 结果「" + res + "」", "L1", { sub, res });
      }
    }
    // ② 主体词单独检索式（中文池逐词搜索，稀疏库更易命中）
    for (const sub of subs.slice(0, 4)) {
      const en = englishTerm(sub, cls) || null;
      addQ(sub, en, "单主体词「" + sub + "」", "L1", { sub, res: "" });
    }
    // ③ 结果词单独检索式
    for (const res of ress.slice(0, 2)) {
      const en = englishTerm(res, cls) || null;
      addQ(res, en, "单结果词「" + res + "」", "L1", { sub: "", res });
    }
    for (const ex of extra.slice(0, 4)) {
      addQ(ex, null, "背景补充「" + ex + "」", "extra", { sub: ex, res: "" });
    }
    const note = aiGenerated
      ? "关键词由 AI 规划器三步生成（提取→延申→自检）并拍平为词，检索前请确认"
      : "未配置检索辅助模型，关键词由内置术语词典确定性生成并拍平为词";
    return { subject, result, extra, queries, note, aiGenerated };
  }

  /** 一步式：第 0/1/2 阶段内容 → MD → AI 规划检索 → 执行 → 核验（关键词模块已移除） */
  async searchAll(projectId: string, opts: { cn: number; en: number; excludeDois?: string[] }): Promise<{ plan: KeywordPlan; outcome: SearchOutcome2; verify: { verifyNote: string; pass: boolean } }> {
    const plan = await this.planKeywords(projectId, { cn: opts.cn, en: opts.en });
    const outcome = await this.executeSearch(projectId, plan, opts);
    const verify = await this.verifyResults(projectId, outcome);
    return { plan, outcome, verify };
  }

  /** ReAct-2：检索执行器——按计划逐个关键词检索；每步核对数量与国内外；不足则继续下一关键词 */
  async executeSearch(projectId: string, plan: KeywordPlan, opts: { cn: number; en: number; excludeDois?: string[] }, onProgress?: (msg: string) => void): Promise<SearchOutcome2> {
    const cnRequested = Math.max(0, opts.cn);
    const enRequested = Math.max(0, opts.en);
    const exclude = new Set((opts.excludeDois ?? []).map((d) => d.trim()).filter(Boolean));
    const excludedCount = exclude.size;
    const seenKeys = new Set<string>();
    const seenTitles = new Set<string>();
    type PoolItem = SearchOutcome["items"][number] & { level: string; citedBy?: number; queryText?: string };
    const cnPool: PoolItem[] = [];
    const enPool: PoolItem[] = [];
    const rawCnPool: PoolItem[] = [];
    const rawEnPool: PoolItem[] = [];
    const queriesUsed: string[] = [];
    let cnFailures = 0;
    let enFailures = 0;
    const topicText = this.collectContext(projectId);

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const BACKOFF = [0, 1500, 5000];
    const fetchWithRetry = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      for (let attempt = 0; attempt < BACKOFF.length; attempt++) {
        try {
          return await fn();
        } catch {
          if (attempt < BACKOFF.length - 1) await sleep(BACKOFF[attempt + 1]); // 429/网络抖动指数退避重试
        }
      }
      return null;
    };

    const pushUnique = (pool: PoolItem[], item: SearchOutcome["items"][number], level: string, citedBy: number, queryText: string) => {
      const key = item.doi || (item.title + "|" + item.authors);
      const normTitle = normalizeTitle(item.title);
      if (!key || seenKeys.has(key) || (normTitle && seenTitles.has(normTitle)) || exclude.has(item.doi)) return;
      seenKeys.add(key);
      if (normTitle) seenTitles.add(normTitle);
      pool.push({ ...item, level, citedBy, queryText });
    };

    const clsPair = (q: KeywordPlan["queries"][number]): TermClassification => ({
      object: q.pair.sub ? [q.pair.sub] : undefined,
      subject: q.pair.sub ? [q.pair.sub] : [],
      result: q.pair.res ? [q.pair.res] : [],
      mediator: [],
      subjectExpansions: expandSubject(q.pair.sub),
      resultExpansions: [],
    });

    const queryIdx = { i: 0 };
    for (const q of plan.queries) {
      const cnNeed = cnRequested > 0 && cnPool.length < cnRequested && cnFailures < 6; // 源连续失败熔断
      const enNeed = enRequested > 0 && enPool.length < enRequested && enFailures < 8;
      if (!cnNeed && !enNeed) break;
      await sleep(350); // 逐条间隔，礼貌访问数据源（防 429 限流）
      queriesUsed.push(q.zh);
      queryIdx.i++;
      onProgress?.("第 " + queryIdx.i + "/" + plan.queries.length + " 组检索式：" + q.zh);
      const pairCls = clsPair(q);
      if (cnNeed && /[\u4e00-\u9fa5]/.test(q.zh)) {
        try {
          const oaCn = await fetchWithRetry(() => openalexSearch(q.zh, { language: "zh", rows: 30, signal: AbortSignal.timeout(30_000) }));
          if (!oaCn) { cnFailures++; } else {
            for (const item of oaCn.items) {
              const typed = { ...item, region: "domestic" as const };
              pushUnique(rawCnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
              if (hardFilterPass(item.title, pairCls, "zh", q.level)) {
                pushUnique(cnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
              }
            }
          }
          // 中文池第二源：Crossref 中文文献（与 OpenAlex 互补，分摊限流压力）
          const crCn = await fetchWithRetry(() => crossrefSearch(q.zh, this.settings.getContactEmail(), AbortSignal.timeout(30_000), { rows: 30 }));
          if (!crCn) { cnFailures++; } else if (crCn.status !== "error") {
            for (const item of crCn.items) {
              const typed = { ...item, region: "domestic" as const };
              pushUnique(rawCnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
              if (hardFilterPass(item.title, pairCls, "zh", q.level)) {
                pushUnique(cnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
              }
            }
          }
        } catch { /* 单源失败继续下一关键词 */ }
      }
      onProgress?.("第 " + queryIdx.i + "/" + plan.queries.length + " 组完成：国内累计 " + cnPool.length + " 条、国外累计 " + enPool.length + " 条");
      if (enNeed && q.en) {
        const enQ = q.en;
        try {
          const oa = await fetchWithRetry(() => openalexSearch(enQ, { language: "en", rows: 30, signal: AbortSignal.timeout(30_000) }));
          const cr = await fetchWithRetry(() => crossrefSearch(enQ, this.settings.getContactEmail(), AbortSignal.timeout(30_000), { rows: 30 }));
          if (!oa && !cr) { enFailures++; continue; }
          if (oa && oa.status !== "error") {
            for (const item of oa.items) {
              const typed = { ...item, region: "foreign" as const };
              pushUnique(rawEnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.en ?? q.zh);
              if (hardFilterPass(item.title, pairCls, "en", q.level)) {
                pushUnique(enPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.en ?? q.zh);
              }
            }
          }
          if (cr && cr.status !== "error") {
            for (const item of cr.items) {
              const typed = { ...item, region: "foreign" as const };
              pushUnique(rawEnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.en ?? q.zh);
              if (hardFilterPass(item.title, pairCls, "en", q.level)) {
                pushUnique(enPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.en ?? q.zh);
              }
            }
          }
        } catch { /* 继续下一关键词 */ }
      }
    }

    const kwText = [...plan.subject, ...plan.result].join(" ");
    const simTarget = (item: PoolItem) => item.queryText ?? kwText ?? topicText;
    const scoreItem = (item: { title: string; abstract?: string; citedBy?: number }) => {
      const hay = (item.title + " " + (item.abstract ?? "")).toLowerCase();
      let subHits = 0;
      let resHits = 0;
      for (const w of plan.subject) {
        const vs = [...new Set([String(w).toLowerCase(), englishTerm(String(w), { subject: [], result: [], mediator: [], subjectExpansions: [], resultExpansions: [] }).toLowerCase()])].filter(Boolean);
        if (vs.some((v) => hay.includes(v))) subHits++;
      }
      for (const w of plan.result) {
        const vs = [...new Set([String(w).toLowerCase(), englishTerm(String(w), { subject: [], result: [], mediator: [], subjectExpansions: [], resultExpansions: [] }).toLowerCase()])].filter(Boolean);
        if (vs.some((v) => hay.includes(v))) resHits++;
      }
      return { subHits, resHits, crossHit: subHits > 0 && resHits > 0, citedBy: item.citedBy ?? 0 };
    };
    const sortPool = (pool: PoolItem[]) => pool.sort((a, b) => {
      const A = scoreItem(a);
      const B = scoreItem(b);
      if (A.crossHit !== B.crossHit) return A.crossHit ? -1 : 1;
      const ha = A.subHits + A.resHits;
      const hb = B.subHits + B.resHits;
      if (ha !== hb) return hb - ha;
      return B.citedBy - A.citedBy;
    });
    const cnFiltered = sortPool(cnPool.filter((i) => ngramSimilarity(i.title + " " + i.abstract, simTarget(i)) >= 0.2));
    const enFiltered = sortPool(enPool.filter((i) => ngramSimilarity(i.title + " " + i.abstract, simTarget(i)) >= 0.2));
    let cnFound = Math.min(cnRequested, cnFiltered.length);
    let enFound = Math.min(enRequested, enFiltered.length);

    // 放宽二次检索：严格命中不足时，从原始池放宽为「标题或摘要至少命中任一关键词」，标注需核验（不编造，只是降低门槛）
    const anyHit = (item: { title: string; abstract?: string }, zh: boolean): boolean => {
      const hay = (item.title + " " + (item.abstract ?? "")).toLowerCase();
      const variants = (w: string): string[] => {
        const s = String(w).trim();
        if (!s) return [];
        const en = englishTerm(s, { subject: [], result: [], mediator: [], subjectExpansions: [], resultExpansions: [] });
        return [...new Set([s.toLowerCase(), en.toLowerCase()])].filter(Boolean);
      };
      const hits = (w: string) => {
        const vs = variants(w);
        if (zh) return vs.some((v) => (item.title + " " + (item.abstract ?? "")).toLowerCase().includes(v));
        return vs.some((v) => hay.includes(v));
      };
      return plan.subject.some(hits) || plan.result.some(hits);
    };
    const loosePool = (raw: typeof rawCnPool, seen: Set<string>) => {
      const loose: typeof rawCnPool = [];
      for (const item of raw) {
        const key = item.doi || (item.title + "|" + item.authors);
        if (seen.has(key)) continue;
        const zh = /[\u4e00-\u9fa5]/.test(item.title);
        if (!anyHit(item, zh)) continue;
        if (ngramSimilarity(item.title + " " + item.abstract, (item as PoolItem).queryText ?? kwText ?? topicText) < 0.12) continue;
        // 多词命中评分：命中不同关键词越多越好；主体侧与结果侧都命中（跨侧）优先
        const hay = (item.title + " " + (item.abstract ?? "")).toLowerCase();
        const hitSet = new Set<string>();
        let subHits = 0;
        let resHits = 0;
        for (const w of plan.subject) {
          const vs = [...new Set([String(w).toLowerCase(), englishTerm(String(w), { subject: [], result: [], mediator: [], subjectExpansions: [], resultExpansions: [] }).toLowerCase()])].filter(Boolean);
          if (vs.some((v) => hay.includes(v))) { hitSet.add(String(w)); subHits++; }
        }
        for (const w of plan.result) {
          const vs = [...new Set([String(w).toLowerCase(), englishTerm(String(w), { subject: [], result: [], mediator: [], subjectExpansions: [], resultExpansions: [] }).toLowerCase()])].filter(Boolean);
          if (vs.some((v) => hay.includes(v))) { hitSet.add(String(w)); resHits++; }
        }
        seen.add(key);
        loose.push({ ...item, level: "loose", citedBy: Number((item as { citedBy?: number }).citedBy ?? 0), queryText: (item as PoolItem).queryText, hitCount: hitSet.size, crossHit: subHits > 0 && resHits > 0 } as never);
      }
      // 排序：跨侧命中优先 → 命中词数多优先 → 引用高优先
      loose.sort((a, b) => {
        const A = a as unknown as { hitCount: number; crossHit: boolean; citedBy?: number };
        const B = b as unknown as { hitCount: number; crossHit: boolean; citedBy?: number };
        if (A.crossHit !== B.crossHit) return A.crossHit ? -1 : 1;
        if (A.hitCount !== B.hitCount) return B.hitCount - A.hitCount;
        return (B.citedBy ?? 0) - (A.citedBy ?? 0);
      });
      return loose;
    };
    const strictKeys = new Set([...cnFiltered, ...enFiltered].map((i) => i.doi || (i.title + "|" + i.authors)));
    if (cnFound < cnRequested) {
      const looseCn = loosePool(rawCnPool, strictKeys).slice(0, cnRequested - cnFound);
      cnFiltered.push(...looseCn);
      cnFound = Math.min(cnRequested, cnFiltered.length);
    }
    if (enFound < enRequested) {
      const looseEn = loosePool(rawEnPool, strictKeys).slice(0, enRequested - enFound);
      enFiltered.push(...looseEn);
      enFound = Math.min(enRequested, enFiltered.length);
    }
    const results = [...cnFiltered.slice(0, cnFound), ...enFiltered.slice(0, enFound)];
    const needMore = cnFound < cnRequested || enFound < enRequested;
    const counts = { cnRequested, enRequested, cnFound, enFound };
    const parts = ["检索完成：国内 " + cnFound + "/" + cnRequested + "、国外 " + enFound + "/" + enRequested + "（已排除 " + excludedCount + " 篇已搜寻文献；中文原始取回 " + rawCnPool.length + " 条、英文原始取回 " + rawEnPool.length + " 条、严格命中 " + (cnPool.length + enPool.length) + " 条）"];
    if (rawCnPool.length === 0 && rawEnPool.length === 0) parts.push("两个数据源都未取回结果：可能触发 OpenAlex/Crossref 限流（429）或网络异常，请稍候 1-2 分钟再试");
    else if (needMore) parts.push("数量未达标（真实数据源尽力检索，未编造）；可点「AI 再次查询」补充");
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
        "你是文献检索结果核验器（ReAct）。核对返回文献是否：1) 数量达到 n 国内/y 国外；2) 标题是否踩中关键词——命中任一主体词+任一结果词即算踩点（其余概念如虚拟主播/社会临场感可在文献综述中补充，不要求全部命中）；3) 主题方向与选题一致。",
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
