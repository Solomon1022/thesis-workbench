import { useCallback, useEffect, useState } from "react";
import { API_STYLE_LABEL, MODEL_PRESETS, TASK_ROLES, THINKING_LEVEL_LABEL } from "../../shared/settings";
import type { ApiStyle, TaskRoleKey, ThinkingLevel } from "../../shared/settings";
import type { ConnectionLayerResult } from "../../shared/settings";

const api = () => window.thesisWorkbench;

interface Channel {
  id: string;
  providerKey: string;
  name: string;
  baseUrl: string;
  model: string;
  apiStyle: ApiStyle;
  thinkingLevel: ThinkingLevel;
  userAgent: string;
  network: { mode: string; proxyUrl: string };
  headerOverrides: Record<string, string>;
  bodyOverrides: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  hasKey: boolean;
}

interface Snapshot {
  channels: Channel[];
  roles: Array<{ roleKey: TaskRoleKey; channelId: string }>;
  encryptionAvailable: boolean;
  contactEmail: string;
}

const LAYER_LABEL: Record<ConnectionLayerResult["layer"], string> = {
  auth: "① 鉴权",
  model: "② 模型可用",
  capability: "③ 实际能力",
};

const EMPTY_FORM = {
  id: "",
  providerKey: "custom",
  name: "",
  baseUrl: "",
  model: "",
  apiStyle: "openai-chat" as ApiStyle,
  thinkingLevel: "none" as ThinkingLevel,
  userAgent: "",
  networkMode: "direct",
  proxyUrl: "",
  headerOverrides: "{}",
  bodyOverrides: "{}",
  apiKey: "",
};

export function SettingsView({ tab, onTabChange }: { tab: "models" | "roles" | "search"; onTabChange: (t: "models" | "roles" | "search") => void }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [testing, setTesting] = useState(false);
  const [testId, setTestId] = useState("");
  const [testResults, setTestResults] = useState<ConnectionLayerResult[] | null>(null);
  const [contactEmail, setContactEmail] = useState("");

  const refresh = useCallback(async () => {
    const a = api();
    if (!a) return;
    try {
      const snap = (await a.settingsGet()) as unknown as Snapshot;
      setSnapshot(snap);
      setContactEmail(snap.contactEmail ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const applyPreset = (providerKey: string) => {
    const preset = MODEL_PRESETS.find((p) => p.providerKey === providerKey);
    if (!preset) return;
    setForm((f) => ({
      ...f,
      id: "",
      providerKey,
      name: preset.name,
      baseUrl: preset.baseUrl,
      model: preset.model,
      apiStyle: preset.apiStyle,
      apiKey: "",
    }));
    setTestResults(null);
  };

  const editChannel = (c: Channel) => {
    setForm({
      id: c.id,
      providerKey: c.providerKey,
      name: c.name,
      baseUrl: c.baseUrl,
      model: c.model,
      apiStyle: c.apiStyle,
      thinkingLevel: c.thinkingLevel,
      userAgent: c.userAgent,
      networkMode: c.network.mode,
      proxyUrl: c.network.proxyUrl,
      headerOverrides: JSON.stringify(c.headerOverrides ?? {}, null, 2),
      bodyOverrides: JSON.stringify(c.bodyOverrides ?? {}, null, 2),
      apiKey: "",
    });
    setTestResults(null);
  };

  const newChannel = () => {
    setForm({ ...EMPTY_FORM });
    setTestResults(null);
  };

  const save = async () => {
    const a = api();
    if (!a) return;
    setError("");
    if (!form.name.trim()) return setError("请填写线路名称");
    if (!form.baseUrl.trim()) return setError("请填写 Base URL");
    if (!form.model.trim()) return setError("请填写模型名");
    try {
      const r = await a.settingsSaveChannel({
        id: form.id || undefined,
        providerKey: form.providerKey,
        name: form.name,
        baseUrl: form.baseUrl,
        model: form.model,
        apiStyle: form.apiStyle,
        thinkingLevel: form.thinkingLevel,
        userAgent: form.userAgent,
        network: { mode: form.networkMode, proxyUrl: form.proxyUrl },
        headerOverrides: form.headerOverrides,
        bodyOverrides: form.bodyOverrides,
      });
      const channelId = r.channelId;
      if (form.apiKey.trim()) await a.settingsSaveSecret(channelId, form.apiKey);
      await refresh();
      setForm((f) => ({ ...f, id: channelId, apiKey: "" }));
      setMessage(form.apiKey.trim()
        ? "线路「" + form.name + "」已保存；密钥已加密保存到本机"
        : "线路「" + form.name + "」已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeChannel = async (id: string) => {
    const a = api();
    if (!a) return;
    await a.settingsDeleteChannel(id);
    await refresh();
    setMessage("线路已删除");
    if (form.id === id) newChannel();
  };

  const deleteKey = async (id: string) => {
    const a = api();
    if (!a) return;
    await a.settingsDeleteSecret(id);
    await refresh();
    setMessage("密钥已删除");
  };

  const runTest = async (channelId?: string) => {
    const a = api();
    if (!a) return;
    const target = channelId ?? form.id;
    if (!target) { setError("请先保存线路再进行连接测试"); return; }
    setError("");
    setMessage("");
    setTestResults([]);
    setTesting(true);
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    setTestId(id);
    try {
      const results = await a.settingsTestConnection(id, target);
      setTestResults(results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const saveRole = async (roleKey: TaskRoleKey, channelId: string) => {
    const a = api();
    if (!a) return;
    setError("");
    try {
      await a.settingsSaveRole(roleKey, channelId);
      await refresh();
      setMessage("角色配置已保存");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveEmail = async () => {
    const a = api();
    if (!a) return;
    setError("");
    try {
      await a.settingsSaveContactEmail(contactEmail);
      await refresh();
      setMessage("联系邮箱已保存（用于 Crossref 检索礼貌池配额）");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const channels = snapshot?.channels ?? [];
  const roleMap = new Map((snapshot?.roles ?? []).map((r) => [r.roleKey, r.channelId]));
  const formConfigured = form.id ? (channels.find((c) => c.id === form.id)?.hasKey ?? false) : false;

  return (
    <div className="workspace-inner settings">
      {tab === "models" && (
        <section className="card">
          <div className="card-head-row">
            <h2 className="card-title">模型服务（多线路，像中转站一样自由配置）</h2>
            <button className="btn" onClick={newChannel}>+ 新建线路</button>
          </div>
          <p className="muted">每条线路独立配置：名称、服务商模板、Base URL、模型、API 风格、思考档位、密钥、代理与 User-Agent/Header/Body 覆盖。配置好的线路全部保存在下方列表，任务角色与搜索服务只从这些线路里选。</p>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="ch-preset">服务商模板（可选，快速填充）</label>
              <select id="ch-preset" className="select" value={form.providerKey} onChange={(e) => applyPreset(e.target.value)}>
                {MODEL_PRESETS.map((p) => <option key={p.providerKey} value={p.providerKey}>{p.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ch-name">线路名称 *</label>
              <input id="ch-name" className="input" placeholder="如：DeepSeek V4 Pro 主线路" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="ch-base">Base URL *</label>
              <input id="ch-base" className="input" placeholder="如：https://api.deepseek.com/v1" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="ch-model">模型名 *</label>
              <input id="ch-model" className="input" placeholder="如：deepseek-v4-pro" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="ch-style">API 风格</label>
              <select id="ch-style" className="select" value={form.apiStyle} onChange={(e) => setForm((f) => ({ ...f, apiStyle: e.target.value as ApiStyle }))}>
                {(Object.keys(API_STYLE_LABEL) as ApiStyle[]).map((s) => <option key={s} value={s}>{API_STYLE_LABEL[s]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="ch-thinking">思考档位</label>
              <select id="ch-thinking" className="select" value={form.thinkingLevel} onChange={(e) => setForm((f) => ({ ...f, thinkingLevel: e.target.value as ThinkingLevel }))}>
                {(Object.keys(THINKING_LEVEL_LABEL) as ThinkingLevel[]).map((t) => <option key={t} value={t}>{THINKING_LEVEL_LABEL[t]}</option>)}
              </select>
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="ch-key">API Key</label>
              <input id="ch-key" className="input" type="password" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                placeholder={formConfigured ? "已配置密钥（留空保持不变，输入新值将覆盖）" : "输入 API Key"} autoComplete="off" />
              <span className="hint">密钥状态：{formConfigured ? <strong>已加密保存到本机</strong> : "未配置"}（只存密文，界面不显示明文）</span>
            </div>
            <div className="field">
              <label htmlFor="ch-netmode">网络方式（线路级代理覆盖）</label>
              <select id="ch-netmode" className="select" value={form.networkMode} onChange={(e) => setForm((f) => ({ ...f, networkMode: e.target.value }))}>
                <option value="direct">直连</option>
                <option value="system">跟随系统代理</option>
                <option value="custom">自定义代理</option>
              </select>
            </div>
            {form.networkMode === "custom" && (
              <div className="field">
                <label htmlFor="ch-proxy">代理地址</label>
                <input id="ch-proxy" className="input" placeholder="如：http://127.0.0.1:7890" value={form.proxyUrl} onChange={(e) => setForm((f) => ({ ...f, proxyUrl: e.target.value }))} />
              </div>
            )}
            <div className="field">
              <label htmlFor="ch-ua">自定义 User-Agent（可选）</label>
              <input id="ch-ua" className="input" placeholder="留空使用默认" value={form.userAgent} onChange={(e) => setForm((f) => ({ ...f, userAgent: e.target.value }))} />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="ch-headers">Header 覆盖（JSON，可选）</label>
              <textarea id="ch-headers" className="textarea code" placeholder={'{"X-Custom": "value"}'} value={form.headerOverrides} onChange={(e) => setForm((f) => ({ ...f, headerOverrides: e.target.value }))} />
            </div>
            <div className="field">
              <label htmlFor="ch-body">Body 覆盖（JSON，可选，浅合并）</label>
              <textarea id="ch-body" className="textarea code" placeholder={'{"temperature": 0.3}'} value={form.bodyOverrides} onChange={(e) => setForm((f) => ({ ...f, bodyOverrides: e.target.value }))} />
            </div>
          </div>

          <div className="settings-actions">
            <button className="btn btn-primary" onClick={() => void save()}>{form.id ? "保存线路修改" : "添加线路"}</button>
            {form.id && <button className="btn" disabled={testing} onClick={() => void runTest()}>连接测试</button>}
            {testing && <button className="btn" onClick={() => { const a = api(); if (a) void a.settingsCancelTest(testId); }}>取消测试</button>}
            {form.id && formConfigured && <button className="btn btn-danger" onClick={() => void deleteKey(form.id)}>删除密钥</button>}
            {form.id && <button className="btn btn-danger" onClick={() => void removeChannel(form.id)}>删除线路</button>}
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

          <div className="channels-list">
            <h3 className="ai-title">已配置的线路（{channels.length} 条，保存在下方）</h3>
            {channels.length === 0 ? (
              <p className="empty-hint">还没有线路。填写上方表单点「添加线路」。</p>
            ) : (
              channels.map((c) => (
                <div key={c.id} className={"lit-item" + (form.id === c.id ? " channel-current" : "")}>
                  <div className="lit-item-main">
                    <div className="lit-title">
                      {c.name}
                      <span className="badge">{c.model}</span>
                      <span className="badge">{API_STYLE_LABEL[c.apiStyle]}</span>
                      {c.thinkingLevel !== "none" && <span className="badge badge-warn">思考 {THINKING_LEVEL_LABEL[c.thinkingLevel]}</span>}
                      {c.hasKey && <span className="badge badge-done">已配置密钥</span>}
                    </div>
                    <div className="muted">{c.baseUrl}{c.network.mode !== "direct" ? " · 代理：" + c.network.mode : ""}</div>
                  </div>
                  <div className="lit-item-actions">
                    <button className="btn btn-sm" onClick={() => editChannel(c)}>编辑</button>
                    <button className="btn btn-sm" onClick={() => void runTest(c.id)}>测试</button>
                    <button className="btn btn-sm btn-danger" onClick={() => void removeChannel(c.id)}>删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {tab === "roles" && (
        <section className="card">
          <h2 className="card-title">任务角色（从已添加的线路中选择）</h2>
          <p className="muted">五个任务角色可分别指定线路；这里只列出你在「模型服务」中已添加的线路。</p>
          {channels.length === 0 && <p className="banner banner-error">还没有添加任何线路：请先到「模型服务」添加线路（含密钥），再回来分配角色。</p>}
          {TASK_ROLES.map((role) => {
            const channelId = roleMap.get(role.key) ?? "";
            return (
              <div key={role.key} className="role-row">
                <div className="role-info">
                  <strong>{role.label}</strong>
                  <span className="muted">{role.description}</span>
                </div>
                <select
                  className="select role-select"
                  aria-label={role.label + "服务商"}
                  value={channelId}
                  onChange={(e) => void saveRole(role.key, e.target.value)}
                >
                  <option value="">— 未指定 —</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.model}）</option>)}
                </select>
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
          <p className="muted">检索辅助（生成检索式）可以单独指定一条已添加的线路；学术检索本身走 Crossref / arXiv / PubMed 真实数据源。</p>
          {(() => {
            const role = TASK_ROLES.find((r) => r.key === "search_assist") as (typeof TASK_ROLES)[number];
            const channelId = roleMap.get(role.key) ?? "";
            return (
              <div className="role-row">
                <div className="role-info">
                  <strong>{role.label}</strong>
                  <span className="muted">{role.description}</span>
                </div>
                <select
                  className="select role-select"
                  aria-label={role.label + "服务商"}
                  value={channelId}
                  onChange={(e) => void saveRole(role.key, e.target.value)}
                >
                  <option value="">— 未指定 —</option>
                  {channels.map((c) => <option key={c.id} value={c.id}>{c.name}（{c.model}）</option>)}
                </select>
              </div>
            );
          })()}
          <div className="field">
            <label htmlFor="sp-email">联系邮箱（Crossref 礼貌池）</label>
            <input id="sp-email" className="input" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Crossref 要求真实邮箱以获得正常检索配额；示例域名会被拒绝（HTTP 429）" />
          </div>
          <div className="settings-actions">
            <button className="btn btn-primary" onClick={() => void saveEmail()}>保存邮箱</button>
          </div>
          {message && <p className="banner banner-info">{message}</p>}
          {error && <p className="banner banner-error">{error}</p>}
        </section>
      )}
    </div>
  );
}
