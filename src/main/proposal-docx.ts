import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  AlignmentType, Document, LineRuleType, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";
import type { ThesisDB } from "./db";

const cm2twips = (cm: number) => Math.round(cm * 567);
const pt2half = (pt: number) => Math.round(pt * 2);

interface Line { kind: "h1" | "h2" | "h3" | "p" | "list"; text: string }

/** 解析开题 MD：一级标题/二级标题/三级标题/正文/列表 */
function parseMd(md: string): Line[] {
  const out: Line[] = [];
  for (const raw of String(md ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^#\s+/.test(line)) { out.push({ kind: "h1", text: line.replace(/^#\s+/, "").trim() }); continue; }
    if (/^##\s+/.test(line)) { out.push({ kind: "h2", text: line.replace(/^##\s+/, "").trim() }); continue; }
    if (/^###\s+/.test(line)) { out.push({ kind: "h3", text: line.replace(/^###\s+/, "").trim() }); continue; }
    if (/^[-*]\s+/.test(line)) { out.push({ kind: "list", text: line.replace(/^[-*]\s+/, "").trim() }); continue; }
    if (line.trim()) out.push({ kind: "p", text: line.trim() });
  }
  return out;
}

/** 行内加粗/斜体 → TextRun 分段 */
function runs(text: string, size: number, cn: string, en: string, bold = false): TextRun[] {
  const parts = String(text).split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  const out: TextRun[] = [];
  for (const part of parts) {
    let t = part;
    let b = bold;
    if (/^\*\*[^*]+\*\*$/.test(t)) { t = t.slice(2, -2); b = true; }
    else if (/^\*[^*]+\*$/.test(t)) { t = t.slice(1, -1); }
    out.push(new TextRun({ text: t, bold: b, size: pt2half(size), font: { ascii: en, eastAsia: cn } }));
  }
  return out;
}

/** 开题报告 MD → Word（按设置中的页面/字体/行距参数排版） */
export async function exportProposalDocx(db: ThesisDB, projectId: string, md: string): Promise<{ ok: boolean; path?: string; message: string }> {
  const get = (k: string, d: string) => db.getAppSetting(k) || d;
  const bodyCn = get("doc_body_cn", "宋体");
  const bodyEn = get("doc_body_en", "Times New Roman");
  const bodySize = Math.max(9, Number(get("doc_body_size", "12")) || 12);
  const titleSize = Math.max(12, Number(get("doc_title_size", "24")) || 24);
  const lineSpacing = Math.max(12, Number(get("doc_line_spacing", "22")) || 22);
  const mTop = Math.max(1, Number(get("doc_margin_top", "2.54")) || 2.54);
  const mBottom = Math.max(1, Number(get("doc_margin_bottom", "2.54")) || 2.54);
  const mLeft = Math.max(1, Number(get("doc_margin_left", "3.17")) || 3.17);
  const mRight = Math.max(1, Number(get("doc_margin_right", "3.17")) || 3.17);

  const lines = parseMd(md);
  const kvRows: Array<[string, string]> = [];
  const bodyLines: Line[] = [];
  let inHeader = true;
  for (const l of lines) {
    if (inHeader && l.kind === "list" && l.text.includes("：")) {
      const i = l.text.indexOf("：");
      kvRows.push([l.text.slice(0, i).trim(), l.text.slice(i + 1).trim()]);
      continue;
    }
    inHeader = false;
    bodyLines.push(l);
  }

  const children: Array<Paragraph | Table> = [];

  // 大标题：黑体 titleSize 磅居中无缩进
  const titleText = lines.find((l) => l.kind === "h1")?.text || "本科毕业论文（设计）开题报告";
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: titleText, bold: true, size: pt2half(titleSize), font: { ascii: "黑体", eastAsia: "黑体" } })],
  }));

  // 信息表格：宋体 bodySize 磅居中，行距固定 lineSpacing 磅
  if (kvRows.length > 0) {
    const rows = kvRows.map(([k, v]) => new TableRow({
      children: [
        new TableCell({
          width: { size: 32, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: lineSpacing * 20, lineRule: LineRuleType.EXACT }, children: runs(k, bodySize, bodyCn, bodyEn) })],
        }),
        new TableCell({
          width: { size: 68, type: WidthType.PERCENTAGE },
          children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { line: lineSpacing * 20, lineRule: LineRuleType.EXACT }, children: runs(v, bodySize, bodyCn, bodyEn) })],
        }),
      ],
    }));
    children.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } }));
    children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
  }

  for (const l of bodyLines) {
    if (l.kind === "h2") {
      children.push(new Paragraph({
        spacing: { before: 200, after: 120 },
        children: [new TextRun({ text: l.text, bold: true, size: pt2half(bodySize + 3), font: { ascii: "黑体", eastAsia: "黑体" } })],
      }));
    } else if (l.kind === "h3") {
      children.push(new Paragraph({
        spacing: { before: 140, after: 100 },
        children: [new TextRun({ text: l.text, bold: true, size: pt2half(bodySize + 1), font: { ascii: "黑体", eastAsia: "黑体" } })],
      }));
    } else if (l.kind === "list") {
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { line: lineSpacing * 20, lineRule: LineRuleType.EXACT },
        children: runs(l.text, bodySize, bodyCn, bodyEn),
      }));
    } else if (l.text) {
      children.push(new Paragraph({
        spacing: { line: lineSpacing * 20, lineRule: LineRuleType.EXACT },
        children: runs(l.text, bodySize, bodyCn, bodyEn),
      }));
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: { ascii: bodyEn, eastAsia: bodyCn }, size: pt2half(bodySize) } },
      },
    },
    sections: [{
      properties: {
        page: {
          size: { width: cm2twips(21.0), height: cm2twips(29.7) },
          margin: { top: cm2twips(mTop), bottom: cm2twips(mBottom), left: cm2twips(mLeft), right: cm2twips(mRight) },
        },
      },
      children,
    }],
  });

  const buffer = await Packer.toBuffer(doc);
  const exportDir = (db.getAppSetting("export_dir") || app.getPath("desktop")).trim();
  const name = (db.getProjectDetail(projectId).project.name || "开题报告").replace(/[\\/:*?"<>|]/g, "-").slice(0, 40);
  const file = path.join(exportDir, name + "-开题报告-" + new Date().toISOString().slice(0, 10) + ".docx");
  try {
    mkdirSync(exportDir, { recursive: true });
    writeFileSync(file, buffer);
    return { ok: true, path: file, message: "已导出 Word：" + file };
  } catch (e) {
    return { ok: false, message: "导出失败：" + (e instanceof Error ? e.message : String(e)) };
  }
}
