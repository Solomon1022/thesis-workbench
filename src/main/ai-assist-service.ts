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

  private stageContext(projectId: string, stageKey: string): string {
    const detail = this.db.getProjectDetail(projectId);
    const fields = detail.content[stageKey] ?? {};
    const text = Object.entries(fields).map(([k, v]) => k + ": " + String(v).slice(0, 200)).join("\n");
    const litCount = this.db.listLiterature(projectId).length;
    return "阶段：" + (STAGES.find((s) => s.key === stageKey)?.name ?? stageKey) + "\n当前已填内容：\n" + (text || "（尚无）") + "\n文献库条目数：" + litCount + "（如需引用文献，请让用户从文献库选择具体条目，不要编造文献、数据或样本量）";
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
      profile: role.profile,
      apiKey: role.apiKey,
      network: { mode: role.profile.mode, proxyUrl: role.profile.proxyUrl },
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
      return { key, label: targets.find((t) => t.key === key)?.label ?? key, content: String(r.content ?? "").trim(), note: String(r.note ?? "").trim() };
    }).filter((s) => validKeys.has(s.key) && s.content.length > 0);
    const advice = typeof parsed?.advice === "string" ? parsed.advice : "";
    if (suggestions.length === 0 && !advice) {
      return { ok: false, message: "模型未返回有效建议（未填入任何内容）" };
    }
    return { ok: true, message: "建议已生成（不会自动填入，请在下方查看并选择采用）", suggestions, advice, provider: role.profile.name, model: role.model };
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
      profile: role.profile,
      apiKey: role.apiKey,
      network: { mode: role.profile.mode, proxyUrl: role.profile.proxyUrl },
      messages,
      maxTokens: 8000,
      temperature: 0.5,
      signal: AbortSignal.timeout(240_000),
    });
    const reply = raw.trim();
    this.db.appendConversation(projectId, stageKey, "assistant", reply);
    return { ok: true, message: "", reply };
  }

  listConversations(projectId: string, stageKey: string) {
    return this.db.listConversations(projectId, stageKey, 50);
  }

  clearConversations(projectId: string, stageKey: string): void {
    this.db.clearConversations(projectId, stageKey);
  }
}
