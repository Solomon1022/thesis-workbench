import { safeStorage } from "electron";
import type { ThesisDB } from "./db";
import type { ConnectionLayerResult, ModelProfile, NetworkConfig, RoleAssignment, RoleKey } from "../shared/settings";
import { DEFAULT_NETWORK, MODEL_PRESETS } from "../shared/settings";
import { testConnection } from "./model-service";

export interface SettingsSnapshot {
  profiles: Array<ModelProfile & NetworkConfig>;
  secretStatus: Record<string, boolean>;
  roles: RoleAssignment[];
  encryptionAvailable: boolean;
}

/** 模型与角色设置服务。密钥经 safeStorage（系统加密）存储，渲染层永远拿不到明文。 */
export class SettingsService {
  private tests = new Map<string, AbortController>();

  constructor(private db: ThesisDB) {}

  getSettings(): SettingsSnapshot {
    const stored = new Map(this.db.listModelProfiles().map((p) => [p.providerKey, p]));
    const profiles = MODEL_PRESETS.map((preset) => stored.get(preset.providerKey) ?? { ...preset, ...DEFAULT_NETWORK });
    return {
      profiles,
      secretStatus: this.db.secretStatus(),
      roles: this.db.listRoleAssignments(),
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  saveProfile(profile: ModelProfile, network: NetworkConfig): void {
    this.db.upsertModelProfile(
      { ...profile, name: profile.name.trim(), baseUrl: profile.baseUrl.trim().replace(/\/+$/, ""), model: profile.model.trim() },
      { mode: network.mode, proxyUrl: network.proxyUrl.trim() },
    );
  }

  /** 保存密钥：空密钥不覆盖；加密后只存密文。 */
  saveSecret(providerKey: string, apiKey: string): boolean {
    const key = apiKey.trim();
    if (!key) return false;
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("当前系统不支持安全加密存储（safeStorage 不可用），密钥未保存");
    }
    const ciphertext = safeStorage.encryptString(key).toString("base64");
    this.db.setModelSecret(providerKey, ciphertext);
    return true;
  }

  deleteSecret(providerKey: string): void {
    this.db.deleteModelSecret(providerKey);
  }

  saveRole(roleKey: RoleKey, providerKey: string, model: string): void {
    this.db.setRoleAssignment(roleKey, providerKey, model.trim());
  }

  /** 三层连接测试；testId 用于取消。 */
  async testConnection(testId: string, providerKey: string): Promise<ConnectionLayerResult[]> {
    const stored = this.db.listModelProfiles().find((p) => p.providerKey === providerKey);
    const preset = MODEL_PRESETS.find((p) => p.providerKey === providerKey);
    const profile = stored ?? (preset ? { ...preset, ...DEFAULT_NETWORK } : null);
    if (!profile) return [{ layer: "auth", ok: false, message: "未知服务商" }];
    if (!profile.baseUrl.trim()) return [{ layer: "auth", ok: false, message: "未填写 Base URL，请先保存配置" }];
    if (!profile.model.trim()) return [{ layer: "auth", ok: false, message: "未填写模型名，请先保存配置" }];
    const ciphertext = this.db.getModelSecret(providerKey);
    if (!ciphertext) return [{ layer: "auth", ok: false, message: "未配置密钥：请先保存 API Key" }];
    let apiKey: string;
    try {
      apiKey = safeStorage.decryptString(Buffer.from(ciphertext, "base64"));
    } catch {
      return [{ layer: "auth", ok: false, message: "密钥解密失败：可能由其他系统账户加密，请重新输入密钥" }];
    }
    const controller = new AbortController();
    this.tests.set(testId, controller);
    try {
      return await testConnection({
        profile,
        apiKey,
        network: { mode: profile.mode, proxyUrl: profile.proxyUrl },
        signal: controller.signal,
      });
    } finally {
      this.tests.delete(testId);
    }
  }

  cancelTest(testId: string): void {
    this.tests.get(testId)?.abort();
  }
}
