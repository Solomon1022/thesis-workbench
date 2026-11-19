import { ipcMain } from "electron";
import type { ThesisDB } from "./db";
import type { ProjectInput, StageStatus } from "../shared/types";

export function registerIpc(db: ThesisDB): void {
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
}
