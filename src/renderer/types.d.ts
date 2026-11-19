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
    };
  }
}

export {};
