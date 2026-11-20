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

export type LiteratureInput = Omit<LiteratureItem, "id" | "projectId" | "verifiedStatus" | "verifiedNote" | "fulltextStatus" | "pdfName" | "createdAt" | "updatedAt">;

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

  /** 一键自动找文献：从选题、变量与研究设计中推导检索式，直接跑真实 Crossref 并给出文献地址。 */
  async autoSearch(projectId: string): Promise<{ ok: boolean; message: string; queryUsed: string[]; results: SearchOutcome["items"] }> {
    const detail = this.db.getProjectDetail(projectId);
    const topic = detail.content["topic"] ?? {};
    const design = detail.content["design"] ?? {};
    const queries: string[] = [];
    const direction = String(topic["direction"] ?? "").trim();
    if (direction) queries.push(direction.split(/[，,；;\n。]/)[0].trim());
    const variablesJson = String(topic["variables"] ?? "").trim();
    if (variablesJson) {
      try {
        const v = JSON.parse(variablesJson) as Record<string, string[]>;
        const parts = [...(v.iv ?? []), ...(v.dv ?? []), ...(v.mediator ?? [])].map((s) => String(s).trim()).filter(Boolean);
        if (parts.length > 0) queries.push(parts.join(" "));
      } catch { /* 忽略非 JSON */ }
    }
    const abstract = String(design["abstract"] ?? "").trim();
    if (abstract) queries.push(abstract.slice(0, 120));
    const candidatesField = String(topic["candidates"] ?? "").trim();
    if (candidatesField) queries.push(candidatesField.split(/[。\n]/)[0].trim().slice(0, 120));
    const used = queries.map((q) => q.trim()).filter((q) => q.length > 2).slice(0, 3);
    if (used.length === 0) {
      return { ok: false, message: "还没有可用的选题信息：请先在「前期检索与选题」填写研究方向或变量，或在「研究问题与设计」填写摘要", queryUsed: [], results: [] };
    }
    const seen = new Set<string>();
    const results: SearchOutcome["items"] = [];
    let lastError = "";
    for (const q of used) {
      try {
        const outcome = await crossrefSearch(q, this.settings.getContactEmail(), this.signalWithTimeout());
        if (outcome.status === "error") { lastError = outcome.message; continue; }
        for (const item of outcome.items) {
          const key = item.doi || item.title;
          if (key && !seen.has(key)) {
            seen.add(key);
            results.push(item);
          }
          if (results.length >= 15) break;
        }
        this.db.appendSearchLog(projectId, "crossref", q, results.length, "ok", "自动检索");
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      if (results.length >= 15) break;
    }
    if (results.length === 0) {
      return { ok: false, message: "自动检索没有返回结果（真实 Crossref）" + (lastError ? "：" + lastError : ""), queryUsed: used, results: [] };
    }
    return { ok: true, message: "自动检索完成：基于" + used.length + " 条检索式，共找到 " + results.length + " 条真实文献（已按 DOI 去重）", queryUsed: used, results };
  }

  /** 保存文献：DOI 与归一化标题去重；真实来源自动标「已核验」，其余默认「待核验」。 */
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
