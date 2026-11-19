import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExistingMaterials, Project, ProjectDetail, ProjectInput, StageRecord, StageStatus } from "../shared/types";
import type { ModelProfile, NetworkConfig, RoleAssignment } from "../shared/settings";
import type { EvidenceCard, LiteratureItem, SearchLogEntry } from "../shared/literature";
import { STAGES } from "../shared/stages";
import { suggestStartStage } from "../shared/templates";

const EMPTY_MATERIALS: ExistingMaterials = { title: "", literature: "", data: "", draft: "", notes: "" };

type Row = Record<string, unknown>;
function litRow(r: Row): LiteratureItem {
  return {
    id: String(r.id),
    projectId: String(r.project_id),
    title: String(r.title ?? ""),
    authors: String(r.authors ?? ""),
    year: String(r.year ?? ""),
    venue: String(r.venue ?? ""),
    doi: String(r.doi ?? ""),
    url: String(r.url ?? ""),
    abstract: String(r.abstract ?? ""),
    source: String(r.source) as LiteratureItem["source"],
    verifiedStatus: String(r.verified_status) as LiteratureItem["verifiedStatus"],
    verifiedNote: String(r.verified_note ?? ""),
    fulltextStatus: String(r.fulltext_status) as LiteratureItem["fulltextStatus"],
    pdfName: String(r.pdf_name ?? ""),
    preprint: Number(r.preprint) === 1,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}


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

      CREATE TABLE IF NOT EXISTS literature_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        authors TEXT NOT NULL DEFAULT '',
        year TEXT NOT NULL DEFAULT '',
        venue TEXT NOT NULL DEFAULT '',
        doi TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        abstract TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual',
        verified_status TEXT NOT NULL DEFAULT 'unverified',
        verified_note TEXT NOT NULL DEFAULT '',
        fulltext_status TEXT NOT NULL DEFAULT 'none',
        pdf_name TEXT NOT NULL DEFAULT '',
        preprint INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lit_project ON literature_items(project_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_lit_doi ON literature_items(project_id, doi) WHERE doi <> '';
      CREATE TABLE IF NOT EXISTS evidence_cards (
        id TEXT PRIMARY KEY,
        literature_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        claim TEXT NOT NULL DEFAULT '',
        location TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_evc_lit ON evidence_cards(literature_id);
      CREATE TABLE IF NOT EXISTS search_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        source TEXT NOT NULL,
        query TEXT NOT NULL,
        result_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ok',
        message TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_slog_project ON search_log(project_id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id TEXT NOT NULL,
        stage_key TEXT NOT NULL,
        version_no INTEGER NOT NULL,
        content_json TEXT NOT NULL DEFAULT '{}',
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sv_project ON stage_versions(project_id, stage_key);
      CREATE TABLE IF NOT EXISTS topic_candidates (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        question TEXT NOT NULL DEFAULT '',
        basis_lit_ids TEXT NOT NULL DEFAULT '[]',
        data_path TEXT NOT NULL DEFAULT '',
        feasibility TEXT NOT NULL DEFAULT '',
        limitations TEXT NOT NULL DEFAULT '',
        ai_generated INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS hypothesis_cards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        number TEXT NOT NULL DEFAULT '',
        statement TEXT NOT NULL DEFAULT '',
        iv TEXT NOT NULL DEFAULT '',
        dv TEXT NOT NULL DEFAULT '',
        basis TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_hc_project ON hypothesis_cards(project_id);

      CREATE TABLE IF NOT EXISTS data_files (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        original_name TEXT NOT NULL DEFAULT '',
        row_count INTEGER NOT NULL,
        column_count INTEGER NOT NULL,
        variables_json TEXT NOT NULL DEFAULT '[]',
        stored_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS analysis_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        data_file_id TEXT NOT NULL,
        method TEXT NOT NULL,
        params_json TEXT NOT NULL DEFAULT '{}',
        results_json TEXT NOT NULL DEFAULT '{}',
        formula TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ok',
        message TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_df_project ON data_files(project_id);
      CREATE INDEX IF NOT EXISTS idx_ar_project ON analysis_runs(project_id);

      CREATE TABLE IF NOT EXISTS reviews (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        stage_key TEXT NOT NULL DEFAULT '',
        section TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        suggestion TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        resolution TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rev_project ON reviews(project_id);

      CREATE TABLE IF NOT EXISTS project_snapshots (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        content_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ps_project ON project_snapshots(project_id);
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
    this.db.prepare("DELETE FROM evidence_cards WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM literature_items WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM search_log WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM stage_versions WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM topic_candidates WHERE project_id = ?").run(id);
    this.db.prepare("DELETE FROM hypothesis_cards WHERE project_id = ?").run(id);
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

  // ===== 文献库 =====

  listLiterature(projectId: string): LiteratureItem[] {
    const rows = this.db.prepare("SELECT * FROM literature_items WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Row[];
    return rows.map(litRow);
  }

  findLiteratureByDoi(projectId: string, doi: string): LiteratureItem | null {
    const row = this.db.prepare("SELECT * FROM literature_items WHERE project_id = ? AND doi = ?").get(projectId, doi) as unknown as Row | undefined;
    return row ? litRow(row) : null;
  }

  insertLiterature(item: Omit<LiteratureItem, "id" | "createdAt" | "updatedAt">): LiteratureItem {
    const id = randomUUID();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO literature_items (id, project_id, title, authors, year, venue, doi, url, abstract, source, verified_status, verified_note, fulltext_status, pdf_name, preprint, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, item.projectId, item.title, item.authors, item.year, item.venue, item.doi, item.url, item.abstract, item.source, item.verifiedStatus, item.verifiedNote, item.fulltextStatus, item.pdfName, item.preprint ? 1 : 0, now, now);
    return this.getLiterature(id) as LiteratureItem;
  }

  getLiterature(id: string): LiteratureItem | null {
    const row = this.db.prepare("SELECT * FROM literature_items WHERE id = ?").get(id) as unknown as Row | undefined;
    return row ? litRow(row) : null;
  }

  updateLiterature(id: string, patch: Partial<Pick<LiteratureItem, "title" | "authors" | "year" | "venue" | "doi" | "url" | "abstract" | "verifiedStatus" | "verifiedNote">>): void {
    const current = this.getLiterature(id);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    this.db.prepare(
      `UPDATE literature_items SET title=?, authors=?, year=?, venue=?, doi=?, url=?, abstract=?, verified_status=?, verified_note=?, updated_at=? WHERE id=?`
    ).run(next.title, next.authors, next.year, next.venue, next.doi, next.url, next.abstract, next.verifiedStatus, next.verifiedNote, next.updatedAt, id);
  }

  setLiteraturePdf(id: string, pdfName: string): void {
    this.db.prepare("UPDATE literature_items SET pdf_name=?, fulltext_status=?, updated_at=? WHERE id=?").run(pdfName, pdfName ? "pdf_linked" : "none", Date.now(), id);
  }

  deleteLiterature(id: string): void {
    this.db.prepare("DELETE FROM evidence_cards WHERE literature_id = ?").run(id);
    this.db.prepare("DELETE FROM literature_items WHERE id = ?").run(id);
  }

  listEvidence(literatureId: string): EvidenceCard[] {
    const rows = this.db.prepare("SELECT * FROM evidence_cards WHERE literature_id = ? ORDER BY created_at DESC").all(literatureId) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      literatureId: String(r.literature_id),
      projectId: String(r.project_id),
      claim: String(r.claim ?? ""),
      location: String(r.location ?? ""),
      createdAt: Number(r.created_at),
    }));
  }

  insertEvidence(projectId: string, literatureId: string, claim: string, location: string): EvidenceCard {
    const card: EvidenceCard = { id: randomUUID(), literatureId, projectId, claim, location, createdAt: Date.now() };
    this.db.prepare("INSERT INTO evidence_cards (id, literature_id, project_id, claim, location, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(card.id, card.literatureId, card.projectId, card.claim, card.location, card.createdAt);
    return card;
  }

  deleteEvidence(id: string): void {
    this.db.prepare("DELETE FROM evidence_cards WHERE id = ?").run(id);
  }

  appendSearchLog(projectId: string, source: string, query: string, resultCount: number, status: "ok" | "no_results" | "error", message: string, createdAt?: number): void {
    this.db.prepare("INSERT INTO search_log (project_id, source, query, result_count, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(projectId, source, query, resultCount, status, message, createdAt ?? Date.now());
  }

  listSearchLog(projectId: string): SearchLogEntry[] {
    const rows = this.db.prepare("SELECT * FROM search_log WHERE project_id = ? ORDER BY id DESC LIMIT 50").all(projectId) as unknown as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      projectId: String(r.project_id),
      source: String(r.source),
      query: String(r.query),
      resultCount: Number(r.result_count),
      status: String(r.status) as SearchLogEntry["status"],
      message: String(r.message ?? ""),
      createdAt: Number(r.created_at),
    }));
  }

  // ===== 应用级设置（键值） =====

  getAppSetting(key: string): string {
    const row = this.db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as unknown as Row | undefined;
    return row ? String(row.value ?? "") : "";
  }

  setAppSetting(key: string, value: string): void {
    this.db.prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).run(key, value, Date.now());
  }

  // ===== 阶段 4：版本、候选方向、假设卡片 =====

  nextStageVersionNo(projectId: string, stageKey: string): number {
    const row = this.db.prepare("SELECT MAX(version_no) AS m FROM stage_versions WHERE project_id = ? AND stage_key = ?").get(projectId, stageKey) as unknown as Row | undefined;
    return Number(row?.m ?? 0) + 1;
  }

  saveStageVersion(projectId: string, stageKey: string, contentJson: string, note: string): number {
    const no = this.nextStageVersionNo(projectId, stageKey);
    this.db.prepare("INSERT INTO stage_versions (project_id, stage_key, version_no, content_json, note, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(projectId, stageKey, no, contentJson, note, Date.now());
    return no;
  }

  listStageVersions(projectId: string, stageKey: string): Array<{ id: number; versionNo: number; contentJson: string; note: string; createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM stage_versions WHERE project_id = ? AND stage_key = ? ORDER BY version_no DESC").all(projectId, stageKey) as unknown as Row[];
    return rows.map((r) => ({
      id: Number(r.id),
      versionNo: Number(r.version_no),
      contentJson: String(r.content_json ?? "{}"),
      note: String(r.note ?? ""),
      createdAt: Number(r.created_at),
    }));
  }


  getStageVersion(id: number): { id: number; projectId: string; stageKey: string; versionNo: number; contentJson: string; note: string; createdAt: number } | null {
    const row = this.db.prepare("SELECT * FROM stage_versions WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      projectId: String(row.project_id),
      stageKey: String(row.stage_key),
      versionNo: Number(row.version_no),
      contentJson: String(row.content_json ?? "{}"),
      note: String(row.note ?? ""),
      createdAt: Number(row.created_at),
    };
  }

  // ---- 候选方向 ----

  insertTopicCandidate(input: { projectId: string; question: string; basisLitIds: string[]; dataPath: string; feasibility: string; limitations: string; aiGenerated: boolean }): void {
    this.db.prepare("INSERT INTO topic_candidates (id, project_id, question, basis_lit_ids, data_path, feasibility, limitations, ai_generated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(randomUUID(), input.projectId, input.question, JSON.stringify(input.basisLitIds), input.dataPath, input.feasibility, input.limitations, input.aiGenerated ? 1 : 0, Date.now());
  }

  listTopicCandidates(projectId: string): Array<{ id: string; question: string; basisLitIds: string[]; dataPath: string; feasibility: string; limitations: string; aiGenerated: boolean; createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM topic_candidates WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Row[];
    return rows.map((r) => {
      let ids: string[] = [];
      try { ids = JSON.parse(String(r.basis_lit_ids ?? "[]")) as string[]; } catch { ids = []; }
      return {
        id: String(r.id),
        question: String(r.question ?? ""),
        basisLitIds: ids,
        dataPath: String(r.data_path ?? ""),
        feasibility: String(r.feasibility ?? ""),
        limitations: String(r.limitations ?? ""),
        aiGenerated: Number(r.ai_generated) === 1,
        createdAt: Number(r.created_at),
      };
    });
  }

  deleteTopicCandidate(id: string): void {
    this.db.prepare("DELETE FROM topic_candidates WHERE id = ?").run(id);
  }

  // ---- 假设卡片 ----

  replaceHypotheses(projectId: string, cards: Array<{ number: string; statement: string; iv: string; dv: string; basis: string }>): void {
    const tx = this.db;
    tx.exec("BEGIN");
    try {
      tx.prepare("DELETE FROM hypothesis_cards WHERE project_id = ?").run(projectId);
      const insert = tx.prepare("INSERT INTO hypothesis_cards (id, project_id, number, statement, iv, dv, basis, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
      const now = Date.now();
      for (const c of cards) insert.run(randomUUID(), projectId, c.number, c.statement, c.iv, c.dv, c.basis, now, now);
      tx.exec("COMMIT");
    } catch (error) {
      tx.exec("ROLLBACK");
      throw error;
    }
  }

  listHypotheses(projectId: string): Array<{ id: string; number: string; statement: string; iv: string; dv: string; basis: string }> {
    const rows = this.db.prepare("SELECT * FROM hypothesis_cards WHERE project_id = ? ORDER BY number").all(projectId) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      number: String(r.number ?? ""),
      statement: String(r.statement ?? ""),
      iv: String(r.iv ?? ""),
      dv: String(r.dv ?? ""),
      basis: String(r.basis ?? ""),
    }));
  }

  deleteHypothesis(id: string): void {
    this.db.prepare("DELETE FROM hypothesis_cards WHERE id = ?").run(id);
  }

  // ===== 阶段 5：数据文件与分析运行 =====

  insertDataFile(input: { projectId: string; name: string; kind: string; originalName: string; rowCount: number; columnCount: number; variablesJson: string; storedPath: string }): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO data_files (id, project_id, name, kind, original_name, row_count, column_count, variables_json, stored_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId, input.name, input.kind, input.originalName, input.rowCount, input.columnCount, input.variablesJson, input.storedPath, Date.now());
    return id;
  }

  listDataFiles(projectId: string): Array<{ id: string; name: string; kind: string; originalName: string; rowCount: number; columnCount: number; variablesJson: string; storedPath: string; createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM data_files WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      kind: String(r.kind ?? ""),
      originalName: String(r.original_name ?? ""),
      rowCount: Number(r.row_count),
      columnCount: Number(r.column_count),
      variablesJson: String(r.variables_json ?? "[]"),
      storedPath: String(r.stored_path ?? ""),
      createdAt: Number(r.created_at),
    }));
  }

  updateDataFileStoredPath(id: string, storedPath: string): void {
    this.db.prepare("UPDATE data_files SET stored_path = ? WHERE id = ?").run(storedPath, id);
  }

  getDataFile(id: string): { id: string; projectId: string; name: string; kind: string; originalName: string; rowCount: number; columnCount: number; variablesJson: string; storedPath: string } | null {
    const r = this.db.prepare("SELECT * FROM data_files WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name ?? ""),
      kind: String(r.kind ?? ""),
      originalName: String(r.original_name ?? ""),
      rowCount: Number(r.row_count),
      columnCount: Number(r.column_count),
      variablesJson: String(r.variables_json ?? "[]"),
      storedPath: String(r.stored_path ?? ""),
    };
  }

  deleteDataFile(id: string): void {
    this.db.prepare("DELETE FROM analysis_runs WHERE data_file_id = ?").run(id);
    this.db.prepare("DELETE FROM data_files WHERE id = ?").run(id);
  }

  insertAnalysisRun(input: { projectId: string; dataFileId: string; method: string; paramsJson: string; resultsJson: string; formula: string; status: "ok" | "error"; message: string }): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO analysis_runs (id, project_id, data_file_id, method, params_json, results_json, formula, status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId, input.dataFileId, input.method, input.paramsJson, input.resultsJson, input.formula, input.status, input.message, Date.now());
    return id;
  }

  listAnalysisRuns(projectId: string): Array<{ id: string; dataFileId: string; method: string; paramsJson: string; resultsJson: string; formula: string; status: string; message: string; createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM analysis_runs WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      dataFileId: String(r.data_file_id),
      method: String(r.method ?? ""),
      paramsJson: String(r.params_json ?? "{}"),
      resultsJson: String(r.results_json ?? "{}"),
      formula: String(r.formula ?? ""),
      status: String(r.status ?? "ok"),
      message: String(r.message ?? ""),
      createdAt: Number(r.created_at),
    }));
  }

  getAnalysisRun(id: string): { id: string; projectId: string; dataFileId: string; method: string; paramsJson: string; resultsJson: string; formula: string; status: string; message: string } | null {
    const r = this.db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      dataFileId: String(r.data_file_id),
      method: String(r.method ?? ""),
      paramsJson: String(r.params_json ?? "{}"),
      resultsJson: String(r.results_json ?? "{}"),
      formula: String(r.formula ?? ""),
      status: String(r.status ?? "ok"),
      message: String(r.message ?? ""),
    };
  }

  deleteAnalysisRun(id: string): void {
    this.db.prepare("DELETE FROM analysis_runs WHERE id = ?").run(id);
  }

  // ===== 阶段 6：审阅意见 =====

  insertReview(input: { projectId: string; stageKey: string; section: string; source: string; content: string; suggestion: string; status?: string; resolution?: string; createdAt?: number }): string {
    const id = randomUUID();
    const now = input.createdAt ?? Date.now();
    this.db.prepare("INSERT INTO reviews (id, project_id, stage_key, section, source, content, suggestion, status, resolution, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId, input.stageKey, input.section, input.source, input.content, input.suggestion, input.status ?? "pending", input.resolution ?? "", now, now);
    return id;
  }

  listReviews(projectId: string): Array<{ id: string; stageKey: string; section: string; source: string; content: string; suggestion: string; status: string; resolution: string; createdAt: number; updatedAt: number }> {
    const rows = this.db.prepare("SELECT * FROM reviews WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      stageKey: String(r.stage_key ?? ""),
      section: String(r.section ?? ""),
      source: String(r.source ?? ""),
      content: String(r.content ?? ""),
      suggestion: String(r.suggestion ?? ""),
      status: String(r.status ?? "pending"),
      resolution: String(r.resolution ?? ""),
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at),
    }));
  }

  updateReview(id: string, patch: { stageKey?: string; section?: string; source?: string; content?: string; suggestion?: string; status?: string; resolution?: string }): void {
    const current = this.db.prepare("SELECT * FROM reviews WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!current) return;
    const next = {
      stageKey: patch.stageKey ?? String(current.stage_key ?? ""),
      section: patch.section ?? String(current.section ?? ""),
      source: patch.source ?? String(current.source ?? ""),
      content: patch.content ?? String(current.content ?? ""),
      suggestion: patch.suggestion ?? String(current.suggestion ?? ""),
      status: patch.status ?? String(current.status ?? "pending"),
      resolution: patch.resolution ?? String(current.resolution ?? ""),
    };
    this.db.prepare("UPDATE reviews SET stage_key=?, section=?, source=?, content=?, suggestion=?, status=?, resolution=?, updated_at=? WHERE id=?")
      .run(next.stageKey, next.section, next.source, next.content, next.suggestion, next.status, next.resolution, Date.now(), id);
  }

  deleteReview(id: string): void {
    this.db.prepare("DELETE FROM reviews WHERE id = ?").run(id);
  }

  // ===== 阶段 6：项目快照 =====

  insertProjectSnapshot(projectId: string, name: string, contentJson: string): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO project_snapshots (id, project_id, name, content_json, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, projectId, name, contentJson, Date.now());
    return id;
  }

  listProjectSnapshots(projectId: string): Array<{ id: string; name: string; contentJson: string; createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM project_snapshots WHERE project_id = ? ORDER BY created_at DESC").all(projectId) as unknown as Row[];
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name ?? ""),
      contentJson: String(r.content_json ?? "{}"),
      createdAt: Number(r.created_at),
    }));
  }

  getProjectSnapshot(id: string): { id: string; projectId: string; name: string; contentJson: string; createdAt: number } | null {
    const r = this.db.prepare("SELECT * FROM project_snapshots WHERE id = ?").get(id) as unknown as Row | undefined;
    if (!r) return null;
    return {
      id: String(r.id),
      projectId: String(r.project_id),
      name: String(r.name ?? ""),
      contentJson: String(r.content_json ?? "{}"),
      createdAt: Number(r.created_at),
    };
  }

  deleteProjectSnapshot(id: string): void {
    this.db.prepare("DELETE FROM project_snapshots WHERE id = ?").run(id);
  }

}
