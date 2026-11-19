import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { fieldsFor, METHOD_TEMPLATES } from "../shared/templates";
import type { LiteratureItem } from "../shared/literature";

/** 从模型输出中容错提取 JSON（支持代码块包裹与前后缀说明文字） */
export function extractJson(text: string): unknown | null {
  const cleaned = text.replace(/`{3}(?:json)?/gi, "").trim();
  try { return JSON.parse(cleaned); } catch { /* 继续尝试提取 */ }
  const pairs: Array<[string, string]> = [["[", "]"], ["{", "}"]];
  for (const [open, close] of pairs) {
    const start = cleaned.indexOf(open);
    if (start < 0) continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") inStr = true;
      else if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
  }
  return null;
}

interface DirectionInput {
  discipline: string;
  interests: string;
  object: string;
  timeCondition: string;
  dataCondition: string;
}

export interface GeneratedDirection {
  question: string;
  basisLitIds: string[];
  basis: LiteratureItem[];
  missingBasis: boolean;
  dataPath: string;
  feasibility: string;
  limitations: string;
}

export interface DesignDraft {
  fields: Record<string, string>;
  hypotheses: Array<{ number: string; statement: string; iv: string; dv: string; basis: string }>;
  note: string;
}

export interface ProposalSection {
  title: string;
  content: string;
}

/** 阶段 4 服务：AI 只做草稿与框架，依据必须来自真实文献库；所有输出标记 AI 生成。 */
export class Stage4Service {
  constructor(
    private db: ThesisDB,
    private settings: SettingsService,
  ) {}

  private litLines(items: LiteratureItem[]): string {
    return items.map((l, i) => i + ". " + l.title + " | " + l.authors + " | " + l.year + " | " + (l.doi || "无 DOI")).join("\n");
  }

  private requireRole() {
    const role = this.settings.resolveRole("research_design");
    if (!role) {
      throw new Error("未配置「研究设计」角色模型：请先在「服务与模型设置 → 任务角色」中分配服务商与模型");
    }
    return role;
  }

  private async ask(role: NonNullable<ReturnType<Stage4Service["requireRole"]>>, system: string, user: string): Promise<string> {
    return chat({
      profile: role.profile,
      apiKey: role.apiKey,
      network: { mode: role.profile.mode, proxyUrl: role.profile.proxyUrl },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 2000,
      signal: AbortSignal.timeout(60_000),
    });
  }

  /** 从零选题：基于真实文献库生成候选方向；引用校验，编造来源一律标待核验。 */
  async generateDirections(projectId: string, inputs: DirectionInput): Promise<{ ok: boolean; message: string; directions?: GeneratedDirection[]; provider?: string; model?: string }> {
    const role = this.requireRole();
    const literature = this.db.listLiterature(projectId).slice(0, 12);
    const litText = literature.length > 0 ? this.litLines(literature) : "（文献库为空：不得引用任何文献，依据一律标注「来源待核验」）";
    const system = [
      "你是论文选题助手。基于用户输入与提供的真实文献列表，生成 3-5 个候选研究方向。",
      "只输出 JSON 数组，不要任何解释。每个元素格式：",
      '{"question":"研究问题（一句话，可检验、有边界）","basis":[文献序号数组，只能引用下方列表中的序号；没有依据写 []],"data_path":"数据/材料获取路径","feasibility":"可行性","limitations":"限制与风险"}',
      "严格禁止：编造文献、作者、DOI、数据。引用列表之外的依据一律不写进 basis，并在 limitations 中注明「来源待核验」。",
    ].join("\n");
    const user = "学科/专业：" + inputs.discipline + "\n兴趣：" + inputs.interests + "\n研究对象：" + inputs.object + "\n时间条件：" + inputs.timeCondition + "\n数据条件：" + inputs.dataCondition + "\n\n文献列表（只能引用其中的序号）：\n" + litText;
    const content = await this.ask(role, system, user);
    const parsed = extractJson(content);
    const arr = Array.isArray(parsed) ? parsed : [];
    const directions: GeneratedDirection[] = arr.slice(0, 5).map((d) => {
      const raw = (d ?? {}) as { question?: unknown; basis?: unknown; data_path?: unknown; feasibility?: unknown; limitations?: unknown };
      const basisRaw = Array.isArray(raw.basis) ? (raw.basis as unknown[]) : [];
      const basisIdx = basisRaw.filter((n): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n < literature.length);
      const citedMissing = basisRaw.length > 0 && basisIdx.length < basisRaw.length;
      const basisLit = basisIdx.map((i) => literature[i]);
      return {
        question: String(raw.question ?? "").trim(),
        basisLitIds: basisLit.map((l) => l.id),
        basis: basisLit,
        missingBasis: citedMissing || basisLit.length === 0,
        dataPath: String(raw.data_path ?? ""),
        feasibility: String(raw.feasibility ?? ""),
        limitations: String(raw.limitations ?? ""),
      };
    }).filter((d) => d.question.length > 0);
    if (directions.length === 0) {
      return { ok: false, message: "模型未返回有效候选方向（未保存任何内容）" };
    }
    return { ok: true, message: "AI 生成的候选方向（依据已按文献库校验，未核验内容已标注）", directions, provider: role.profile.name, model: role.model };
  }

  saveDirection(projectId: string, d: GeneratedDirection): void {
    this.db.insertTopicCandidate({
      projectId,
      question: d.question,
      basisLitIds: d.basisLitIds,
      dataPath: d.dataPath,
      feasibility: d.feasibility,
      limitations: d.limitations,
      aiGenerated: true,
    });
  }

  listDirections(projectId: string) {
    return this.db.listTopicCandidates(projectId);
  }

  deleteDirection(id: string): void {
    this.db.deleteTopicCandidate(id);
  }

  /** 研究设计起草：按该方法的真实字段字典生成草稿；未知字段丢弃；问卷方法生成假设卡片。 */
  async generateDesignDraft(projectId: string): Promise<{ ok: boolean; message: string; draft?: DesignDraft; provider?: string; model?: string }> {
    const role = this.requireRole();
    const project = this.db.getProjectDetail(projectId);
    const method = project.project.researchMethod;
    const methodLabel = METHOD_TEMPLATES[method]?.label ?? method;
    const { fields } = fieldsFor(method, "design");
    const fieldDict = fields.map((f) => f.key + "（" + f.label + "）").join("；");
    const current = project.content["design"] ?? {};
    const currentText = Object.entries(current).map(([k, v]) => k + ": " + v).join("\n") || "（尚无输入）";
    const topicContent = project.content["topic"] ?? {};
    const topicText = Object.entries(topicContent).map(([k, v]) => k + ": " + v).join("\n") || "（选题阶段尚无输入）";
    const savedDirections = this.db.listTopicCandidates(projectId).map((c) => "- " + c.question).join("\n");
    const literature = this.db.listLiterature(projectId).slice(0, 12);
    const litText = literature.length > 0 ? this.litLines(literature) : "（文献库为空：不得引用文献，依据标注「待核验」）";
    const isQuestionnaire = method === "questionnaire";
    const system = [
      "你是研究设计助手。按给定字段字典为每个字段起草内容。",
      "只输出 JSON，不要任何解释：",
      '{"fields":{"字段key":"草稿文本"},"hypotheses":[]}',
      isQuestionnaire
        ? "本方法是问卷定量研究：hypotheses 输出假设卡片数组 [{\"number\":\"H1\",\"statement\":\"假设陈述\",\"iv\":\"自变量\",\"dv\":\"因变量\",\"basis\":\"依据（来自文献列表或标注待核验）\"}]。不强制中介、调节或控制变量；横截面相关不写成因果。"
        : "非问卷方法 hypotheses 输出空数组 []。",
      "严格禁止：编造数据、样本量、文献、性能数字。不确定的内容写明「待核验」。只能引用提供的文献。",
    ].join("\n");
    const user = "研究方法：" + methodLabel + "\n字段字典：" + fieldDict + "\n已有输入：\n" + currentText + "\n\n选题阶段内容：\n" + topicText + "\n\n已保存候选方向：\n" + (savedDirections || "（无）") + "\n\n文献依据：\n" + litText;
    const content = await this.ask(role, system, user);
    const parsed = extractJson(content) as { fields?: unknown; hypotheses?: unknown } | null;
    const rawFields = (parsed && typeof parsed.fields === "object" && parsed.fields !== null ? parsed.fields : {}) as Record<string, unknown>;
    const validKeys = new Set(fields.map((f) => f.key));
    const draftFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(rawFields)) {
      if (validKeys.has(k) && typeof v === "string") draftFields[k] = v;
    }
    const hypotheses = isQuestionnaire
      ? (Array.isArray(parsed?.hypotheses) ? parsed.hypotheses : []).map((h) => {
          const r = (h ?? {}) as { number?: unknown; statement?: unknown; iv?: unknown; dv?: unknown; basis?: unknown };
          return {
            number: String(r.number ?? "").trim(),
            statement: String(r.statement ?? "").trim(),
            iv: String(r.iv ?? "").trim(),
            dv: String(r.dv ?? "").trim(),
            basis: String(r.basis ?? "").trim(),
          };
        }).filter((h) => h.statement.length > 0).slice(0, 10)
      : [];
    if (Object.keys(draftFields).length === 0 && hypotheses.length === 0) {
      return { ok: false, message: "模型未返回有效草稿（未写入任何字段）" };
    }
    return {
      ok: true,
      message: "AI 草稿已生成（字段按模板字典过滤；请人工复核后使用，版本保存前内容不会覆盖旧版本）",
      draft: { fields: draftFields, hypotheses, note: "AI 生成 " + new Date().toLocaleString("zh-CN") },
      provider: role.profile.name,
      model: role.model,
    };
  }

  /** 开题报告章节框架。 */
  async generateProposal(projectId: string): Promise<{ ok: boolean; message: string; sections?: ProposalSection[]; provider?: string; model?: string }> {
    const role = this.requireRole();
    const project = this.db.getProjectDetail(projectId);
    const design = project.content["design"] ?? {};
    const designText = Object.entries(design).map(([k, v]) => k + ": " + v).join("\n") || "（研究设计尚无内容）";
    const candidates = this.db.listTopicCandidates(projectId).map((c) => c.question).join("\n") || "（无已保存候选方向）";
    const literature = this.db.listLiterature(projectId).slice(0, 12);
    const litText = literature.length > 0 ? this.litLines(literature) : "（文献库为空：不得引用文献）";
    const system = [
      "你是开题报告助手。基于研究设计内容与文献依据，生成开题报告章节框架。",
      "只输出 JSON，不要任何解释：",
      '{"sections":[{"title":"章节标题","content":"草稿段落"}]}',
      "章节建议：研究背景与问题、研究目标与内容、研究方法与技术路线、预期结果、进度安排（可增减）。",
      "引用文献用「[作者, 年份]」格式，只能引用提供的文献；不确定的内容标注「待核验」；禁止编造文献、数据与方法结果。",
    ].join("\n");
    const user = "研究设计内容：\n" + designText + "\n\n候选方向：\n" + candidates + "\n\n文献依据：\n" + litText;
    const content = await this.ask(role, system, user);
    const parsed = extractJson(content) as { sections?: unknown } | null;
    const sections = Array.isArray(parsed?.sections)
      ? parsed.sections.map((s) => {
          const r = (s ?? {}) as { title?: unknown; content?: unknown };
          return { title: String(r.title ?? "").trim(), content: String(r.content ?? "").trim() };
        }).filter((s) => s.title.length > 0).slice(0, 10)
      : [];
    if (sections.length === 0) {
      return { ok: false, message: "模型未返回有效章节框架（未写入任何内容）" };
    }
    return { ok: true, message: "开题框架已生成（AI 草稿，请人工复核与编辑）", sections, provider: role.profile.name, model: role.model };
  }

  // ---- 版本 ----

  saveVersion(projectId: string, stageKey: string, contentJson: string, note: string): number {
    return this.db.saveStageVersion(projectId, stageKey, contentJson, note);
  }

  listVersions(projectId: string, stageKey: string) {
    return this.db.listStageVersions(projectId, stageKey);
  }

  restoreVersion(versionId: number): { contentJson: string; versionNo: number; warning: string } | null {
    const version = this.db.getStageVersion(versionId);
    if (!version) return null;
    return {
      contentJson: version.contentJson,
      versionNo: version.versionNo,
      warning: "已恢复版本 v" + version.versionNo + "；下游（问卷、数据、分析、章节）内容可能基于旧版本，请人工复核后再继续",
    };
  }

  // ---- 假设卡片 ----

  replaceHypotheses(projectId: string, cards: Array<{ number: string; statement: string; iv: string; dv: string; basis: string }>): void {
    this.db.replaceHypotheses(projectId, cards);
  }

  listHypotheses(projectId: string) {
    return this.db.listHypotheses(projectId);
  }

  deleteHypothesis(id: string): void {
    this.db.deleteHypothesis(id);
  }
}
