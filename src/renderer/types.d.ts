import type { ConnectionLayerResult, ModelProfile, NetworkConfig, RoleKey } from "../shared/settings";
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
    };
  }
}

export {};
