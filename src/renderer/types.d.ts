import type { ConnectionLayerResult, ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
import type { EvidenceCard, LiteratureItem, SearchLogEntry, SearchOutcome } from "../shared/literature";
import type { Project, ProjectDetail, ProjectInput, StageStatus } from "../shared/types";

declare global {
  interface Window {
    thesisWorkbench?: {
      runtime(): Promise<{ platform: string; dbPath: string }>;
      listProjects(): Promise<Project[]>;
      createProject(input: ProjectInput): Promise<ProjectDetail>;
      getProject(id: string): Promise<ProjectDetail>;
      updateProject(id: string, patch: Partial<{ name: string; deadline: string; disciplines: string[] }>): Promise<void>;
      deleteProject(id: string): Promise<void>;
      setStageStatus(projectId: string, stageKey: string, status: StageStatus, skipReason: string): Promise<void>;
      setStageContent(projectId: string, stageKey: string, fieldKey: string, value: string): Promise<void>;
      settingsGet(): Promise<{
        profiles: Array<ModelProfile & NetworkConfig>;
        secretStatus: Record<string, boolean>;
        roles: Array<{ roleKey: RoleKey; providerKey: string; model: string }>;
        encryptionAvailable: boolean;
      }>;
      settingsSaveProfile(profile: ModelProfile, network: NetworkConfig): Promise<unknown>;
      settingsSaveSecret(providerKey: string, apiKey: string): Promise<boolean>;
      settingsDeleteSecret(providerKey: string): Promise<void>;
      settingsSaveRole(roleKey: RoleKey, providerKey: string, model: string): Promise<unknown>;
      settingsTestConnection(testId: string, providerKey: string): Promise<ConnectionLayerResult[]>;
      settingsCancelTest(testId: string): Promise<void>;
      literatureList(projectId: string): Promise<LiteratureItem[]>;
      literatureSearch(projectId: string, source: string, query: string): Promise<{ outcome: SearchOutcome; log: SearchLogEntry }>;
      literatureLookupDoi(doi: string): Promise<{ found: boolean; message: string; item?: SearchOutcome["items"][number] }>;
      literatureSave(projectId: string, input: unknown, opts: { note?: string; manuallyVerified?: boolean }): Promise<{ saved: boolean; message: string; item?: LiteratureItem; existing?: LiteratureItem }>;
      literatureVerifyManual(id: string, note: string): Promise<void>;
      literatureDelete(id: string): Promise<void>;
      literatureAttachPdf(projectId: string, literatureId: string): Promise<{ pdfName?: string; canceled?: boolean }>;
      literatureListEvidence(literatureId: string): Promise<EvidenceCard[]>;
      literatureAddEvidence(projectId: string, literatureId: string, claim: string, location: string): Promise<EvidenceCard>;
      literatureDeleteEvidence(id: string): Promise<void>;
      literatureSearchLog(projectId: string): Promise<SearchLogEntry[]>;
      literatureGenQueries(topic: string): Promise<{ ok: boolean; message: string; queries?: string[]; provider?: string; model?: string }>;
      openExternal(url: string): Promise<boolean>;
    };
  }
}

export {};
