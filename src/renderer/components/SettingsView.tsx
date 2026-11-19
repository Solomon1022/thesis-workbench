import { useCallback, useEffect, useState } from "react";
import { DEFAULT_NETWORK, MODEL_PRESETS, TASK_ROLES } from "../../shared/settings";
import type { ConnectionLayerResult, ModelProfile, NetworkConfig, RoleAssignment, RoleKey } from "../../shared/settings";

interface SettingsSnapshot {
  profiles: Array<ModelProfile & NetworkConfig>;
  secretStatus: Record<string, boolean>;
  roles: RoleAssignment[];
  encryptionAvailable: boolean;
}

const api = () => window.thesisWorkbench;

const LAYER_LABEL: Record<ConnectionLayerResult["layer"], string> = {
  auth: "① 鉴权",
  model: "② 模型可用",
  capability: "③ 实际能力",
};

export function SettingsView({ onBack }: { onBack: () => void }) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [tab, setTab] = useState<"models" | "roles" | "search">("models");
  const [selected, setSelected] = useState("custom");
  const [profile, setProfile] = useState<ModelProfile>({ ...(MODEL_PRESETS.find((p) => p.providerKey === "custom") as ModelProfile) });
  const [network, setNetwork] = useState<NetworkConfig>({ ...DEFAULT_NETWORK });
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testId, setTestId] = useState("");
  const [testResults, setTestResults] = useState<ConnectionLayerResult[] | null>(null);

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try {
      const snap = await a.settingsGet();
      setSnapshot(snap);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const selectProvider = (key: string) => {
    setSelected(key);
    const fromSnapshot = snapshot?.profiles.find((x) => x.providerKey === key);
    const fromPreset = MODEL_PRESETS.find((x) => x.providerKey === key) ?? MODEL_PRESETS[0];
    const p: ModelProfile & NetworkConfig = fromSnapshot ?? { ...fromPreset, ...DEFAULT_NETWORK };
    setProfile({ ...p });
    setNetwork({ mode: p.mode, proxyUrl: p.proxyUrl });
    setApiKey("");
    setTestResults(null);
    setMessage("");
    setError("");
  };

  const save = async () => {
    const a = api();
    if (!a || !snapshot) return;
    setError("");
    if (!profile.baseUrl.trim() && profile.providerKey !== "custom") return;
    if (!profile.model.trim()) return setError("请填写模型名");
    try {
      await a.settingsSaveProfile(profile, network);
      if (apiKey.trim()) await a.settingsSaveSecret(profile.providerKey, apiKey);
      await refresh();
      setApiKey("");
      setMessage("已保存" + (apiKey.trim() ? "（含密钥）" : ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const deleteKey = async () => {
    const a = api();
    if (!a) return;
    await a.settingsDeleteSecret(selected);
    await refresh();
    setMessage("密钥已删除");
  };

  const runTest = async () => {
    const a = api();
    if (!a) return;
    setError("");
    setMessage("");
    setTestResults([]);
    setTesting(true);
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    setTestId(id);
    try {
      const results = await a.settingsTestConnection(id, selected);
      setTestResults(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const cancelTest = () => {
    const a = api();
    if (!a) return;
    void a.settingsCancelTest(testId);
  };

  const saveRole = async (roleKey: RoleKey, providerKey: string, model: string) => {
    const a = api();
    if (!a) return;
    setError("");
    try {
      await a.settingsSaveRole(roleKey, providerKey, model);
      await refresh();
      setMessage("角色配置已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const configured = snapshot?.secretStatus[selected] ?? false;
  const roleMap = new Map((snapshot?.roles ?? []).map((r) => [r.roleKey, r]));

  return (
    <div className="workspace-inner settings">
      <div className="settings-top">
        <div>
          <h1>服务与模型设置</h1>
          <p className="muted">
            密钥经系统安全加密后保存在本机，界面与日志中不会出现明文；数据与密钥均不离开本机。
            {snapshot && !snapshot.encryptionAvailable && <span className="save-failed">（当前系统安全加密不可用，无法保存密钥）</span>}
          </p>
        </div>
        <button className="btn" onClick={onBack}>返回项目</button>
      </div>

      <div className="tabs">
        <button className={"tab" + (tab === "models" ? " tab-on" : "")} onClick={() => setTab("models")}>模型服务</button>
        <button className={"tab" + (tab === "roles" ? " tab-on" : "")} onClick={() => setTab("roles")}>任务角色</button>
        <button className={"tab" + (tab === "search" ? " tab-on" : "")} onClick={() => setTab("search")}>搜索服务</button>
      </div>

      {tab === "models" && (
        <section className="card">
          <div className="provider-list">
            {(snapshot?.profiles ?? MODEL_PRESETS).map((p) => (
              <button
                key={p.providerKey}
                className={"provider-option" + (selected === p.providerKey ? " active" : "")}
                onClick={() => selectProvider(p.providerKey)}
              >
                {p.name}
                {(snapshot?.secretStatus[p.providerKey] ?? false) && <span className="badge badge-done">已配置</span>}
              </button>
            ))}
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="sp-baseurl">Base URL *</label>
              <input id="sp-baseurl" className="input" value={profile.baseUrl} onChange={(e) => setProfile((p) => ({ ...p, baseUrl: e.target.value }))} placeholder="如：https://api.deepseek.com/v1 或你的中转地址/v1" />
            </div>
            <div className="field">
              <label htmlFor="sp-model">模型名 *</label>
              <input id="sp-model" className="input" value={profile.model} onChange={(e) => setProfile((p) => ({ ...p, model: e.target.value }))} placeholder="以服务商后台实际可用模型为准" />
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sp-style">API 风格</label>
              <select id="sp-style" className="select" value={profile.apiStyle} onChange={(e) => setProfile((p) => ({ ...p, apiStyle: e.target.value as "openai" | "anthropic" }))}>
                <option value="openai">OpenAI 兼容（/chat/completions）</option>
                <option value="anthropic">Anthropic 风格（/messages）</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sp-key">API Key</label>
              <input id="sp-key" className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={configured ? "已配置密钥（留空保持不变，输入新值将覆盖）" : "输入 API Key"} autoComplete="off" />
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label htmlFor="sp-netmode">网络方式</label>
              <select id="sp-netmode" className="select" value={network.mode} onChange={(e) => setNetwork((n) => ({ ...n, mode: e.target.value as NetworkConfig["mode"] }))}>
                <option value="direct">直连</option>
                <option value="system">跟随系统代理</option>
                <option value="custom">自定义代理</option>
              </select>
            </div>
            {network.mode === "custom" && (
              <div className="field">
                <label htmlFor="sp-proxy">代理地址</label>
                <input id="sp-proxy" className="input" value={network.proxyUrl} onChange={(e) => setNetwork((n) => ({ ...n, proxyUrl: e.target.value }))} placeholder="如：http://127.0.0.1:7890" />
              </div>
            )}
          </div>

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={() => void save()}>保存配置</button>
            {configured && <button className="btn btn-danger" onClick={() => void deleteKey()}>删除密钥</button>}
            <button className="btn" disabled={testing} onClick={() => void runTest()}>连接测试</button>
            {testing && <button className="btn" onClick={cancelTest}>取消测试</button>}
          </div>

          {message && <p className="banner banner-info">{message}</p>}
          {error && <p className="banner banner-error">{error}</p>}

          {testResults !== null && (
            <div className="layer-results">
              {testing && testResults.length === 0 && <p className="muted">连接测试进行中…</p>}
              {testResults.map((r) => (
                <div key={r.layer} className={"layer-row" + (r.ok ? " layer-ok" : " layer-bad")}>
                  <span className="layer-name">{LAYER_LABEL[r.layer]}</span>
                  <span className="layer-msg">{r.message}</span>
                  <span className="layer-status">{r.ok ? "✓ 通过" : (r.message === "已取消" ? "已取消" : "✗ 失败")}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {tab === "roles" && (
        <section className="card">
          <p className="muted">五个任务角色可分别指定服务商与模型；未指定的角色在对应功能接入前保持未配置。</p>
          {TASK_ROLES.map((role) => {
            const assignment = roleMap.get(role.key);
            const providerKey = assignment?.providerKey ?? "";
            const model = assignment?.model ?? "";
            const profiles = snapshot?.profiles ?? MODEL_PRESETS;
            return (
              <div key={role.key} className="role-row">
                <div className="role-info">
                  <strong>{role.label}</strong>
                  <span className="muted">{role.description}</span>
                </div>
                <select
                  className="select role-select"
                  aria-label={role.label + "服务商"}
                  value={providerKey}
                  onChange={(e) => {
                    const p = profiles.find((x) => x.providerKey === e.target.value);
                    const m = assignment?.model || p?.model || "";
                    void saveRole(role.key, e.target.value, m);
                  }}
                >
                  <option value="">— 未指定 —</option>
                  {profiles.map((p) => <option key={p.providerKey} value={p.providerKey}>{p.name}</option>)}
                </select>
                <input
                  className="input role-model"
                  aria-label={role.label + "模型名"}
                  placeholder="模型名（留空则使用该服务商默认）"
                  value={model}
                  onChange={(e) => void saveRole(role.key, providerKey, e.target.value)}
                />
                <button className="btn btn-sm" aria-label={"保存" + role.label} onClick={() => void saveRole(role.key, providerKey, model)}>保存</button>
              </div>
            );
          })}
          {message && <p className="banner banner-info">{message}</p>}
          {error && <p className="banner banner-error">{error}</p>}
        </section>
      )}

      {tab === "search" && (
        <section className="card">
          <h2 className="card-title">搜索服务</h2>
          <p className="muted">Tavily / Brave 等检索服务的配置与真实学术源接入将在阶段 3 完成。当前阶段未接入，不做演示。</p>
        </section>
      )}
    </div>
  );
}
