import {
  ACADEMIC_SYNONYMS, CN_EN_TERM_DICT, FORBIDDEN_SUBJECT_EXPANSIONS,
  RESULT_WORD_DICT, RESULT_WORD_SUFFIX,
} from "../shared/literature";

/** 词典词表（同义词键 + 中英词典键），按长度降序做最长匹配切词 */
const SEG_DICT: string[] = (() => {
  const s = new Set<string>();
  for (const k of Object.keys(ACADEMIC_SYNONYMS)) { s.add(k); for (const x of ACADEMIC_SYNONYMS[k]) s.add(x); }
  for (const k of Object.keys(CN_EN_TERM_DICT)) s.add(k);
  return [...s].sort((a, b) => b.length - a.length);
})();

function SEGMENT_TERMS(text: string): string[] {
  let remaining = String(text ?? "");
  const out: string[] = [];
  while (remaining.length > 0 && out.length < 6) {
    let matched = false;
    for (const t of SEG_DICT) {
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

/** 核心词分类：主体词（自变量域）/ 结果词（因变量域，必选）/ 变量词（中介等） */
export interface TermClassification {
  subject: string[];
  result: string[];
  mediator: string[];
  subjectExpansions: string[];
  resultExpansions: string[];
}

/** 是否为结果词（词典精确 + 后缀启发式） */
export function isResultWord(term: string): boolean {
  if (RESULT_WORD_DICT.includes(term)) return true;
  return RESULT_WORD_SUFFIX.some((s) => term.length > s.length && term.endsWith(s));
}

/** 主体同义扩展：每个词衍生 3-4 个相关词；剔除禁止放宽的泛词与自身 */
export function expandSubject(term: string): string[] {
  // 只从同义词词典扩词；种子库术语绝不进入扩词（防止把其他选题的检索式带到本选题域）
  const banned = new Set(FORBIDDEN_SUBJECT_EXPANSIONS[term] ?? []);
  return (ACADEMIC_SYNONYMS[term] ?? []).filter((s) => !banned.has(s) && s !== term).slice(0, 4);
}

/** 结果同义扩展（结果词必须命中，只允许同层级同义词） */
export function expandResult(term: string): string[] {
  return (ACADEMIC_SYNONYMS[term] ?? []).slice(0, 3);
}

/** 从选题文本 + 变量 JSON 拆分主体/结果/变量词（变量优先，词典分类兜底） */
export function classifyTerms(topicText: string, variablesJson: string, segmented: string[]): TermClassification {
  let subject: string[] = [];
  let result: string[] = [];
  let mediator: string[] = [];
  try {
    const v = JSON.parse(variablesJson ?? "{}") as Record<string, string[]>;
    // 变量值也做词典切词（如「AI虚拟主播直播互动性」→「AI虚拟主播」「互动性」）
    const flat = (arr: string[] | undefined) => (arr ?? []).flatMap((s) => {
      const t = String(s).trim();
      if (!t) return [];
      const seg = SEGMENT_TERMS(t);
      return seg.length > 0 ? seg : [t];
    });
    subject = [...flat(v.iv), ...flat(v.custom)].filter((t) => !isResultWord(t));
    result = flat(v.dv);
    mediator = flat(v.mediator);
    const misplaced = subject.filter((t) => isResultWord(t));
    subject = subject.filter((t) => !isResultWord(t));
    result = [...result, ...misplaced];
  } catch { /* 无变量 JSON */ }
  if (subject.length === 0 || result.length === 0) {
    for (const t of segmented) {
      if (result.length === 0 && isResultWord(t)) result.push(t);
      else if (!isResultWord(t)) subject.push(t);
      else result.push(t);
    }
  }
  void topicText;
  return {
    subject: [...new Set(subject)].slice(0, 3),
    result: [...new Set(result)].slice(0, 3),
    mediator: [...new Set(mediator)].slice(0, 2),
    subjectExpansions: [...new Set(subject.flatMap(expandSubject))],
    resultExpansions: [...new Set(result.flatMap(expandResult))],
  };
}

export type QueryLevel = "L0" | "L1" | "L2" | "L3";

export interface PlannedQuery {
  level: QueryLevel;
  constraint: string;
  cnQuery: string | null;
  enQuery: string | null;
  countAsCore: boolean;
  citeNote: string;
}

/** 分层扩容（熔断：L0-L3 共 4 级，禁止继续放宽） */
export function planLevels(cls: TermClassification): PlannedQuery[] {
  const enOf = (t: string): string => {
    if (/[a-zA-Z]{2,}/.test(t)) return t;
    return CN_EN_TERM_DICT[t] ?? (ACADEMIC_SYNONYMS[t]?.[0] ? CN_EN_TERM_DICT[ACADEMIC_SYNONYMS[t][0]] ?? "" : "");
  };
  const cnAnd = (terms: string[]) => terms.filter(Boolean).join(" AND ");
  const enTerm = (t: string): string => (t.includes(" ") ? "\"" + t + "\"" : t);
  // OR 组作为一个整体（括号包裹），再与其余词 AND
  const enAnd = (terms: string[]) => terms.filter(Boolean).map((t) => (t.includes(" OR ") ? "(" + t.split(" OR ").map(enTerm).join(" OR ") + ")" : enTerm(t))).join(" AND ");
  const subjectEn = [...new Set(cls.subject.map(enOf).filter(Boolean))];
  const resultEn = [...new Set(cls.result.map(enOf).filter(Boolean))];
  const mediatorEn = [...new Set(cls.mediator.map(enOf).filter(Boolean))];
  const plans: PlannedQuery[] = [];
  plans.push({
    level: "L0",
    constraint: "主体词 AND 结果词 AND 变量词 全部命中",
    cnQuery: cnAnd([...cls.subject, ...cls.result, ...cls.mediator]),
    enQuery: enAnd([...subjectEn, ...resultEn, ...mediatorEn]) || null,
    countAsCore: true,
    citeNote: "核心文献·核心变量研究，正常引用",
  });
  plans.push({
    level: "L1",
    constraint: "主体词 AND 结果词 必中（去变量词）",
    cnQuery: cnAnd([...cls.subject, ...cls.result]),
    enQuery: enAnd([...subjectEn, ...resultEn]) || null,
    countAsCore: true,
    citeNote: "核心文献·核心变量研究，可正常引用",
  });
  if (cls.subjectExpansions.length > 0) {
    plans.push({
      level: "L2",
      constraint: "主体同义词扩展 AND 结果词 必中（禁止放宽主体为泛词）",
      cnQuery: cnAnd([cls.subjectExpansions.join(" OR "), ...cls.result]),
      enQuery: enAnd([cls.subjectExpansions.map(enOf).filter(Boolean).join(" OR "), ...resultEn]) || null,
      countAsCore: true,
      citeNote: "1/2级扩容·同概念不同表述，可正常引用",
    });
  }
  if (cls.result.length > 0) {
    // L3 理论补充：通用理论/机制词 + 结果词（不再硬编码任何具体领域，防止跨域跑偏）
    plans.push({
      level: "L3",
      constraint: "同理论场景补充（通用理论/机制词 AND 结果词）",
      cnQuery: cnAnd(["影响机制 OR 理论模型 OR 实证研究", ...cls.result]),
      enQuery: enAnd(["influencing mechanism OR theoretical model OR empirical study", ...resultEn]) || null,
      countAsCore: false,
      citeNote: "理论补充文献·支撑模型合理性，不计入核心配额",
    });
  }
  return plans;
}

/** ===== P1 第一层：规则硬过滤（毫秒级）=====
 *  标题必须同时命中「主体类词」和「结果类词」至少各一个（中英文分别判定）。 */
const RE_ESCAPE = /[.*+?^$\x7b\x7d()|[\]\\]/g;
export function hardFilterPass(title: string, cls: TermClassification, lang: "zh" | "en", level?: string): boolean {
  if (level === "L3") {
    // L3 理论补充：主体范围放宽为同理论场景词（结果词仍必中），不计核心配额
    const sceneZh = ["直播电商", "电商直播", "电子商务", "直播带货"];
    const sceneEn = ["live streaming", "e-commerce", "live commerce", "livestream"];
    const scene = lang === "zh" ? sceneZh : sceneEn;
    const result = lang === "zh" ? [...cls.result, ...cls.resultExpansions] : [...cls.result, ...cls.resultExpansions].map((x) => CN_EN_TERM_DICT[x] ?? x).map((x) => x.toLowerCase());
    const t = String(title ?? "");
    const hitScene = lang === "zh" ? scene.some((s) => t.includes(s)) : scene.some((s) => t.toLowerCase().includes(s));
    const hitResult = result.length === 0 ? true : result.some((r) => (lang === "zh" ? t.includes(r) : t.toLowerCase().includes(r)));
    return hitScene && hitResult;
  }
  const t = String(title ?? "");
  const mapEn = (x: string) => (CN_EN_TERM_DICT[x] ?? x).toLowerCase();
  const subjectTerms = lang === "zh" ? [...cls.subject, ...cls.subjectExpansions] : [...cls.subject, ...cls.subjectExpansions].map(mapEn);
  const resultTerms = lang === "zh" ? [...cls.result, ...cls.resultExpansions] : [...cls.result, ...cls.resultExpansions].map(mapEn);
  const hit = (terms: string[]): boolean => {
    if (lang === "zh") return terms.some((term) => t.includes(term));
    const lower = t.toLowerCase();
    return terms.some((term) => {
      if (term.includes(" ")) return lower.includes(term);
      return new RegExp("\\b" + term.replace(RE_ESCAPE, "\\$&") + "\\b", "i").test(lower);
    });
  };
  if (resultTerms.length === 0) return hit(subjectTerms);
  return hit(subjectTerms) && hit(resultTerms);
}

/** ===== P1 第二层：轻量语义相似度（本地纯 TS 字符 n-gram 余弦，零依赖、毫秒级）
 *  ===== 注：bge-small-zh ONNX 需原生运行时，暂以 n-gram 余弦近似（预留模型接入扩展口） */
export function ngramSimilarity(a: string, b: string, n = 2): number {
  const build = (text: string): Map<string, number> => {
    const s = String(text ?? "").toLowerCase().replace(/[^\u4e00-\u9fa5a-z0-9]/g, "");
    const m = new Map<string, number>();
    for (let i = 0; i + n <= s.length; i++) {
      const g = s.slice(i, i + n);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ma = build(a);
  const mb = build(b);
  if (ma.size === 0 || mb.size === 0) return 0;
  let dot = 0;
  for (const [g, c] of ma) dot += c * (mb.get(g) ?? 0);
  let na = 0;
  let nb = 0;
  for (const c of ma.values()) na += c * c;
  for (const c of mb.values()) nb += c * c;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 第二层过滤阈值（中文语义场景 0.6；外文池与短文本场景 0.35，阈值可调） */
export const SIMILARITY_THRESHOLD = 0.6;
export const SIMILARITY_THRESHOLD_EN = 0.3;

/** ===== P2：多维权重评分 =====
 *  相关度 60%（语义相似度 40 + 命中位置 20） + 质量 30%（核心期刊 > 普刊） + 引用 10%（仅参考） */
export function compositeScore(item: {
  similarity: number;
  subjectHitInTitle: boolean;
  resultHitInTitle: boolean;
  isCoreJournal: boolean;
  citedBy?: number;
}): number {
  const relevance = item.similarity * 40 + (item.subjectHitInTitle ? 10 : 0) + (item.resultHitInTitle ? 10 : 0);
  const quality = item.isCoreJournal ? 30 : 12;
  const citation = Math.min(10, Number(item.citedBy ?? 0) * 0.5);
  return relevance + quality + citation;
}
