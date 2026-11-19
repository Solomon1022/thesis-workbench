import { ipcMain, shell } from "electron";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import type { LiteratureService, LiteratureInput } from "./literature-service";
import type { ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
import type { ProjectInput, StageStatus } from "../shared/types";

export function registerIpc(db: ThesisDB, settings: SettingsService, literature: LiteratureService): void {
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

  // 打开外部链接（仅 http/https）
  ipcMain.handle("shell:openExternal", (_e, url: string) => {
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return false;
    return shell.openExternal(url);
  });
}
