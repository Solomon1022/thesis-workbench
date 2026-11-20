import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DEFAULT_NETWORK, MODEL_PRESETS, TASK_ROLES } from "../../src/shared/settings";
import { buildDispatcher } from "../../src/main/model-service";
import { ThesisDB } from "../../src/main/db";

describe("服务商预设与角色定义", () => {
  it("预设含自定义中转且字段完整、key 唯一", () => {
    expect(MODEL_PRESETS.some((p) => p.providerKey === "custom")).toBe(true);
    for (const p of MODEL_PRESETS) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(["openai-chat", "anthropic", "openai-responses", "gemini"]).toContain(p.apiStyle);
    }
    expect(new Set(MODEL_PRESETS.map((p) => p.providerKey)).size).toBe(MODEL_PRESETS.length);
  });

  it("五个任务角色齐全且说明非空", () => {
    expect(TASK_ROLES.map((r) => r.key).sort()).toEqual(["analysis", "research_design", "review", "search_assist", "writing"].sort());
    for (const r of TASK_ROLES) expect(r.description.length).toBeGreaterThan(0);
  });
});

describe("网络方式 dispatcher", () => {
  it("直连不设置代理；自定义代理与系统代理分别构造对应 agent", () => {
    expect(buildDispatcher({ mode: "direct", proxyUrl: "" })).toBeUndefined();
    const custom = buildDispatcher({ mode: "custom", proxyUrl: "http://127.0.0.1:7890" });
    expect(custom).toBeDefined();
    custom?.close();
    const system = buildDispatcher({ mode: "system", proxyUrl: "" });
    expect(system).toBeDefined();
    system?.close();
  });
});

describe("多线路持久化（SQLite，密文只存不解）", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-settings-"));
    dbPath = path.join(dir, "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("线路、密钥密文与角色分配关闭重开后可恢复", () => {
    const db = new ThesisDB(dbPath);
    const channelId = db.upsertChannel({
      providerKey: "custom", name: "自定义线路", baseUrl: "http://127.0.0.1:1/v1", model: "m1",
      apiStyle: "openai-chat", thinkingLevel: "high", userAgent: "UA-X", networkMode: "custom", proxyUrl: "http://127.0.0.1:7890",
      headerOverrides: JSON.stringify({ "X-Custom": "v" }), bodyOverrides: JSON.stringify({ temperature: 0.2 }),
    });
    db.setChannelSecret(channelId, "fake-ciphertext-base64");
    db.setRoleChannel("research_design", channelId);
    db.close();

    const db2 = new ThesisDB(dbPath);
    const c = db2.listChannels().find((x) => x.id === channelId);
    expect(c?.model).toBe("m1");
    expect(c?.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(c?.thinkingLevel).toBe("high");
    expect(c?.apiStyle).toBe("openai-chat");
    expect(db2.getChannelSecret(channelId)).toBe("fake-ciphertext-base64");
    expect(db2.secretStatusByChannel()[channelId]).toBe(true);
    expect(db2.listRoleChannels().find((r) => r.roleKey === "research_design")?.channelId).toBe(channelId);
    db2.close();
  });

  it("删除密钥与删除线路", () => {
    const db = new ThesisDB(dbPath);
    const id = db.upsertChannel({
      providerKey: "custom", name: "x", baseUrl: "http://127.0.0.1:1/v1", model: "m",
      apiStyle: "anthropic", thinkingLevel: "none", userAgent: "", networkMode: "direct", proxyUrl: "",
      headerOverrides: "{}", bodyOverrides: "{}",
    });
    db.setChannelSecret(id, "x");
    expect(db.secretStatusByChannel()[id]).toBe(true);
    db.deleteChannelSecret(id);
    expect(db.secretStatusByChannel()[id] ?? false).toBe(false);
    db.deleteChannel(id);
    expect(db.listChannels().some((c) => c.id === id)).toBe(false);
    db.close();
  });

  it("旧版单线路数据自动迁移为线路", () => {
    const db = new ThesisDB(dbPath);
    // 直接写旧表（模拟旧版本数据）
    (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
      .prepare("INSERT INTO model_profiles (provider_key, name, base_url, model, api_style, network_mode, proxy_url, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .run("deepseek", "DeepSeek", "https://api.deepseek.com/v1", "deepseek-v4-pro", "openai", "direct", "", Date.now());
    (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
      .prepare("INSERT INTO model_secrets (provider_key, ciphertext, updated_at) VALUES (?, ?, ?)")
      .run("deepseek", "cipher-old", Date.now());
    (db as unknown as { db: { prepare: (sql: string) => { run: (...args: unknown[]) => void } } }).db
      .prepare("INSERT INTO role_assignments (role_key, provider_key, model, updated_at) VALUES (?, ?, ?, ?)")
      .run("writing", "deepseek", "deepseek-v4-pro", Date.now());
    db.close();

    const db2 = new ThesisDB(dbPath);
    const channels = db2.listChannels();
    expect(channels.length).toBe(1);
    expect(channels[0].model).toBe("deepseek-v4-pro");
    expect(channels[0].apiStyle).toBe("openai-chat");
    expect(db2.getChannelSecret(channels[0].id)).toBe("cipher-old");
    expect(db2.listRoleChannels().find((r) => r.roleKey === "writing")?.channelId).toBe(channels[0].id);
    db2.close();
  });

  it("默认网络配置为直连", () => {
    expect(DEFAULT_NETWORK).toEqual({ mode: "direct", proxyUrl: "" });
  });
});
