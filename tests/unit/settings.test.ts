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
      expect(["openai", "anthropic"]).toContain(p.apiStyle);
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

describe("设置持久化（SQLite，密文只存不解）", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "tw-settings-"));
    dbPath = path.join(dir, "test.db");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("服务商配置、密钥密文与角色分配关闭重开后可恢复", () => {
    const db = new ThesisDB(dbPath);
    db.upsertModelProfile(
      { providerKey: "custom", name: "自定义", baseUrl: "http://127.0.0.1:1/v1", model: "m1", apiStyle: "openai" },
      { mode: "custom", proxyUrl: "http://127.0.0.1:7890" },
    );
    db.setModelSecret("custom", "fake-ciphertext-base64");
    db.setRoleAssignment("research_design", "custom", "m1");
    db.close();

    const db2 = new ThesisDB(dbPath);
    const profile = db2.listModelProfiles().find((p) => p.providerKey === "custom");
    expect(profile?.model).toBe("m1");
    expect(profile?.proxyUrl).toBe("http://127.0.0.1:7890");
    expect(db2.getModelSecret("custom")).toBe("fake-ciphertext-base64");
    expect(db2.secretStatus().custom).toBe(true);
    expect(db2.listRoleAssignments().find((r) => r.roleKey === "research_design")?.providerKey).toBe("custom");
    db2.close();
  });

  it("删除密钥后状态为未配置", () => {
    const db = new ThesisDB(dbPath);
    db.setModelSecret("custom", "x");
    expect(db.secretStatus().custom).toBe(true);
    db.deleteModelSecret("custom");
    expect(db.secretStatus().custom ?? false).toBe(false);
    db.close();
  });

  it("默认网络配置为直连", () => {
    expect(DEFAULT_NETWORK).toEqual({ mode: "direct", proxyUrl: "" });
  });
});
