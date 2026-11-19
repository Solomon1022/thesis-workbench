import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ThesisDB } from "../../src/main/db";
import { ExportService } from "../../src/main/export-service";

describe("备份与快照（阶段 6.3）", () => {
  let dir: string;
  let dbPath: string;
  let db: ThesisDB;
  let service: ExportService;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-export-"));
    dbPath = path.join(dir, "test.db");
    db = new ThesisDB(dbPath);
    service = new ExportService(db, dir);
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedProject() {
    const created = db.createProject({ name: "备份测试", disciplines: ["电子商务"], researchMethod: "questionnaire", educationLevel: "本科", deadline: "", materials: { title: "", literature: "", data: "", draft: "", notes: "" } });
    const pid = created.project.id;
    db.setStageContent(pid, "design", "research_question", "直播互动如何影响购买意愿？");
    db.setStageStatus(pid, "design", "in_progress", "");
    const lit = db.insertLiterature({ projectId: pid, title: "Live Streaming and Purchase Intention", authors: "Li", year: "2023", venue: "J.", doi: "10.1/live", url: "https://example.org/live", abstract: "摘要内容", source: "crossref", verifiedStatus: "verified", verifiedNote: "", fulltextStatus: "abstract_only", pdfName: "原文.pdf", preprint: false });
    // 伪造附件 PDF 文件
    const attDir = path.join(dir, "attachments", pid);
    mkdirSync(attDir, { recursive: true });
    writeFileSync(path.join(attDir, lit.id + ".pdf"), Buffer.from("FAKE-PDF"));
    db.insertEvidence(pid, lit.id, "直播互动显著影响购买意愿", "第 3 页");
    db.insertReview({ projectId: pid, stageKey: "writing", section: "研究背景", source: "导师", content: "背景缺研究意义", suggestion: "补一段", status: "in_progress", resolution: "" });
    // 数据文件
    const dataDir = path.join(dir, "attachments", "data", pid);
    mkdirSync(dataDir, { recursive: true });
    const dataId = db.insertDataFile({ projectId: pid, name: "问卷数据", kind: "csv", originalName: "q.csv", rowCount: 2, columnCount: 2, variablesJson: "[]", storedPath: "" });
    const dataPath = path.join(dataDir, dataId + ".csv");
    writeFileSync(dataPath, "a,b\n1,2\n");
    db.updateDataFileStoredPath(dataId, dataPath);
    db.insertAnalysisRun({ projectId: pid, dataFileId: dataId, method: "descriptive", paramsJson: "{}", resultsJson: "{\"a\":{}}", formula: "mean", status: "ok", message: "" });
    // 密钥（应用级，不应出现在备份里）
    db.setModelSecret("deepseek", "BASE64-CIPHERTEXT-SECRET");
    return { pid, litId: lit.id, dataId };
  }

  it("bundle 不含密钥与绝对路径，包含真实项目内容", () => {
    const { pid } = seedProject();
    const bundle = service.buildBundle(pid);
    const text = JSON.stringify(bundle);
    expect(text).not.toContain("model_secrets");
    expect(text).not.toContain("CIPHERTEXT");
    expect(text).not.toContain(dir); // 不含用户数据目录绝对路径
    expect(text).toContain("直播互动如何影响购买意愿？");
    expect(text).toContain("Live Streaming and Purchase Intention");
    expect(text).toContain("背景缺研究意义");
    expect(bundle.stages.length).toBe(13);
    expect(bundle.literaturePdfFiles[0].present).toBe(true);
  });

  it("备份 ZIP 往返：恢复为新项目副本，内容/证据/意见/数据/附件一致，原项目不变", async () => {
    const { pid, litId } = seedProject();
    const zipPath = path.join(dir, "backup.zip");
    const size = await service.writeBackupZip(pid, zipPath);
    expect(size).toBeGreaterThan(0);
    expect(existsSync(zipPath)).toBe(true);

    const outcome = await service.restoreFromZip(zipPath);
    expect(outcome.projectId).not.toBe(pid);
    expect(outcome.projectName).toContain("恢复副本");
    expect(outcome.missingAttachments.length).toBe(0);

    // 新项目内容
    const newDetail = db.getProjectDetail(outcome.projectId);
    expect(newDetail.content["design"]?.["research_question"]).toBe("直播互动如何影响购买意愿？");
    expect(newDetail.stages.length).toBe(13);
    const newLits = db.listLiterature(outcome.projectId);
    expect(newLits.length).toBe(1);
    expect(newLits[0].title).toContain("Live Streaming");
    expect(newLits[0].id).not.toBe(litId);
    expect(newLits[0].pdfName).toBe("原文.pdf");
    expect(existsSync(path.join(dir, "attachments", outcome.projectId, newLits[0].id + ".pdf"))).toBe(true);
    expect(db.listEvidence(newLits[0].id).length).toBe(1);
    expect(db.listReviews(outcome.projectId).length).toBe(1);
    expect(db.listReviews(outcome.projectId)[0].status).toBe("in_progress");
    expect(db.listDataFiles(outcome.projectId).length).toBe(1);
    expect(db.listAnalysisRuns(outcome.projectId).length).toBe(1);
    // 数据附件内容恢复
    const restoredData = db.getDataFile(db.listDataFiles(outcome.projectId)[0].id);
    expect(restoredData?.storedPath).toBeTruthy();
    expect(readFileSync(restoredData?.storedPath as string, "utf8")).toBe("a,b\n1,2\n");

    // 原项目未被改动
    expect(db.listLiterature(pid).length).toBe(1);
    expect(db.listReviews(pid).length).toBe(1);
  });

  it("快照创建与恢复为副本（附件按缺失提示）", async () => {
    const { pid } = seedProject();
    const snapId = db.insertProjectSnapshot(pid, "提交前", JSON.stringify(service.buildBundle(pid)));
    expect(db.listProjectSnapshots(pid).length).toBe(1);
    const outcome = await service.restoreSnapshot(snapId);
    expect(outcome.projectId).not.toBe(pid);
    // 快照不含附件文件 → 文献 PDF 提示缺失
    expect(outcome.missingAttachments.some((m) => m.includes("文献 PDF"))).toBe(true);
    const newDetail = db.getProjectDetail(outcome.projectId);
    expect(newDetail.content["design"]?.["research_question"]).toBe("直播互动如何影响购买意愿？");
    db.deleteProjectSnapshot(snapId);
    expect(db.listProjectSnapshots(pid).length).toBe(0);
  });
});
