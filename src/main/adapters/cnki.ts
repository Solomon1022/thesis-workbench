import { fetch } from "undici";
import type { SearchOutcome } from "../../shared/literature";
import { rankJournal } from "../../shared/journal-rank";

/**
 * 知网（CNKI）题录直抓适配器。
 * 合规边界（用户确认）：只抓检索页「题录列表」（标题/作者/期刊/年份/摘要/被引/核心标记），
 * 不绕验证码、不批量下载全文；抓取失败（外网、IP 风控、页面改版）由调用方自动降级为跳转链接。
 * 知网无开放接口：桌面检索页 kns8s 为服务端渲染 + 异步题录接口，解析采用多策略容错，
 * 页面改版导致解析失败时如实报错并降级，绝不编造题录。
 */

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const REAL_BASE = "https://kns.cnki.net";

/** 测试环境可用 TWB_CNKI_BASE 指向本地模拟服务；正常环境固定知网官方地址。 */
export function cnkiBase(): string {
  if (process.env.NODE_ENV === "test" && process.env.TWB_CNKI_BASE) return process.env.TWB_CNKI_BASE;
  return REAL_BASE;
}
const BASE = REAL_BASE;

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function firstMatch(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? stripHtml(m[1] ?? "") : "";
}

/** 解析 kns8s 结果表格（结构变化时多种策略兜底；解析不出就返回空数组 → 调用方降级） */
function parseKnsRows(html: string): Array<Record<string, string>> {
  const rowHtmls: string[] = [];
  const resultTr = /<tr[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = resultTr.exec(html))) rowHtmls.push(m[1] ?? "");
  if (rowHtmls.length === 0) {
    const anyTr = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    while ((m = anyTr.exec(html))) {
      const cell = m[1] ?? "";
      if (/<a[^>]*>/.test(cell) && !/<th[^>]*>/.test(cell)) rowHtmls.push(cell);
    }
  }
  const rows: Array<Record<string, string>> = [];
  for (const cell of rowHtmls.slice(0, 25)) {
    let title = firstMatch(cell, /<a[^>]*class="[^"]*fz14[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!title) {
      const href = firstMatch(cell, /<a[^>]*href="([^"]*Detail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const href2 = firstMatch(cell, /<a[^>]*href="([^"]*kcms[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
      const a = firstMatch(cell, /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
      title = href || href2 || a;
    }
    if (!title) continue;
    const link = firstMatch(cell, /href="([^"]*(?:kcms|Detail)[^"]*)"/i);
    const authors = firstMatch(cell, /<td[^>]*class="[^"]*author[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const sourceCell = firstMatch(cell, /<td[^>]*class="[^"]*source[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const dateCell = firstMatch(cell, /<td[^>]*class="[^"]*date[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const abstractCell = firstMatch(cell, /<(?:td|div)[^>]*class="[^"]*(?:abstract|data)[^"]*"[^>]*>([\s\S]*?)<\/(?:td|div)>/i);
    const year = (dateCell.match(/\d{4}/) ?? [""])[0];
    const quote = firstMatch(cell, /<td[^>]*class="[^"]*quote[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const cited = (quote.match(/(\d+)/) ?? (stripHtml(cell).match(/被引[^0-9]*(\d+)/) ?? []))[1] ?? "";
    const coreBadge = /北大核心|CSSCI|cssci/i.test(stripHtml(cell)) ? (cell.match(/(北大核心|CSSCI)/i) ?? [])[1] ?? "" : "";
    rows.push({ title, link, authors, venue: sourceCell, year, abstract: abstractCell, cited, coreBadge });
  }
  return rows;
}

function looksBlocked(html: string): boolean {
  return html.length < 3000 && /安全验证|verify|验证|challenge|forbidden|robot/i.test(html);
}

/** 知网题录直抓：成功返回真实题录；失败抛错由调用方降级为跳转链接。 */
export async function cnkiSearch(query: string, signal?: AbortSignal, rows = 20): Promise<SearchOutcome> {
  const q = query.trim();
  if (!q) throw new Error("知网检索式为空");
  const base = cnkiBase();
  const headers = {
    "User-Agent": UA,
    "Referer": base + "/kns8s/defaultresult/index",
    "Accept": "text/html,application/json,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9",
  };
  let html = "";
  let lastErr = "";
  try {
    const body = new URLSearchParams();
    body.set("classid", "WD0FTY92");
    body.set("searchType", "1");
    body.set("pagename", "ASP.brief_result_aspx");
    body.set("kw", q);
    body.set("korder", "SU");
    body.set("curpage", "1");
    body.set("RecordCount", String(rows));
    body.set("pageNum", "1");
    const resp = await fetch(base + "/kns8s/brief/grid", {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal,
    });
    if (!resp.ok) throw new Error("知网题录接口返回 HTTP " + resp.status);
    html = await resp.text();
    if (looksBlocked(html)) throw new Error("知网返回安全验证页（当前网络环境被风控，未尝试绕过）");
  } catch (e) {
    lastErr = e instanceof Error ? e.message : String(e);
    try {
      const resp = await fetch(base + "/kns8s/defaultresult/index?kw=" + encodeURIComponent(q) + "&korder=SU", { headers, signal });
      if (!resp.ok) throw new Error("知网检索页返回 HTTP " + resp.status);
      html = await resp.text();
      if (looksBlocked(html)) throw new Error("知网返回安全验证页（当前网络环境被风控，未尝试绕过）");
      lastErr = "";
    } catch (e2) {
      lastErr = e2 instanceof Error ? e2.message : String(e2);
    }
  }
  const rowsParsed = parseKnsRows(html);
  const items = rowsParsed.map((r) => {
    const title = r.title;
    const venue = r.venue.replace(/^来源[:：]\s*/, "").split(/\s{2,}/)[0] ?? "";
    return {
      title,
      authors: r.authors,
      year: r.year,
      venue,
      doi: "",
      url: r.link ? (r.link.startsWith("http") ? r.link : base + r.link) : (base + "/kns8s/defaultresult/index?kw=" + encodeURIComponent(q)),
      abstract: r.abstract,
      source: "cnki" as const,
      preprint: false,
      refType: "journal" as const,
      region: "domestic" as const,
      language: "中文",
      citedBy: r.cited ? Number(r.cited) : undefined,
      journalRank: rankJournal(venue, r.coreBadge),
    };
  }).filter((i) => i.title);
  if (items.length === 0) {
    throw new Error(lastErr || "知网返回页面中未解析到题录（页面结构可能已改版，未编造结果）");
  }
  return {
    source: "cnki",
    query: q,
    searchedAt: Date.now(),
    status: "ok",
    message: "",
    items,
  };
}
