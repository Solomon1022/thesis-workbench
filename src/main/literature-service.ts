import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { crossrefByDoi, crossrefSearch } from "./adapters/crossref";
import { arxivSearch } from "./adapters/arxiv";
import { pubmedSearch } from "./adapters/pubmed";
import { normalizeDoi, normalizeTitle } from "../shared/bibparse";
import type { EvidenceCard, LiteratureItem, LiteratureSource, SearchLogEntry, SearchOutcome } from "../shared/literature";

export type LiteratureInput = Omit<LiteratureItem, "id" | "projectId" | "verifiedStatus" | "verifiedNote" | "fulltextStatus" | "pdfName" | "createdAt" | "updatedAt" | "refType" | "region"> & Partial<Pick<LiteratureItem, "refType" | "region">>;

export interface SaveOutcome {
  saved: boolean;
  message: string;
  item?: LiteratureItem;
  existing?: LiteratureItem;
}

const REAL_SOURCES: LiteratureSource[] = ["crossref", "arxiv", "pubmed"];

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

  /** 一键自动找文献：按总数/国内/国外篇数推导检索式，跑真实 Crossref；排除已保存与历史推荐的 DOI，保证再次检索得到不同结果。 */
  async autoSearch(projectId: string, opts?: { total?: number; cn?: number; en?: number; excludeDois?: string[] }): Promise<{
    ok: boolean;
    message: string;
    queryUsed: string[];
    results: SearchOutcome["items"];
    counts?: { cnRequested: number; enRequested: number; cnFound: number; enFound: number };
    cnNote?: string;
  }> {
    const total = Math.min(30, Math.max(1, opts?.total ?? 15));
    const cnRequested = Math.min(total, Math.max(0, opts?.cn ?? 0));
    const enRequested = total - cnRequested;
    const exclude = new Set((opts?.excludeDois ?? []).map((d) => d.trim()).filter(Boolean));
    const detail = this.db.getProjectDetail(projectId);
    const topic = detail.content["topic"] ?? {};
    const design = detail.content["design"] ?? {};
    const direction = String(topic["direction"] ?? "").trim();
    const candidatesField = String(topic["candidates"] ?? "").trim();
    const abstract = String(design["abstract"] ?? "").trim();

    // 国外检索式（英文与变量组合）
    const enQueries: string[] = [];
    if (direction) enQueries.push(direction.split(/[，,；;\n。]/)[0].trim());
    const variablesJson = String(topic["variables"] ?? "").trim();
    if (variablesJson) {
      try {
        const v = JSON.parse(variablesJson) as Record<string, string[]>;
        const parts = [...(v.iv ?? []), ...(v.dv ?? []), ...(v.mediator ?? [])].map((s) => String(s).trim()).filter(Boolean);
        if (parts.length > 0) enQueries.push(parts.join(" "));
      } catch { /* 忽略非 JSON */ }
    }
    if (abstract) enQueries.push(abstract.slice(0, 120));

    // 国内检索式（中文关键词；Crossref 中文覆盖有限，如实说明）
    const cnTokens: string[] = [];
    for (const text of [direction, candidatesField, abstract]) {
      const matches = text.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
      for (const m of matches) {
        const t = m.trim();
        if (t.length >= 2 && !cnTokens.includes(t)) cnTokens.push(t);
      }
    }
    cnTokens.sort((a, b) => b.length - a.length);
    const cnQueries = cnTokens.slice(0, 2).map((t) => t.slice(0, 40));
    const cnNote = cnRequested > 0 && cnQueries.length === 0
      ? "项目里没有可用的中文关键词：国内文献请在下方的「检索与核验」或「手动录入」中补充（Crossref 对中文文献覆盖有限）"
      : undefined;

    const used: string[] = [];
    const results: SearchOutcome["items"] = [];
    const seen = new Set<string>();
    let cnFound = 0;
    let enFound = 0;
    let lastError = "";

    const fetchOne = async (q: string) => {
      used.push(q);
      try {
        const outcome = await crossrefSearch(q, this.settings.getContactEmail(), this.signalWithTimeout(), { rows: 20 });
        if (outcome.status === "error") { lastError = outcome.message; return; }
        for (const item of outcome.items) {
          const key = item.doi || item.title;
          if (!key || seen.has(key) || exclude.has(item.doi)) continue;
          seen.add(key);
          results.push(item);
        }
        this.db.appendSearchLog(projectId, "crossref", q, results.length, "ok", "自动检索");
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    };

    for (const q of enQueries) {
      if (enFound >= enRequested) break;
      const before = results.length;
      await fetchOne(q);
      enFound += results.length - before;
      if (results.length >= total) break;
    }
    for (const q of cnQueries) {
      if (cnFound >= cnRequested || results.length >= total) break;
      const before = results.length;
      await fetchOne(q);
      cnFound += results.length - before;
    }

    const counts = { cnRequested, enRequested, cnFound, enFound };
    if (results.length === 0) {
      return { ok: false, message: "自动检索没有返回结果（真实 Crossref）" + (lastError ? "：" + lastError : ""), queryUsed: used, results, counts, cnNote };
    }
    const parts = ["自动检索完成：共 " + results.length + " 条真实文献"];
    if (cnRequested > 0) parts.push("国内 " + cnFound + "/" + cnRequested);
    parts.push("国外 " + enFound + "/" + enRequested);
    parts.push("（已排除已保存与历史推荐的文献，再次检索会得到不同结果）");
    return { ok: true, message: parts.join("，"), queryUsed: used, results: results.slice(0, total), counts, cnNote };
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

  /** 手动录入辅助：AI 检索——从用户粘贴的参考文献引用中提取检索式并跑真实 Crossref，
   *  返回可核验的候选题录（含 DOI 与链接）。未配置检索辅助角色时退化为直接用引文检索。 */
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
      // 退化：取引文中的标题片段（第一个句号之后、[J]/[D]/[C]/[M] 之前）
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

  /** 保存文献：DOI 与归一化标题去重；真实来源自动标「已核验」，其余默认「待核验」。 */  /** 保存文献：DOI 与归一化标题去重；真实来源自动标「已核验」，其余默认「待核验」。 */
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
