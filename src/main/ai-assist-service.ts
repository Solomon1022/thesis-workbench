import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { extractJson } from "./stage4-service";
import { STAGES } from "../shared/stages";
import { METHOD_ORDER } from "../shared/templates";

/** 选题顾问提示词（源自用户提供的《AI 按学历专业生成选题提示词》核心规则） */
const TOPIC_ADVISOR_SYSTEM = [
  "你是一名熟悉高等教育与学术论文写作的选题顾问。请根据学生的学历、专业与条件生成 3 个可实际完成的候选论文题目。",
  "【约束】",
  "1. 学历定难度：大专偏真实岗位与具体业务场景；本科边界清晰、数据或材料可获得、基础方法可完成；硕士有明确理论框架与作用机制；博士有经过文献验证的理论缺口。",
  "2. 专业定边界：选题与专业知识相关，允许合理跨学科。",
  "3. 题目要具体：明确研究对象、核心问题与研究范围，禁止只写「XX研究」「XX分析」这类空题目。",
  "4. 不把热点等同于有价值，不堆叠复杂理论与技术名词，不为显高级而加模型。",
  "5. 严禁编造文献、数据、政策、案例或结论；不承诺一定完成、通过或发表；「创新」「填补空白」等表述保持谨慎。",
  "只输出 JSON，不要任何解释：",
  '{"titles":[{"title":"候选题目","rationale":"推荐理由（一句话）","risk":"主要难点或收窄建议（一句话）"}]}',
].join("\n");

/** 研究方法顾问提示词（多选组合：文献研究法+问卷+统计等） */
const METHOD_ADVISOR_SYSTEM = [
  "你是研究方法顾问。根据学生的学历、专业与选题，推荐 2-4 种适合的研究方法组合（一篇论文常见多种方法组合，例如文献研究法+问卷调查法+统计分析法）。",
  "方法要可落地：结合学生的资源与周期，不推荐无法完成的方法；不编造数据与结论。",
  "只输出 JSON，不要任何解释：",
  '{"suggestions":[{"method":"方法名称","reason":"理由一句话"}]}',
].join("\n");

/** 理论框架与研究假设生成规范（源自《学术理论框架与研究假设生成系统执行规范》，摘要为系统提示词） */
const THEORY_SPEC_SYSTEM = [
  "【理论框架与研究假设生成规范（最高优先级，不得突破）】",
  "1. 学历层级刚性管控：本科=1个核心主理论+0-1个辅助理论，模型为简单中介（自变量≤3个子维度+1个中介变量+1个因变量），假设6-8条，表述用「正向影响/显著正相关」，须能用SPSS基础统计检验；硕士=1核心+1-2辅助，可加调节/平行中介，10-15条；博士=多理论整合，20条以上。禁止跨级超纲。",
  "2. 理论匹配：按选题关键词识别学科领域，从对应理论池选择。工商管理/市场营销/消费者行为：核心=S-O-R、计划行为理论(TPB)、技术接受模型(TAM)、感知价值理论、信任传递理论；辅助=社会临场感理论、社会资本理论、自我决定理论。不得选用池外小众理论；统计方法/软件/分析工具不得冒充理论。",
  "3. 假设以变量路径为生成单位（不以理论数量为单位）：H1组=自变量→因变量直接效应（子维度用H1a/H1b/H1c）；H2=自变量→中介变量；H3=中介变量→因变量；H4=中介作用；H5及以后=调节（仅硕士及以上）。编号连续、不跳号、不重号，子假设计入总数。",
  "4. 表述规范：横截面研究禁止「导致/决定/使得/必然」等绝对因果措辞；每条假设是完整学术陈述句；变量用稳定学术中文名，全文一致，不混用「购买意愿/购买行为」「满意度/信任」等近义概念。",
  "5. 最简充分原则：能用一个中介解释就不加链式；没有边界条件问题不加调节；不凑假设数量；不为形式完整强加总框架理论；直接效应模型也是合法选择。",
  "6. 不适用统计假设的选题（纯概念辨析、法律规范、工程设计、描述性调查、扎根理论等）不得强行套模型，改输出研究问题或研究命题。",
  "7. 严禁编造理论出处、量表名称、信效度、样本数据与统计结果；维度划分无可靠依据时写「建议维度，需结合文献与量表进一步核验」。",
  "8. 本系统为机器接口：hypotheses 字段输出 JSON 卡片数组（number/statement/iv/dv/basis，basis 不足时写「待核验」）；论文正文的自然语言版本由写作阶段另行生成，不混入本输出。",
].join("\n");



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
    lines.push("- 研究方法：" + ((p.methods && p.methods.length > 0) ? p.methods.join("、") : p.researchMethod));
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
      (stageKey === "design" && targets.some((t) => t.key === "hypotheses")) ? "\n\n" + THEORY_SPEC_SYSTEM : "",
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

  /** 选题顾问：根据学历/专业/条件生成候选题目（用于向导 AI 生成与第 0 项 3 选 1）。 */
  async suggestTitles(input: { education: string; disciplines: string[]; methods?: string[]; materials?: Record<string, string>; deadline?: string }): Promise<{ ok: boolean; message: string; titles?: Array<{ title: string; rationale: string; risk: string }> }> {
    const role = this.roleFor("establish");
    const materialText = Object.entries(input.materials ?? {}).filter(([, v]) => String(v ?? "").trim()).map(([k, v]) => k + "：" + String(v).slice(0, 120)).join("；") || "无";
    const user = [
      "【我的基本信息】",
      "学历阶段：" + (input.education || "本科"),
      "专业名称：" + input.disciplines.join("、"),
      "选题用途：毕业论文",
      "已掌握或希望使用的方法：" + (input.methods?.join("、") || "未定"),
      "可获得的资源：" + materialText,
      "完成周期：" + (input.deadline ? "截止 " + input.deadline : "未定"),
      "期望候选数量：3 个（直接生成，不必先提问）",
    ].join("\n");
    const raw = await chat({
      channel: role.channel,
      apiKey: role.apiKey,
      messages: [
        { role: "system", content: TOPIC_ADVISOR_SYSTEM },
        { role: "user", content: user },
      ],
      maxTokens: 4000,
      temperature: 0.7,
      signal: AbortSignal.timeout(240_000),
    });
    const parsed = extractJson(raw) as { titles?: unknown } | null;
    const titles = (Array.isArray(parsed?.titles) ? parsed.titles : []).map((t) => {
      const r = (t ?? {}) as { title?: unknown; rationale?: unknown; risk?: unknown };
      return { title: String(r.title ?? "").trim(), rationale: String(r.rationale ?? "").trim(), risk: String(r.risk ?? "").trim() };
    }).filter((t) => t.title).slice(0, 3);
    if (titles.length === 0) return { ok: false, message: "模型未返回候选题目（未生成任何内容）" };
    return { ok: true, message: "已生成 " + titles.length + " 个候选题目（AI 建议，请自行判断并确认）", titles };
  }

  /** 研究方法顾问：推荐方法组合（与内置方法列表模糊匹配）。 */
  async suggestMethods(input: { education: string; disciplines: string[]; topic: string }): Promise<{ ok: boolean; message: string; suggestions?: Array<{ method: string; reason: string; methodKey?: string }> }> {
    const role = this.roleFor("establish");
    const user = "学历阶段：" + (input.education || "本科") + "\n专业名称：" + input.disciplines.join("、") + "\n论文选题：" + input.topic + "\n可选方法库：" + METHOD_ORDER.map((m) => m.label).join("、");
    const raw = await chat({
      channel: role.channel,
      apiKey: role.apiKey,
      messages: [
        { role: "system", content: METHOD_ADVISOR_SYSTEM },
        { role: "user", content: user },
      ],
      maxTokens: 2000,
      temperature: 0.4,
      signal: AbortSignal.timeout(240_000),
    });
    const parsed = extractJson(raw) as { suggestions?: unknown } | null;
    const suggestions = (Array.isArray(parsed?.suggestions) ? parsed.suggestions : []).map((s) => {
      const r = (s ?? {}) as { method?: unknown; reason?: unknown };
      const name = String(r.method ?? "").trim();
      const hit = METHOD_ORDER.find((m) => m.label === name || name.includes(m.label.replace(/（.*）/, "")) || m.label.replace(/（.*）/, "").includes(name.slice(0, 4)));
      return { method: name, reason: String(r.reason ?? "").trim(), methodKey: hit?.key };
    }).filter((s) => s.method);
    if (suggestions.length === 0) return { ok: false, message: "模型未返回方法建议" };
    return { ok: true, message: "已生成方法建议（点击建议可直接加入选择）", suggestions: suggestions.slice(0, 4) };
  }

  /** 第 0 项：根据项目信息（专业/学历/方法/已有材料）生成 3 个选题方向，用户自行选择采用。 */
  async topicOptions(projectId: string): Promise<{ ok: boolean; message: string; options?: Array<{ title: string; rationale: string }> }> {
    const p = this.db.getProjectDetail(projectId).project;
    const r = await this.suggestTitles({
      education: p.educationLevel,
      disciplines: p.disciplines,
      methods: p.methods ?? [],
      materials: (p.materials ?? {}) as unknown as Record<string, string>,
      deadline: p.deadline,
    });
    return { ok: r.ok, message: r.message, options: r.titles?.map((t) => ({ title: t.title, rationale: t.rationale + (t.risk ? "；风险：" + t.risk : "") })) };
  }

    listConversations(projectId: string, stageKey: string) {
    return this.db.listConversations(projectId, stageKey, 50);
  }

  clearConversations(projectId: string, stageKey: string): void {
    this.db.clearConversations(projectId, stageKey);
  }
}
