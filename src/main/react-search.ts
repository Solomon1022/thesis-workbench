import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { crossrefSearch } from "./adapters/crossref";
import { openalexSearch } from "./adapters/openalex";
import { hanspubSearch } from "./adapters/hanspub";
import { cnkiSearch } from "./adapters/cnki";
import { normalizeTitle } from "../shared/bibparse";
import { CN_SEARCH_PLATFORMS, FOREIGN_PLATFORMS, type SearchOutcome } from "../shared/literature";
import {
  classifyTerms, englishTerm, expandResult, expandSubject, hardFilterPass, isResultWord, ngramSimilarity, type TermClassification,
} from "./query-planner";
import { segmentKeywords } from "./literature-service";
import { makePoolId, rerankPool, sanitizePlanQueries } from "./pool-rerank";
import {
  ALLOWED_PLAN_SOURCES, CNKI_REQUEST_TIMEOUT_MS, MAX_SEARCH_ROUNDS, PER_SOURCE_CAP, PLAN_MAX_TOKENS, POOL_CAP,
  REWRITE_MAX_QUERIES, REWRITE_MAX_TOKENS, SEARCH_REQUEST_TIMEOUT_MS, TOTAL_SEARCH_TIMEOUT_MS,
} from "./search-guards";

type ModelResolver = { generate(system: string, user: string, maxTokens: number, temperature: number): Promise<string> } | null;

export interface KeywordPlan {
  subject: string[];
  result: string[];
  extra: string[];
  /** 检索计划：每组一组关键词（不合并搜索框）；可带目标源/字段/年限/每源上限（LLM 计划 JSON 生成，程序钳制） */
  queries: Array<{ zh: string; en: string | null; label: string; level: string; pair: { sub: string; res: string }; fields?: string[]; sources?: string[]; yearFrom?: number; yearTo?: number; capPerSource?: number }>;
  note: string;
  aiGenerated: boolean;
  /** 各 AI 环节耗时（计划四步/改写/重排），用于界面显示与耗时预估 */
  timings?: Array<{ label: string; ms: number }>;
}

export interface SearchOutcome2 {
  ok: boolean;
  message: string;
  queriesUsed: string[];
  results: Array<SearchOutcome["items"][number] & { aiScore?: number; relevanceReason?: string }>;
  /** 实际执行的查询轮次（改写查询最多 3 轮） */
  roundsUsed: number;
  counts: { cnRequested: number; enRequested: number; cnFound: number; enFound: number };
  verifyNote: string;
  needMore: boolean;
  excludedCount: number;
  /** 中文库跳转链接（知网着重；抓取失败时的降级入口） */
  cnJumpLinks: Array<{ name: string; url: string; query: string }>;
  /** 境外源跳转链接（英文检索式：汉斯出版社/Google Scholar/BASE） */
  foreignLinks: Array<{ key: string; name: string; url: string; query: string }>;
  /** 数据源与年份口径说明 */
  cnNote: string;
}

/**
 * ReAct 检索框架：3 个高级 ReAct 功能
 *  ReAct-1 关键词规划器：读第 0/1/2 阶段内容 → 提取 → 延申同义 → 自检（多步推理）
 *  ReAct-2 检索执行器：按计划逐个关键词检索 → 每步核对数量与国内外 → 不足则换下一关键词
 *  ReAct-3 结果核验器：输出前核对数量与关键词踩点 → 不合格提示「AI 再次查询」
 */
export class ReactSearchService {
  constructor(private db: ThesisDB, private settings: SettingsService) {}

  private resolver(signal?: AbortSignal): ModelResolver {
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
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(240_000)]) : AbortSignal.timeout(240_000),
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

  /** 导出第 0/1/2 阶段内容 MD（发给 AI 平台找文献；含用户检索偏好与使用说明；每次导出都是最新内容） */
  buildSearchMd(projectId: string, prefs?: { refTypes?: string[]; platforms?: string[] }): string {
    const base = this.buildMd(projectId);
    const lines = [base, "", "# 检索偏好（用户指定，发送给 AI 时请一并带上）"];
    const refTypes = (prefs?.refTypes ?? []).filter(Boolean);
    lines.push("- 文献类型偏好：" + (refTypes.length > 0 ? refTypes.join("、") : "期刊论文为主，学位论文、会议论文、综述适当补充"));
    const platforms = (prefs?.platforms ?? []).filter(Boolean);
    lines.push("- 平台偏好：" + (platforms.length > 0 ? platforms.join("、") : "中国知网为主，兼顾汉斯出版社、Google Scholar、BASE 与开放学术索引"));
    lines.push("- 检索要求：请基于以上论文信息与偏好，列出真实存在的文献（标题、作者、期刊/会议、年份、DOI 或链接），格式采用 GB/T 7714；严禁编造文献；数量 15–30 篇，国内为主、国外少量，近 5 年且尽量包含当年文献。");
    lines.push("");
    lines.push("# 使用说明");
    lines.push("- 把本文档整体发送给 AI（如 DeepSeek、ChatGPT 等），让 AI 按上面的信息与偏好查找适配文献。");
    lines.push("- 拿到文献后，把标题或完整参考文献粘贴到论文工作台「文献综述与证据整理 → 手动录入（参考文献引用 + 摘要）」，即可精准入库（链接/参考文献准确时，查找与核验都很快）。");
    return lines.join("\n");
  }

  /** ReAct-1：关键词规划器（提取 → 延申 → 自检；无模型时走确定性规则） */
  async planKeywords(projectId: string, counts?: { cn: number; en: number }, signal?: AbortSignal): Promise<KeywordPlan> {
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
    const aiTimings: Array<{ label: string; ms: number }> = [];
    const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        aiTimings.push({ label, ms: Date.now() - t0 });
      }
    };

    /* AI 步骤返回的某类关键词为空时，回退到上一步/词典结果（推理模型常因思考耗 token 返回空数组） */
    const pickArr = (ai: string[] | undefined, prev: string[]): string[] => {
      const cleaned = (Array.isArray(ai) ? ai : []).filter((s) => String(s ?? "").trim().length > 0);
      return cleaned.length > 0 ? cleaned : prev;
    };

    let plan: KeywordPlan | null = null;
    let aiFailedNote = "";
    if (model) {
      try {
        const extractSystem = [
          "你是学术检索关键词规划器（ReAct）。第 1 步：从给定论文信息中提取检索关键词。",
          "只输出 JSON：{\"subject\":[\"主体词（研究对象/自变量）\"],\"result\":[\"结果词（因变量/结局）\"],\"extra\":[\"背景补充词\"]}",
          "规则：以选题与摘要的关键词为主、背景为辅；subject 至少 3 个词、result 至少 2 个词（result=因变量/目标指标，如效果/绩效/满意度/意愿/转化率/自我效能/销量等，选题里没有就根据研究目标写出 2 个合理的词）；每个词 2-8 字；禁止输出泛词（研究/分析/影响/现状/问题）。" + (counts ? "检索目标数量：国内 " + counts.cn + " 篇、国外 " + counts.en + " 篇，请规划足够的检索式组合来支撑该数量。" : ""),
        ].join("\n");
        const step1 = await timed("关键词提取", () => model.generate(extractSystem, context, 4000, 0.3));
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
        const step2 = await timed("同义词延申", () => model.generate(extendSystem, JSON.stringify(base), 4000, 0.4));
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
        const step3 = await timed("关键词自检", () => model.generate(checkSystem, JSON.stringify(merged), 2000, 0.2));
        const ex3 = this.parseJsonSafe(step3) as { subject?: string[]; result?: string[]; extra?: string[] } | null;
        const final = {
          subject: pickArr(ex3?.subject, merged.subject),
          result: pickArr(ex3?.result, merged.result),
          extra: pickArr(ex3?.extra, merged.extra),
        };
        const flat = this.flattenKeywords({ ...cls, subject: this.sanitizeTerms(final.subject), result: this.sanitizeTerms(final.result), mediator: this.sanitizeTerms(final.extra) });
        plan = this.buildPlan(flat.subject, flat.result, flat.extra, cls, true);
        // 第 4 步：基于原始 MD + 关键词生成结构化检索计划 JSON（多组查询/目标源/字段/年限/每源上限）
        try {
          const planSystem = [
            "你是学术检索计划生成器。基于论文原始信息与已提取的关键词，生成多组检索式计划。",
            "只输出 JSON：{\"queries\":[{\"zh\":\"中文检索式\",\"en\":\"英文检索式（可空）\",\"label\":\"说明\",\"sources\":[\"cnki\",\"hanspub\",\"openalex\",\"crossref\"],\"fields\":[\"title\",\"topic\"],\"yearFrom\":2022,\"yearTo\":2026,\"capPerSource\":30}]}",
            "规则：queries 8-14 组；zh 为 2-6 个词拼接（含同义词变体，不要句子）；en 用英文学术用语，可为空字符串；sources 只允许 cnki/hanspub/openalex/crossref/google-scholar/base；yearFrom=当年-4、yearTo=当年；capPerSource 默认 30 且不超过 30；fields 只允许 title/topic/keyword。",
            "禁止输出句子式检索式；禁止编造文献；禁止输出 JSON 以外的内容。",
          ].join("\n");
          const step4 = await timed("检索计划生成", () => model.generate(planSystem, context + "\n\n关键词：" + JSON.stringify({ subject: final.subject, result: final.result, extra: final.extra }), PLAN_MAX_TOKENS, 0.2));
          const ex4 = this.parseJsonSafe(step4) as { queries?: Array<Record<string, unknown>> } | null;
          const planQueries = sanitizePlanQueries(ex4?.queries);
          if (planQueries.length > 0) {
            plan = { ...plan, queries: planQueries, note: (plan.note ? plan.note + "。" : "") + "检索计划由 AI 基于原始 MD 生成（多组查询/目标源/年限/每源上限）" };
          }
        } catch { /* 计划生成失败保持词典计划，检索不中断 */ }
      } catch { plan = null; aiFailedNote = "AI 规划异常（超时/余额不足/网络），已自动切换内置词典兜底，检索不中断"; }
    }
    if (!plan) {
      const flat = this.flattenKeywords(cls);
      plan = this.buildPlan(flat.subject, flat.result, flat.extra, cls, false);
    }
    if (aiFailedNote) plan = { ...plan, note: (plan.note ? plan.note + "。" : "") + aiFailedNote };
    if (aiTimings.length > 0) plan = { ...plan, timings: aiTimings };
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

  /** 改写查询：上一轮不足时，LLM 基于原始 MD 生成不重复的新检索式（护栏内，最多 6 组） */
  private async rewriteQueries(model: NonNullable<ModelResolver>, md: string, used: string[], cnShort: number, enShort: number): Promise<KeywordPlan["queries"]> {
    try {
      const system = [
        "你是学术检索计划改写器。上一轮检索结果不足（国内缺 " + cnShort + " 篇、国外缺 " + enShort + " 篇），请基于论文原始信息改写查询。",
        "只输出 JSON：{\"queries\":[{\"zh\":\"中文检索式\",\"en\":\"英文检索式（可空）\",\"label\":\"说明\"}]}",
        "规则：每组 zh 为 2-6 个词（换同义词/近义概念/英文变体）；不得与已用检索式重复；最多 6 组；禁止句子；禁止编造文献。",
        "已用检索式：" + used.join("、"),
      ].join("\n");
      const raw = await model.generate(system, md, REWRITE_MAX_TOKENS, 0.3);
      const data = this.parseJsonSafe(raw) as { queries?: Array<Record<string, unknown>> } | null;
      const cleaned = sanitizePlanQueries(data?.queries);
      return cleaned.filter((q) => !used.includes(q.zh)).slice(0, REWRITE_MAX_QUERIES);
    } catch {
      return [];
    }
  }

  /** 一步式：第 0/1/2 阶段内容 → MD → AI 规划检索 → 执行 → 核验（关键词模块已移除；onProgress 供任务状态与进度展示） */
  async searchAll(projectId: string, opts: { cn: number; en: number; excludeDois?: string[] }, onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<{ plan: KeywordPlan; outcome: SearchOutcome2; verify: { verifyNote: string; pass: boolean } }> {
    const plan = await this.planKeywords(projectId, { cn: opts.cn, en: opts.en }, signal);
    onProgress?.("AI 规划完成，开始真实数据源检索…");
    const outcome = await this.executeSearch(projectId, plan, opts, onProgress, signal);
    // 检索记录：AI 检索论文整次结果落日志（可追溯）
    const qs = plan.queries.slice(0, 3).map((q) => [q.zh, q.en].filter(Boolean).join(" / ")).join("；");
    this.db.appendSearchLog(projectId, "ai-search", qs || "（多源检索式）", outcome.results.length, "ok", "AI 检索论文（多源·池内重排）");
    onProgress?.("池内重排与核验完成");
    const verify = await this.verifyResults(projectId, outcome);
    return { plan, outcome, verify };
  }

  /** ReAct-2：检索执行器——多轮查询（护栏内 ≤3 轮）+ 真实召回 + 池内重排（LLM 只排序、不生成文献） */
  async executeSearch(projectId: string, plan: KeywordPlan, opts: { cn: number; en: number; excludeDois?: string[] }, onProgress?: (msg: string) => void, signal?: AbortSignal): Promise<SearchOutcome2> {
    const startedAt = Date.now();
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
    const md = this.buildMd(projectId);
    const topicText = this.collectContext(projectId);
    const kwTextBase = [...plan.subject, ...plan.result].join(" ");
    const aiTimings: Array<{ label: string; ms: number }> = [...(plan.timings ?? [])];
    const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      const t0 = Date.now();
      try {
        return await fn();
      } finally {
        aiTimings.push({ label, ms: Date.now() - t0 });
      }
    };
    const currentYear = new Date().getFullYear();
    const cnJumpLinks: Array<{ name: string; url: string; query: string }> = [];
    const foreignLinks: Array<{ key: string; name: string; url: string; query: string }> = [];
    let cnkiOk = false;
    let cnkiDegraded = false;

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const BACKOFF = [0, 1500, 5000];
    const fetchWithRetry = async <T>(fn: () => Promise<T>): Promise<T | null> => {
      for (let attempt = 0; attempt < BACKOFF.length; attempt++) {
        try {
          return await fn();
        } catch {
          if (attempt < BACKOFF.length - 1) await sleep(BACKOFF[attempt + 1]);
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

    // 词典计划沿用「逐词对」过滤；LLM 计划（pair 为空）回退到计划级主体词/结果词集合
    const clsPair = (q: KeywordPlan["queries"][number]): TermClassification => ({
      object: q.pair.sub ? [q.pair.sub] : undefined,
      subject: q.pair.sub ? [q.pair.sub] : plan.subject.slice(0, 4),
      result: q.pair.res ? [q.pair.res] : plan.result.slice(0, 2),
      mediator: [],
      subjectExpansions: q.pair.sub ? expandSubject(q.pair.sub) : [],
      resultExpansions: [],
    });

    const simTarget = (item: PoolItem) => item.queryText ?? kwTextBase ?? topicText;
    const scoreItem = (item: { title: string; abstract?: string; citedBy?: number; year?: string }) => {
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
      return { subHits, resHits, crossHit: subHits > 0 && resHits > 0, citedBy: item.citedBy ?? 0, recent: Number(item.year) === currentYear ? 1 : 0 };
    };
    const sortPool = (pool: PoolItem[]) => pool.sort((a, b) => {
      const A = scoreItem(a);
      const B = scoreItem(b);
      if (A.crossHit !== B.crossHit) return A.crossHit ? -1 : 1;
      const ha = A.subHits + A.resHits;
      const hb = B.subHits + B.resHits;
      if (ha !== hb) return hb - ha;
      if (A.citedBy !== B.citedBy) return B.citedBy - A.citedBy;
      return B.recent - A.recent;
    });

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
    const loosePool = (raw: PoolItem[], seen: Set<string>) => {
      const loose: PoolItem[] = [];
      for (const item of raw) {
        const key = item.doi || (item.title + "|" + item.authors);
        if (seen.has(key)) continue;
        const zh = /[\u4e00-\u9fa5]/.test(item.title);
        if (!anyHit(item, zh)) continue;
        if (ngramSimilarity(item.title + " " + item.abstract, item.queryText ?? kwTextBase ?? topicText) < 0.12) continue;
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
        loose.push({ ...item, level: "loose", citedBy: Number(item.citedBy ?? 0), queryText: item.queryText, hitCount: hitSet.size, crossHit: subHits > 0 && resHits > 0 } as never);
      }
      loose.sort((a, b) => {
        const A = a as unknown as { hitCount: number; crossHit: boolean; citedBy?: number };
        const B = b as unknown as { hitCount: number; crossHit: boolean; citedBy?: number };
        if (A.crossHit !== B.crossHit) return A.crossHit ? -1 : 1;
        if (A.hitCount !== B.hitCount) return B.hitCount - A.hitCount;
        return (B.citedBy ?? 0) - (A.citedBy ?? 0);
      });
      return loose;
    };

    let round = 1;
    const runQueries = async (queries: KeywordPlan["queries"]) => {
      let cnFailures = 0;
      let enFailures = 0;
      for (const q of queries) {
        if (Date.now() - startedAt > TOTAL_SEARCH_TIMEOUT_MS) { onProgress?.("已达总超时护栏（5 分钟），停止继续检索"); return false; }
        const cnNeed = cnPool.length < cnRequested && cnFailures < 6;
        const enNeed = enPool.length < enRequested && enFailures < 8;
        if (!cnNeed && !enNeed) return true;
        await sleep(350); // 逐条间隔，礼貌访问数据源（防 429 限流）
        queriesUsed.push(q.zh);
        onProgress?.("第 " + round + "/" + MAX_SEARCH_ROUNDS + " 轮 · 检索式：" + q.zh);
        const pairCls = clsPair(q);
        const cap = Math.min(PER_SOURCE_CAP, q.capPerSource ?? PER_SOURCE_CAP);
        const yearOk = (item: SearchOutcome["items"][number]) => {
          const y = Number(item.year);
          if (!y) return true;
          if (q.yearFrom && y < q.yearFrom) return false;
          if (q.yearTo && y > q.yearTo) return false;
          return true;
        };
        if (cnNeed && /[\u4e00-\u9fa5]/.test(q.zh)) {
          try {
            // 中文库跳转入口（知网着重）：无论直抓成败都给出，供官网核验与手动导入
            for (const pf of CN_SEARCH_PLATFORMS) {
              if (cnJumpLinks.some((l) => l.name === pf.name)) continue;
              const url = pf.searchTemplate ? pf.searchTemplate.replace("%s", encodeURIComponent(q.zh)) : "https://www.nssd.cn";
              cnJumpLinks.push({ name: pf.name, url, query: q.zh });
            }
            // 知网题录直抓（校园网/VPN 环境；失败自动降级，不绕验证码）
            if (!cnkiDegraded && (!q.sources || q.sources.includes("cnki"))) {
              const ck = await fetchWithRetry(() => cnkiSearch(q.zh, t(CNKI_REQUEST_TIMEOUT_MS), Math.min(20, cap)));
              if (ck && ck.status === "ok") {
                cnkiOk = true;
                for (const item of ck.items) {
                  if (!yearOk(item)) continue;
                  const typed = { ...item, region: "domestic" as const };
                  pushUnique(rawCnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  if (hardFilterPass(item.title, pairCls, "zh", q.level)) {
                    pushUnique(cnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  }
                }
              } else {
                cnkiDegraded = true;
              }
            }
            // 汉斯出版社中文真实取回（OA，DOI 前缀 10.12677）
            if (!q.sources || q.sources.includes("hanspub")) {
              const hsCn = await fetchWithRetry(() => hanspubSearch(q.zh, t(SEARCH_REQUEST_TIMEOUT_MS), Math.min(20, cap)));
              if (!hsCn) { cnFailures++; } else if (hsCn.status !== "error") {
                for (const item of hsCn.items) {
                  if (!yearOk(item)) continue;
                  const typed = { ...item, region: "domestic" as const };
                  pushUnique(rawCnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  if (hardFilterPass(item.title, pairCls, "zh", q.level)) {
                    pushUnique(cnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  }
                }
              }
            }
            if (!q.sources || q.sources.includes("openalex")) {
              const oaCn = await fetchWithRetry(() => openalexSearch(q.zh, { language: "zh", rows: cap, signal: t(SEARCH_REQUEST_TIMEOUT_MS) }));
              if (!oaCn) { cnFailures++; } else {
                for (const item of oaCn.items) {
                  if (!yearOk(item)) continue;
                  const typed = { ...item, region: "domestic" as const };
                  pushUnique(rawCnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  if (hardFilterPass(item.title, pairCls, "zh", q.level)) {
                    pushUnique(cnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  }
                }
              }
            }
            // 中文池补充源：Crossref 中文文献（与 OpenAlex 互补，分摊限流压力）
            if (!q.sources || q.sources.includes("crossref")) {
              const crCn = await fetchWithRetry(() => crossrefSearch(q.zh, this.settings.getContactEmail(), t(SEARCH_REQUEST_TIMEOUT_MS), { rows: cap }));
              if (!crCn) { cnFailures++; } else if (crCn.status !== "error") {
                for (const item of crCn.items) {
                  if (!yearOk(item)) continue;
                  const typed = { ...item, region: "domestic" as const };
                  pushUnique(rawCnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  if (hardFilterPass(item.title, pairCls, "zh", q.level)) {
                    pushUnique(cnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.zh);
                  }
                }
              }
            }
          } catch { /* 单源失败继续下一关键词 */ }
        }
        onProgress?.("第 " + round + "/" + MAX_SEARCH_ROUNDS + " 轮 · 国内累计 " + cnPool.length + " 条、国外累计 " + enPool.length + " 条");
        if (enNeed && q.en) {
          const enQ = q.en;
          if (foreignLinks.length === 0 && enQ.trim()) {
            for (const f of FOREIGN_PLATFORMS) {
              const url = f.searchTemplate ? f.searchTemplate.replace("%s", encodeURIComponent(enQ)) : "";
              foreignLinks.push({ key: f.key, name: f.name, url, query: enQ });
            }
          }
          try {
            const hs = (!q.sources || q.sources.includes("hanspub")) ? await fetchWithRetry(() => hanspubSearch(enQ, t(SEARCH_REQUEST_TIMEOUT_MS), Math.min(20, cap))) : null;
            const oa = (!q.sources || q.sources.includes("openalex")) ? await fetchWithRetry(() => openalexSearch(enQ, { language: "en", rows: cap, signal: t(SEARCH_REQUEST_TIMEOUT_MS) })) : null;
            const cr = (!q.sources || q.sources.includes("crossref")) ? await fetchWithRetry(() => crossrefSearch(enQ, this.settings.getContactEmail(), t(SEARCH_REQUEST_TIMEOUT_MS), { rows: cap })) : null;
            if (!hs && !oa && !cr) { enFailures++; continue; }
            if (hs && hs.status !== "error") {
              for (const item of hs.items) {
                if (!yearOk(item)) continue;
                const typed = { ...item, region: "foreign" as const };
                pushUnique(rawEnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), enQ);
                if (hardFilterPass(item.title, pairCls, "en", q.level)) {
                  pushUnique(enPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), enQ);
                }
              }
            }
            if (oa && oa.status !== "error") {
              for (const item of oa.items) {
                if (!yearOk(item)) continue;
                const typed = { ...item, region: "foreign" as const };
                pushUnique(rawEnPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.en ?? q.zh);
                if (hardFilterPass(item.title, pairCls, "en", q.level)) {
                  pushUnique(enPool, typed, q.level, Number((item as { citedBy?: number }).citedBy ?? 0), q.en ?? q.zh);
                }
              }
            }
            if (cr && cr.status !== "error") {
              for (const item of cr.items) {
                if (!yearOk(item)) continue;
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
      return true;
    };

    // 两层过滤 + 年份口径 + 放宽轮（evaluate 可重复调用，供轮次间判断缺口）
    const inWindow = (i: PoolItem, span: number) => { const y = Number(i.year); return !y || y >= currentYear - span; };
    const evaluate = () => {
      const cnFiltered = sortPool(cnPool.filter((i) => ngramSimilarity(i.title + " " + i.abstract, simTarget(i)) >= 0.2));
      const enFiltered = sortPool(enPool.filter((i) => ngramSimilarity(i.title + " " + i.abstract, simTarget(i)) >= 0.2));
      let yearNote = "";
      let cnRecent = cnFiltered.filter((i) => inWindow(i, 4));
      let enRecent = enFiltered.filter((i) => inWindow(i, 4));
      let cnFound = Math.min(cnRequested, cnRecent.length);
      let enFound = Math.min(enRequested, enRecent.length);
      if ((cnFound < cnRequested || enFound < enRequested) && (cnFiltered.some((i) => !inWindow(i, 4)) || enFiltered.some((i) => !inWindow(i, 4)))) {
        const cnWide = cnFiltered.filter((i) => inWindow(i, 9));
        const enWide = enFiltered.filter((i) => inWindow(i, 9));
        if (cnWide.length > cnRecent.length || enWide.length > enRecent.length) {
          cnRecent = cnWide; enRecent = enWide;
          cnFound = Math.min(cnRequested, cnRecent.length);
          enFound = Math.min(enRequested, enRecent.length);
          yearNote = "近 5 年结果不足，已放宽至近 10 年";
        }
      }
      const strictKeys = new Set([...cnRecent, ...enRecent].map((i) => i.doi || (i.title + "|" + i.authors)));
      if (cnFound < cnRequested) {
        const looseCn = loosePool(rawCnPool, strictKeys).filter((i) => inWindow(i, 9)).slice(0, cnRequested - cnFound);
        cnRecent.push(...looseCn);
        cnFound = Math.min(cnRequested, cnRecent.length);
      }
      if (enFound < enRequested) {
        const looseEn = loosePool(rawEnPool, strictKeys).filter((i) => inWindow(i, 9)).slice(0, enRequested - enFound);
        enRecent.push(...looseEn);
        enFound = Math.min(enRequested, enRecent.length);
      }
      return { cnRecent, enRecent, cnFound, enFound, needMore: cnFound < cnRequested || enFound < enRequested, yearNote };
    };

    const t = (ms: number) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

    // 多轮查询：不足时 LLM 改写查询再查（护栏内，最多 3 轮；无模型则单轮规则兜底）
    let queries = plan.queries;
    while (round <= MAX_SEARCH_ROUNDS) {
      await runQueries(queries);
      const snap = evaluate();
      if (!snap.needMore) break;
      if (round >= MAX_SEARCH_ROUNDS) break;
      const model = this.resolver(signal);
      if (!model) break;
      const newQueries = await timed("改写查询（第 " + round + " 轮）", () => this.rewriteQueries(model, md, queriesUsed, cnRequested - snap.cnFound, enRequested - snap.enFound));
      if (newQueries.length === 0) break;
      queries = newQueries;
      round++;
    }

    const ev = evaluate();
    // 兜底跳转链接（前面各分支已生成；这里按首条检索式补足）
    if (cnJumpLinks.length === 0 && cnRequested > 0) {
      const zhQ = kwTextBase || queriesUsed[0] || "";
      if (zhQ.trim()) {
        for (const pf of CN_SEARCH_PLATFORMS) {
          const url = pf.searchTemplate ? pf.searchTemplate.replace("%s", encodeURIComponent(zhQ)) : "https://www.nssd.cn";
          cnJumpLinks.push({ name: pf.name, url, query: zhQ });
        }
      }
    }
    if (foreignLinks.length === 0 && enRequested > 0) {
      const enFallback = plan.queries.map((x) => x.en).find((x) => x && x.trim());
      if (enFallback) {
        for (const f of FOREIGN_PLATFORMS) {
          const url = f.searchTemplate ? f.searchTemplate.replace("%s", encodeURIComponent(enFallback)) : "";
          foreignLinks.push({ key: f.key, name: f.name, url, query: enFallback });
        }
      }
    }

    // 池内重排：原始 MD + 候选池交给 LLM 排序（白名单校验 + 元数据原值 + 无模型回退规则预排）
    const targetNote = "国内 " + cnRequested + " 篇、国外 " + enRequested + " 篇；近 5 年且必含当年；期刊优先。";
    const resolver = this.resolver(signal);
    const onRerankWarn = (msg: string) => this.db.appendSearchLog(projectId, "rerank", "guard", 0, "error", msg);
    const cnPoolForRank = ev.cnRecent.map((i) => ({ ...i, poolId: makePoolId(i) })).slice(0, POOL_CAP);
    const enPoolForRank = ev.enRecent.map((i) => ({ ...i, poolId: makePoolId(i) })).slice(0, POOL_CAP);
    const rrCn = await timed("池内重排（国内池）", () => rerankPool({ md, pool: cnPoolForRank, targetNote, resolver, onWarn: onRerankWarn, onProgress }));
    const rrEn = await timed("池内重排（国外池）", () => rerankPool({ md, pool: enPoolForRank, targetNote, resolver, onWarn: onRerankWarn, onProgress }));
    const results = [...rrCn.ranked.slice(0, ev.cnFound), ...rrEn.ranked.slice(0, ev.enFound)];
    const needMore = ev.needMore;
    const counts = { cnRequested, enRequested, cnFound: ev.cnFound, enFound: ev.enFound };
    const currentYearCount = results.filter((i) => Number(i.year) === currentYear).length;
    const yearReport = currentYearCount > 0 ? "；当年（" + currentYear + "）文献 " + currentYearCount + " 篇" : "；当年（" + currentYear + "）暂无文献（已如实报告）";
    const parts = ["检索完成：国内 " + ev.cnFound + "/" + cnRequested + "、国外 " + ev.enFound + "/" + enRequested + "（已排除 " + excludedCount + " 篇已搜寻文献；中文原始取回 " + rawCnPool.length + " 条、英文原始取回 " + rawEnPool.length + " 条、严格命中 " + (cnPool.length + enPool.length) + " 条" + yearReport + (round > 1 ? "；共 " + round + " 轮查询" : "") + "）"];
    if (rawCnPool.length === 0 && rawEnPool.length === 0) parts.push("全部真实数据源（知网/汉斯出版社/OpenAlex/Crossref）都未取回结果：可能网络异常或触发限流（429），请稍候 1-2 分钟再试");
    else if (needMore) parts.push("数量未达标（真实数据源尽力检索，未编造）；可点「AI 再次查询」补充，或按建议改写查询");
    if (rrCn.droppedForeignIds + rrEn.droppedForeignIds > 0) parts.push("重排白名单丢弃池外条目 " + (rrCn.droppedForeignIds + rrEn.droppedForeignIds) + " 条（已告警）");
    const rerankNotes = [rrCn.note, rrEn.note].filter(Boolean);
    if (rerankNotes.length > 0) parts.push(rerankNotes.join("；"));
    if (aiTimings.length > 0) {
      const totalS = Math.round(aiTimings.reduce((s, t) => s + t.ms, 0) / 1000);
      const detail = aiTimings.map((t) => t.label + " " + Math.round(t.ms / 1000) + "s").join("、");
      parts.push("AI 环节耗时 " + totalS + "s（" + detail + "）");
    }
    const cnNote = (cnkiOk ? "知网题录直抓成功（校园网/VPN 环境），已取回被引次数与核心期刊标记" : "知网题录直抓未成功（外网/风控/页面改版，未绕过验证码），已自动降级为跳转链接：请点击下方知网链接在官网检索后，通过「国内平台人工核验」导入本库") + "；中文真实取回另含 OpenAlex 中文子集、Crossref 与汉斯出版社（OA，DOI 前缀 10.12677）。境外数据源（汉斯出版社、Google Scholar、BASE）一律使用英文检索式（不直接用中文）：汉斯出版社论文已通过 Crossref（10.12677）真实取回并给出地址；Google Scholar 与 BASE 已生成英文检索式官网跳转链接（两者均无开放 API，BASE 开放接口需注册密钥）。语言只标记「中文/外文」，国内外归属需人工确认作者单位与出版地。" + (ev.yearNote ? "。" + ev.yearNote + "（如实报告）。" : "");
    return {
      ok: results.length > 0 || !needMore,
      message: parts.join("；"),
      queriesUsed,
      results,
      counts,
      verifyNote: "",
      needMore,
      excludedCount,
      roundsUsed: round,
      cnJumpLinks,
      foreignLinks,
      cnNote,
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
