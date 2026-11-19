import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionLayerResult, ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
import type { EvidenceCard, LiteratureItem, SearchLogEntry, SearchOutcome } from "../shared/literature";
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
  settingsSaveContactEmail: (email: string) => ipcRenderer.invoke("settings:saveContactEmail", email),
  settingsDeleteSecret: (providerKey: string) => ipcRenderer.invoke("settings:deleteSecret", providerKey),
  settingsSaveRole: (roleKey: RoleKey, providerKey: string, model: string) => ipcRenderer.invoke("settings:saveRole", roleKey, providerKey, model),
  settingsTestConnection: (testId: string, providerKey: string): Promise<ConnectionLayerResult[]> =>
    ipcRenderer.invoke("settings:testConnection", testId, providerKey),
  settingsCancelTest: (testId: string) => ipcRenderer.invoke("settings:cancelTest", testId),
  literatureList: (projectId: string): Promise<LiteratureItem[]> => ipcRenderer.invoke("literature:list", projectId),
  literatureSearch: (projectId: string, source: string, query: string): Promise<{ outcome: SearchOutcome; log: SearchLogEntry }> =>
    ipcRenderer.invoke("literature:search", projectId, source, query),
  literatureLookupDoi: (doi: string): Promise<{ found: boolean; message: string; item?: SearchOutcome["items"][number] }> =>
    ipcRenderer.invoke("literature:lookupDoi", doi),
  literatureSave: (projectId: string, input: unknown, opts: { note?: string; manuallyVerified?: boolean }) =>
    ipcRenderer.invoke("literature:save", projectId, input, opts),
  literatureVerifyManual: (id: string, note: string): Promise<void> => ipcRenderer.invoke("literature:verifyManual", id, note),
  literatureDelete: (id: string): Promise<void> => ipcRenderer.invoke("literature:delete", id),
  literatureAttachPdf: (projectId: string, literatureId: string): Promise<{ pdfName?: string; canceled?: boolean }> =>
    ipcRenderer.invoke("literature:attachPdf", projectId, literatureId),
  literatureListEvidence: (literatureId: string): Promise<EvidenceCard[]> => ipcRenderer.invoke("literature:listEvidence", literatureId),
  literatureAddEvidence: (projectId: string, literatureId: string, claim: string, location: string): Promise<EvidenceCard> =>
    ipcRenderer.invoke("literature:addEvidence", projectId, literatureId, claim, location),
  literatureDeleteEvidence: (id: string): Promise<void> => ipcRenderer.invoke("literature:deleteEvidence", id),
  literatureSearchLog: (projectId: string): Promise<SearchLogEntry[]> => ipcRenderer.invoke("literature:searchLog", projectId),
  literatureGenQueries: (topic: string): Promise<{ ok: boolean; message: string; queries?: string[]; provider?: string; model?: string }> =>
    ipcRenderer.invoke("literature:genQueries", topic),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke("shell:openExternal", url),
  stage4GenerateDirections: (projectId: string, inputs: unknown) => ipcRenderer.invoke("stage4:generateDirections", projectId, inputs),
  stage4SaveDirection: (projectId: string, d: unknown) => ipcRenderer.invoke("stage4:saveDirection", projectId, d),
  stage4ListDirections: (projectId: string) => ipcRenderer.invoke("stage4:listDirections", projectId),
  stage4DeleteDirection: (id: string) => ipcRenderer.invoke("stage4:deleteDirection", id),
  stage4GenerateDesignDraft: (projectId: string) => ipcRenderer.invoke("stage4:generateDesignDraft", projectId),
  stage4GenerateProposal: (projectId: string) => ipcRenderer.invoke("stage4:generateProposal", projectId),
  stage4SaveVersion: (projectId: string, stageKey: string, contentJson: string, note: string) => ipcRenderer.invoke("stage4:saveVersion", projectId, stageKey, contentJson, note),
  stage4ListVersions: (projectId: string, stageKey: string) => ipcRenderer.invoke("stage4:listVersions", projectId, stageKey),
  stage4RestoreVersion: (versionId: number) => ipcRenderer.invoke("stage4:restoreVersion", versionId),
  stage4ReplaceHypotheses: (projectId: string, cards: unknown) => ipcRenderer.invoke("stage4:replaceHypotheses", projectId, cards),
  stage4ListHypotheses: (projectId: string) => ipcRenderer.invoke("stage4:listHypotheses", projectId),
  stage4DeleteHypothesis: (id: string) => ipcRenderer.invoke("stage4:deleteHypothesis", id),
};

contextBridge.exposeInMainWorld("thesisWorkbench", api);
