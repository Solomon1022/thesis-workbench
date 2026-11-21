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
  object?: string[];
  english?: Record<string, string>;
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
    const flat = (arr: string[] | undefined) => (Array.isArray(arr) ? arr : []).flatMap((s) => {
      const t = String(s).trim();
      if (!t) return [];
      const seg = SEGMENT_TERMS(t);
      return [t, ...seg];
    });
    subject = [...flat(v.iv), ...flat(v.custom)];
    result = flat(v.dv);
    mediator = flat(v.mediator);
    const misplaced = subject.filter((t) => isResultWord(t));
    subject = subject.filter((t) => !isResultWord(t));
    result = [...result, ...misplaced];
  } catch { /* 无变量 JSON */ }
  const all = [...new Set([...segmented, ...SEGMENT_TERMS(topicText)])];
  const generic = new Set(["消费者", "大学生", "员工", "影响因素", "实证研究", "中介效应", "调节效应", "结构方程模型"]);
  const topicLead = String(topicText ?? "").split(/[；;\n]/)[0]?.split(/的|对|与|研究|影响/)[0]?.trim() ?? "";
  // 只把中文短句当作单一研究对象；英文/纯空格关键词串按词切分，避免整串被当成必中的短语。
  const isCjkLead = /[\u3400-\u9fff]/.test(topicLead);
  const object = [...new Set([
    ...SEGMENT_TERMS(topicLead),
    ...(isCjkLead && topicLead.length >= 2 && topicLead.length <= 60 ? [topicLead] : []),
  ])].filter(t => !isResultWord(t) && !generic.has(t) && !mediator.includes(t));
  if (result.length === 0) result = all.filter(isResultWord);
  if (subject.length === 0) subject = all.filter(t => !isResultWord(t) && !generic.has(t) && !mediator.includes(t));
  return {
    object: [...new Set(object)].slice(0, 3),
    subject: [...new Set(subject)].slice(0, 6),
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

/** 中英文对译：含 AI 的中文仍须对译。 */
export function englishTerm(term: string, cls?: TermClassification): string {
  const direct = cls?.english?.[term] ?? CN_EN_TERM_DICT[term];
  if (direct) return direct;
  if (!/[\u3400-\u9fff]/.test(term) && /[a-z]/i.test(term)) return term;
  const parts = SEGMENT_TERMS(term).map(t => CN_EN_TERM_DICT[t]).filter(Boolean);
  return [...new Set(parts)].join(' ');
}
export function conceptAliases(terms: string[], lang: 'zh' | 'en', cls: TermClassification): string[] {
  return [...new Set(terms.flatMap(t => [t, ...expandSubject(t)]).map(t => lang === 'zh' ? t : englishTerm(t, cls)).filter(Boolean))];
}
/** 各层保留对象，仅去除可选属性和中介。 */
export function planLevels(cls: TermClassification): PlannedQuery[] {
  const anchor = cls.object?.length ? cls.object : cls.subject;
  const group = (terms: string[], lang: 'zh' | 'en', expand = true) => {
    const aliases = expand ? conceptAliases(terms, lang, cls).slice(0, 6) : terms.map(t => lang === 'zh' ? t : englishTerm(t, cls)).filter(Boolean);
    const quoted = [...new Set(aliases)].map(t => '"' + t.replace(/"/g, '') + '"');
    return quoted.length > 1 ? '(' + quoted.join(' OR ') + ')' : quoted[0] ?? '';
  };
  const make = (level: QueryLevel, extra: string[]): PlannedQuery => {
    const query = (lang: 'zh' | 'en') => {
      if (lang === 'en' && (!anchor.every(t => englishTerm(t, cls)) || (cls.result.length > 0 && !cls.result.every(t => englishTerm(t, cls))))) return null;
      return [group(anchor, lang, level === 'L2'), group(cls.result, lang, level === 'L2'), ...extra.map(t => group([t], lang, false))].filter(Boolean).join(' AND ') || null;
    };
    return {level, constraint:'保留研究对象和结果，逐层去除可选条件', cnQuery:query('zh'), enQuery:query('en'), countAsCore:true, citeNote:'主题候选，仍需阅读核验'};
  };
  const attrs = cls.object?.length ? cls.subject.filter(t => !anchor.includes(t)).slice(0, 1) : [];
  const theoryZh = ['理论模型', '实证研究', '机制', '方法'];
  const theoryEn = ['theoretical model', 'empirical study', 'mechanism', 'method'];
  const l3Query = (lang: 'zh' | 'en') => {
    const theory = lang === 'zh' ? theoryZh : theoryEn;
    const result = cls.result.map(t => lang === 'zh' ? t : englishTerm(t, cls)).filter(Boolean);
    return '(' + theory.map(t => '"' + t + '"').join(' OR ') + ') AND ' + result.map(t => '"' + t + '"').join(' AND ');
  };
  return [
    make('L0', [...attrs, ...cls.mediator.slice(0, 1)]),
    make('L1', []),
    make('L2', []),
    { level: 'L3', constraint: '理论/机制/方法补充，结果词仍需命中', cnQuery: l3Query('zh'), enQuery: l3Query('en'), countAsCore: false, citeNote: '理论/方法参考，独立展示，不计核心配额' },
  ];
}
/** 仅概念词面命中，不是语义概率。支持英文复数和连字符。 */
export function matchConcept(text: string, terms: string[], lang: 'zh' | 'en', cls: TermClassification): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const hay = ' ' + normalize(text) + ' ';
  return conceptAliases(terms, lang, cls).some(term => {
    if (lang === 'zh' && /[\u3400-\u9fff]/.test(term)) return text.toLowerCase().includes(term.toLowerCase());
    const words = normalize(term).split(' ').filter(Boolean);
    if (!words.length) return false;
    const pattern = words.map(w => w + '(?:s|es)?').join('\\s+');
    return new RegExp('(?:^|\\s)' + pattern + '(?=\\s|$)', 'i').test(hay);
  });
}
export function hardFilterPass(text: string, cls: TermClassification, lang: 'zh' | 'en', level?: string): boolean {
  const anchor = cls.object?.length ? cls.object : cls.subject;
  const resultHit = cls.result.length === 0 || matchConcept(text, cls.result, lang, cls);
  if (level === 'L3') return resultHit && matchConcept(text, ['理论模型', '模型', '机制', '方法', '实证研究', 'theoretical model', 'empirical study', 'mechanism', 'method', 'mediation'], lang, cls);
  return matchConcept(text, anchor, lang, cls) && resultHit;
}

/** ===== P1 第二层：字符 n-gram 余弦相似度（本地纯 TS，零依赖、毫秒级）
 *  ===== 仅作初步排序/过滤，不是语义判定；真正的语义相关度需阅读核验或接入语义模型 */
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

/** 第二层过滤阈值（字符 n-gram 初筛；中文 0.6，外文/短文本 0.3，阈值可调） */
export const SIMILARITY_THRESHOLD = 0.6;
export const SIMILARITY_THRESHOLD_EN = 0.3;

/** ===== P2：多维权重评分 =====
 *  相关度 60%（字符相似度 40 + 命中位置 20） + 质量 30%（核心期刊 > 普刊） + 引用 10%（仅参考） */
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
