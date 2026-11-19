import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExistingMaterials, Project, ProjectDetail, ProjectInput, StageRecord, StageStatus } from "../shared/types";
import type { ModelProfile, NetworkConfig, RoleAssignment } from "../shared/settings";
import { STAGES } from "../shared/stages";
import { suggestStartStage } from "../shared/templates";

const EMPTY_MATERIALS: ExistingMaterials = { title: "", literature: "", data: "", draft: "", notes: "" };

type Row = Record<string, unknown>;

// 打包器会把 node: 前缀剥掉（"sqlite" 裸名在 Electron 中不可解析），
// 因此通过 process.getBuiltinModule 在运行时加载 node:sqlite。
const sqliteModule = process.getBuiltinModule("node:sqlite") as
  | { DatabaseSync: new (path: string) => DatabaseSyncType }
  | undefined;
if (!sqliteModule) throw new Error("当前运行环境缺少 node:sqlite（需要 Electron 45 / Node 22.5+）");
const DatabaseSync = sqliteModule.DatabaseSync;

/**
 * 本地持久化层（SQLite）。
 * 使用 Electron 内置 Node 的 node:sqlite（免原生模块打包）。
 * 决策依据：better-sqlite3 暂无 Electron 45（ABI 150）预编译产物，本地编译链不稳定；
 * node:sqlite 是 Electron 45 内置 Node 24 自带能力，已实测可用。见 docs/技术决策记录.md。
 */
export class ThesisDB {
  readonly path: string;
  private db: DatabaseSyncType;

  constructor(dbPath: string) {
    this.path = dbPath;
    if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        disciplines TEXT NOT NULL DEFAULT '[]',
        research_method TEXT NOT NULL DEFAULT '',
        education_level TEXT NOT NULL DEFAULT '本科',
        deadline TEXT NOT NULL DEFAULT '',
        materials TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stages (
        project_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'not_started',
        skip_reason TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, stage_key)
      );
      CREATE TABLE IF NOT EXISTS stage_content (
        project_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        field_key TEXT NOT NULL,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, stage_key, field_key)
      );

      CREATE TABLE IF NOT EXISTS model_profiles (
        provider_key TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        api_style TEXT NOT NULL DEFAULT 'openai',
        network_mode TEXT NOT NULL DEFAULT 'direct',
        proxy_url TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_secrets (
        provider_key TEXT PRIMARY KEY,
        ciphertext TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS role_assignments (
        role_key TEXT PRIMARY KEY,
        provider_key TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
    `);
  }

  close(): void { this.db.close(); }

  listProjects(): Project[] {
    const rows = this.db.prepare("SELECT * FROM projects ORDER BY updated_at DESC").all() as unknown as Row[];
    return rows.map((r) => this.rowToProject(r));
  }

  createProject(input: ProjectInput): ProjectDetail {
    const now = Date.now();
    const id = randomUUID();
    const materials: ExistingMaterials = { ...EMPTY_MATERIALS, ...input.materials };
    this.db.prepare(
      `INSERT INTO projects (id, name, disciplines, research_method, education_level, deadline, materials, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, input.name.trim(), JSON.stringify(input.disciplines), input.researchMethod,
      input.educationLevel, (input.deadline ?? "").trim(), JSON.stringify(materials), now, now,
    );
    // 阶段初始化：已有材料 → 自动跳过中间阶段并从建议阶段开始
    const suggestion = suggestStartStage(materials);
    const order = STAGES.map((s) => s.key);
    const startIndex = Math.max(1, order.indexOf(suggestion.stageKey));
    const insert = this.db.prepare("INSERT INTO stages (project_id, stage_key, status, skip_reason, updated_at) VALUES (?, ?, ?, ?, ?)");
    STAGES.forEach((stage, index) => {
      let status: StageStatus = "not_started";
      let skipReason = "";
      if (index === 0) status = "done"; // 建立项目阶段由创建向导完成
      else if (index < startIndex) { status = "skipped"; skipReason = "已有材料，从「" + STAGES[startIndex].name + "」阶段进入"; }
      else if (index === startIndex) status = "in_progress";
      insert.run(id, stage.key, status, skipReason, now);
    });
    return this.getProjectDetail(id);
  }

  getProjectDetail(id: string): ProjectDetail {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!row) throw new Error("项目不存在");
    const stageRows = this.db.prepare("SELECT * FROM stages WHERE project_id = ?").all(id) as unknown as Row[];
    const stages: StageRecord[] = stageRows.map((r) => ({
      stageKey: String(r.stage_key),
      status: String(r.status) as StageStatus,
      skipReason: String(r.skip_reason ?? ""),
      updatedAt: Number(r.updated_at),
    }));
    const contentRows = this.db.prepare("SELECT * FROM stage_content WHERE project_id = ?").all(id) as unknown as Row[];
    const content: Record<string, Record<string, string>> = {};
    for (const r of contentRows) {
      const sk = String(r.stage_key);
      (content[sk] ??= {})[String(r.field_key)] = String(r.value);
    }
    return { project: this.rowToProject(row), stages, content };
  }

  updateProject(id: string, patch: { name?: string; deadline?: string; disciplines?: string[] }): void {
    const cur = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!cur) throw new Error("项目不存在");
    let disciplines: string[] = [];
    try { disciplines = JSON.parse(String(cur.disciplines)) as string[]; } catch { /* keep empty */ }
    this.db.prepare("UPDATE projects SET name = ?, deadline = ?, disciplines = ?, updated_at = ? WHERE id = ?").run(
      patch.name ?? String(cur.name),
      patch.deadline ?? String(cur.deadline ?? ""),
      JSON.stringify(patch.disciplines ?? disciplines),
      Date.now(), id,
    );
  }

  deleteProject(id: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM stage_content WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM stages WHERE project_id = ?").run(id);
      this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  setStageStatus(projectId: string, stageKey: string, status: StageStatus, skipReason: string): void {
    this.db.prepare(
      `INSERT INTO stages (project_id, stage_key, status, skip_reason, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, stage_key) DO UPDATE SET status = excluded.status, skip_reason = excluded.skip_reason, updated_at = excluded.updated_at`
    ).run(projectId, stageKey, status, skipReason, Date.now());
    this.touch(projectId);
  }

  setStageContent(projectId: string, stageKey: string, fieldKey: string, value: string): void {
    this.db.prepare(
      `INSERT INTO stage_content (project_id, stage_key, field_key, value, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, stage_key, field_key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(projectId, stageKey, fieldKey, value, Date.now());
    this.touch(projectId);
  }

  private touch(projectId: string): void {
    this.db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(Date.now(), projectId);
  }

  private rowToProject(r: Row): Project {
    let materials: ExistingMaterials;
    try { materials = JSON.parse(String(r.materials)) as ExistingMaterials; } catch { materials = { ...EMPTY_MATERIALS }; }
    let disciplines: string[] = [];
    try { disciplines = JSON.parse(String(r.disciplines)) as string[]; } catch { /* keep empty */ }
    return {
      id: String(r.id), name: String(r.name), disciplines, researchMethod: String(r.research_method ?? ""),
      educationLevel: String(r.education_level ?? ""), deadline: String(r.deadline ?? ""),
      materials, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
    };
  }
  // ===== 模型与角色设置 =====

  listModelProfiles(): Array<ModelProfile & NetworkConfig> {
    const rows = this.db.prepare("SELECT * FROM model_profiles").all() as unknown as Row[];
    return rows.map((r) => ({
      providerKey: String(r.provider_key),
      name: String(r.name),
      baseUrl: String(r.base_url ?? ""),
      model: String(r.model ?? ""),
      apiStyle: String(r.api_style) as "openai" | "anthropic",
      mode: String(r.network_mode) as NetworkConfig["mode"],
      proxyUrl: String(r.proxy_url ?? ""),
    }));
  }

  upsertModelProfile(profile: ModelProfile, network: NetworkConfig): void {
    this.db.prepare(
      `INSERT INTO model_profiles (provider_key, name, base_url, model, api_style, network_mode, proxy_url, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider_key) DO UPDATE SET name = excluded.name, base_url = excluded.base_url, model = excluded.model,
         api_style = excluded.api_style, network_mode = excluded.network_mode, proxy_url = excluded.proxy_url, updated_at = excluded.updated_at`
    ).run(profile.providerKey, profile.name, profile.baseUrl, profile.model, profile.apiStyle, network.mode, network.proxyUrl, Date.now());
  }

  /** 返回密文（base64）。加解密在服务层用 safeStorage 完成，数据层不接触明文。 */
  getModelSecret(providerKey: string): string {
    const row = this.db.prepare("SELECT ciphertext FROM model_secrets WHERE provider_key = ?").get(providerKey) as unknown as Row | undefined;
    return row ? String(row.ciphertext ?? "") : "";
  }

  setModelSecret(providerKey: string, ciphertext: string): void {
    this.db.prepare(
      `INSERT INTO model_secrets (provider_key, ciphertext, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(provider_key) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`
    ).run(providerKey, ciphertext, Date.now());
  }

  deleteModelSecret(providerKey: string): void {
    this.db.prepare("DELETE FROM model_secrets WHERE provider_key = ?").run(providerKey);
  }

  secretStatus(): Record<string, boolean> {
    const rows = this.db.prepare("SELECT provider_key, ciphertext FROM model_secrets").all() as unknown as Row[];
    const out: Record<string, boolean> = {};
    for (const r of rows) out[String(r.provider_key)] = String(r.ciphertext ?? "").length > 0;
    return out;
  }

  listRoleAssignments(): RoleAssignment[] {
    const rows = this.db.prepare("SELECT * FROM role_assignments").all() as unknown as Row[];
    return rows.map((r) => ({
      roleKey: String(r.role_key) as RoleAssignment["roleKey"],
      providerKey: String(r.provider_key ?? ""),
      model: String(r.model ?? ""),
    }));
  }

  setRoleAssignment(roleKey: string, providerKey: string, model: string): void {
    this.db.prepare(
      `INSERT INTO role_assignments (role_key, provider_key, model, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(role_key) DO UPDATE SET provider_key = excluded.provider_key, model = excluded.model, updated_at = excluded.updated_at`
    ).run(roleKey, providerKey, model, Date.now());
  }

}
