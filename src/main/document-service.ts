import { existsSync, statSync, writeFileSync } from "node:fs";
import { BrowserWindow, dialog } from "electron";
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { ThesisDB } from "./db";
import { STAGES } from "../shared/stages";
import { LITERATURE_SOURCE_LABEL, VERIFIED_STATUS_LABEL } from "../shared/literature";
import { fieldsFor, METHOD_TEMPLATES } from "../shared/templates";

export interface DocData {
  title: string;
  abstract: string;
  keywords: string;
  projectName: string;
  methodLabel: string;
  designSections: Array<{ title: string; items: Array<{ label: string; value: string }> }>;
  hypotheses: Array<{ number: string; statement: string; iv: string; dv: string; basis: string }>;
  bodySections: Array<{ title: string; content: string }>;
  analysisSections: Array<{ title: string; rows: Array<Array<string>> }>;
  references: Array<{ line: string; note: string }>;
  reviewLog: Array<{ status: string; stage: string; content: string; resolution: string }>;
}

/** 阶段 6 文档导出：内容全部来自当前项目真实数据；不支持的排版能力在界面与文档中明确标注。 */
export class DocumentService {
  constructor(private db: ThesisDB) {}

  /** 汇总真实内容为文档数据。 */
  buildDocData(projectId: string): DocData {
    const detail = this.db.getProjectDetail(projectId);
    const p = detail.project;
    const content = detail.content;
    const writing = content["writing"] ?? {};
    const title = (writing["title"] ?? "").trim() || p.name;
    const methodLabel = METHOD_TEMPLATES[p.researchMethod]?.label ?? p.researchMethod;

    // 研究设计：设计阶段字段（用模板中文标签）
    const designSections: DocData["designSections"] = [];
    const designFields = this.db.getProjectDetail(projectId).content["design"] ?? {};
    const designLabelMap = new Map(fieldsFor(p.researchMethod, "design").fields.map((f) => [f.key, f.label]));
    const designItems = Object.entries(designFields)
      .filter(([, v]) => String(v ?? "").trim() !== "")
      .map(([k, v]) => ({ label: designLabelMap.get(k) ?? k, value: String(v) }));
    if (designItems.length > 0) {
      designSections.push({ title: "研究设计", items: designItems });
    }

    const hypotheses = this.db.listHypotheses(projectId);

    // 正文：写作阶段草稿按段落分块
    const draft = (writing["draft"] ?? "").trim();
    const bodySections: DocData["bodySections"] = [];
    if (draft) {
      const paragraphs = draft.split(/\n{2,}/).map((s) => s.trim()).filter((s) => s.length > 0);
      const chunkSize = 6;
      for (let i = 0; i < paragraphs.length; i += chunkSize) {
        const part = paragraphs.slice(i, i + chunkSize);
        bodySections.push({ title: i === 0 ? "正文草稿" : "正文草稿（续）", content: part.join("\n\n") });
      }
    }

    // 分析结果：真实运行记录 → 文本表格
    const analysisSections: DocData["analysisSections"] = [];
    const runs = this.db.listAnalysisRuns(projectId);
    for (const run of runs) {
      if (run.status !== "ok") continue;
      const rows: Array<Array<string>> = [];
      rows.push(["方法", run.method]);
      if (run.formula) rows.push(["公式", run.formula]);
      if (run.message) rows.push(["说明", run.message]);
      let results: unknown = null;
      try { results = JSON.parse(run.resultsJson); } catch { /* ignore */ }
      if (results && typeof results === "object") {
        if (run.method === "descriptive") {
          const table = (results as { table?: Record<string, { n: number; missing: number; mean: number; sd: number; median: number; min: number; max: number }> }).table ?? {};
          for (const [name, d] of Object.entries(table)) {
            rows.push([name, "n=" + d.n + " 缺失=" + d.missing + " 均值=" + d.mean.toFixed(3) + " 标准差=" + d.sd.toFixed(3) + " 中位数=" + d.median + " 范围=" + d.min + "~" + d.max]);
          }
        } else if (run.method === "cronbach") {
          const a = results as { alpha: number; nItems: number; nCases: number };
          rows.push(["Cronbach α", Number.isFinite(a.alpha) ? a.alpha.toFixed(4) + "（题项 " + a.nItems + "，完整观测 " + a.nCases + "）" : "无法计算"]);
        } else if (run.method === "regression") {
          const r = results as { dv: string; predictors: string[]; n: number; rSquared: number; adjRSquared: number; residualSd: number; coefficients: Array<{ term: string; estimate: number; se: number; t: number; p: number }> };
          rows.push(["模型", r.dv + " ~ " + r.predictors.join(" + ") + "（n=" + r.n + "）"]);
          rows.push(["R² / 调整R² / 残差SD", r.rSquared.toFixed(4) + " / " + r.adjRSquared.toFixed(4) + " / " + r.residualSd.toFixed(4)]);
          for (const c of r.coefficients) {
            rows.push([c.term, c.estimate.toFixed(4) + "（SE " + c.se.toFixed(4) + "，t=" + c.t.toFixed(3) + "，p=" + (Number.isFinite(c.p) ? c.p.toFixed(4) : "—") + "）"]);
          }
        } else if (run.method === "pearson") {
          const m = results as { columns: string[]; matrix: number[][] };
          rows.push(["相关矩阵", m.columns.map((c, i) => c + "：" + m.matrix[i].map((v) => v.toFixed(3)).join(" ")).join("；")]);
        }
      }
      analysisSections.push({ title: "数据分析结果（真实运行记录）", rows });
    }

    // 参考文献：真实文献库
    const references = this.db.listLiterature(projectId).map((lit) => ({
      line: [lit.authors, lit.year, lit.title, lit.venue, lit.doi ? "DOI: " + lit.doi : "", lit.url].filter((s) => s && s.trim()).join("。"),
      note: VERIFIED_STATUS_LABEL[lit.verifiedStatus] + " · " + LITERATURE_SOURCE_LABEL[lit.source] + (lit.preprint ? " · 预印本" : ""),
    }));

    // 审阅意见记录
    const reviewLog = this.db.listReviews(projectId).map((r) => ({
      status: r.status,
      stage: STAGES.find((s) => s.key === r.stageKey)?.name ?? r.stageKey,
      content: r.content,
      resolution: r.resolution,
    }));

    return {
      title,
      abstract: (writing["abstract"] ?? "").trim(),
      keywords: (writing["keywords"] ?? "").trim(),
      projectName: p.name,
      methodLabel,
      designSections,
      hypotheses,
      bodySections,
      analysisSections,
      references,
      reviewLog,
    };
  }

  /** 生成 DOCX Buffer（标题层级/段落/表格/参考文献/中文）。 */
  async buildDocx(data: DocData): Promise<Buffer> {
    const children: Array<Paragraph | Table> = [];

    children.push(new Paragraph({
      children: [new TextRun({ text: data.title, bold: true, size: 36, font: "黑体" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: "项目：" + data.projectName + " · 研究方法：" + data.methodLabel, size: 20, color: "666666", font: "宋体" })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
    }));

    if (data.abstract) {
      children.push(new Paragraph({ children: [new TextRun({ text: "摘要", bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      children.push(new Paragraph({ children: [new TextRun({ text: data.abstract, size: 24, font: "宋体" })], spacing: { after: 120 } }));
    }
    if (data.keywords) {
      children.push(new Paragraph({ children: [new TextRun({ text: "关键词：" + data.keywords, size: 24, font: "宋体" })], spacing: { after: 200 } }));
    }

    for (const section of data.designSections) {
      children.push(new Paragraph({ children: [new TextRun({ text: section.title, bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      for (const item of section.items) {
        children.push(new Paragraph({
          children: [new TextRun({ text: item.label + "：", bold: true, size: 24, font: "宋体" }), new TextRun({ text: item.value, size: 24, font: "宋体" })],
          spacing: { after: 80 },
        }));
      }
    }

    if (data.hypotheses.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "研究假设", bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      const rows = [new TableRow({ children: [hCell("编号"), hCell("假设陈述"), hCell("自变量"), hCell("因变量"), hCell("依据")] })];
      for (const h of data.hypotheses) {
        rows.push(new TableRow({ children: [tCell(h.number), tCell(h.statement), tCell(h.iv), tCell(h.dv), tCell(h.basis)] }));
      }
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }

    for (const section of data.bodySections) {
      children.push(new Paragraph({ children: [new TextRun({ text: section.title, bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      for (const para of section.content.split(/\n{2,}/)) {
        children.push(new Paragraph({ children: [new TextRun({ text: para.trim(), size: 24, font: "宋体" })], spacing: { after: 120, line: 360 } }));
      }
    }

    for (const section of data.analysisSections) {
      children.push(new Paragraph({ children: [new TextRun({ text: section.title, bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      const rows = section.rows.map((r) => new TableRow({ children: r.map((c, i) => (i === 0 ? hCell(c) : tCell(c))) }));
      children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    }

    if (data.references.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "参考文献", bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      data.references.forEach((ref, i) => {
        children.push(new Paragraph({
          children: [new TextRun({ text: "[" + (i + 1) + "] " + ref.line, size: 24, font: "宋体" }), new TextRun({ text: "（" + ref.note + "）", size: 20, color: "666666", font: "宋体" })],
          spacing: { after: 60 },
        }));
      });
    }

    if (data.reviewLog.length > 0) {
      children.push(new Paragraph({ children: [new TextRun({ text: "审阅意见记录", bold: true, size: 28, font: "黑体" })], heading: HeadingLevel.HEADING_1 }));
      for (const r of data.reviewLog) {
        children.push(new Paragraph({
          children: [new TextRun({ text: "【" + r.stage + "】" + r.content, size: 24, font: "宋体" }), new TextRun({ text: r.resolution ? "（修改说明：" + r.resolution + "）" : "", size: 20, color: "666666", font: "宋体" })],
          spacing: { after: 60 },
        }));
      }
    }

    const doc = new Document({
      sections: [{
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
        },
        children,
      }],
    });
    return Packer.toBuffer(doc);
  }

  /** 生成导出 HTML（PDF 用；A4、页码页脚、中文字体由系统提供）。 */
  buildHtml(data: DocData): string {
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const parts: string[] = [];
    parts.push("<h1 class=\"title\">" + esc(data.title) + "</h1>");
    parts.push("<p class=\"meta\">项目：" + esc(data.projectName) + " · 研究方法：" + esc(data.methodLabel) + "</p>");
    if (data.abstract) { parts.push("<h2>摘要</h2><p>" + esc(data.abstract).replace(/\n/g, "<br/>") + "</p>"); }
    if (data.keywords) { parts.push("<p><strong>关键词：</strong>" + esc(data.keywords) + "</p>"); }
    for (const s of data.designSections) {
      parts.push("<h2>" + esc(s.title) + "</h2>");
      for (const item of s.items) parts.push("<p><strong>" + esc(item.label) + "：</strong>" + esc(item.value).replace(/\n/g, "<br/>") + "</p>");
    }
    if (data.hypotheses.length > 0) {
      parts.push("<h2>研究假设</h2><table><tr><th>编号</th><th>假设陈述</th><th>自变量</th><th>因变量</th><th>依据</th></tr>");
      for (const h of data.hypotheses) parts.push("<tr><td>" + esc(h.number) + "</td><td>" + esc(h.statement) + "</td><td>" + esc(h.iv) + "</td><td>" + esc(h.dv) + "</td><td>" + esc(h.basis) + "</td></tr>");
      parts.push("</table>");
    }
    for (const s of data.bodySections) {
      parts.push("<h2>" + esc(s.title) + "</h2>");
      for (const para of s.content.split(/\n{2,}/)) parts.push("<p>" + esc(para.trim()).replace(/\n/g, "<br/>") + "</p>");
    }
    for (const s of data.analysisSections) {
      parts.push("<h2>" + esc(s.title) + "</h2><table>");
      for (const r of s.rows) parts.push("<tr>" + r.map((c, i) => i === 0 ? "<th>" + esc(c) + "</th>" : "<td>" + esc(c) + "</td>").join("") + "</tr>");
      parts.push("</table>");
    }
    if (data.references.length > 0) {
      parts.push("<h2>参考文献</h2><ol>");
      for (const ref of data.references) parts.push("<li>" + esc(ref.line) + " <span class=\"note\">（" + esc(ref.note) + "）</span></li>");
      parts.push("</ol>");
    }
    if (data.reviewLog.length > 0) {
      parts.push("<h2>审阅意见记录</h2>");
      for (const r of data.reviewLog) parts.push("<p>【" + esc(r.stage) + "】" + esc(r.content) + (r.resolution ? "（修改说明：" + esc(r.resolution) + "）" : "") + "</p>");
    }
    return "<!DOCTYPE html><html><head><meta charset=\"utf-8\"/><style>" + PDF_CSS + "</style></head><body>" + parts.join("\n") + "</body></html>";
  }

  /** 导出 DOCX（真实内容 → 临时 Buffer → 用户选位置写入 → 校验存在）。 */
  async exportDocx(projectId: string): Promise<{ canceled: true } | { path: string; size: number }> {
    const data = this.buildDocData(projectId);
    const buffer = await this.buildDocx(data);
    const project = this.db.getProjectDetail(projectId).project;
    const result = await dialog.showSaveDialog({
      title: "导出 DOCX",
      defaultPath: project.name + ".docx",
      filters: [{ name: "Word 文档", extensions: ["docx"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    writeFileSync(result.filePath, buffer);
    if (!existsSync(result.filePath)) throw new Error("DOCX 写入失败");
    return { path: result.filePath, size: statSync(result.filePath).size };
  }

  /** 导出 PDF（隐藏窗口 printToPDF，系统字体渲染中文，页脚页码）。 */
  async exportPdf(projectId: string): Promise<{ canceled: true } | { path: string; size: number }> {
    const data = this.buildDocData(projectId);
    const project = this.db.getProjectDetail(projectId).project;
    const result = await dialog.showSaveDialog({
      title: "导出 PDF",
      defaultPath: project.name + ".pdf",
      filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const size = await this.pdfTo(projectId, result.filePath);
    return { path: result.filePath, size };
  }

  async pdfTo(projectId: string, targetPath: string): Promise<number> {
    const data = this.buildDocData(projectId);
    const html = this.buildHtml(data);
    const win = new BrowserWindow({ show: false, width: 800, height: 1000, webPreferences: { sandbox: true } });
    try {
      await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      const pdf = await win.webContents.printToPDF({
        pageSize: "A4",
        printBackground: true,
        displayHeaderFooter: true,
        headerTemplate: "<div></div>",
        footerTemplate: "<div style=\"width:100%;text-align:center;font-size:9px;color:#666;\"><span class=\"pageNumber\"></span> / <span class=\"totalPages\"></span></div>",
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      });
      writeFileSync(targetPath, pdf);
      if (!existsSync(targetPath)) throw new Error("PDF 写入失败");
      return statSync(targetPath).size;
    } finally {
      win.destroy();
    }
  }

  async docxTo(projectId: string, targetPath: string): Promise<number> {
    const data = this.buildDocData(projectId);
    const buffer = await this.buildDocx(data);
    writeFileSync(targetPath, buffer);
    if (!existsSync(targetPath)) throw new Error("DOCX 写入失败");
    return statSync(targetPath).size;
  }
}

function hCell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, bold: true, size: 22, font: "宋体" })] })] });
}
function tCell(text: string): TableCell {
  return new TableCell({ children: [new Paragraph({ children: [new TextRun({ text, size: 22, font: "宋体" })] })] });
}

const PDF_CSS = [
  "body { font-family: 'SimSun', 'Microsoft YaHei', serif; font-size: 12pt; line-height: 1.8; color: #111; margin: 0; }",
  "h1.title { font-size: 18pt; text-align: center; margin: 0 0 6pt 0; font-family: 'SimHei', 'Microsoft YaHei', sans-serif; }",
  "p.meta { text-align: center; color: #666; font-size: 10pt; margin-bottom: 16pt; }",
  "h2 { font-size: 14pt; font-family: 'SimHei', 'Microsoft YaHei', sans-serif; margin: 14pt 0 6pt; border-bottom: 1px solid #ddd; padding-bottom: 2pt; page-break-after: avoid; }",
  "p { margin: 4pt 0; }",
  "table { border-collapse: collapse; width: 100%; margin: 6pt 0; font-size: 10pt; }",
  "th, td { border: 1px solid #999; padding: 3pt 5pt; text-align: left; vertical-align: top; }",
  "th { background: #f2f2f2; }",
  "ol { padding-left: 18pt; }",
  ".note { color: #666; font-size: 9pt; }",
  "h2 { page-break-inside: avoid; }",
].join("\n");
