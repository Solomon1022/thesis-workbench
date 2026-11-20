import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { extractJson } from "./stage4-service";
import { STAGES } from "../shared/stages";

const STAGE_ROLE: Record<string, "search_assist" | "research_design" | "writing" | "analysis" | "review"> = {
  topic: "research_design",
  design: "research_design",
  proposal: "research_design",
  instruments: "research_design",
  data: "research_design",
  writing: "writing",
  revision: "review",
  midterm: "review",
  analysis: "analysis",
  defense: "writing",
  archive: "writing",
  literature: "search_assist",
  establish: "research_design",
};

export interface FieldSuggestion {
  key: string;
  label: string;
  content: string;
  note: string;
}

export interface SuggestResult {
  ok: boolean;
  message: string;
  suggestions?: FieldSuggestion[];
  advice?: string;
  provider?: string;
  model?: string;
}

/** 全局 AI 辅助：建议（不自动填入）+ 实时对话（带记忆，可随时重新提问/清空）。 */
export class AiAssistService {
  constructor(
    private db: ThesisDB,
    private settings: SettingsService,
  ) {}

  private roleFor(stageKey: string) {
    const roleKey = STAGE_ROLE[stageKey] ?? "research_design";
    const role = this.settings.resolveRole(roleKey);
    if (!role) {
      throw new Error("未配置「" + (roleKey === "research_design" ? "研究设计" : roleKey === "writing" ? "写作" : roleKey === "analysis" ? "分析解释" : roleKey === "search_assist" ? "检索辅助" : "审阅") + "」角色模型：请先在「服务与模型设置 → 任务角色」中分配服务商与模型");
    }
    return role;
  }


  /** 全项目知识汇总：第 0 项信息 + 各阶段已填内容 + 变量 + 假设 + 候选方向 + 文献，作为 AI 的统一上下文。 */
  buildProjectKnowledge(projectId: string): string {
    const detail = this.db.getProjectDetail(projectId);
    const p = detail.project;
    const lines: string[] = [];
    lines.push("# 项目信息");
    lines.push("- 项目名称：" + p.name);
    lines.push("- 学科：" + p.disciplines.join("、"));
    lines.push("- 研究方法：" + p.researchMethod);
    lines.push("- 学历：" + p.educationLevel);
    lines.push("- 截止日期：" + (p.deadline || "未设置"));
    const materials = (p.materials ?? {}) as unknown as Record<string, string>;
    if (Object.values(materials).some((v) => String(v ?? "").trim())) {
      lines.push("- 已有材料：");
      for (const [k, v] of Object.entries(materials)) {
        if (String(v ?? "").trim()) lines.push("  - " + k + "：" + String(v).slice(0, 200));
      }
    }
    lines.push("");
    lines.push("# 各阶段内容");
    for (const s of STAGES) {
      const fields = detail.content[s.key] ?? {};
      const entries = Object.entries(fields).filter(([, v]) => String(v ?? "").trim() !== "");
      if (entries.length > 0) {
        lines.push("## " + s.name);
        for (const [k, v] of entries) lines.push("- " + k + "：" + String(v).slice(0, 300));
      }
    }
    const hypotheses = this.db.listHypotheses(projectId);
    if (hypotheses.length > 0) {
      lines.push("");
      lines.push("# 研究假设卡片");
      for (const h of hypotheses) lines.push("- " + h.number + "：" + h.statement + "（IV: " + h.iv + "，DV: " + h.dv + "，依据: " + h.basis + "）");
    }
    const candidates = this.db.listTopicCandidates(projectId);
    if (candidates.length > 0) {
      lines.push("");
      lines.push("# 已保存候选方向");
      for (const c of candidates) lines.push("- " + c.question);
    }
    const literature = this.db.listLiterature(projectId);
    if (literature.length > 0) {
      lines.push("");
      lines.push("# 文献库（" + literature.length + " 条，只能引用真实存在的条目）");
      literature.slice(0, 15).forEach((l, i) => {
        lines.push((i + 1) + ". " + l.title + " | " + l.authors + " | " + l.year + (l.doi ? " | DOI: " + l.doi : ""));
      });
    }
    return lines.join("\n");
  }

  private stageContext(projectId: string, stageKey: string): string {
    const stageName = STAGES.find((s) => s.key === stageKey)?.name ?? stageKey;
    return "当前阶段：" + stageName + "\n\n以下是该论文项目已确定的全部知识（读取储存的信息；不得编造其中没有的文献、数据、样本量）：\n\n" + this.buildProjectKnowledge(projectId);
  }

  /** 生成字段建议：只返回建议，由用户决定是否填入。 */
  async suggest(projectId: string, stageKey: string, targets: Array<{ key: string; label: string }>): Promise<SuggestResult> {
    const role = this.roleFor(stageKey);
    const targetText = targets.map((t) => t.key + "（" + t.label + "）").join("；");
    const formatHints = targets.map((t) => {
      if (t.key === "variables") return "\"\"variables\"\" 字段的 content 必须是 JSON 对象：{\"iv\":[\"自变量\"],\"dv\":[\"因变量\"],\"mediator\":[\"中介变量\"],\"custom\":[\"其他变量\"]}，只输出 JSON，不要写说明文字；没有的数组留空 []。";
      if (t.key === "hypotheses") return "\"\"hypotheses\"\" 字段的 content 必须是 JSON 数组：[{\"number\":\"H1\",\"statement\":\"假设陈述\",\"iv\":\"自变量\",\"dv\":\"因变量\",\"basis\":\"依据或待核验\"}]，只输出 JSON 数组。";
      return "";
    }).filter(Boolean).join("\n");
    const system = [
      "你是论文写作助手。针对给定字段生成建议内容草稿。",
      "只输出 JSON，不要任何解释：",
      '{"fields":[{"key":"字段key","content":"建议内容","note":"一句说明（依据/注意事项；不足时写「待核验」）"}],"advice":"整体建议"}',
      formatHints ? "字段内容格式要求：" + "\n" + formatHints : "",
      "严格禁止编造数据、文献、样本量与统计结果。建议是草稿，由用户决定是否采用；不要替用户做最终决定。",
    ].filter((s) => s !== "").join("\n");
    const user = this.stageContext(projectId, stageKey) + "\n\n需要生成建议的字段：" + targetText;
    const raw = await chat({
      channel: role.channel,
      apiKey: role.apiKey,

      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 8000,
      temperature: 0.4,
      signal: AbortSignal.timeout(240_000),
    });
    const parsed = extractJson(raw) as { fields?: unknown; advice?: unknown } | null;
    const rawFields = Array.isArray(parsed?.fields) ? parsed.fields : [];
    const validKeys = new Set(targets.map((t) => t.key));
    const suggestions: FieldSuggestion[] = rawFields.map((f) => {
      const r = (f ?? {}) as { key?: unknown; content?: unknown; note?: unknown };
      const key = String(r.key ?? "");
      // content 可能是字符串或结构化对象（如 hypotheses 数组）：统一为可显示、可填入的文本
      const content = typeof r.content === "string" ? r.content : r.content == null ? "" : JSON.stringify(r.content);
      return { key, label: targets.find((t) => t.key === key)?.label ?? key, content: content.trim(), note: String(r.note ?? "").trim() };
    }).filter((s) => validKeys.has(s.key) && s.content.length > 0);
    const advice = typeof parsed?.advice === "string" ? parsed.advice : "";
    if (suggestions.length === 0 && !advice) {
      return { ok: false, message: "模型未返回有效建议（未填入任何内容）" };
    }
    return { ok: true, message: "建议已生成（不会自动填入，请在下方查看并选择采用）", suggestions, advice, provider: role.channel.name, model: role.channel.model };
  }

  /** 实时对话：保留本阶段历史，用户可随时追问或重新提问。 */
  async chat(projectId: string, stageKey: string, message: string): Promise<{ ok: boolean; message: string; reply?: string }> {
    const role = this.roleFor(stageKey);
    this.db.appendConversation(projectId, stageKey, "user", message.trim());
    const history = this.db.listConversations(projectId, stageKey, 20);
    const system = [
      "你是论文写作助手，与研究者就该阶段内容实时对话。",
      "回答要具体、可执行；只能依据研究者提供的当前内容与文献库条目，不得编造文献、数据、样本量与统计结果；不确定处明确说「不确定」并说明需要什么信息。",
    ].join("\n");
    const context = this.stageContext(projectId, stageKey);
    const messages = [
      { role: "system", content: system },
      { role: "user", content: context + "\n\n以下是本阶段对话历史（最早在前）：\n" + history.map((h) => (h.role === "user" ? "问：" : "答：") + h.content).join("\n") + "\n\n现在请回答下面的问题：" },
      { role: "user", content: message.trim() },
    ];
    const raw = await chat({
      channel: role.channel,
      apiKey: role.apiKey,

      messages,
      maxTokens: 8000,
      temperature: 0.5,
      signal: AbortSignal.timeout(240_000),
    });
    const reply = raw.trim();
    this.db.appendConversation(projectId, stageKey, "assistant", reply);
    return { ok: true, message: "", reply };
  }

  /** 第 0 项：根据项目信息（专业/学历/方法/已有材料）生成 3 个选题方向，用户自行选择采用。 */
  async topicOptions(projectId: string): Promise<{ ok: boolean; message: string; options?: Array<{ title: string; rationale: string }> }> {
    const role = this.roleFor("establish");
    const p = this.db.getProjectDetail(projectId).project;
    const materials = (p.materials ?? {}) as unknown as Record<string, string>;
    const materialText = Object.entries(materials).filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => k + "：" + String(v).slice(0, 120)).join("；") || "无";
    const system = [
      "你是论文选题助手。根据学生提供的个人信息生成 3 个可开展的论文选题方向。",
      "只输出 JSON，不要任何解释：",
      '{"options":[{"title":"选题方向（一句话）","rationale":"推荐理由（一句话）"}],"advice":"整体建议"}',
      "选题要结合学科与研究方法、本科/硕士/博士论文的可行范围；禁止编造文献、数据与指导教师信息。",
    ].join("\n");
    const user = "学生信息：\n- 学科：" + p.disciplines.join("、") + "\n- 学历：" + p.educationLevel + "\n- 研究方法偏好：" + p.researchMethod + "\n- 已有材料：" + materialText;
    const raw = await chat({
      channel: role.channel,
      apiKey: role.apiKey,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 4000,
      temperature: 0.6,
      signal: AbortSignal.timeout(240_000),
    });
    const parsed = extractJson(raw) as { options?: unknown } | null;
    const options = (Array.isArray(parsed?.options) ? parsed.options : []).map((o) => {
      const r = (o ?? {}) as { title?: unknown; rationale?: unknown };
      return { title: String(r.title ?? "").trim(), rationale: String(r.rationale ?? "").trim() };
    }).filter((o) => o.title).slice(0, 3);
    if (options.length === 0) return { ok: false, message: "模型未返回选题方向（未生成任何内容）" };
    return { ok: true, message: "已生成 " + options.length + " 个选题方向（AI 建议，请结合自身情况选择）", options };
  }

  listConversations(projectId: string, stageKey: string) {
    return this.db.listConversations(projectId, stageKey, 50);
  }

  clearConversations(projectId: string, stageKey: string): void {
    this.db.clearConversations(projectId, stageKey);
  }
}
