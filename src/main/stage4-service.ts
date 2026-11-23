import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { fieldsFor, METHOD_TEMPLATES } from "../shared/templates";
import type { LiteratureItem } from "../shared/literature";

/** 从模型输出中容错提取 JSON（支持代码块包裹、前后缀说明文字、尾逗号与截断容错） */
export function extractJson(text: string): unknown | null {
  let cleaned = text.replace(/`{3}(?:json)?/gi, "").trim();
  // 去掉 JSON 外的说明性文字时保留最后一个完整 JSON 块
  const candidates: string[] = [];
  for (const raw of [cleaned, cleaned.replace(/,\s*([}\]])/g, "$1")]) {
    if (raw) candidates.push(raw);
  }
  for (const c of candidates) {
    try { return JSON.parse(c); } catch { /* 继续 */ }
    // 整体可能是被引号包裹的 JSON 字符串
    if (c.startsWith("\"") && c.endsWith("\"")) {
      try { return JSON.parse(JSON.parse(c)); } catch { /* 继续 */ }
    }
    // 剥壳解析：取第一个 { 到最后一个 } 之间的内容并去除尾逗号（处理「说明文字+完整 JSON+说明文字」）
    {
      const first = c.indexOf("{");
      const last = c.lastIndexOf("}");
      if (first >= 0 && last > first) {
        try { return JSON.parse(c.slice(first, last + 1).replace(/,\s*([}\]])/g, "$1")); } catch { /* 继续 */ }
      }
    }
    // 截断容错：文本不以 } ] 结尾且含 [ 时，按「已完成对象列表」解析
    // （推理型模型可能因 max_tokens 被截断在数组中间）。
    if (c.includes("[") && !/[}\]]\s*$/.test(c)) {
      const list = parseObjectList(c);
      if (list && list.length > 0) return list;
    }
    // 取最后一个 {…} 或 […] 平衡块（模型常在 JSON 前后加解释文字）
    for (const [open, close] of [["{", "}"], ["[", "]"]] as Array<[string, string]>) {
      let start = c.lastIndexOf(open);
      while (start >= 0) {
        let depth = 0;
        let inStr = false;
        let esc = false;
        let found = false;
        for (let i = start; i < c.length; i++) {
          const ch = c[i];
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
              try { return JSON.parse(c.slice(start, i + 1)); } catch { /* 这个块不行，换更早的 */ }
              found = true;
              break;
            }
          }
        }
        void found;
        const nextFrom = start - 1;
        start = nextFrom < 0 ? -1 : c.lastIndexOf(open, nextFrom);
      }
    }
  }
  // 截断容错：文本不以 } ] 结尾且含 [ 时，优先按「已完成对象列表」解析
  // （推理型模型可能因 max_tokens 被截断在数组中间）。
  if (cleaned.includes("[") && !/[}\]]\s*$/.test(cleaned)) {
    const list = parseObjectList(cleaned);
    if (list && list.length > 0) return list;
  }
  return parseObjectList(cleaned);
}

/** 从可能被截断的 JSON 数组中提取所有完整对象 */
function parseObjectList(text: string): unknown[] | null {
  const start = text.indexOf("[");
  if (start < 0) return null;
  const out: unknown[] = [];
  let i = start + 1;
  while (i < text.length) {
    while (i < text.length && (text[i] === "," || /\s/.test(text[i]))) i++;
    if (i >= text.length || text[i] === "]") break;
    if (text[i] !== "{") { i++; continue; }
    let depth = 0;
    let inStr = false;
    let esc = false;
    let j = i;
    for (; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (j >= text.length) break;
    try {
      const obj = JSON.parse(text.slice(i, j + 1));
      if (obj && typeof obj === "object") out.push(obj);
    } catch { /* 跳过损坏元素 */ }
    i = j + 1;
  }
  return out.length > 0 ? out : null;
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
// 默认开题框架模板：严格按照学校《本科毕业论文（设计）开题报告》表格架构
// （研究目的意义与现状 / 拟研究的主要问题新颖性方法 两大块由 AI 分节生成；
//   主要参考文献与整体进度安排由程序按文献库与截止时间生成，保证真实）
export const DEFAULT_PROPOSAL_TEMPLATE = [
  "# 研究目的、意义（价值）及相关领域研究现状",
  "## 一、研究目的",
  "## 二、研究意义",
  "## 三、相关领域研究现状",
  "",
  "# 拟研究的主要问题、新颖性及拟采用的研究方法",
  "## 一、拟研究的主要问题",
  "## 二、本文研究的新颖性",
  "## 三、拟采用的研究方法",
  "",
  "# 主要参考文献（程序自动生成）",
  "",
  "# 整体进度安排（程序自动生成）",
  "",
].join("\n");

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
      channel: role.channel,
      apiKey: role.apiKey,

      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 8000,
      signal: AbortSignal.timeout(240_000),
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
      "可以基于领域常识提出研究问题与数据路径，但不得编造任何文献、作者、DOI、数据与统计结果；引用列表之外的依据一律不写进 basis，并在 limitations 中注明「来源待核验」。不要因为文献列表不相关就拒绝给出方向。",
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
    return { ok: true, message: "AI 生成的候选方向（依据已按文献库校验，未核验内容已标注）", directions, provider: role.channel.name, model: role.channel.model };
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
      "优先基于「已保存候选方向」确定研究问题草稿：选择其中一条最可行的方向直接改写为研究问题，不要因为设计字段为空就只写「待核验」或拒绝作答。",
      "只输出 JSON，不要任何解释：",
      '{"fields":{"字段key":"草稿文本"},"hypotheses":[]}',
      isQuestionnaire
        ? "本方法是问卷定量研究：hypotheses 基于研究问题草稿推导 2-4 条假设卡片 [{\"number\":\"H1\",\"statement\":\"假设陈述\",\"iv\":\"自变量\",\"dv\":\"因变量\",\"basis\":\"依据（文献列表序号+简述，或写「理论推导，待核验」）\"}]。不强制中介、调节或控制变量；横截面相关不写成因果；必须给出具体假设而不是空数组。"
        : "非问卷方法 hypotheses 输出空数组 []。",
      "严格禁止：编造数据、样本量、文献、性能数字与引用。文献引用只能来自提供的列表；其余内容写明「待核验」或「理论推导，待核验」，但仍要给出具体可用的草稿内容。",
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
      provider: role.channel.name,
      model: role.channel.model,
    };
  }

  /** 开题报告章节框架。 */
  /** 解析开题框架模板：每个一级标题为一节；一级以下结构随该节一起交给 AI */
  private parseTemplate(text: string): string[] {
    const titles: string[] = [];
    for (const line of String(text ?? "").split(/\r?\n/)) {
      const m = line.match(/^#\s+(.+)$/);
      if (m) titles.push(m[1].trim());
    }
    return titles.length > 0 ? titles : ["研究目的、意义（价值）及相关领域研究现状", "拟研究的主要问题、新颖性及拟采用的研究方法", "主要参考文献", "整体进度安排"];
  }

  /** 第 0/1/2 阶段全部内容 → Markdown（与文献检索发送给 AI 的 MD 同构；不含候选方向——生成开题框架以主研究方向为准） */
  private buildStageMd(projectId: string): string {
    const detail = this.db.getProjectDetail(projectId);
    const p0 = detail.project;
    const topic = detail.content["topic"] ?? {};
    const design = detail.content["design"] ?? {};
    const writing = detail.content["writing"] ?? {};
    const L: string[] = [];
    const field = (label: string, value: unknown) => {
      const v = String(value ?? "").trim();
      if (v) L.push("- " + label + "：" + v);
    };
    L.push("# 论文信息（第 0/1/2 阶段汇总）");
    L.push("## 第 0 阶段 · 建立项目");
    field("项目名称", p0.name);
    field("学科", p0.disciplines.join("、"));
    field("学历", p0.educationLevel);
    const m = p0.materials as unknown as Record<string, string>;
    if (m) {
      field("已有题目", m.title);
      field("已有文献", m.literature);
      field("已有数据", m.data);
      field("已有草稿", m.draft);
      field("备注", m.notes);
    }
    L.push("## 第 1 阶段 · 前期检索与选题");
    field("研究方向（主研究方向，生成开题报告以此为准）", topic["direction"]);
    field("变量（JSON）", topic["variables"]);
    field("样本可获得性", topic["sample_access"]);
    L.push("## 第 2 阶段 · 研究问题与设计");
    field("研究问题", design["research_question"]);
    field("理论构念", design["constructs"]);
    field("变量角色", design["variable_roles"]);
    field("测量方式", design["measures"]);
    field("样本与抽样设计", design["sampling"]);
    field("论文摘要", design["abstract"]);
    field("内容框架（章节提纲）", design["outline"]);
    field("摘要与关键词", design["abstract_keywords"]);
    field("写作关键词", writing["keywords"]);
    const hyps = this.db.listHypotheses(projectId);
    if (hyps.length > 0) {
      L.push("## 研究假设");
      for (const h of hyps) L.push("- " + h.number + "：" + h.statement + "（IV：" + h.iv + "；DV：" + h.dv + "；依据：" + h.basis + "）");
    }
    return L.join("\n");
  }

  /** 程序生成 GB/T 7714 主要参考文献（仅用文献库真实条目，绝不编造） */
  private gbtReferences(projectId: string): string[] {
    const lit = this.db.listLiterature(projectId);
    const lines: string[] = [];
    lit.slice(0, 200).forEach((l, i) => {
      const typeCode = l.refType === "thesis" ? "D" : l.refType === "conference" ? "C" : "J";
      const authors = (l.authors ?? "").trim();
      const venue = (l.venue ?? "").trim();
      const year = (l.year ?? "").trim();
      let line = "[" + (i + 1) + "] " + (authors ? authors + ". " : "") + (l.title ?? "").trim();
      line += "[" + typeCode + "].";
      if (venue) line += " " + venue + (year ? ", " + year : "") + ".";
      else if (year) line += " " + year + ".";
      if (l.doi) line += " DOI: " + l.doi + ".";
      lines.push(line);
    });
    return lines;
  }

  /** 程序生成整体进度安排（模板化，不交给 AI 编造） */
  private schedulePlan(projectId: string): string[] {
    const p = this.db.getProjectDetail(projectId).project;
    const deadline = p.deadline ? "（项目截止时间：" + p.deadline + "，各阶段应在此前完成）" : "（按学校要求时间节点倒排，各阶段时间以指导教师要求为准）";
    return [
      "一、开题阶段：完成开题报告撰写与修改，通过开题答辩。",
      "二、研究设计阶段：确定变量测量与问卷，完成预调研与问卷修订。",
      "三、数据收集阶段：发放与回收问卷，完成数据清洗。",
      "四、统计分析阶段：信效度检验、相关与回归分析、中介效应检验。",
      "五、论文撰写阶段：完成论文初稿与修改。",
      "六、定稿与答辩阶段：格式排版、查重、定稿与答辩准备。",
      deadline,
    ];
  }

  /** 开题报告：严格按学校《开题报告》表格架构生成——AI 只写两大块内容，
   *  参考文献与进度安排由程序按文献库/截止时间生成（真实、不编造）；流式逐节回调 */
  async generateProposal(
    projectId: string,
    onSection?: (index: number, total: number, title: string, content: string) => void,
  ): Promise<{ ok: boolean; message: string; sections?: ProposalSection[]; md?: string; provider?: string; model?: string }> {
    const role = this.requireRole();
    const stageMd = this.buildStageMd(projectId);
    // 第 3 阶段文献库：全部文献（不设上限；防 token 爆炸兜底 300 条并如实标注）
    const allLit = this.db.listLiterature(projectId);
    const litOverflow = allLit.length > 300;
    const literature = allLit.slice(0, 300);
    const litText = literature.length > 0
      ? this.litLines(literature) + (litOverflow ? "\n（文献较多，仅列出前 300 条，其余请在文献库核对；引用只能来自这里列出的文献）" : "")
      : "（文献库为空：不得引用任何文献，依据一律标注「待核验」）";
    const template = this.db.getAppSetting("proposal_template") || DEFAULT_PROPOSAL_TEMPLATE;
    // 程序生成的章节不交给 AI：参考文献、进度安排、指导教师意见、填写说明
    const PROGRAM_SECTIONS = /参考文献|进度安排|指导教师|填写说明/;
    const aiSections = this.parseTemplate(template).filter((t) => !PROGRAM_SECTIONS.test(t));
    const rules = [
      "你是本科毕业论文（设计）开题报告写作助手。请模仿管理学实证期刊论文绪论的写法：语言学术规范、具体充实，避免空话套话与「首先/其次/最后」式堆砌。",
      "凡涉及数据、事实必须注明出处（机构+报告名+年份）；没有真实出处的数据一律不得出现，相关内容标注「待核验」；严禁编造数字、文献与结论。",
      "引用文献用「[作者, 年份]」格式，只能引用下方「文献依据」中列出的文献；未列出的文献禁止引用。",
      "结构要求：研究现状先总起（现有研究形成的线索），再按国内、国外逐篇概括（作者+方法+核心发现，一篇一句），最后简要评述研究缺口；研究目的用「本文旨在……具体而言，一是……二是……三是……」结构；研究意义分理论意义与实践意义两段；拟研究的主要问题围绕论文题目给出 3-4 个层层递进的问题；新颖性对比已有研究说明本文在研究对象、中介机制或情境上的不同；拟采用的研究方法结合论文已定方法说明方法、量表、样本与统计检验思路。",
      "字数：研究现状 800-1200 字；其余每个小节 300-600 字。",
      "生成依据为「主研究方向」；候选研究方向不纳入生成依据（已忽略）。",
      "只输出该部分的 Markdown（含「一、二、三」小节的二级标题），不要输出任何解释。",
    ].join("\n");
    const generated: ProposalSection[] = [];
    const failed: string[] = [];
    const total = aiSections.length;
    for (let i = 0; i < total; i++) {
      const title = aiSections[i];
      const system = "现在只写开题报告「" + title + "」这一部分。" + rules;
      try {
        const content = await this.ask(role, system, "论文信息：\n" + stageMd + "\n\n文献依据：\n" + litText + "\n\n请写开题报告部分：" + title);
        const text = String(content ?? "").trim();
        if (!text) { failed.push(title); continue; }
        generated.push({ title, content: text });
        onSection?.(i, total, title, text);
      } catch (e) {
        failed.push(title + "（" + (e instanceof Error ? e.message.slice(0, 60) : String(e)) + "）");
      }
    }
    if (generated.length === 0) {
      return { ok: false, message: "模型未返回有效章节内容（未写入任何内容）" + (failed.length ? "；失败章节：" + failed.join("、") : "") };
    }
    // 汇总 MD：标题 → 信息表（学校模板字段） → AI 两大块 → 程序生成的参考文献/进度/意见/说明
    const detail = this.db.getProjectDetail(projectId);
    const p0 = detail.project;
    const mdParts: string[] = [
      "# 本科毕业论文（设计）开题报告",
      "",
      "**论文（设计）题目：** " + p0.name,
      "",
      "- 学院：＿＿＿＿＿＿",
      "- 专业：" + (p0.disciplines.join("、") || "＿＿＿＿＿＿"),
      "- 年级：" + (p0.educationLevel || "＿＿＿＿＿＿"),
      "- 班级：＿＿＿＿＿＿",
      "- 学生姓名：＿＿＿＿＿＿",
      "- 学号：＿＿＿＿＿＿",
      "- 指导教师姓名：＿＿＿＿＿＿",
      "- 指导教师职称 / 学历：＿＿＿＿＿＿",
      "- 完成形式：＿＿＿＿＿＿",
      "- 选题方式：＿＿＿＿＿＿",
      "- 题目来源：＿＿＿＿＿＿",
      "- 题目类型：＿＿＿＿＿＿",
      "- 计划起止时间：" + (p0.deadline ? p0.deadline + " 前完成" : "＿＿＿＿＿＿"),
      "",
    ];
    for (const s of generated) mdParts.push("## " + s.title + "\n\n" + s.content);
    // 主要参考文献：程序按文献库生成（保证真实，不交给 AI）
    const refs = this.gbtReferences(projectId);
    mdParts.push("## 主要参考文献");
    mdParts.push(refs.length > 0 ? refs.join("\n") : "（文献库为空：请先在「文献综述与证据整理」阶段保存文献，再重新生成开题报告）");
    // 整体进度安排：程序生成
    mdParts.push("", "## 整体进度安排");
    mdParts.push(this.schedulePlan(projectId).join("\n"));
    // 指导教师意见（留空，打印后由教师填写）
    mdParts.push("", "## 指导教师意见");
    mdParts.push("＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿");
    mdParts.push("", "指导教师签字：＿＿＿＿＿＿", "");
    // 附：填写说明（与学校模板一致）
    mdParts.push("## 附：填写说明");
    mdParts.push(
      "- 完成形式：学术论文、毕业设计、案例分析、调研报告、翻译作品、毕业创作、项目策划、创业模拟、实验（实践）报告、作品表演等。",
      "- 选题方式：学生自拟、教师指定、师生双选。",
      "- 题目来源：生产实际、社会实践、实习实验、科研课题、其它。",
      "- 题目类型：理论研究、应用研究、工程工业设计、艺美设计、综合性艺术与学术训练、其它。",
    );
    const md = mdParts.join("\n");
    return {
      ok: true,
      message: "开题报告已生成（AI 草稿，请人工复核与编辑；参考文献与进度安排由程序按文献库与截止时间生成）" + (failed.length ? "；以下部分生成失败需人工补写：" + failed.join("、") : ""),
      sections: generated,
      md,
      provider: role.channel.name,
      model: role.channel.model,
    };
  }

  // ---- 版本 ----

  saveVersion(projectId: string, stageKey: string, contentJson: string, note: string, name = ""): number {
    return this.db.saveStageVersion(projectId, stageKey, contentJson, note, name);
  }

  renameVersion(versionId: number, name: string): void {
    this.db.renameStageVersion(versionId, name);
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