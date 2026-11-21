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
import { ACADEMIC_SYNONYMS, CORE_CN_JOURNALS, MAJOR_PLATFORM_GROUPS, SEED_LIBRARY } from "../shared/literature";
import { buildForeignQuery, type ForeignQueryResolver } from "./query-builder";
import type { EvidenceCard, LiteratureItem, LiteratureSource, SearchLogEntry, SearchOutcome } from "../shared/literature";

export type LiteratureInput = Omit<LiteratureItem, "id" | "projectId" | "verifiedStatus" | "verifiedNote" | "fulltextStatus" | "pdfName" | "createdAt" | "updatedAt" | "refType" | "region"> & Partial<Pick<LiteratureItem, "refType" | "region">>;

export interface SaveOutcome {
  saved: boolean;
  message: string;
  item?: LiteratureItem;
  existing?: LiteratureItem;
}

const REAL_SOURCES: LiteratureSource[] = ["crossref", "openalex", "arxiv", "pubmed"];

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

/** 排序权重：核心期刊 > 被引数（汉斯系等 OA 平台默认低权重，需人工核验质量） */
function rankScore(item: { venue: string; citedBy?: number }): number {
  let score = 0;
  const venue = item.venue ?? "";
  if (CORE_CN_JOURNALS.some((j) => venue.includes(j))) score += 30;
  score += Math.min(20, Number(item.citedBy ?? 0));
  if (/汉斯|Hans|Operations Research and Fuzziology|E-Commerce Letters|Open Journal/i.test(venue)) score -= 5;
  return score;
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

  /** 一键自动找文献（双池架构）：
   *  国内池 = OpenAlex(language=zh) + Crossref 中文检索；国外池 = OpenAlex + Crossref 英文检索。
   *  双池独立计数；中文关键词多层扩词；国内不足时按 1/2 级扩容；3/4 级只给背景引用跳转链接（不计入配额）。
   *  真实检索不足时如实报告缺口，绝不编造或硬塞不相关文献。 */
  async autoSearch(projectId: string, opts?: { total?: number; cn?: number; en?: number; excludeDois?: string[]; preferredPlatforms?: string[]; openAccessOnly?: boolean; globalLibraries?: boolean }): Promise<{
    ok: boolean;
    message: string;
    queryUsed: string[];
    results: SearchOutcome["items"];
    counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number };
    cnNote?: string;
    preferredLinks?: Array<{ key: string; name: string; url: string }>;
    backgroundLinks?: Array<{ name: string; url: string }>;
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

    // 中文关键词（方向/摘要中的中文片段）与英文关键词（变量名）
    const cnKeywords: string[] = [];
    for (const text of [direction, candidatesField, abstract]) {
      for (const m of text.match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
        if (m.length >= 2 && !cnKeywords.includes(m)) cnKeywords.push(m);
      }
    }
    const enQueries: string[] = [];
    if (direction && /[a-zA-Z]{2,}/.test(direction)) enQueries.push(direction.split(/[，,；;\n。]/)[0].trim());
    const variablesJson = String(topic["variables"] ?? "").trim();
    if (variablesJson) {
      try {
        const v = JSON.parse(variablesJson) as Record<string, string[]>;
        const parts = [...(v.iv ?? []), ...(v.dv ?? []), ...(v.mediator ?? []), ...(v.custom ?? [])].map((s) => String(s).trim()).filter(Boolean);
        // 中文变量名 → 国内池关键词；拉丁字母变量名 → 国外池检索式
        for (const s of parts) {
          for (const m of String(s).match(/[\u4e00-\u9fa5]{2,}/g) ?? []) {
            if (m.length >= 2 && !cnKeywords.includes(m)) cnKeywords.push(m);
          }
        }
        const enParts = parts.filter((p) => /[a-zA-Z]{2,}/.test(p));
        if (enParts.length > 0) enQueries.push(enParts.join(" "));
      } catch { /* 忽略 */ }
    }
    if (abstract && /[a-zA-Z]{2,}/.test(abstract)) enQueries.push(abstract.slice(0, 120));

    const used: string[] = [];
    const seenKeys = new Set<string>();
    const seenTitles = new Set<string>();
    const cnResults: Array<SearchOutcome["items"][number] & { level?: string; citedBy?: number }> = [];
    const enResults: Array<SearchOutcome["items"][number] & { level?: string; citedBy?: number }> = [];

    const pushUnique = (pool: typeof cnResults, item: SearchOutcome["items"][number], level: string, citedBy: number) => {
      const key = item.doi || (item.title + "|" + item.authors);
      const normTitle = normalizeTitle(item.title);
      if (!key || seenKeys.has(key) || (normTitle && seenTitles.has(normTitle)) || exclude.has(item.doi)) return false;
      seenKeys.add(key);
      if (normTitle) seenTitles.add(normTitle);
      pool.push({ ...item, level, citedBy });
      return true;
    };

    const fetchPool = async (query: string, language: "zh" | "en" | "", pool: typeof cnResults, level: string) => {
      used.push(query);
      try {
        const [oa, cr] = await Promise.allSettled([
          openalexSearch(query, { language, rows: 20, signal: this.signalWithTimeout() }),
          crossrefSearch(query, this.settings.getContactEmail(), this.signalWithTimeout(), { rows: 20 }),
        ]);
        if (oa.status === "fulfilled" && oa.value.status !== "error") {
          for (const item of oa.value.items) {
            const typed = item as SearchOutcome["items"][number] & { citedBy: number };
            pushUnique(pool, item, level, Number(typed.citedBy ?? 0));
          }
        }
        if (cr.status === "fulfilled" && cr.value.status !== "error") {
          for (const item of cr.value.items) pushUnique(pool, item, level, Number((item as { citedBy?: number }).citedBy ?? 0));
        }
        this.db.appendSearchLog(projectId, "crossref+openalex", query, pool.length, "ok", "双池自动检索");
      } catch { /* 单个源失败不阻塞另一源 */ }
    };

    // 国外池缺少英文检索式时：词典硬匹配 + 可插拔模型布尔检索式（真实库检索，不编造文献）
    if (enQueries.length === 0 && cnKeywords.length > 0) {
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
      const built = await buildForeignQuery(cnKeywords.slice(0, 4), resolver);
      if (built) enQueries.push(built.query);
    }
    // 国外池
    for (const q of enQueries.slice(0, 3)) {
      if (enResults.length >= enRequested + 5) break;
      await fetchPool(q, "en", enResults, "core");
    }
    // 国内池：扩词逐级检索（不足再下一级）
    const expanded = expandQueries(cnKeywords.slice(0, 4));
    for (const e of expanded) {
      if (cnResults.length >= cnRequested + 5) break;
      await fetchPool(e.query, "zh", cnResults, e.level);
    }

    // 排序（核心期刊优先 + 被引数）
    cnResults.sort((a, b) => rankScore(b) - rankScore(a));
    enResults.sort((a, b) => rankScore(b) - rankScore(a));

    const cnFound = Math.min(cnRequested, cnResults.length);
    const enFound = Math.min(enRequested, enResults.length);
    const counts = { cnRequested, enRequested, cnFound, enFound };
    const cnSelected = cnResults.slice(0, cnFound);
    const enSelected = enResults.slice(0, enFound);
    const results = [...cnSelected, ...enSelected];

    // 3/4 级背景引用跳转（不计入配额，不混入学术文献）
    const bgKeywords = cnKeywords.slice(0, 2).join(" ") || direction.slice(0, 30);
    const bgQ = encodeURIComponent(bgKeywords);
    const backgroundLinks = [
      { name: "百度学术（跳转检索）", url: "https://xueshu.baidu.com/s?wd=" + bgQ },
      { name: "知网（跳转检索）", url: "https://kns.cnki.net/kns8s/defaultresult/index?kw=" + bgQ },
      { name: "万方（跳转检索）", url: "https://s.wanfangdata.com.cn/paper?q=" + bgQ },
      { name: "行业报告·艾瑞咨询", url: "https://www.iresearch.com.cn/search/?keyword=" + bgQ },
      { name: "行业报告·QuestMobile", url: "https://www.questmobile.com.cn/search?keyword=" + bgQ },
    ];

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

    // 如实报告缺口
    const gapCn = Math.max(0, cnRequested - cnFound);
    const gapEn = Math.max(0, enRequested - enFound);
    const levelSummary = (() => {
      const l1 = cnResults.filter((r) => r.level === "l1").length;
      const l2 = cnResults.filter((r) => r.level === "l2").length;
      return l1 + l2 > 0 ? "（其中 " + l1 + " 篇来自 1 级扩容、" + l2 + " 篇来自 2 级扩容，引用位置已标注）" : "";
    })();
    const parts: string[] = ["双池检索完成：国内 " + cnFound + "/" + cnRequested + "、国外 " + enFound + "/" + enRequested + levelSummary];
    if (gapCn > 0 || gapEn > 0) {
      parts.push("真实公开数据源不足的部分未硬凑：" + (gapCn > 0 ? "国内缺 " + gapCn + " 篇，" : "") + (gapEn > 0 ? "国外缺 " + gapEn + " 篇" : "") + "；请用下方背景引用链接与跳转检索补充，或手动录入核心文献");
    }
    const cnNote = "国内文献来自 OpenAlex 中文子集与 Crossref（知网/万方无公开 API，仅提供跳转检索）；3/4 级行业报告与政策文件只作背景引用，不计入学术文献配额";
    if (results.length === 0) {
      return { ok: false, message: parts.join("，") + "（真实检索 0 条）", queryUsed: used, results, counts, cnNote, preferredLinks, backgroundLinks };
    }
    return { ok: true, message: parts.join("，"), queryUsed: used, results, counts, cnNote, preferredLinks, backgroundLinks };
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
