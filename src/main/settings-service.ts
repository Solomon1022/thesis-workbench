import { safeStorage } from "electron";
import type { ThesisDB } from "./db";
import type { ConnectionLayerResult, ModelChannel, TaskRoleKey } from "../shared/settings";
import { testConnection } from "./model-service";

export interface ChannelSnapshot extends ModelChannel {
  hasKey: boolean;
}

export interface SettingsSnapshot {
  channels: ChannelSnapshot[];
  roles: Array<{ roleKey: TaskRoleKey; channelId: string }>;
  encryptionAvailable: boolean;
  contactEmail: string;
}

function parseOverridesHeader(json: string): Record<string, string> {
  try {
    const p = JSON.parse(json);
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(p as Record<string, unknown>)) out[k] = String(v);
      return out;
    }
  } catch { /* ignore */ }
  return {};
}

function parseOverridesBody(json: string): Record<string, unknown> {
  try {
    const p = JSON.parse(json);
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch { /* ignore */ }
  return {};
}

/** 模型服务：多线路（每条线路独立配置），密钥经 safeStorage 加密，渲染层拿不到明文。 */
export class SettingsService {
  private tests = new Map<string, AbortController>();

  constructor(private db: ThesisDB) {}

  getSettings(): SettingsSnapshot {
    const keyStatus = this.db.secretStatusByChannel();
    return {
      channels: this.db.listChannels().map((c) => ({
        id: c.id,
        providerKey: c.providerKey,
        name: c.name,
        baseUrl: c.baseUrl,
        model: c.model,
        apiStyle: c.apiStyle as ModelChannel["apiStyle"],
        thinkingLevel: c.thinkingLevel as ModelChannel["thinkingLevel"],
        userAgent: c.userAgent,
        network: { mode: c.networkMode as ModelChannel["network"]["mode"], proxyUrl: c.proxyUrl },
        headerOverrides: parseOverridesHeader(c.headerOverrides),
        bodyOverrides: parseOverridesBody(c.bodyOverrides),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        hasKey: keyStatus[c.id] ?? false,
      })),
      roles: this.db.listRoleChannels().map((r) => ({ roleKey: r.roleKey as TaskRoleKey, channelId: r.channelId })),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
      contactEmail: this.db.getAppSetting("contact_email"),
    };
  }

  saveChannel(input: {
    id?: string; providerKey: string; name: string; baseUrl: string; model: string; apiStyle: string; thinkingLevel: string;
    userAgent: string; network: { mode: string; proxyUrl: string }; headerOverrides: string; bodyOverrides: string;
  }): string {
    // 校验 JSON 覆盖字段可解析
    parseOverridesHeader(input.headerOverrides);
    parseOverridesBody(input.bodyOverrides);
    return this.db.upsertChannel({
      id: input.id,
      providerKey: input.providerKey,
      name: input.name.trim(),
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model.trim(),
      apiStyle: input.apiStyle,
      thinkingLevel: input.thinkingLevel,
      userAgent: input.userAgent.trim(),
      networkMode: input.network.mode,
      proxyUrl: input.network.proxyUrl.trim(),
      headerOverrides: input.headerOverrides,
      bodyOverrides: input.bodyOverrides,
    });
  }

  deleteChannel(id: string): void {
    this.db.deleteChannel(id);
  }

  /** 保存密钥：空密钥不覆盖；加密后只存密文。 */
  saveSecret(channelId: string, apiKey: string): boolean {
    const key = apiKey.trim();
    if (!key) return false;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不支持安全加密存储（safeStorage 不可用），密钥未保存");
    }
    const ciphertext = safeStorage.encryptString(key).toString("base64");
    this.db.setChannelSecret(channelId, ciphertext);
    return true;
  }

  deleteSecret(channelId: string): void {
    this.db.deleteChannelSecret(channelId);
  }

  saveRole(roleKey: TaskRoleKey, channelId: string): void {
    this.db.setRoleChannel(roleKey, channelId);
  }

  saveContactEmail(email: string): void {
    this.db.setAppSetting("contact_email", email.trim());
  }

  getContactEmail(): string {
    return this.db.getAppSetting("contact_email");
  }

  /** 解析某任务角色的可用调用配置（线路 + 明文密钥，仅主进程内使用）。未配置返回 null。 */
  resolveRole(roleKey: TaskRoleKey): { channel: ModelChannel; apiKey: string } | null {
    const assignment = this.db.listRoleChannels().find((r) => r.roleKey === roleKey);
    if (!assignment || !assignment.channelId) return null;
    const row = this.db.listChannels().find((c) => c.id === assignment.channelId);
    if (!row || !row.baseUrl || !row.model) return null;
    const ciphertext = this.db.getChannelSecret(row.id);
    if (!ciphertext) return null;
    try {
      const apiKey = safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
      return {
        channel: {
          id: row.id,
          providerKey: row.providerKey,
          name: row.name,
          baseUrl: row.baseUrl,
          model: row.model,
          apiStyle: row.apiStyle as ModelChannel["apiStyle"],
          thinkingLevel: row.thinkingLevel as ModelChannel["thinkingLevel"],
          userAgent: row.userAgent,
          network: { mode: row.networkMode as ModelChannel["network"]["mode"], proxyUrl: row.proxyUrl },
          headerOverrides: parseOverridesHeader(row.headerOverrides),
          bodyOverrides: parseOverridesBody(row.bodyOverrides),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        },
        apiKey,
      };
    } catch {
      return null;
    }
  }

  /** 三层连接测试；testId 用于取消。 */
  async testConnection(testId: string, channelId: string): Promise<ConnectionLayerResult[]> {
    const row = this.db.listChannels().find((c) => c.id === channelId);
    if (!row) return [{ layer: "auth", ok: false, message: "线路不存在" }];
    if (!row.baseUrl.trim()) return [{ layer: "auth", ok: false, message: "未填写 Base URL" }];
    if (!row.model.trim()) return [{ layer: "auth", ok: false, message: "未填写模型名" }];
    const ciphertext = this.db.getChannelSecret(channelId);
    if (!ciphertext) return [{ layer: "auth", ok: false, message: "未配置密钥：请先保存 API Key" }];
    let apiKey: string;
    try {
      apiKey = safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch {
      return [{ layer: "auth", ok: false, message: "密钥解密失败：可能由其他系统账户加密，请重新输入密钥" }];
    }
    const channel: ModelChannel = {
      id: row.id,
      providerKey: row.providerKey,
      name: row.name,
      baseUrl: row.baseUrl,
      model: row.model,
      apiStyle: row.apiStyle as ModelChannel["apiStyle"],
      thinkingLevel: row.thinkingLevel as ModelChannel["thinkingLevel"],
      userAgent: row.userAgent,
      network: { mode: row.networkMode as ModelChannel["network"]["mode"], proxyUrl: row.proxyUrl },
      headerOverrides: parseOverridesHeader(row.headerOverrides),
      bodyOverrides: parseOverridesBody(row.bodyOverrides),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    const controller = new AbortController();
    this.tests.set(testId, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]);
    try {
      return await testConnection({ channel, apiKey, signal });
    } finally {
      this.tests.delete(testId);
    }
  }

  cancelTest(testId: string): void {
    this.tests.get(testId)?.abort();
  }
}
