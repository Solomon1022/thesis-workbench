export type NetworkMode = "direct" | "system" | "custom";

export interface NetworkConfig {
  mode: NetworkMode;
  proxyUrl: string;
}

export type ApiStyle = "openai-chat" | "anthropic" | "openai-responses" | "gemini";

export type ThinkingLevel = "none" | "low" | "medium" | "high" | "max";

/** 一条可独立配置的模型线路（像中转站的渠道）：完整自定义字段。 */
export interface ModelChannel {
  id: string;
  providerKey: string;
  name: string;
  baseUrl: string;
  model: string;
  apiStyle: ApiStyle;
  thinkingLevel: ThinkingLevel;
  userAgent: string;
  network: NetworkConfig;
  headerOverrides: Record<string, string>;
  bodyOverrides: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type TaskRoleKey = "search_assist" | "research_design" | "writing" | "analysis" | "review";

export interface TaskRole {
  key: TaskRoleKey;
  label: string;
  description: string;
}

export interface ConnectionLayerResult {
  layer: "auth" | "model" | "capability";
  ok: boolean;
  message: string;
}

export const API_STYLE_LABEL: Record<ApiStyle, string> = {
  "openai-chat": "OpenAI Chat Completions",
  anthropic: "Anthropic Messages（原生）",
  "openai-responses": "OpenAI Responses API",
  gemini: "Gemini Native generateContent",
};

export const THINKING_LEVEL_LABEL: Record<ThinkingLevel, string> = {
  none: "关闭思考",
  low: "低",
  medium: "中",
  high: "高",
  max: "最大",
};

/** 预设只做模板；用户可按线路自由增删改。 */
export const MODEL_PRESETS: Array<{ providerKey: string; name: string; baseUrl: string; model: string; apiStyle: ApiStyle }> = [
  { providerKey: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "", apiStyle: "openai-chat" },
  { providerKey: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "", apiStyle: "openai-chat" },
  { providerKey: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "", apiStyle: "openai-chat" },
  { providerKey: "doubao", name: "豆包 / 火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "", apiStyle: "openai-chat" },
  { providerKey: "moonshot", name: "Kimi / Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "", apiStyle: "openai-chat" },
  { providerKey: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "", apiStyle: "openai-chat" },
  { providerKey: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", model: "", apiStyle: "gemini" },
  { providerKey: "anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", model: "", apiStyle: "anthropic" },
  { providerKey: "custom", name: "自定义 / OpenAI 兼容中转", baseUrl: "", model: "", apiStyle: "openai-chat" },
];

export const DEFAULT_NETWORK: NetworkConfig = { mode: "direct", proxyUrl: "" };

export const TASK_ROLES: TaskRole[] = [
  { key: "search_assist", label: "检索辅助", description: "生成/优化检索式与候选题目建议" },
  { key: "research_design", label: "研究设计", description: "研究问题、变量与实验/算法设计建议" },
  { key: "writing", label: "写作", description: "章节草稿与文字润色" },
  { key: "analysis", label: "分析解释", description: "统计与实验结果解释" },
  { key: "review", label: "审阅", description: "检查逻辑、方法、引用与格式问题" },
];
