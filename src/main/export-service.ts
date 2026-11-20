import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dialog } from "electron";
import JSZip from "jszip";
import type { ThesisDB } from "./db";
import type { EvidenceCard, LiteratureItem } from "../shared/literature";

const BUNDLE_FORMAT = "thesis-workbench-bundle";
const BUNDLE_VERSION = 1;

interface BundleLiteraturePdf { literatureKey: string; fileName: string; present: boolean }
interface BundleDataFile { key: string; name: string; kind: string; originalName: string; rowCount: number; columnCount: number; variables: unknown; storedExt: string }

interface ProjectBundle {
  format: string;
  version: number;
  exportedAt: number;
  sourceProjectId: string;
  project: { name: string; disciplines: string[]; researchMethod: string; educationLevel: string; deadline: string; materials: unknown; createdAt: number };
  stages: Array<{ stageKey: string; status: string; skipReason: string; updatedAt: number }>;
  stageContent: Array<{ stageKey: string; fieldKey: string; value: string }>;
  literature: LiteratureItem[];
  evidence: EvidenceCard[];
  searchLog: Array<{ source: string; query: string; resultCount: number; status: string; message: string; createdAt: number }>;
  topicCandidates: Array<{ question: string; basisLitIds: string[]; dataPath: string; feasibility: string; limitations: string; aiGenerated: boolean; createdAt: number }>;
  hypotheses: Array<{ number: string; statement: string; iv: string; dv: string; basis: string }>;
  stageVersions: Array<{ stageKey: string; versionNo: number; contentJson: string; note: string; createdAt: number }>;
  analysisRuns: Array<{ method: string; paramsJson: string; resultsJson: string; formula: string; status: string; message: string; createdAt: number; dataFileKey: string }>;
  reviews: Array<{ stageKey: string; section: string; source: string; content: string; suggestion: string; status: string; resolution: string; createdAt: number }>;
  dataFiles: BundleDataFile[];
  literaturePdfFiles: BundleLiteraturePdf[];
}

export interface RestoreOutcome {
  projectId: string;
  projectName: string;
  missingAttachments: string[];
}

/** 备份与快照服务：备份包 = bundle.json + 附件副本；不含密钥与应用级设置，不含绝对路径。 */
export class ExportService {
  constructor(
    private db: ThesisDB,
    private userDataDir: string,
  ) {}

  private attachmentsDir(projectId: string): string {
    return path.join(this.userDataDir, "attachments", projectId);
  }

  private dataDir(projectId: string): string {
    return path.join(this.userDataDir, "attachments", "data", projectId);
  }

  /** 汇总项目全部数据为 bundle（不含 model_secrets" || table === "channel_secrets" || table === "model_channels" || table === "role_channels 等应用级设置与任何绝对路径）。 */
  buildBundle(projectId: string): ProjectBundle {
    const detail = this.db.getProjectDetail(projectId);
    const p = detail.project;
    const literature = this.db.listLiterature(projectId);
    const evidence: EvidenceCard[] = [];
    for (const lit of literature) evidence.push(...this.db.listEvidence(lit.id));
    const dataFiles = this.db.listDataFiles(projectId);
    const literaturePdfFiles: BundleLiteraturePdf[] = [];
    for (const lit of literature) {
      if (lit.pdfName) {
        const stored = path.join(this.attachmentsDir(projectId), lit.id + ".pdf");
        literaturePdfFiles.push({ literatureKey: lit.id, fileName: lit.pdfName, present: existsSync(stored) });
      }
    }
    const dataFileEntries: BundleDataFile[] = [];
    for (const f of dataFiles) {
      const ext = f.storedPath ? path.extname(f.storedPath) : (f.kind === "xlsx" ? ".xlsx" : ".csv");
      dataFileEntries.push({
        key: f.id,
        name: f.name,
        kind: f.kind,
        originalName: f.originalName,
        rowCount: f.rowCount,
        columnCount: f.columnCount,
        variables: JSON.parse(f.variablesJson),
        storedExt: ext,
      });
    }
    const versions: ProjectBundle["stageVersions"] = [];
    for (const sk of ["design", "proposal"]) {
      for (const v of this.db.listStageVersions(projectId, sk)) {
        versions.push({ stageKey: sk, versionNo: v.versionNo, contentJson: v.contentJson, note: v.note, createdAt: v.createdAt });
      }
    }
    versions.sort((a, b) => a.createdAt - b.createdAt);
    return {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      exportedAt: Date.now(),
      sourceProjectId: projectId,
      project: {
        name: p.name,
        disciplines: p.disciplines,
        researchMethod: p.researchMethod,
        educationLevel: p.educationLevel,
        deadline: p.deadline,
        materials: p.materials,
        createdAt: p.createdAt,
      },
      stages: detail.stages.map((s) => ({ stageKey: s.stageKey, status: s.status, skipReason: s.skipReason, updatedAt: s.updatedAt })),
      stageContent: Object.entries(detail.content).flatMap(([stageKey, fields]) =>
        Object.entries(fields).map(([fieldKey, value]) => ({ stageKey, fieldKey, value }))
      ),
      literature,
      evidence,
      searchLog: this.db.listSearchLog(projectId).map((l) => ({
        source: l.source, query: l.query, resultCount: l.resultCount, status: l.status, message: l.message, createdAt: l.createdAt,
      })),
      topicCandidates: this.db.listTopicCandidates(projectId),
      hypotheses: this.db.listHypotheses(projectId),
      stageVersions: versions,
      analysisRuns: this.db.listAnalysisRuns(projectId).map((r) => ({
        method: r.method, paramsJson: r.paramsJson, resultsJson: r.resultsJson, formula: r.formula, status: r.status, message: r.message, createdAt: r.createdAt, dataFileKey: r.dataFileId,
      })),
      reviews: this.db.listReviews(projectId).map((r) => ({
        stageKey: r.stageKey, section: r.section, source: r.source, content: r.content, suggestion: r.suggestion, status: r.status, resolution: r.resolution, createdAt: r.createdAt,
      })),
      dataFiles: dataFileEntries,
      literaturePdfFiles,
    };
  }

  /** 生成备份 ZIP：bundle.json + attachments/ 下的附件副本；写完后校验文件存在。 */
  async writeBackupZip(projectId: string, targetPath: string): Promise<number> {
    const bundle = this.buildBundle(projectId);
    const zip = new JSZip();
    zip.file("bundle.json", JSON.stringify(bundle, null, 2));
    const att = zip.folder("attachments");
    if (att) {
      for (const f of bundle.literaturePdfFiles) {
        const src = path.join(this.attachmentsDir(projectId), f.literatureKey + ".pdf");
        if (f.present && existsSync(src)) att.file(f.literatureKey + ".pdf", readFileSync(src));
      }
      for (const f of bundle.dataFiles) {
        const stored = this.db.getDataFile(f.key)?.storedPath;
        if (stored && existsSync(stored)) att.file(f.key + f.storedExt, readFileSync(stored));
      }
    }
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    writeFileSync(targetPath, buffer);
    if (!existsSync(targetPath)) throw new Error("备份文件写入失败");
    return statSync(targetPath).size;
  }

  async exportBackup(projectId: string): Promise<{ canceled: true } | { path: string; size: number }> {
    const project = this.db.getProjectDetail(projectId).project;
    const result = await dialog.showSaveDialog({
      title: "导出项目备份包",
      defaultPath: project.name + ".thesisworkbench.zip",
      filters: [{ name: "论文工作台备份包", extensions: ["zip"] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    const size = await this.writeBackupZip(projectId, result.filePath);
    return { path: result.filePath, size };
  }

  async restoreBackup(): Promise<{ canceled: true } | { outcome: RestoreOutcome; path: string }> {
    const result = await dialog.showOpenDialog({
      title: "选择项目备份包（.zip）",
      filters: [{ name: "论文工作台备份包", extensions: ["zip"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const outcome = await this.restoreFromZip(result.filePaths[0]);
    return { outcome, path: result.filePaths[0] };
  }

  /** 从备份 ZIP 恢复为新项目副本（不覆盖任何现有项目）。 */
  async restoreFromZip(zipPath: string): Promise<RestoreOutcome> {
    const buffer = readFileSync(zipPath);
    const zip = await JSZip.loadAsync(buffer);
    const raw = zip.file("bundle.json");
    if (!raw) throw new Error("备份包格式不正确：缺少 bundle.json");
    const bundle = JSON.parse(await raw.async("string")) as ProjectBundle;
    if (bundle.format !== BUNDLE_FORMAT) throw new Error("不是本应用生成的项目备份包（format 不匹配）");
    const attachmentMap = new Map<string, JSZip.JSZipObject>();
    zip.folder("attachments")?.forEach((rel, entry) => {
      if (!entry.dir) attachmentMap.set(rel, entry);
    });
    return this.restoreBundle(bundle, attachmentMap);
  }

  /** 从 bundle（备份或快照）恢复为新项目副本。附件仅在 bundle 中包含对应文件时写入。 */
  async restoreBundle(bundle: ProjectBundle, attachments: Map<string, JSZip.JSZipObject>): Promise<RestoreOutcome> {
    const p = bundle.project;
    const created = this.db.createProject({
      name: p.name + "（恢复副本）",
      disciplines: p.disciplines,
      researchMethod: p.researchMethod,
      educationLevel: p.educationLevel,
      deadline: p.deadline,
      materials: p.materials as { title: string; literature: string; data: string; draft: string; notes: string },
    });
    const newId = created.project.id;
    const missingAttachments: string[] = [];

    for (const s of bundle.stages) this.db.setStageStatus(newId, s.stageKey, s.status as "not_started" | "in_progress" | "needs_review" | "done" | "skipped", s.skipReason);
    for (const c of bundle.stageContent) this.db.setStageContent(newId, c.stageKey, c.fieldKey, c.value);

    const litMap = new Map<string, string>();
    for (const lit of bundle.literature) {
      const n = this.db.insertLiterature({ ...lit, projectId: newId, pdfName: "" });
      litMap.set(lit.id, n.id);
    }
    for (const e of bundle.evidence) {
      const mapped = litMap.get(e.literatureId);
      if (mapped) this.db.insertEvidence(newId, mapped, e.claim, e.location);
    }
    for (const f of bundle.literaturePdfFiles ?? []) {
      const mappedLit = litMap.get(f.literatureKey);
      const entry = attachments.get(f.literatureKey + ".pdf");
      if (mappedLit && entry) {
        const dir = this.attachmentsDir(newId);
        mkdirSync(dir, { recursive: true });
        const target = path.join(dir, mappedLit + ".pdf");
        const data = await entry.async("nodebuffer");
        writeFileSync(target, data);
        this.db.setLiteraturePdf(mappedLit, f.fileName);
      } else if (mappedLit && f.present) {
        missingAttachments.push("文献 PDF：" + f.fileName);
      }
    }
    for (const c of bundle.topicCandidates ?? []) {
      this.db.insertTopicCandidate({
        projectId: newId, question: c.question,
        basisLitIds: c.basisLitIds.map((oldId) => litMap.get(oldId) ?? "").filter((x) => x),
        dataPath: c.dataPath, feasibility: c.feasibility, limitations: c.limitations, aiGenerated: c.aiGenerated,
      });
    }
    if ((bundle.hypotheses ?? []).length > 0) {
      this.db.replaceHypotheses(newId, bundle.hypotheses);
    }
    for (const v of bundle.stageVersions ?? []) {
      this.db.saveStageVersion(newId, v.stageKey, v.contentJson, v.note);
    }
    const dataMap = new Map<string, string>();
    for (const f of bundle.dataFiles ?? []) {
      const newDataId = this.db.insertDataFile({
        projectId: newId, name: f.name, kind: f.kind, originalName: f.originalName, rowCount: f.rowCount, columnCount: f.columnCount,
        variablesJson: JSON.stringify(f.variables), storedPath: "",
      });
      const entry = attachments.get(f.key + f.storedExt);
      if (entry) {
        const dir = this.dataDir(newId);
        mkdirSync(dir, { recursive: true });
        const target = path.join(dir, newDataId + f.storedExt);
        const data = await entry.async("nodebuffer");
        writeFileSync(target, data);
        this.db.updateDataFileStoredPath(newDataId, target);
      } else {
        missingAttachments.push("数据文件：" + f.name);
      }
      dataMap.set(f.key, newDataId);
    }
    for (const r of bundle.analysisRuns ?? []) {
      this.db.insertAnalysisRun({
        projectId: newId, dataFileId: dataMap.get(r.dataFileKey) ?? "", method: r.method, paramsJson: r.paramsJson, resultsJson: r.resultsJson,
        formula: r.formula, status: r.status as "ok" | "error", message: r.message,
      });
    }
    for (const r of bundle.reviews ?? []) {
      this.db.insertReview({ projectId: newId, stageKey: r.stageKey, section: r.section, source: r.source, content: r.content, suggestion: r.suggestion, status: r.status, resolution: r.resolution, createdAt: r.createdAt });
    }
    for (const l of bundle.searchLog ?? []) {
      this.db.appendSearchLog(newId, l.source, l.query, l.resultCount, l.status as "ok" | "no_results" | "error", l.message, l.createdAt);
    }
    return { projectId: newId, projectName: created.project.name, missingAttachments };
  }

  /** 恢复快照（快照只含 bundle JSON，附件按缺失提示）。 */
  async restoreSnapshot(snapshotId: string): Promise<RestoreOutcome> {
    const snap = this.db.getProjectSnapshot(snapshotId);
    if (!snap) throw new Error("快照不存在");
    const bundle = JSON.parse(snap.contentJson) as ProjectBundle;
    return this.restoreBundle(bundle, new Map());
  }
}
