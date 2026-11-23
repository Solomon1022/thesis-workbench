/**
 * 直聊 AI 结果回填解析器：把豆包/DeepSeek/Kimi 等直聊 AI 返回的文献文本
 * 解析成候选条目（标题/作者/年份/期刊/DOI）。解析只做「提取」，真实性由
 * 后续的真实数据源核验保证；解析不出来的不入库，绝不编造。
 */

export interface AiLitCandidate {
  title: string;
  authors: string;
  year: string;
  venue: string;
  doi: string;
  refType: "journal" | "thesis" | "conference" | "other";
  /** 解析置信度：高=标准 GB/T 7714 行或带 DOI；低=自由文本行 */
  confidence: "high" | "low";
}

const DOI_RE = /(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i;
const YEAR_RE = /(?:19|20)\d{2}/;

function clean(s: string): string {
  return String(s ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1") // Markdown 加粗
    .replace(/\u0060+/g, "") // 反引号代码标记
    .replace(/^\s*[-*•]\s*/, "")
    .replace(/^\s*\d+[.、)]\s*/, "") // 编号 1. 2、 3)
    .replace(/\s+/g, " ")
    .trim();
}

function typeOf(t: string): AiLitCandidate["refType"] {
  const u = t.toUpperCase();
  if (u.startsWith("D")) return "thesis";
  if (u.startsWith("C")) return "conference";
  if (u.startsWith("J")) return "journal";
  return "other";
}

/** 标准 GB/T 7714 行：作者. 题名[J]. 刊名, 年... 或 作者. 题名[D]. 学校, 年... */
function fromGbt(line: string): AiLitCandidate | null {
  const m = line.match(/^(.+?)\.\s*(.+?)\[([JDCMNR])(?:\/OL)?\]\.?(.*)$/i);
  if (!m) return null;
  const authors = m[1].trim();
  const title = m[2].trim();
  const rest = m[4] ?? "";
  const year = rest.match(YEAR_RE)?.[0] ?? "";
  const venue = rest.replace(YEAR_RE, "").replace(/^[\s,，.．:：]+/, "").replace(/[\s,，.．:：]+$/, "").split(/[,，;；]/)[0]?.trim() ?? "";
  if (!title || title.length < 4 || title.length > 300) return null;
  return { title, authors, year, venue, doi: rest.match(DOI_RE)?.[1] ?? "", refType: typeOf(m[3]), confidence: "high" };
}

/** 带 DOI 的行：从 DOI 前后拆出标题/年份 */
function fromDoiLine(line: string): AiLitCandidate | null {
  const doi = line.match(DOI_RE)?.[1];
  if (!doi) return null;
  const before = line.slice(0, line.indexOf(doi)).replace(/[\s|｜,，;；:：.。]+$/g, "").trim();
  const title = before.length >= 4 && before.length <= 300 ? before : "";
  const year = line.match(YEAR_RE)?.[0] ?? "";
  if (!title) return null;
  return { title, authors: "", year, venue: "", doi, refType: "journal", confidence: "high" };
}

/** 管道分隔行：标题 | 作者 | 年 | 期刊（与程序导出 MD 的文献行一致） */
function fromPipeLine(line: string): AiLitCandidate | null {
  if (!line.includes("|")) return null;
  const parts = line.split(/\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const title = parts[0];
  if (title.length < 4 || title.length > 300) return null;
  const doi = line.match(DOI_RE)?.[1] ?? "";
  const year = parts.map((p) => p.match(/^(?:19|20)\d{2}$/)).find((m) => m)?.[0] ?? "";
  const authors = parts.length >= 3 && !/^(?:19|20)\d{2}$/.test(parts[1]) ? parts[1] : "";
  const venue = parts.find((p) => p !== title && p !== authors && p !== year && !p.includes("DOI") && !p.startsWith("http")) ?? "";
  return { title, authors, year, venue, doi, refType: "journal", confidence: "high" };
}

/** 自由文本行兜底：整行当标题；必须含年份或 DOI（过滤「以下是…」「为您找到…」等引导句） */
function fromFreeLine(line: string): AiLitCandidate | null {
  const doi = line.match(DOI_RE)?.[1] ?? "";
  const year = line.match(YEAR_RE)?.[0] ?? "";
  if (!doi && !year) return null;
  const title = line.replace(DOI_RE, "").replace(/https?:\/\/\S+/g, "").replace(/[\s|｜,，;；]+$/g, "").trim();
  if (title.length < 6 || title.length > 300) return null;
  if (!/[\u4e00-\u9fa5]|[a-zA-Z]{4}/.test(title)) return null;
  return { title, authors: "", year, venue: "", doi, refType: "other", confidence: "low" };
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fa5]/g, "");

/** 解析直聊 AI 回复文本 → 候选条目（去重，最多 50 条） */
export function parseAiLiterature(text: string): AiLitCandidate[] {
  const raw = String(text ?? "").replace(/\r/g, "");
  const lines = raw.split(/\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const out: AiLitCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: AiLitCandidate | null) => {
    if (!c) return;
    const key = normTitle(c.title) || c.doi;
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = clean(lines[i]);
    if (line.length < 6) continue;
    // 每行独立解析：直聊 AI 的文献列表几乎都是一条一行，合并相邻行会误吞条目（实测会丢掉一半）
    push(fromGbt(line) ?? fromPipeLine(line) ?? fromDoiLine(line) ?? fromFreeLine(line));
    if (out.length >= 50) break;
  }
  return out;
}
