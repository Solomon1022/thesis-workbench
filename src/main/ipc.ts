import { ipcMain, shell } from "electron";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import type { LiteratureService, LiteratureInput } from "./literature-service";
import type { Stage4Service } from "./stage4-service";
import type { WritingService } from "./writing-service";
import type { DataService } from "./data-service";
import type { ExportService } from "./export-service";
import type { ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
import type { ProjectInput, StageStatus } from "../shared/types";

export function registerIpc(db: ThesisDB, settings: SettingsService, literature: LiteratureService, stage4: Stage4Service, writing: WritingService, dataService: DataService, exportService: ExportService): void {
  ipcMain.handle("runtime", () => ({ platform: process.platform, dbPath: db.path }));
  ipcMain.handle("project:list", () => db.listProjects());
  ipcMain.handle("project:create", (_e, input: ProjectInput) => db.createProject(input));
  ipcMain.handle("project:get", (_e, id: string) => db.getProjectDetail(id));
  ipcMain.handle("project:update", (_e, id: string, patch: { name?: string; deadline?: string; disciplines?: string[] }) => db.updateProject(id, patch));
  ipcMain.handle("project:delete", (_e, id: string) => db.deleteProject(id));
  ipcMain.handle("stage:setStatus", (_e, projectId: string, stageKey: string, status: StageStatus, skipReason: string) =>
    db.setStageStatus(projectId, stageKey, status, skipReason));
  ipcMain.handle("stage:setContent", (_e, projectId: string, stageKey: string, fieldKey: string, value: string) =>
    db.setStageContent(projectId, stageKey, fieldKey, value));

  // 服务与模型设置
  ipcMain.handle("settings:get", () => settings.getSettings());
  ipcMain.handle("settings:saveProfile", (_e, profile: ModelProfile, network: NetworkConfig) => {
    settings.saveProfile(profile, network);
    return settings.getSettings();
  });
  ipcMain.handle("settings:saveSecret", (_e, providerKey: string, apiKey: string) => settings.saveSecret(providerKey, apiKey));
  ipcMain.handle("settings:saveContactEmail", (_e, email: string) => {
    settings.saveContactEmail(email);
    return settings.getSettings();
  });
  ipcMain.handle("settings:deleteSecret", (_e, providerKey: string) => settings.deleteSecret(providerKey));
  ipcMain.handle("settings:saveRole", (_e, roleKey: RoleKey, providerKey: string, model: string) => {
    settings.saveRole(roleKey, providerKey, model);
    return settings.getSettings();
  });
  ipcMain.handle("settings:testConnection", (_e, testId: string, providerKey: string) => settings.testConnection(testId, providerKey));
  ipcMain.handle("settings:cancelTest", (_e, testId: string) => settings.cancelTest(testId));

  // 文献库（真实学术数据源）
  ipcMain.handle("literature:list", (_e, projectId: string) => db.listLiterature(projectId));
  ipcMain.handle("literature:search", (_e, projectId: string, source: string, query: string) => literature.search(projectId, source, query));
  ipcMain.handle("literature:lookupDoi", (_e, doi: string) => literature.lookupDoi(doi));
  ipcMain.handle("literature:save", (_e, projectId: string, input: LiteratureInput, opts: { note?: string; manuallyVerified?: boolean }) => literature.saveItem(projectId, input, opts ?? {}));
  ipcMain.handle("literature:verifyManual", (_e, id: string, note: string) => literature.verifyManual(id, note));
  ipcMain.handle("literature:delete", (_e, id: string) => db.deleteLiterature(id));
  ipcMain.handle("literature:attachPdf", (_e, projectId: string, literatureId: string) => literature.attachPdf(projectId, literatureId));
  ipcMain.handle("literature:listEvidence", (_e, literatureId: string) => db.listEvidence(literatureId));
  ipcMain.handle("literature:addEvidence", (_e, projectId: string, literatureId: string, claim: string, location: string) => literature.addEvidence(projectId, literatureId, claim, location));
  ipcMain.handle("literature:deleteEvidence", (_e, id: string) => literature.deleteEvidence(id));
  ipcMain.handle("literature:searchLog", (_e, projectId: string) => db.listSearchLog(projectId));
  ipcMain.handle("literature:genQueries", (_e, topic: string) => literature.genQueries(topic));

  // 阶段 4：选题、研究设计与开题
  ipcMain.handle("stage4:generateDirections", (_e, projectId: string, inputs: unknown) => stage4.generateDirections(projectId, inputs as Parameters<Stage4Service["generateDirections"]>[1]));
  ipcMain.handle("stage4:saveDirection", (_e, projectId: string, d: unknown) => stage4.saveDirection(projectId, d as Parameters<Stage4Service["saveDirection"]>[1]));
  ipcMain.handle("stage4:listDirections", (_e, projectId: string) => stage4.listDirections(projectId));
  ipcMain.handle("stage4:deleteDirection", (_e, id: string) => stage4.deleteDirection(id));
  ipcMain.handle("stage4:generateDesignDraft", (_e, projectId: string) => stage4.generateDesignDraft(projectId));
  ipcMain.handle("stage4:generateProposal", (_e, projectId: string) => stage4.generateProposal(projectId));
  ipcMain.handle("stage4:saveVersion", (_e, projectId: string, stageKey: string, contentJson: string, note: string) => stage4.saveVersion(projectId, stageKey, contentJson, note));
  ipcMain.handle("stage4:listVersions", (_e, projectId: string, stageKey: string) => stage4.listVersions(projectId, stageKey));
  ipcMain.handle("stage4:restoreVersion", (_e, versionId: number) => stage4.restoreVersion(versionId));
  ipcMain.handle("stage4:replaceHypotheses", (_e, projectId: string, cards: unknown) => stage4.replaceHypotheses(projectId, cards as Parameters<Stage4Service["replaceHypotheses"]>[1]));
  ipcMain.handle("stage4:listHypotheses", (_e, projectId: string) => stage4.listHypotheses(projectId));
  ipcMain.handle("stage4:deleteHypothesis", (_e, id: string) => stage4.deleteHypothesis(id));

  // 写作管线（接地文献库的 RAG）
  ipcMain.handle("writing:generate", (_e, projectId: string, instruction: string, opts: { query?: string; topK?: number }) =>
    writing.generate(projectId, instruction, opts ?? {}));

  // 阶段 5：数据导入与本地分析
  ipcMain.handle("data:importText", (_e, projectId: string, name: string, text: string) => dataService.importText(projectId, name, text));
  ipcMain.handle("data:importFile", (_e, projectId: string) => dataService.importFile(projectId));
  ipcMain.handle("data:list", (_e, projectId: string) => dataService.listFiles(projectId));
  ipcMain.handle("data:delete", (_e, id: string) => db.deleteDataFile(id));
  ipcMain.handle("data:analyze", (_e, projectId: string, dataFileId: string, method: string, params: unknown) =>
    dataService.analyze(projectId, dataFileId, method, params));
  ipcMain.handle("data:runs", (_e, projectId: string) => dataService.listRuns(projectId));
  ipcMain.handle("data:explain", (_e, runId: string) => dataService.explain(runId));

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

  // 打开外部链接（仅 http/https）
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
    return shell.openExternal(url);
  });
}
