import type { ThesisDB } from "./db";
import type { SettingsService } from "./settings-service";
import { chat } from "./model-service";
import { extractJson } from "./stage4-service";

/** 系统提示词：与《学术论文写作系统提示词.md》的 text 块保持一致（正文/引用/gap 约束不变）。 */
export const WRITING_SYSTEM_PROMPT = [
  "你是一名严谨的学术论文全流程写作助手，负责辅助研究者完成从零到成稿的全过程：",
  "文献梳理 → 选题开题 → 假设构建 → 正文草稿 → 审稿修改。",
  "",
  "你的输出会被一个程序解析，因此必须严格遵守文末的输出格式，且只输出一个 JSON 对象，不要输出任何额外文字、解释或 Markdown 代码块。",
  "",
  "【最高准则：接地，而非编造；写出，而非回避】",
  "",
  "1. 每一条事实性陈述，必须能对应到「用户消息中的【材料清单】」里的一个来源。",
  "2. 有依据就写，并且在句末用 [@source_id] 标注来源。",
  "3. 没有依据时，禁止写「待核验」「需进一步验证」这类占位废话。正确做法是：",
  "   - 基于已有材料，写出你能给出的最好草稿（不因缺料而整段不写）；",
  "   - 把「缺乏依据的具体论断」逐条收进 gaps 数组，说明缺什么、用户补上什么材料后就能补全。",
  "4. 你的「保守」不是「不敢写」，而是「写了就明确它依据在哪」。宁可草稿带缺口，不可正文有编造。",
  "",
  "【引用规则】",
  "",
  "- 正文中凡有具体事实来源的句子，句末用 [@source_id] 标注，source_id 必须来自【材料清单】里真实存在的编号。",
  "- 通用常识、学科方法学通识、纯逻辑推理不需要引用；但「某研究做了X」「某数据显示Y」「某作者提出Z」这类具体论断必须引用。",
  "- 材料里没有对应来源时，不得伪造 source_id；该论断转入 gaps。",
  "",
  "【工作流】",
  "",
  "按用户指定的阶段执行；用户未指定时，按顺序推进。每次只输出当前阶段的 JSON：",
  "",
  "1. 文献梳理：归纳【材料清单】，输出主题地图、已有共识、关键空白。",
  "2. 开题框架：产出研究问题、研究意义、研究假设、拟用方法，形成开题大纲。",
  "3. 假设卡片：把每个假设写成「可证伪命题 + 支持依据(带引用) + 待验证点」。",
  "4. 正文草稿：按章节撰写，逐段标注引用，未定的部分进 gaps。",
  "5. 审稿修改：自我批判，标出逻辑漏洞、证据不足、表述问题，并给出修改版。",
  "",
  "【输出格式】",
  "",
  "只返回一个 JSON 对象，结构如下（字段名固定，不要增删）：",
  "",
  "{",
  "  \"stage\": \"当前阶段名\",",
  "  \"content\": \"正文，Markdown 格式，事实句句末带 [@source_id]\",",
  "  \"claims\": [",
  "    {\"statement\": \"论断原文\", \"source_ids\": [\"ref_1\"], \"status\": \"grounded\"}",
  "  ],",
  "  \"gaps\": [",
  "    {\"claim\": \"缺乏依据的论断\", \"missing\": \"缺什么\", \"action\": \"建议用户补充什么材料\"}",
  "  ],",
  "  \"next_steps\": [\"下一步建议\"]",
  "}",
  "",
  "【风格】",
  "",
  "- 用中文，学术、克制，不堆砌套话，能用材料说话就不空谈。",
  "- 不确定时明确写「不确定」，并把不确定性落进 gap，而不是含糊带过。",
  "- 正文密度高、可编辑性强，方便研究者直接在其上修改。",
].join("\n");

export interface MaterialHit {
  refId: string;
  sourceId: string;
  title: string;
  text: string;
  kind: "literature" | "evidence";
  url: string;
  score: number;
}

export interface WriteResult {
  stage: string;
  content: string;
  claims: Array<{ statement: string; source_ids: string[]; status: string }>;
  gaps: Array<{ claim: string; missing: string; action: string }>;
  nextSteps: string[];
  materials: Array<{ refId: string; title: string; url: string; kind: string }>;
  unlistedRefs: string[];
  provider?: string;
  model?: string;
}

/** 分词：拉丁词 + 中文二字滑窗（对短查询有区分度，检索结果可解释、可复现）。 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  const latin = lower.match(/[a-z0-9][a-z0-9-]*/g) ?? [];
  for (const w of latin) tokens.push(w);
  const cjk = lower.replace(/[^\u4e00-\u9fff]/g, "");
  for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk.slice(i, i + 2));
  return tokens;
}

function scoreText(queryTokens: Set<string>, text: string, boost: number): number {
  let hits = 0;
  for (const t of tokenize(text)) {
    if (queryTokens.has(t)) hits++;
  }
  return hits * boost;
}

/** 精准检索：文献题录（标题加权）、摘要与证据卡片（原文定位加权）按命中得分排序。 */
export function retrieve(projectId: string, query: string, topK: number, db: ThesisDB): MaterialHit[] {
  const queryTokens = new Set(tokenize(query));
  const hits: Array<Omit<MaterialHit, "refId">> = [];
  const items = db.listLiterature(projectId);
  for (const lit of items) {
    const metaText = lit.title + " " + lit.authors + " " + lit.year + " " + lit.venue + " " + lit.doi;
    const metaScore = scoreText(queryTokens, metaText, 1.4) + scoreText(queryTokens, lit.title, 1.6);
    const abstractText = (lit.abstract ?? "").trim();
    hits.push({
      sourceId: lit.id,
      title: lit.title,
      text: abstractText ? "摘要：" + abstractText.slice(0, 1200) : "题录信息：" + metaText,
      kind: "literature",
      url: lit.url,
      score: metaScore + (abstractText ? scoreText(queryTokens, abstractText, 1.0) : 0),
    });
    for (const card of db.listEvidence(lit.id)) {
      const evidenceText = card.claim + (card.location ? "（原文定位：" + card.location + "）" : "");
      const evidenceScore = scoreText(queryTokens, evidenceText, 1.6);
      if (evidenceScore > 0) {
        hits.push({
          sourceId: lit.id,
          title: lit.title,
          text: "证据卡片：" + evidenceText,
          kind: "evidence",
          url: lit.url,
          score: evidenceScore + metaScore * 0.3,
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const kept = hits.filter((h) => h.score > 0).slice(0, topK);
  if (kept.length === 0 && hits.length > 0) {
    // 无命中时退回最新入库的文献，保证材料清单不为空（仍是真实来源）
    return hits.slice(0, Math.min(topK, 3)).map((h, i) => ({ ...h, refId: "ref_" + (i + 1) }));
  }
  return kept.map((h, i) => ({ ...h, refId: "ref_" + (i + 1) }));
}

export function buildMaterials(hits: MaterialHit[]): string {
  if (hits.length === 0) {
    return "【材料清单】\n\n（文献库为空：没有任何可引用的真实材料）";
  }
  const lines = ["【材料清单】", ""];
  for (const h of hits) {
    lines.push("[" + h.refId + "] 《" + h.title + "》");
    lines.push(h.text.trim());
    lines.push("");
  }
  return lines.join("\n");
}

/** 写作管线：检索真实文献 → 拼【材料清单】→ 调「写作」角色模型 → 解析 JSON。 */
export class WritingService {
  constructor(
    private db: ThesisDB,
    private settings: SettingsService,
  ) {}

  async generate(projectId: string, instruction: string, opts?: { query?: string; topK?: number }): Promise<WriteResult> {
    const role = this.settings.resolveRole("writing");
    if (!role) {
      throw new Error("未配置「写作」角色模型：请先在「服务与模型设置 → 任务角色」中为「写作」分配服务商与模型");
    }
    const query = (opts?.query ?? instruction).trim();
    const hits = retrieve(projectId, query, opts?.topK ?? 5, this.db);
    const materialsText = buildMaterials(hits);
    const user = materialsText + "\n\n" + instruction.trim();
    const raw = await chat({
      profile: role.profile,
      apiKey: role.apiKey,
      network: { mode: role.profile.mode, proxyUrl: role.profile.proxyUrl },
      messages: [
        { role: "system", content: WRITING_SYSTEM_PROMPT },
        { role: "user", content: user },
      ],
      maxTokens: 8000,
      temperature: 0.4,
      signal: AbortSignal.timeout(240_000),
    });
    const parsed = extractJson(raw) as {
      stage?: unknown;
      content?: unknown;
      claims?: unknown;
      gaps?: unknown;
      next_steps?: unknown;
    } | null;
    const contentText = typeof parsed?.content === "string" ? parsed.content : "";
    const usedRefs = new Set<string>();
    const refRe = /\[@(ref_\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = refRe.exec(contentText)) !== null) usedRefs.add(m[1]);
    const knownRefs = new Set(hits.map((h) => h.refId));
    const unlistedRefs = [...usedRefs].filter((r) => !knownRefs.has(r));
    return {
      stage: typeof parsed?.stage === "string" ? parsed.stage : "unknown",
      content: contentText,
      claims: Array.isArray(parsed?.claims)
        ? parsed.claims.map((c) => {
            const r = (c ?? {}) as { statement?: unknown; source_ids?: unknown; status?: unknown };
            return {
              statement: String(r.statement ?? ""),
              source_ids: Array.isArray(r.source_ids) ? r.source_ids.map(String) : [],
              status: String(r.status ?? ""),
            };
          }).filter((c) => c.statement)
        : [],
      gaps: Array.isArray(parsed?.gaps)
        ? parsed.gaps.map((g) => {
            const r = (g ?? {}) as { claim?: unknown; missing?: unknown; action?: unknown };
            return {
              claim: String(r.claim ?? ""),
              missing: String(r.missing ?? ""),
              action: String(r.action ?? ""),
            };
          }).filter((g) => g.claim)
        : [],
      nextSteps: Array.isArray(parsed?.next_steps) ? parsed.next_steps.map(String) : [],
      materials: hits.map((h) => ({ refId: h.refId, title: h.title, url: h.url, kind: h.kind })),
      unlistedRefs,
      provider: role.profile.name,
      model: role.model,
    };
  }
}
