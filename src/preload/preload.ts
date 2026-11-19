import { contextBridge, ipcRenderer } from "electron";
import type { Project, ProjectDetail, ProjectInput, StageStatus } from "../shared/types";

const api = {
  runtime: (): Promise<{ platform: string; dbPath: string }> => ipcRenderer.invoke("runtime"),
  listProjects: (): Promise<Project[]> => ipcRenderer.invoke("project:list"),
  createProject: (input: ProjectInput): Promise<ProjectDetail> => ipcRenderer.invoke("project:create", input),
  getProject: (id: string): Promise<ProjectDetail> => ipcRenderer.invoke("project:get", id),
  updateProject: (id: string, patch: Partial<{ name: string; deadline: string; disciplines: string[] }>): Promise<void> =>
    ipcRenderer.invoke("project:update", id, patch),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke("project:delete", id),
  setStageStatus: (projectId: string, stageKey: string, status: StageStatus, skipReason: string): Promise<void> =>
    ipcRenderer.invoke("stage:setStatus", projectId, stageKey, status, skipReason),
  setStageContent: (projectId: string, stageKey: string, fieldKey: string, value: string): Promise<void> =>
    ipcRenderer.invoke("stage:setContent", projectId, stageKey, fieldKey, value),
};

contextBridge.exposeInMainWorld("thesisWorkbench", api);
