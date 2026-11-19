import { EnvHttpProxyAgent, ProxyAgent, fetch, type Dispatcher } from "undici";
import type { ConnectionLayerResult, ModelProfile, NetworkConfig } from "../shared/settings";

export interface ChatRequest {
  profile: ModelProfile;
  apiKey: string;
  network: NetworkConfig;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  signal?: AbortSignal;
}

/** 网络方式 → undici dispatcher：直连（无代理）／系统代理／自定义代理 */
export function buildDispatcher(network: NetworkConfig): Dispatcher | undefined {
  if (network.mode === "custom" && network.proxyUrl.trim()) {
    return new ProxyAgent({ uri: network.proxyUrl.trim() });
  }
  if (network.mode === "system") {
    return new EnvHttpProxyAgent();
  }
  return undefined;
}

function authHeaders(profile: ModelProfile, apiKey: string): Record<string, string> {
  if (profile.apiStyle === "anthropic") {
    return { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" };
  }
  return { Authorization: "Bearer " + apiKey, "content-type": "application/json" };
}

function chatUrl(profile: ModelProfile): string {
  const base = profile.baseUrl.replace(/\/+$/, "");
  return profile.apiStyle === "anthropic" ? base + "/messages" : base + "/chat/completions";
}

export function friendlyHttpError(status: number, bodyText: string): string {
  let detail = "";
  try {
    const data = JSON.parse(bodyText) as { error?: { message?: string } };
    const err = data.error;
    if (err && typeof err === "object" && typeof err.message === "string") detail = err.message;
    else if (typeof err === "string") detail = err;
  } catch { /* 非 JSON 响应，忽略 */ }
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

/** 发起一次对话并返回文本内容（空文本与异常都向上抛出，由调用方决定含义） */
export async function chat(req: ChatRequest): Promise<string> {
  const dispatcher = buildDispatcher(req.network);
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
  const body = req.profile.apiStyle === "anthropic"
    ? JSON.stringify({ model: req.profile.model, max_tokens: req.maxTokens, messages })
    : JSON.stringify({ model: req.profile.model, max_tokens: req.maxTokens, messages });
  const response = await fetch(chatUrl(req.profile), {
    method: "POST",
    headers: authHeaders(req.profile, req.apiKey),
    body,
    dispatcher,
    signal: req.signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(friendlyHttpError(response.status, text));
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    if (req.profile.apiStyle === "anthropic") {
      const content = (data.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
      return content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
    }
    const choices = data.choices as Array<{ message?: { content?: string; reasoning_content?: string } }> | undefined;
    const message = choices?.[0]?.message;
    if (!message) return "";
    if (message.content && message.content.trim()) return message.content;
    // 推理型模型（如 deepseek-v4-pro）：思考过程在 reasoning_content，最终答案可能为空时回退
    return message.reasoning_content ?? "";
  } catch { return ""; }
}

/** 三层连接测试：鉴权 → 模型可用 → 实际能力。任一层失败即停止。 */
export async function testConnection(req: {
  profile: ModelProfile;
  apiKey: string;
  network: NetworkConfig;
  signal: AbortSignal;
}): Promise<ConnectionLayerResult[]> {
  const results: ConnectionLayerResult[] = [];
  const dispatcher = buildDispatcher(req.network);
  const base = req.profile.baseUrl.replace(/\/+$/, "");

  // 第一层：鉴权（models 端点）
  try {
    const response = await fetch(base + "/models", {
      headers: authHeaders(req.profile, req.apiKey),
      dispatcher,
      signal: req.signal,
    });
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
    await chat({ ...req, messages: [{ role: "user", content: "ping" }], maxTokens: 1 });
    if (req.signal.aborted) { results.push({ layer: "model", ok: false, message: "已取消" }); return results; }
    results.push({ layer: "model", ok: true, message: "模型可响应请求" });
  } catch (error) {
    results.push({ layer: "model", ok: false, message: abortOrNetworkError(error, req.signal) });
    return results;
  }

  // 第三层：实际能力（一次真实小任务）
  try {
    const answer = await chat({ ...req, messages: [{ role: "user", content: "用一句话回答：1 加 1 等于几？" }], maxTokens: 64 });
    if (req.signal.aborted) { results.push({ layer: "capability", ok: false, message: "已取消" }); return results; }
    if (!answer.trim()) { results.push({ layer: "capability", ok: false, message: "模型返回了空内容，请检查模型配置" }); return results; }
    results.push({ layer: "capability", ok: true, message: "实际生成正常（示例回答：" + answer.trim().slice(0, 40) + "）" });
  } catch (error) {
    results.push({ layer: "capability", ok: false, message: abortOrNetworkError(error, req.signal) });
  }
  return results;
}
