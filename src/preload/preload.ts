import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionLayerResult, ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
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
  settingsGet: () => ipcRenderer.invoke("settings:get"),
  settingsSaveProfile: (profile: ModelProfile, network: NetworkConfig) => ipcRenderer.invoke("settings:saveProfile", profile, network),
  settingsSaveSecret: (providerKey: string, apiKey: string) => ipcRenderer.invoke("settings:saveSecret", providerKey, apiKey),
  settingsDeleteSecret: (providerKey: string) => ipcRenderer.invoke("settings:deleteSecret", providerKey),
  settingsSaveRole: (roleKey: RoleKey, providerKey: string, model: string) => ipcRenderer.invoke("settings:saveRole", roleKey, providerKey, model),
  settingsTestConnection: (testId: string, providerKey: string): Promise<ConnectionLayerResult[]> =>
    ipcRenderer.invoke("settings:testConnection", testId, providerKey),
  settingsCancelTest: (testId: string) => ipcRenderer.invoke("settings:cancelTest", testId),
};

contextBridge.exposeInMainWorld("thesisWorkbench", api);
