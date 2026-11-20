import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 阶段 4（新交互）验证：全局 AI 助手（建议不自动填入 + 对话记忆）、
 * 选题变量编辑器、假设卡片、版本管理、开题框架、重启持久化。
 */

const VARIABLES_JSON = JSON.stringify({ iv: ["直播互动性"], dv: ["购买意愿"], mediator: ["消费者信任"], custom: ["观看频次"] });

function startMockModel(): { server: Server; base: string } {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let system = "";
      let user = "";
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> };
        system = parsed.messages?.find((m) => m.role === "system")?.content ?? "";
        user = parsed.messages?.find((m) => m.role === "user")?.content ?? "";
      } catch { /* ignore */ }
      let out: unknown = { message: "unknown" };
      if (system.startsWith("你是开题报告助手")) {
        out = { sections: [{ title: "研究背景与问题", content: "AI 虚拟主播直播日益普及（AI 草稿，待核验）。" }, { title: "研究方法", content: "问卷定量研究，量表来源待核验。" }] };
      } else if (system.startsWith("你是论文写作助手，与研究者就该阶段内容实时对话")) {
        out = { reply: "" };
      } else if (system.startsWith("你是论文写作助手。针对给定字段生成建议内容草稿。")) {
        const marker = "需要生成建议的字段：";
        const targetPart = user.includes(marker) ? user.slice(user.indexOf(marker) + marker.length) : user;
        if (targetPart.includes("variables")) {
          out = {
            fields: [
              { key: "variables", content: VARIABLES_JSON, note: "变量划分建议，可按需增删" },
              { key: "candidates", content: "直播互动性是否通过消费者信任影响购买意愿？", note: "候选问题示例" },
            ],
            advice: "整体建议：先确定变量关系，再细化研究问题。",
          };
        } else if (targetPart.includes("hypotheses")) {
          out = {
            fields: [
              { key: "research_question", content: "直播互动性如何通过消费者信任影响购买意愿？（AI 草稿，待复核）", note: "基于变量关系" },
              { key: "constructs", content: "互动性、消费者信任、购买意愿（构念定义待核验）", note: "" },
              { key: "hypotheses", content: JSON.stringify([{ number: "H1", statement: "互动性正向影响购买意愿", iv: "互动性", dv: "购买意愿", basis: "理论推导，待核验" }]), note: "假设卡片" },
            ],
            advice: "整体建议：H1 可直接采用。",
          };
        }
      }
      // 对话回复
      if (system.startsWith("你是论文写作助手，与研究者就该阶段内容实时对话")) {
        out = "这是 AI 的对话回复：建议先明确研究对象，再展开候选问题。";
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: typeof out === "string" ? out : JSON.stringify(out) } }] }));
    });
  });
  return {
    server,
    get base() {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      return "http://127.0.0.1:" + port + "/v1";
    },
  };
}

function startMockCrossref(): { server: Server; base: string } {
  const works = [
    { title: ["Attention is all you need"], author: [{ given: "Ashish", family: "Vaswani" }], issued: { "date-parts": [[2017]] }, "container-title": ["NeurIPS"], DOI: "10.5555/3295222.3295349", URL: "https://example.org/attention", abstract: "", type: "proceedings-article" },
  ];
  const server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/works?query")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: { items: works } }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  return {
    server,
    get base() {
      const a = server.address();
      const port = typeof a === "object" && a ? a.port : 0;
      return "http://127.0.0.1:" + port;
    },
  };
}

test("阶段 4：全局 AI 助手（建议+对话）→ 变量 → 假设 → 版本 → 开题 → 重启恢复", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const model = startMockModel();
  const crossref = startMockCrossref();
  await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", () => resolve()));
  await new Promise<void>((resolve) => crossref.server.listen(0, "127.0.0.1", () => resolve()));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    TWB_TEST_USER_DATA: userDataDir,
    TWB_CROSSREF_BASE: crossref.base,
    ELECTRON_DEV_URL: "http://localhost:5173",
  } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 配置模型并分配研究设计角色
    await page.getByRole("button", { name: "服务与模型设置" }).click();
    await page.getByLabel("服务商模板（可选，快速填充）").selectOption("custom");
    await page.getByLabel("线路名称 *").fill("测试线路");
    await page.getByLabel("Base URL *").fill(model.base);
    await page.getByLabel("模型名 *").fill("test-model");
    await page.getByLabel("API Key").fill("sk-mock");
    await page.getByRole("button", { name: "添加线路" }).click();
    await expect(page.getByText(/密钥已加密保存到本机/)).toBeVisible();
    await page.getByRole("button", { name: "任务角色" }).click();
    await page.getByLabel("研究设计服务商").selectOption({ index: 1 });
    await expect(page.getByText("角色配置已保存")).toBeVisible();
    await page.getByRole("button", { name: "返回项目" }).click();

    // 建问卷项目
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("阶段4新交互-" + Date.now());
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();

    // 入库一篇真实文献
    await page.getByRole("button", { name: /文献综述与证据整理/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("检索式").fill("attention");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Attention is all you need" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/已保存：Attention/)).toBeVisible();

    // 选题阶段：可视化指南 + 变量编辑器 + AI 建议（不自动填入）+ 对话
    await page.getByRole("button", { name: /前期检索与选题/ }).click();
    await expect(page.getByText("这一阶段做什么")).toBeVisible();
    await expect(page.getByText("AI 助手（建议不自动填入；对话有记忆，可随时重新提问）")).toBeVisible();
    // 变量编辑器存在（研究对象与场景已拆分）
    await expect(page.getByText("自变量（IV）")).toBeVisible();
    await expect(page.getByText("因变量（DV）")).toBeVisible();
    // 生成建议 → 不自动填入
    await page.getByRole("button", { name: "为当前阶段生成建议" }).click();
    await expect(page.getByText("变量划分建议，可按需增删")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("整体建议：先确定变量关系，再细化研究问题。")).toBeVisible();
    await expect(page.getByLabel("自变量（IV）变量1")).toHaveValue("");
    // 用户点击填入
    await page.locator(".ai-suggest-item").filter({ hasText: "研究对象变量" }).getByRole("button", { name: "填入此内容" }).click();
    await expect(page.getByLabel("自变量（IV）变量1")).toHaveValue("直播互动性");
    await expect(page.getByLabel("因变量（DV）变量1")).toHaveValue("购买意愿");
    await page.locator(".ai-suggest-item").filter({ hasText: "候选研究问题" }).getByRole("button", { name: "填入此内容" }).click();
    await expect(page.getByLabel("候选研究问题")).toHaveValue("直播互动性是否通过消费者信任影响购买意愿？");
    // 对话 + 重新提问 + 清空
    await page.getByLabel("AI 提问").fill("这个方向可行吗？");
    await page.getByRole("button", { name: "发送" }).click();
    await expect(page.getByText("这是 AI 的对话回复：建议先明确研究对象，再展开候选问题。")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "清空对话" }).click();
    await expect(page.getByText("对话已清空（记忆已清除）")).toBeVisible();

    // 研究设计：AI 建议（不自动填入）→ 填入字段与假设卡片 → 版本
    await page.getByRole("button", { name: /研究问题与设计/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByLabel("研究问题")).toHaveValue("");
    await page.getByRole("button", { name: "为当前阶段生成建议" }).click();
    await expect(page.getByText("基于变量关系")).toBeVisible({ timeout: 30_000 });
    await page.locator(".ai-suggest-item").filter({ hasText: "研究问题" }).getByRole("button", { name: "填入此内容" }).click();
    await expect(page.getByLabel("研究问题")).toHaveValue(/直播互动性如何通过消费者信任影响购买意愿/);
    await page.locator(".ai-suggest-item").filter({ hasText: "研究假设卡片" }).getByRole("button", { name: "填入此内容" }).click();
    await expect(page.getByLabel("假设陈述").first()).toHaveValue("互动性正向影响购买意愿");
    await page.getByRole("button", { name: "保存假设卡片" }).click();
    await page.getByLabel("版本备注").fill("AI 初稿");
    await page.getByRole("button", { name: "保存版本" }).click();
    await expect(page.getByText("版本已保存")).toBeVisible();
    await expect(page.getByText(/v1/).first()).toBeVisible();

    // 开题框架
    await page.getByRole("button", { name: /开题报告/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByRole("button", { name: "生成开题框架" }).click();
    await expect(page.getByLabel("章节标题1")).toHaveValue("研究背景与问题");
    await page.getByLabel("版本备注").fill("框架初稿");
    await page.getByRole("button", { name: "保存版本" }).click();
    await expect(page.getByText(/v1/).first()).toBeVisible();
  } finally {
    await app.close();
  }

  // 重启验证持久化（变量、假设卡片、版本、对话清空状态）
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(/阶段4新交互-/)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(/阶段4新交互-/).click();
    await page2.getByRole("button", { name: /前期检索与选题/ }).click();
    await expect(page2.getByLabel("自变量（IV）变量1")).toHaveValue("直播互动性");
    await expect(page2.getByLabel("候选研究问题")).toHaveValue("直播互动性是否通过消费者信任影响购买意愿？");
    await page2.getByRole("button", { name: /研究问题与设计/ }).click();
    await expect(page2.getByLabel("假设陈述").first()).toHaveValue("互动性正向影响购买意愿");
    await expect(page2.getByText(/v1/).first()).toBeVisible();
    await page2.getByRole("button", { name: "恢复此版本" }).click();
    await expect(page2.getByText(/已恢复版本 v1/).first()).toBeVisible();
    await expect(page2.getByLabel("研究问题")).toHaveValue(/直播互动性如何通过消费者信任影响购买意愿/);
  } finally {
    await app2.close();
    await new Promise<void>((resolve) => model.server.close(() => resolve()));
    await new Promise<void>((resolve) => crossref.server.close(() => resolve()));
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
