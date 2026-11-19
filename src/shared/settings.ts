export type NetworkMode = "direct" | "system" | "custom";

export interface NetworkConfig {
  mode: NetworkMode;
  proxyUrl: string;
}

export interface ModelProfile {
  providerKey: string;
  name: string;
  baseUrl: string;
  model: string;
  apiStyle: "openai" | "anthropic";
}

export type RoleKey = "search_assist" | "research_design" | "writing" | "analysis" | "review";

export interface TaskRole {
  key: RoleKey;
  label: string;
  description: string;
}

export interface RoleAssignment {
  roleKey: RoleKey;
  providerKey: string;
  model: string;
}

export interface ConnectionLayerResult {
  layer: "auth" | "model" | "capability";
  ok: boolean;
  message: string;
}

/** 预设只减少配置工作量；模型名与可用区域以各服务商后台为准，均可修改。 */
export const MODEL_PRESETS: ModelProfile[] = [
  { providerKey: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "", apiStyle: "openai" },
  { providerKey: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "", apiStyle: "openai" },
  { providerKey: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "", apiStyle: "openai" },
  { providerKey: "doubao", name: "豆包 / 火山方舟", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "", apiStyle: "openai" },
  { providerKey: "moonshot", name: "Kimi / Moonshot", baseUrl: "https://api.moonshot.cn/v1", model: "", apiStyle: "openai" },
  { providerKey: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "", apiStyle: "openai" },
  { providerKey: "gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "", apiStyle: "openai" },
  { providerKey: "anthropic", name: "Anthropic Claude", baseUrl: "https://api.anthropic.com/v1", model: "", apiStyle: "anthropic" },
  { providerKey: "custom", name: "自定义 / OpenAI 兼容中转", baseUrl: "", model: "", apiStyle: "openai" },
];

export const DEFAULT_NETWORK: NetworkConfig = { mode: "direct", proxyUrl: "" };

export const TASK_ROLES: TaskRole[] = [
  { key: "search_assist", label: "检索辅助", description: "生成/优化检索式与候选题目建议" },
  { key: "research_design", label: "研究设计", description: "研究问题、变量与实验/算法设计建议" },
  { key: "writing", label: "写作", description: "章节草稿与文字润色" },
  { key: "analysis", label: "分析解释", description: "统计与实验结果解释" },
  { key: "review", label: "审阅", description: "检查逻辑、方法、引用与格式问题" },
];
