export type StageStatus = "not_started" | "in_progress" | "needs_review" | "done" | "skipped";

export interface ExistingMaterials {
  title: string;
  literature: string;
  data: string;
  draft: string;
  notes: string;
}

export interface ProjectInput {
  name: string;
  disciplines: string[];
  researchMethod: string;
  educationLevel: string;
  deadline: string;
  materials: ExistingMaterials;
}

export interface Project {
  id: string;
  name: string;
  disciplines: string[];
  researchMethod: string;
  educationLevel: string;
  deadline: string;
  materials: ExistingMaterials;
  createdAt: number;
  updatedAt: number;
}

export interface StageRecord {
  stageKey: string;
  status: StageStatus;
  skipReason: string;
  updatedAt: number;
}

export interface ProjectDetail {
  project: Project;
  stages: StageRecord[];
  content: Record<string, Record<string, string>>;
}
