import { CN_EN_TERM_DICT } from "../shared/literature";

/**
 * 外文检索式构建器（MCP 工具层的预留扩展口：纯函数 + 注入式模型解析器，不绑定任何单一模型）
 * 架构（用户要求）：
 * 1) 内置中英术语词典硬匹配 → 基底布尔检索式（确定性、零模型成本）
 * 2) 模型生成布尔逻辑检索式（AND/OR/引号短语，只做补全与逻辑组合，不做句子翻译）
 * 3) 适配层封装：解析器通过接口注入（当前为配置的「检索辅助」角色，任意服务商/模型可插拔）
 * 4) 校验与兜底：模型输出不符合检索式特征时回退词典结果
 */

export interface ForeignQueryResolver {
  generate(cnKeywords: string[]): Promise<string>;
}

/** 词典硬匹配：中文关键词 → 英文术语，多词引号短语 + AND 组合（提升精度） */
export function dictionaryBooleanQuery(cnKeywords: string[]): string | null {
  const terms = (cnKeywords ?? []).map((k) => String(k).trim()).filter(Boolean);
  const translated = terms.map((k) => CN_EN_TERM_DICT[k] ?? null).filter((t): t is string => Boolean(t));
  if (translated.length === 0) return null;
  const unique = [...new Set(translated)];
  const quoted = unique.map((t) => (t.includes(" ") ? "\"" + t + "\"" : t));
  return quoted.join(" AND ");
}

/** 校验模型输出的布尔检索式：拒绝句子翻译（系动词/论文套话特征），保留检索式特征 */
export function sanitizeBooleanQuery(raw: string): string | null {
  const cleaned = raw.trim().replace(/[。．；，,]/g, " ").replace(/\s+/g, " ").slice(0, 200);
  if (!/[a-zA-Z]{2,}/.test(cleaned)) return null;
  // 句子翻译特征（自然语言系动词/论文套话）一律拒绝，只保留检索式
  const looksLikeSentence = /\b(the|is|are|was|were|study|research|this|paper|will|can|should|studies|examines)\b/i.test(cleaned);
  if (looksLikeSentence) return null;
  return cleaned;
}

/** 可插拔模型布尔检索式生成 */
export async function modelBooleanQuery(resolver: ForeignQueryResolver, cnKeywords: string[]): Promise<string | null> {
  try {
    const raw = await resolver.generate(cnKeywords);
    return sanitizeBooleanQuery(raw);
  } catch {
    return null;
  }
}

/** 组合入口：词典硬匹配为基底；模型输出为精化（含布尔连接词才采纳，否则词典优先） */
export async function buildForeignQuery(cnKeywords: string[], resolver: ForeignQueryResolver | null): Promise<{ query: string; source: "dictionary" | "model" | "hybrid" } | null> {
  const base = dictionaryBooleanQuery(cnKeywords);
  if (!base) return null;
  if (!resolver) return { query: base, source: "dictionary" };
  const modelQuery = await modelBooleanQuery(resolver, cnKeywords);
  if (!modelQuery) return { query: base, source: "dictionary" };
  // 大写布尔连接词才算模型布尔检索式（小写 and/or 可能是自然语言残留）
  if (/\b(AND|OR|NOT)\b/.test(modelQuery)) {
    return { query: modelQuery, source: "model" };
  }
  return { query: base + " OR " + modelQuery, source: "hybrid" };
}
