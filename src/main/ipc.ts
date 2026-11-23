import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { AiJobRegistry } from "./ai-jobs";
import { DEFAULT_PROPOSAL_TEMPLATE } from "./stage4-service";
import { exportProposalDocx } from "./proposal-docx";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import type { LiteratureService, LiteratureInput } from "./literature-service";
import type { Stage4Service } from "./stage4-service";
import type { WritingService } from "./writing-service";
import type { DataService } from "./data-service";
import type { ExportService } from "./export-service";
import type { DocumentService } from "./document-service";
import type { AiAssistService } from "./ai-assist-service";
import type { ReactSearchService } from "./react-search";
import type { TaskRoleKey } from "../shared/settings";
import type { ProjectInput, StageStatus } from "../shared/types";

export function registerIpc(db: ThesisDB, settings: SettingsService, literature: LiteratureService, stage4: Stage4Service, writing: WritingService, dataService: DataService, exportService: ExportService, documentService: DocumentService, aiAssist: AiAssistService, reactSearch: ReactSearchService, aiJobs: AiJobRegistry): void {
  ipcMain.handle("runtime", () => ({ platform: process.platform, dbPath: db.path }));
  // AI 任务状态：广播给所有窗口；切界面不中断，返回可恢复
  aiJobs.setEmitter((job) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w.isDestroyed()) w.webContents.send("ai:jobUpdated", job);
    }
  });
  ipcMain.handle("aiJobs:list", (_e, projectId: string) => aiJobs.list(projectId));
  /** 任务跟踪包装：AI 工作在主进程后台继续，进度/结果落库，渲染层订阅与恢复 */
  const trackJob = async <T>(projectId: string | undefined, stageKey: string, kind: string, label: string, fn: (jobId: string, report: (pct: number, msg: string) => void) => Promise<T>): Promise<T> => {
    if (!projectId) return fn("", () => {});
    const job = aiJobs.start(projectId, stageKey, kind, label);
    try {
      const result = await fn(job.id, (pct, msg) => aiJobs.report(job.id, pct, msg));
      let json = "";
      try { json = JSON.stringify(result ?? null); } catch { json = ""; }
      aiJobs.finish(job.id, true, "已完成", json);
      return result;
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "AbortError" || /abort|已取消/i.test(e.message));
      aiJobs.finish(job.id, false, aborted ? "已取消（用户中断）" : (e instanceof Error ? e.message : String(e)), "");
      throw e;
    }
  };
  ipcMain.handle("project:list", () => db.listProjects());
  ipcMain.handle("project:create", (_e, input: ProjectInput) => db.createProject({ ...input, methods: (input as ProjectInput & { methods?: string[] }).methods ?? (input.researchMethod ? [input.researchMethod] : []) }));
  ipcMain.handle("project:get", (_e, id: string) => db.getProjectDetail(id));
  ipcMain.handle("project:update", (_e, id: string, patch: { name?: string; deadline?: string; disciplines?: string[]; methods?: string[]; researchMethod?: string; educationLevel?: string; materials?: unknown }) =>
    db.updateProject(id, patch as { name?: string; deadline?: string; disciplines?: string[]; methods?: string[]; researchMethod?: string; educationLevel?: string; materials?: Parameters<ThesisDB["updateProject"]>[1]["materials"] }));
  ipcMain.handle("project:delete", (_e, id: string) => db.deleteProject(id));
  ipcMain.handle("stage:setStatus", (_e, projectId: string, stageKey: string, status: StageStatus, skipReason: string) =>
    db.setStageStatus(projectId, stageKey, status, skipReason));
  ipcMain.handle("stage:setContent", (_e, projectId: string, stageKey: string, fieldKey: string, value: string) =>
    db.setStageContent(projectId, stageKey, fieldKey, value));

  // 服务与模型设置（多线路）
  ipcMain.handle("settings:get", () => settings.getSettings());
  ipcMain.handle("settings:saveChannel", (_e, input: Parameters<SettingsService["saveChannel"]>[0]) => {
    const channelId = settings.saveChannel(input);
    return { settings: settings.getSettings(), channelId };
  });
  ipcMain.handle("settings:deleteChannel", (_e, id: string) => settings.deleteChannel(id));
  ipcMain.handle("settings:saveSecret", (_e, channelId: string, apiKey: string) => settings.saveSecret(channelId, apiKey));
  ipcMain.handle("settings:deleteSecret", (_e, channelId: string) => settings.deleteSecret(channelId));
  ipcMain.handle("settings:saveContactEmail", (_e, email: string) => {
    settings.saveContactEmail(email);
    return settings.getSettings();
  });
  ipcMain.handle("settings:saveRole", (_e, roleKey: TaskRoleKey, channelId: string) => {
    settings.saveRole(roleKey, channelId);
    return settings.getSettings();
  });
  ipcMain.handle("settings:testConnection", (_e, testId: string, channelId: string) => settings.testConnection(testId, channelId));
  ipcMain.handle("settings:cancelTest", (_e, testId: string) => settings.cancelTest(testId));
  // 通用设置：本地文件位置（只读展示）、附件目录、输出目录、界面语言、文字大小
  ipcMain.handle("settings:getApp", () => ({
    userDataDir: app.getPath("userData"),
    attachmentsDir: db.getAppSetting("attachments_dir") || path.join(app.getPath("userData"), "attachments"),
    exportDir: db.getAppSetting("export_dir") || app.getPath("desktop"),
    uiLanguage: db.getAppSetting("ui_language") || "zh",
    fontSize: db.getAppSetting("ui_font_size") || "100",
    proposalTemplate: db.getAppSetting("proposal_template") || DEFAULT_PROPOSAL_TEMPLATE,
    docMarginTop: db.getAppSetting("doc_margin_top") || "2.54",
    docMarginBottom: db.getAppSetting("doc_margin_bottom") || "2.54",
    docMarginLeft: db.getAppSetting("doc_margin_left") || "3.17",
    docMarginRight: db.getAppSetting("doc_margin_right") || "3.17",
    docBodySize: db.getAppSetting("doc_body_size") || "12",
    docTitleSize: db.getAppSetting("doc_title_size") || "24",
    docBodyCn: db.getAppSetting("doc_body_cn") || "宋体",
    docBodyEn: db.getAppSetting("doc_body_en") || "Times New Roman",
    docLineSpacing: db.getAppSetting("doc_line_spacing") || "22",
  }));
  ipcMain.handle("settings:saveApp", (_e, patch: Record<string, string>) => {
    for (const [k, v] of Object.entries(patch ?? {})) {
      if (typeof v === "string") db.setAppSetting(k, v);
    }
    return true;
  });
  ipcMain.handle("settings:chooseDir", async () => {
    const res = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });
  // 导出第 0/1/2 阶段内容 MD（默认输出到「输出存放位置」，未设置则为桌面）
  ipcMain.handle("literature:exportMd", (_e, projectId: string, prefs?: { refTypes?: string[]; platforms?: string[] }) => {
    const md = reactSearch.buildSearchMd(projectId, prefs);
    const exportDir = (db.getAppSetting("export_dir") || app.getPath("desktop")).trim();
    const safeName = (db.getProjectDetail(projectId).project.name || "项目").replace(/[\\/:*?"<>|]/g, "-").slice(0, 40);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
    const file = path.join(exportDir, safeName + "-发送AI检索-" + stamp + ".md");
    try {
      mkdirSync(exportDir, { recursive: true });
      writeFileSync(file, md, "utf8");
      return { ok: true, md, path: file, message: "已导出：" + file };
    } catch (e) {
      return { ok: false, md, path: "", message: "导出失败：" + (e instanceof Error ? e.message : String(e)) };
    }
  });
  // 文献库（真实学术数据源）
  ipcMain.handle("literature:list", (_e, projectId: string) => db.listLiterature(projectId));
  ipcMain.handle("literature:search", (_e, projectId: string, source: string, query: string) => literature.search(projectId, source, query));
  ipcMain.handle("literature:autoSearch", (_e, projectId: string, opts?: { total?: number; cn?: number; en?: number; excludeDois?: string[] }) =>
    trackJob(projectId, "literature", "auto_search", "一键自动找文献", () => literature.autoSearch(projectId, opts)));
  ipcMain.handle("literature:updateMeta", (_e, projectId: string, literatureId: string, patch: { refType?: string; region?: string }) => literature.updateMeta(projectId, literatureId, patch));
  ipcMain.handle("literature:manualAiSearch", (_e, projectId: string, citation: string) =>
    trackJob(projectId, "literature", "manual_ai_search", "手动录入 AI 检索", () => literature.manualAiSearch(projectId, citation)));
  ipcMain.handle("literature:importAiText", (_e, projectId: string, text: string) =>
    trackJob(projectId, "literature", "ai_import", "AI 结果回填导入", (_jobId, report) =>
      literature.importAiText(projectId, text, (pct, msg) => report(pct, msg))));
  // ReAct 检索三步
  ipcMain.handle("react:planKeywords", (_e, projectId: string) => reactSearch.planKeywords(projectId));
  const searchControllers = new Map<string, AbortController>();
  ipcMain.handle("react:cancelSearch", (_e, projectId: string) => {
    const ctl = searchControllers.get(projectId);
    if (ctl) ctl.abort();
    return Boolean(ctl);
  });
  ipcMain.handle("react:searchAll", (e, projectId: string, opts: { cn: number; en: number; excludeDois?: string[] }) => {
    const send = (msg: string) => { if (!e.sender.isDestroyed()) e.sender.send("react:searchProgress", msg); };
    const ctl = new AbortController();
    searchControllers.set(projectId, ctl);
    return trackJob(projectId, "literature", "literature_search", "AI 检索论文", (_jobId, report) =>
      reactSearch.searchAll(projectId, opts, (msg: string) => {
        send(msg);
        const pct = /规划|关键词|计划|整理/.test(msg) ? 8 + Math.random() * 25
          : /重排|核验/.test(msg) ? 78 + Math.random() * 19
          : /检索式|轮|累计|取回/.test(msg) ? 40 + Math.random() * 36
          : 30;
        report(Math.min(97, pct), msg);
      }, ctl.signal).finally(() => { searchControllers.delete(projectId); }));
  });
  ipcMain.handle("react:executeSearch", (e, projectId: string, plan: unknown, opts: { cn: number; en: number; excludeDois?: string[] }) =>
    trackJob(projectId, "literature", "literature_execute", "AI 检索执行", (_jobId, report) =>
      reactSearch.executeSearch(projectId, plan as Parameters<ReactSearchService["executeSearch"]>[1], opts, (msg: string) => {
        if (!e.sender.isDestroyed()) e.sender.send("react:searchProgress", msg);
        const pct = /重排|核验/.test(msg) ? 78 + Math.random() * 19 : 40 + Math.random() * 36;
        report(Math.min(97, pct), msg);
      })));
  ipcMain.handle("react:verifyResults", (_e, projectId: string, outcome: unknown) =>
    reactSearch.verifyResults(projectId, outcome as Parameters<ReactSearchService["verifyResults"]>[1]));
  ipcMain.handle("literature:lookupDoi", (_e, doi: string) => literature.lookupDoi(doi));
  ipcMain.handle("literature:save", (_e, projectId: string, input: LiteratureInput, opts: { note?: string; manuallyVerified?: boolean }) => literature.saveItem(projectId, input, opts ?? {}));
  ipcMain.handle("literature:verifyManual", (_e, id: string, note: string) => literature.verifyManual(id, note));
  ipcMain.handle("literature:delete", (_e, id: string) => db.deleteLiterature(id));
  ipcMain.handle("literature:attachPdf", (_e, projectId: string, literatureId: string) => literature.attachPdf(projectId, literatureId));
  ipcMain.handle("literature:listEvidence", (_e, literatureId: string) => db.listEvidence(literatureId));
  ipcMain.handle("literature:addEvidence", (_e, projectId: string, literatureId: string, claim: string, location: string) => literature.addEvidence(projectId, literatureId, claim, location));
  ipcMain.handle("literature:deleteEvidence", (_e, id: string) => literature.deleteEvidence(id));
  ipcMain.handle("literature:searchLog", (_e, projectId: string) => db.listSearchLog(projectId));
  ipcMain.handle("literature:genQueries", (_e, projectId: string, topic: string) =>
    trackJob(projectId, "literature", "gen_queries", "AI 生成检索式", () => literature.genQueries(topic)));

  // 阶段 4：选题、研究设计与开题
  ipcMain.handle("stage4:generateDirections", (_e, projectId: string, inputs: unknown) =>
    trackJob(projectId, "topic", "directions", "候选研究方向", () => stage4.generateDirections(projectId, inputs as Parameters<Stage4Service["generateDirections"]>[1])));
  ipcMain.handle("stage4:saveDirection", (_e, projectId: string, d: unknown) => stage4.saveDirection(projectId, d as Parameters<Stage4Service["saveDirection"]>[1]));
  ipcMain.handle("stage4:listDirections", (_e, projectId: string) => stage4.listDirections(projectId));
  ipcMain.handle("stage4:deleteDirection", (_e, id: string) => stage4.deleteDirection(id));
  ipcMain.handle("stage4:generateDesignDraft", (_e, projectId: string) =>
    trackJob(projectId, "design", "design_draft", "研究设计草案", () => stage4.generateDesignDraft(projectId)));
  ipcMain.handle("stage4:generateProposal", (e, projectId: string) =>
    trackJob(projectId, "proposal", "proposal", "开题报告框架", (_jobId, report) =>
      stage4.generateProposal(projectId, (index, total, title) => {
        if (!e.sender.isDestroyed()) e.sender.send("stage4:proposalSection", { index, total, title });
        report(Math.min(97, Math.round(((index + 1) / total) * 85) + 5), "正在生成第 " + (index + 1) + "/" + total + " 节：" + title);
      })));
  ipcMain.handle("stage4:saveVersion", (_e, projectId: string, stageKey: string, contentJson: string, note: string, name: string) => stage4.saveVersion(projectId, stageKey, contentJson, note, name));
  ipcMain.handle("stage4:exportProposalDocx", (_e, projectId: string, md: string) => exportProposalDocx(db, projectId, md));
  ipcMain.handle("stage4:renameVersion", (_e, versionId: number, name: string) => stage4.renameVersion(versionId, name));
  ipcMain.handle("stage4:listVersions", (_e, projectId: string, stageKey: string) => stage4.listVersions(projectId, stageKey));
  ipcMain.handle("stage4:restoreVersion", (_e, versionId: number) => stage4.restoreVersion(versionId));
  ipcMain.handle("stage4:replaceHypotheses", (_e, projectId: string, cards: unknown) => stage4.replaceHypotheses(projectId, cards as Parameters<Stage4Service["replaceHypotheses"]>[1]));
  ipcMain.handle("stage4:listHypotheses", (_e, projectId: string) => stage4.listHypotheses(projectId));
  ipcMain.handle("stage4:deleteHypothesis", (_e, id: string) => stage4.deleteHypothesis(id));

  // 写作管线（接地文献库的 RAG）
  ipcMain.handle("writing:generate", (_e, projectId: string, instruction: string, opts: { query?: string; topK?: number }) =>
    trackJob(projectId, "writing", "writing", "写作生成", () => writing.generate(projectId, instruction, opts ?? {})));

  // 阶段 5：数据导入与本地分析
  ipcMain.handle("data:importText", (_e, projectId: string, name: string, text: string) => dataService.importText(projectId, name, text));
  ipcMain.handle("data:importFile", (_e, projectId: string) => dataService.importFile(projectId));
  ipcMain.handle("data:list", (_e, projectId: string) => dataService.listFiles(projectId));
  ipcMain.handle("data:delete", (_e, id: string) => db.deleteDataFile(id));
  ipcMain.handle("data:analyze", (_e, projectId: string, dataFileId: string, method: string, params: unknown) =>
    dataService.analyze(projectId, dataFileId, method, params));
  ipcMain.handle("data:runs", (_e, projectId: string) => dataService.listRuns(projectId));
  ipcMain.handle("data:explain", (_e, runId: string) => {
    const run = db.getAnalysisRun(runId);
    return trackJob(run?.projectId, "analysis", "data_explain", "分析结果解读", () => dataService.explain(runId));
  });

  // 阶段 6：审阅意见
  ipcMain.handle("review:list", (_e, projectId: string) => db.listReviews(projectId));
  ipcMain.handle("review:create", (_e, input: { projectId: string; stageKey: string; section: string; source: string; content: string; suggestion: string }) => db.insertReview(input));
  ipcMain.handle("review:update", (_e, id: string, patch: { stageKey?: string; section?: string; source?: string; content?: string; suggestion?: string; status?: string; resolution?: string }) => db.updateReview(id, patch));
  ipcMain.handle("review:delete", (_e, id: string) => db.deleteReview(id));

  // 阶段 6：备份 / 快照 / 导出
  ipcMain.handle("export:backup", (_e, projectId: string) => exportService.exportBackup(projectId));
  ipcMain.handle("export:backupTo", (_e, projectId: string, targetPath: string) => exportService.writeBackupZip(projectId, targetPath));
  ipcMain.handle("export:restore", () => exportService.restoreBackup());
  ipcMain.handle("export:restoreFrom", (_e, zipPath: string) => exportService.restoreFromZip(zipPath));
  ipcMain.handle("snapshot:create", (_e, projectId: string, name: string) => db.insertProjectSnapshot(projectId, name, JSON.stringify(exportService.buildBundle(projectId))));
  ipcMain.handle("snapshot:list", (_e, projectId: string) => db.listProjectSnapshots(projectId));
  ipcMain.handle("snapshot:delete", (_e, id: string) => db.deleteProjectSnapshot(id));
  ipcMain.handle("snapshot:restore", (_e, id: string) => exportService.restoreSnapshot(id));

  // 阶段 6：文档导出
  ipcMain.handle("export:docx", (_e, projectId: string) => documentService.exportDocx(projectId));
  ipcMain.handle("export:docxTo", (_e, projectId: string, targetPath: string) => documentService.docxTo(projectId, targetPath));
  ipcMain.handle("export:pdf", (_e, projectId: string) => documentService.exportPdf(projectId));
  ipcMain.handle("export:pdfTo", (_e, projectId: string, targetPath: string) => documentService.pdfTo(projectId, targetPath));

  // 全局 AI 辅助
  ipcMain.handle("ai:suggest", (_e, projectId: string, stageKey: string, targets: Array<{ key: string; label: string }>) =>
    trackJob(projectId, stageKey, "suggest", "AI 助手建议", () => aiAssist.suggest(projectId, stageKey, targets)));
  ipcMain.handle("ai:chat", (_e, projectId: string, stageKey: string, message: string) =>
    trackJob(projectId, stageKey, "chat", "AI 对话", () => aiAssist.chat(projectId, stageKey, message)));
  ipcMain.handle("ai:listConversations", (_e, projectId: string, stageKey: string) => aiAssist.listConversations(projectId, stageKey));
  ipcMain.handle("ai:clearConversations", (_e, projectId: string, stageKey: string) => aiAssist.clearConversations(projectId, stageKey));
  ipcMain.handle("ai:projectKnowledge", (_e, projectId: string) =>
    trackJob(projectId, "", "knowledge", "项目知识汇总", async () => aiAssist.buildProjectKnowledge(projectId)));
  ipcMain.handle("ai:topicOptions", (_e, projectId: string) =>
    trackJob(projectId, "topic", "topic_options", "选题方向建议", () => aiAssist.topicOptions(projectId)));
  ipcMain.handle("ai:suggestTitles", (_e, input: Parameters<AiAssistService["suggestTitles"]>[0]) => aiAssist.suggestTitles(input));
  ipcMain.handle("ai:suggestMethods", (_e, input: Parameters<AiAssistService["suggestMethods"]>[0]) => aiAssist.suggestMethods(input));

  // 打开外部链接（仅 http/https）
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
    return shell.openExternal(url);
  });
}
