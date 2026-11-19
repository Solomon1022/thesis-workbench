import { ipcMain } from "electron";
import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import type { ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
import type { ProjectInput, StageStatus } from "../shared/types";

export function registerIpc(db: ThesisDB, settings: SettingsService): void {
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
}
