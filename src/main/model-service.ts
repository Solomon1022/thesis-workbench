import { EnvHttpProxyAgent, ProxyAgent, fetch, type Dispatcher } from "undici";
import type { ConnectionLayerResult, ModelChannel, NetworkConfig, ThinkingLevel } from "../shared/settings";

export interface ChatRequest {
  channel: ModelChannel;
  apiKey: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature?: number;
  signal?: AbortSignal;
}

/** 网络方式 → undici dispatcher（线路级覆盖：直连/系统代理/自定义代理） */
export function buildDispatcher(network: NetworkConfig): Dispatcher | undefined {
  if (network.mode === "custom" && network.proxyUrl.trim()) {
    return new ProxyAgent({ uri: network.proxyUrl.trim() });
  }
  if (network.mode === "system") {
    return new EnvHttpProxyAgent();
  }
  return undefined;
}

function base(channel: ModelChannel): string {
  return channel.baseUrl.trim().replace(/\/+$/, "");
}

/** 认证头 + 用户自定义 header 覆盖 */
function authHeaders(channel: ModelChannel, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (channel.apiStyle === "anthropic") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  } else if (channel.apiStyle === "gemini") {
    headers["x-goog-api-key"] = apiKey;
  } else {
    headers["Authorization"] = "Bearer " + apiKey;
  }
  if (channel.userAgent.trim()) headers["User-Agent"] = channel.userAgent.trim();
  return { ...headers, ...channel.headerOverrides };
}

/** 思考档位 → 各家 API 参数（openai 系 reasoning_effort；anthropic thinking；gemini thinkingConfig） */
function thinkingParams(channel: ModelChannel): Record<string, unknown> {
  const level: ThinkingLevel = channel.thinkingLevel;
  if (level === "none") return {};
  const effort = level === "max" ? "high" : level;
  if (channel.apiStyle === "openai-chat" || channel.apiStyle === "openai-responses") {
    return { reasoning_effort: effort };
  }
  if (channel.apiStyle === "anthropic") {
    return { thinking: { type: "enabled", budget_tokens: level === "max" ? 32000 : level === "high" ? 16000 : 8000 } };
  }
  if (channel.apiStyle === "gemini") {
    return { thinkingConfig: { includeThoughts: false } };
  }
  return {};
}

export function friendlyHttpError(status: number, bodyText: string): string {
  let detail = "";
  try {
    const data = JSON.parse(bodyText) as { error?: { message?: string } };
    const err = data.error;
    if (err && typeof err === "object" && typeof err.message === "string") detail = err.message;
    else if (typeof err === "string") detail = err;
  } catch { /* 非 JSON 响应，忽略 */ }
  if (status === 402) return "余额不足（HTTP 402）：该服务商账户需要充值" + (detail ? "：" + detail : "");
  if (status === 401 || status === 403) return "鉴权失败：密钥无效或无权限（HTTP " + status + "）" + (detail ? "：" + detail : "");
  if (status === 404) return "接口或模型不存在（HTTP 404）" + (detail ? "：" + detail : "");
  if (status === 429) return "请求过于频繁或被限流（HTTP 429）";
  return "服务返回错误（HTTP " + status + "）" + (detail ? "：" + detail : "");
}

function abortOrNetworkError(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted || (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))) {
    if (error instanceof Error && error.name === "TimeoutError") return "超时：请求超过 20 秒未完成";
    return "已取消";
  }
  if (error instanceof Error && /fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket|tls|proxy/i.test(error.message)) {
    return "无法连接服务器（请检查 Base URL、网络方式与网络连接）：" + error.message;
  }
  return "请求失败：" + (error instanceof Error ? error.message : String(error));
}

function buildBody(channel: ModelChannel, messages: Array<{ role: string; content: string }>, maxTokens: number, temperature?: number): { url: string; body: unknown } {
  let url = "";
  let body: unknown;
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const others = messages.filter((m) => m.role !== "system");
  if (channel.apiStyle === "anthropic") {
    url = base(channel) + "/messages";
    body = {
      model: channel.model,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: others.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
      ...(temperature !== undefined ? { temperature } : {}),
      ...thinkingParams(channel),
    };
  } else if (channel.apiStyle === "openai-responses") {
    url = base(channel) + "/responses";
    const input = system ? system + "\n\n" + others.map((m) => (m.role === "user" ? "问：" : "答：") + m.content).join("\n") : others.map((m) => m.content).join("\n");
    body = {
      model: channel.model,
      input,
      max_output_tokens: maxTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...thinkingParams(channel),
    };
  } else if (channel.apiStyle === "gemini") {
    url = base(channel) + "/models/" + encodeURIComponent(channel.model) + ":generateContent";
    body = {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: others.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
      ...(temperature !== undefined ? { temperature } : {}),
      ...thinkingParams(channel),
    };
  } else {
    url = base(channel) + "/chat/completions";
    body = {
      model: channel.model,
      max_tokens: maxTokens,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      ...(temperature !== undefined ? { temperature } : {}),
      ...thinkingParams(channel),
    };
  }
  // body 覆盖（浅合并）
  const overrides = channel.bodyOverrides ?? {};
  if (overrides && typeof overrides === "object" && Object.keys(overrides).length > 0) {
    body = { ...(body as Record<string, unknown>), ...(overrides as Record<string, unknown>) };
  }
  return { url, body };
}

function extractText(channel: ModelChannel, data: Record<string, unknown>): string {
  try {
    if (channel.apiStyle === "anthropic") {
      const content = (data.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
      return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    }
    if (channel.apiStyle === "openai-responses") {
      if (typeof data.output_text === "string") return data.output_text;
      const output = data.output as Array<{ content?: Array<{ type?: string; text?: string }> }> | undefined;
      return (output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text" || c.type === "text").map((c) => c.text ?? "").join("");
    }
    if (channel.apiStyle === "gemini") {
      const candidates = data.candidates as Array<{ content?: { parts?: Array<{ text?: string }> } }> | undefined;
      return (candidates ?? []).flatMap((c) => c.content?.parts ?? []).map((p) => p.text ?? "").join("");
    }
    const choices = data.choices as Array<{ message?: { content?: string; reasoning_content?: string } }> | undefined;
    const message = choices?.[0]?.message;
    if (!message) return "";
    if (message.content && message.content.trim()) return message.content;
    return message.reasoning_content ?? "";
  } catch {
    return "";
  }
}

/** 发起一次对话并返回文本内容。 */
export async function chat(req: ChatRequest): Promise<string> {
  const { url, body } = buildBody(req.channel, req.messages, req.maxTokens, req.temperature);
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders(req.channel, req.apiKey),
    body: JSON.stringify(body),
    dispatcher: buildDispatcher(req.channel.network),
    signal: req.signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(friendlyHttpError(response.status, text));
  return extractText(req.channel, JSON.parse(text) as Record<string, unknown>);
}

/** 三层连接测试：鉴权 → 模型可用 → 实际能力（按 API 风格选择鉴权端点）。 */
export async function testConnection(req: {
  channel: ModelChannel;
  apiKey: string;
  signal: AbortSignal;
}): Promise<ConnectionLayerResult[]> {
  const results: ConnectionLayerResult[] = [];
  const dispatcher = buildDispatcher(req.channel.network);
  const b = base(req.channel);

  // 第一层：鉴权（各风格的模型列表端点）
  try {
    let url = b + "/models";
    if (req.channel.apiStyle === "gemini") {
      url = b + "/models?pageSize=10";
    }
    const response = await fetch(url, { headers: authHeaders(req.channel, req.apiKey), dispatcher, signal: req.signal });
    if (!response.ok) {
      results.push({ layer: "auth", ok: false, message: friendlyHttpError(response.status, await response.text()) });
      return results;
    }
    await response.text();
    results.push({ layer: "auth", ok: true, message: "鉴权通过" });
  } catch (error) {
    results.push({ layer: "auth", ok: false, message: abortOrNetworkError(error, req.signal) });
    return results;
  }

  // 第二层：模型可用（最小请求）
  try {
    await chat({ channel: req.channel, apiKey: req.apiKey, messages: [{ role: "user", content: "ping" }], maxTokens: 1, signal: req.signal });
    if (req.signal.aborted) { results.push({ layer: "model", ok: false, message: "已取消" }); return results; }
    results.push({ layer: "model", ok: true, message: "模型可响应请求" });
  } catch (error) {
    results.push({ layer: "model", ok: false, message: abortOrNetworkError(error, req.signal) });
    return results;
  }

  // 第三层：实际能力（一次真实小任务）
  try {
    const answer = await chat({ channel: req.channel, apiKey: req.apiKey, messages: [{ role: "user", content: "用一句话回答：1 加 1 等于几？" }], maxTokens: 64, signal: req.signal });
    if (req.signal.aborted) { results.push({ layer: "capability", ok: false, message: "已取消" }); return results; }
    if (!answer.trim()) { results.push({ layer: "capability", ok: false, message: "模型返回了空内容，请检查模型配置" }); return results; }
    results.push({ layer: "capability", ok: true, message: "实际生成正常（示例回答：" + answer.trim().slice(0, 40) + "）" });
  } catch (error) {
    results.push({ layer: "capability", ok: false, message: abortOrNetworkError(error, req.signal) });
  }
  return results;
}
