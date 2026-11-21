import type { ExistingMaterials } from "./types";

export interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea";
  placeholder?: string;
  help?: string;
}

export interface MethodTemplate {
  key: string;
  label: string;
  description: string;
  /** 该模板是否已提供专门字段（未提供的用通用字段并明确提示） */
  implemented: boolean;
  stageFields: Record<string, FieldDef[]>;
}

export const DISCIPLINES = [
  "生物科学", "医学与健康", "化学与材料", "人工智能与计算机", "数字技术与数字化应用", "电子商务", "经济与管理",
] as const;

/** 通用兜底模板：用于尚未提供专门模板的研究方法 */
const GENERIC_FIELDS: Record<string, FieldDef[]> = {
  topic: [
    { key: "direction", label: "研究方向与关键词", kind: "text", placeholder: "如：直播电商 / 蛋白质结构预测" },
    { key: "candidates", label: "候选研究问题", kind: "textarea", placeholder: "每个候选问题附一条依据或明确标注待核验" },
    { key: "sample_access", label: "样本可获得性", kind: "textarea", placeholder: "发放渠道、预估样本量、可行性" },
  ],
  design: [
    { key: "research_question", label: "研究问题", kind: "textarea", placeholder: "要回答什么问题？可检验、有边界" },
    { key: "plan", label: "研究计划与条件", kind: "textarea", placeholder: "方法路径、数据/资源条件、预计难点" },
    { key: "constructs", label: "理论构念", kind: "textarea", placeholder: "构念 ≠ 题项；每个构念写定义与依据" },
    { key: "variable_roles", label: "变量角色", kind: "textarea", placeholder: "自变量/因变量/中介/调节/控制——不强制每项都出现" },
    { key: "measures", label: "测量方式", kind: "textarea", placeholder: "量表、来源、改编说明" },
    { key: "sampling", label: "样本与抽样设计", kind: "textarea" },
    { key: "hypotheses", label: "研究假设卡片", kind: "textarea", placeholder: "H1、H2…… 每条对应变量关系；横截面相关不写成因果" },
    { key: "abstract", label: "论文摘要（在研究设计基础上生成）", kind: "textarea", placeholder: "含研究背景、方法与预期内容；数据引用须真实（选填）" },
    { key: "outline", label: "内容框架（章节提纲）", kind: "textarea", placeholder: "绪论 → 概念与理论 → 实证分析 → 问题与对策 → 结论与展望（选填）" },
    { key: "abstract_keywords", label: "摘要与关键词（开题报告与正文连用）", kind: "textarea", placeholder: "格式：摘要一段（研究对象、理论、方法、路径、结论），另起一行「关键词：词1；词2；词3；词4」共四个关键词，分号分隔。可点 AI 生成" },
  ],
  instruments: [{ key: "tool_plan", label: "工具准备计划", kind: "textarea" }],
  data: [{ key: "data_record", label: "资料/实验记录", kind: "textarea", placeholder: "保留原始版本、来源、条件与单位" }],
      writing: [
        { key: "title", label: "论文标题", kind: "text", placeholder: "论文正式标题（导出时作为文档标题）" },
        { key: "abstract", label: "摘要", kind: "textarea", placeholder: "中文摘要（导出时原样使用）" },
        { key: "keywords", label: "关键词", kind: "text", placeholder: "分号分隔，如：深度学习；表示学习" },
        { key: "draft", label: "草稿与正文", kind: "textarea", placeholder: "AI 写作接地文献库生成；事实句带 [@ref_N] 引用，缺口进缺口清单" },
      ],
};

export const METHOD_TEMPLATES: Record<string, MethodTemplate> = {
  "chemistry-experiment": {
    key: "chemistry-experiment",
    label: "化学与材料实验研究",
    description: "样品、对照、批次、重复层级、单位与表征记录；实验流程模板（阶段 1 提供字段，专业分析后续验证）。",
    implemented: true,
    stageFields: {
      topic: [
        { key: "direction", label: "研究方向与关键词", kind: "text", placeholder: "如：钙钛矿稳定性 / 催化剂活性" },
        { key: "candidates", label: "候选研究问题", kind: "textarea", placeholder: "每个候选问题附依据或标注待核验" },
        { key: "conditions", label: "实验条件与资源", kind: "textarea", placeholder: "仪器、试剂、场地、安全条件" },
      ],
      design: [
        { key: "hypothesis", label: "研究假设或设计目标", kind: "textarea", placeholder: "要检验的假设或设计要达到的目标" },
        { key: "samples", label: "样品与材料体系", kind: "textarea", placeholder: "样品组成、材料体系、来源" },
        { key: "control", label: "对照与处理设计", kind: "textarea", placeholder: "对照组、处理组、变量控制" },
        { key: "metrics", label: "测量指标与单位", kind: "textarea", placeholder: "如：转化率（%）、粒径（nm）" },
        { key: "replicates", label: "重复层级", kind: "text", placeholder: "区分生物重复与技术重复；同一样本重复测量不算独立样本" },
        { key: "instruments", label: "仪器与表征方法", kind: "textarea", placeholder: "XRD、SEM、光谱等及关键参数" },
        { key: "pilot", label: "预实验计划", kind: "textarea" },
      ],
      instruments: [
        { key: "instrument_list", label: "仪器清单", kind: "textarea" },
        { key: "reagent_list", label: "试剂与材料清单", kind: "textarea" },
        { key: "safety", label: "安全与审批要求", kind: "textarea", placeholder: "按机构实际要求记录，研究辅助不替代专业审批" },
        { key: "pilot_record", label: "预试验记录", kind: "textarea" },
      ],
      data: [
        { key: "batches", label: "样品批次记录", kind: "textarea" },
        { key: "treatment", label: "处理条件", kind: "textarea" },
        { key: "control_record", label: "对照信息", kind: "textarea" },
        { key: "measurement", label: "测量时间与单位", kind: "textarea" },
        { key: "raw_files", label: "原始文件引用", kind: "textarea", placeholder: "原始文件路径/编号；原始文件不被覆盖" },
        { key: "deviations", label: "偏离方案说明", kind: "textarea" },
      ],
      writing: [
        { key: "title", label: "论文标题", kind: "text", placeholder: "论文正式标题（导出时作为文档标题）" },
        { key: "abstract", label: "摘要", kind: "textarea", placeholder: "中文摘要（导出时原样使用）" },
        { key: "keywords", label: "关键词", kind: "text", placeholder: "分号分隔，如：深度学习；表示学习" },
        { key: "draft", label: "草稿与正文", kind: "textarea", placeholder: "AI 写作接地文献库生成；事实句带 [@ref_N] 引用，缺口进缺口清单" },
      ],
    },
  },
  "ai-algorithm": {
    key: "ai-algorithm",
    label: "AI/算法与系统研究",
    description: "数据集、基线、数据划分、指标、消融、代码与环境的评估记录（阶段 1 提供字段，不代替实际训练与运行）。",
    implemented: true,
    stageFields: {
      topic: [
        { key: "direction", label: "任务与方向", kind: "text", placeholder: "如：推荐系统 / 小样本图像分类" },
        { key: "candidates", label: "候选研究问题", kind: "textarea", placeholder: "每个候选问题附依据或标注待核验" },
        { key: "resources", label: "计算资源与数据条件", kind: "textarea", placeholder: "GPU、数据可得性、许可" },
      ],
      design: [
        { key: "task", label: "任务定义", kind: "textarea", placeholder: "输入/输出、任务类型、应用场景" },
        { key: "hypothesis", label: "设计目标或研究假设", kind: "textarea" },
        { key: "dataset_source", label: "数据集来源与许可", kind: "textarea", placeholder: "来源、版本、许可；未核实时标注待核验" },
        { key: "baselines", label: "基线方法", kind: "textarea", placeholder: "与哪些方法比较、为什么" },
        { key: "metrics", label: "评估指标", kind: "textarea", placeholder: "如：F1、AUC、BLEU；指标定义要写清" },
        { key: "split_plan", label: "训练/验证/测试划分计划", kind: "textarea", placeholder: "划分方式与防泄漏检查" },
        { key: "ablation", label: "消融与对比计划", kind: "textarea" },
      ],
      instruments: [
        { key: "environment", label: "环境与依赖清单", kind: "textarea" },
        { key: "preprocessing", label: "数据预处理方案", kind: "textarea" },
        { key: "baseline_impl", label: "基线实现计划", kind: "textarea" },
        { key: "eval_scripts", label: "评估脚本与日志方案", kind: "textarea" },
      ],
      data: [
        { key: "dataset_version", label: "数据集版本", kind: "text" },
        { key: "split_record", label: "划分记录", kind: "textarea" },
        { key: "hyperparams", label: "超参数", kind: "textarea" },
        { key: "seed", label: "随机种子", kind: "text" },
        { key: "code_version", label: "代码版本", kind: "text" },
        { key: "run_logs", label: "运行日志与硬件信息", kind: "textarea" },
        { key: "baseline_results", label: "基线结果（真实运行后填写）", kind: "textarea", placeholder: "未实际运行不得填写性能数字" },
      ],
      writing: [
        { key: "title", label: "论文标题", kind: "text", placeholder: "论文正式标题（导出时作为文档标题）" },
        { key: "abstract", label: "摘要", kind: "textarea", placeholder: "中文摘要（导出时原样使用）" },
        { key: "keywords", label: "关键词", kind: "text", placeholder: "分号分隔，如：深度学习；表示学习" },
        { key: "draft", label: "草稿与正文", kind: "textarea", placeholder: "AI 写作接地文献库生成；事实句带 [@ref_N] 引用，缺口进缺口清单" },
      ],
    },
  },
  questionnaire: {
    key: "questionnaire",
    label: "问卷定量研究（电商）",
    description: "理论构念、题项、样本与变量映射；以电商问卷为代表场景（阶段 1 提供字段，统计能力阶段 5 接入）。",
    implemented: true,
    stageFields: {
      topic: [
        { key: "direction", label: "研究对象与场景", kind: "text", placeholder: "如：直播电商消费者 / 平台商家" },
        { key: "candidates", label: "候选研究问题", kind: "textarea" },
        { key: "sample_access", label: "样本可获得性", kind: "textarea", placeholder: "发放渠道、预估样本量、可行性" },
      ],
      design: [
        { key: "research_question", label: "研究问题", kind: "textarea" },
        { key: "constructs", label: "理论构念", kind: "textarea", placeholder: "构念 ≠ 题项；每个构念写定义与依据" },
        { key: "variable_roles", label: "变量角色", kind: "textarea", placeholder: "自变量/因变量/中介/调节/控制——不强制每项都出现" },
        { key: "measures", label: "测量方式", kind: "textarea", placeholder: "量表、来源、改编说明" },
        { key: "sampling", label: "样本与抽样设计", kind: "textarea" },
        { key: "hypotheses", label: "研究假设卡片", kind: "textarea", placeholder: "H1、H2…… 每条对应变量关系；横截面相关不写成因果" },
        { key: "abstract", label: "论文摘要（在研究设计基础上生成）", kind: "textarea", placeholder: "含研究背景、方法与预期内容；数据引用须真实（选填）" },
        { key: "outline", label: "内容框架（章节提纲）", kind: "textarea", placeholder: "绪论 → 概念与理论 → 实证分析 → 问题与对策 → 结论与展望（选填）" },
        { key: "abstract_keywords", label: "摘要与关键词（开题报告与正文连用）", kind: "textarea", placeholder: "格式：摘要一段（研究对象、理论、方法、路径、结论），另起一行「关键词：词1；词2；词3；词4」共四个关键词，分号分隔。可点 AI 生成" },
      ],
      instruments: [
        { key: "scale_source", label: "量表来源与授权", kind: "textarea", placeholder: "量表存在不代表允许无限复制，需记录来源与授权" },
        { key: "items", label: "题项与编码表", kind: "textarea" },
        { key: "reverse_scoring", label: "反向题与计分规则", kind: "textarea" },
        { key: "pretest", label: "预测试计划", kind: "textarea" },
      ],
      data: [
        { key: "channels", label: "发放渠道", kind: "textarea" },
        { key: "collection", label: "回收情况", kind: "textarea" },
        { key: "filter_rules", label: "筛选规则", kind: "textarea" },
        { key: "data_files", label: "数据文件", kind: "textarea" },
        { key: "sample_stats", label: "样本量与有效率", kind: "textarea" },
      ],
      writing: [
        { key: "title", label: "论文标题", kind: "text", placeholder: "论文正式标题（导出时作为文档标题）" },
        { key: "abstract", label: "摘要", kind: "textarea", placeholder: "中文摘要（导出时原样使用）" },
        { key: "keywords", label: "关键词", kind: "text", placeholder: "分号分隔，如：深度学习；表示学习" },
        { key: "draft", label: "草稿与正文", kind: "textarea", placeholder: "AI 写作接地文献库生成；事实句带 [@ref_N] 引用，缺口进缺口清单" },
      ],
    },
  },
};

/** 研究方法列表（多选；只有前三个有专门阶段模板，其余用通用字段并明确标注） */
export const METHOD_ORDER: Array<{ key: string; label: string; note?: string }> = [
  { key: "questionnaire", label: "问卷定量研究" },
  { key: "interview", label: "访谈研究" },
  { key: "case-study", label: "案例分析" },
  { key: "content-analysis", label: "内容/文本分析" },
  { key: "experiment", label: "实验研究（真实验/准实验）" },
  { key: "secondary-data", label: "二手数据分析" },
  { key: "literature-review", label: "文献综述（概念/理论辨析）" },
  { key: "chemistry-experiment", label: "化学与材料实验" },
  { key: "ai-algorithm", label: "AI/算法设计" },
  { key: "system-design", label: "系统/工程设计" },
  { key: "mixed", label: "混合方法研究" },
  { key: "public-data", label: "公开数据研究", note: "专门模板待补充" },
  { key: "bio-experiment", label: "生物/医学实验", note: "专门模板待补充" },
  { key: "quasi-experimental", label: "准实验/复杂计量", note: "专门模板待补充" },
];

/** 取某方法在某阶段的字段（无专门模板时用通用字段） */
export function fieldsFor(methodKey: string, stageKey: string): { fields: FieldDef[]; isGeneric: boolean } {
  const t = METHOD_TEMPLATES[methodKey];
  if (t?.implemented && t.stageFields[stageKey]?.length) {
    return { fields: t.stageFields[stageKey], isGeneric: false };
  }
  return { fields: GENERIC_FIELDS[stageKey] ?? [], isGeneric: true };
}

/** 根据已有材料建议起始阶段 */
export function suggestStartStage(materials: ExistingMaterials): { stageKey: string; reasons: string[] } {
  if (materials.draft.trim()) {
    return { stageKey: "writing", reasons: ["检测到已有初稿：从「初稿与完整稿」阶段继续。", "前面阶段自动标记为“已有材料”，结果章节在补充真实分析前保持待补。"] };
  }
  if (materials.data.trim()) {
    return { stageKey: "analysis", reasons: ["检测到已有数据：从「整理与分析」阶段继续。", "前面阶段自动标记为“已有材料”，分析能力阶段 5 接入前先记录数据条件。"] };
  }
  if (materials.literature.trim()) {
    return { stageKey: "literature", reasons: ["检测到已有文献：从「文献综述与证据整理」阶段继续。", "选题与设计阶段保留待填内容，可随时回看。"] };
  }
  if (materials.title.trim()) {
    return { stageKey: "design", reasons: ["检测到已有题目：从「研究问题与设计」阶段继续。", "选题阶段自动标记为“已有材料”。"] };
  }
  return { stageKey: "topic", reasons: ["未检测到已有材料：从「前期检索与选题」阶段开始。"] };
}

/** 材料缺口提示（项目首页展示） */
export function materialGaps(materials: ExistingMaterials): string[] {
  const gaps: string[] = [];
  if (materials.draft.trim()) gaps.push("已有初稿：结果章节在补充真实分析记录前保持“待补”，不生成虚构结果。");
  if (materials.data.trim()) gaps.push("已有数据：需补充清洗规则与分析记录（统计能力阶段 5 接入，当前仅记录）。");
  if (materials.literature.trim()) gaps.push("已有文献：文献核验与证据卡片阶段 3 接入，当前先保留清单。");
  if (materials.title.trim()) gaps.push("已有题目：需补充题目对应的文献依据（阶段 3 核验）。");
  if (!gaps.length) gaps.push("暂无缺口提示：按阶段顺序推进即可。");
  return gaps;
}
