import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 阶段 4 验证（测试夹具）：从零选题（依据真实文献库，编造引用标待核验）→ 设计起草与假设卡片 →
 * 开题框架 → 版本保存与恢复 → 重启持久化。模型与 Crossref 均为本地模拟服务。
 */

function startMockModel(): { server: Server; base: string } {
  const directions = [
    { question: "直播互动性如何影响消费者购买意愿？", basis: [0], data_path: "问卷星发放 300 份", feasibility: "发放渠道可得", limitations: "横截面数据不能作因果推断" },
    { question: "AI 主播可信度与复购意愿的关系", basis: [99], data_path: "待定", feasibility: "待核验", limitations: "来源待核验" },
  ];
  const design = {
    fields: {
      research_question: "AI 虚拟主播的互动性对消费者购买意愿有何影响？（AI 草稿，待复核）",
      constructs: "互动性、购买意愿（构念定义待核验）",
      variable_roles: "自变量：互动性；因变量：购买意愿",
      measures: "改编自已有量表（来源待核验）",
      sampling: "便利抽样",
      hypotheses: "",
    },
    hypotheses: [
      { number: "H1", statement: "互动性正向影响购买意愿", iv: "互动性", dv: "购买意愿", basis: "文献 0（待人工确认原文）" },
    ],
  };
  const proposal = {
    sections: [
      { title: "研究背景与问题", content: "AI 虚拟主播直播日益普及（AI 草稿，待核验）。" },
      { title: "研究方法", content: "问卷定量研究，量表来源待核验。" },
    ],
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let system = "";
      try {
        const parsed = JSON.parse(body) as { messages?: Array<{ role?: string; content?: string }> };
        system = parsed.messages?.find((m) => m.role === "system")?.content ?? "";
      } catch { /* ignore */ }
      let out: unknown = { message: "unknown prompt" };
      if (system.startsWith("你是论文选题助手")) out = directions;
      else if (system.startsWith("你是研究设计助手")) out = design;
      else if (system.startsWith("你是开题报告助手")) out = proposal;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: JSON.stringify(out) } }] }));
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

test("阶段 4：选题→设计→假设→开题→版本→重启恢复", async () => {
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
    await page.getByRole("button", { name: "自定义 / OpenAI 兼容中转" }).click();
    await page.getByLabel("Base URL *").fill(model.base);
    await page.getByLabel("模型名 *").fill("test-model");
    await page.getByLabel("API Key").fill("sk-mock");
    await page.getByRole("button", { name: "保存配置" }).click();
    await expect(page.getByText(/已保存/).first()).toBeVisible();
    await page.getByRole("button", { name: "任务角色" }).click();
    await page.getByLabel("研究设计服务商").selectOption("custom");
    await page.getByRole("button", { name: "保存研究设计" }).click();
    await expect(page.getByText("角色配置已保存")).toBeVisible();
    await page.getByRole("button", { name: "返回项目" }).click();

    // 建问卷项目
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("阶段4测试-" + Date.now());
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();

    // 先入库一篇真实文献
    await page.getByRole("button", { name: /文献综述与证据整理/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("检索式").fill("attention");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Attention is all you need" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/已保存：Attention/)).toBeVisible();

    // 选题：AI 生成候选方向，依据校验（有效引用 + 编造引用标待核验）
    await page.getByRole("button", { name: /前期检索与选题/ }).click();
    await expect(page.getByText("选题工作台（AI 辅助，依据真实文献库）")).toBeVisible();
    await page.getByLabel("研究对象", { exact: true }).fill("电商直播消费者");
    await page.getByRole("button", { name: "AI 生成候选方向" }).click();
    await expect(page.getByText("直播互动性如何影响消费者购买意愿？")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("AI 主播可信度与复购意愿的关系")).toBeVisible();
    await expect(page.getByText("来源待核验", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Attention is all you need")).toBeVisible();
    await page.locator(".lit-candidate").filter({ hasText: "直播互动性如何影响消费者购买意愿？" }).getByRole("button", { name: "保存方向" }).click();
    await expect(page.getByText("候选方向已保存")).toBeVisible();

    // 研究设计：AI 起草 + 假设卡片 + 版本
    await page.getByRole("button", { name: /研究问题与设计/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByRole("button", { name: "AI 起草设计内容" }).click();
    await expect(page.getByLabel("研究问题")).toHaveValue(/AI 虚拟主播的互动性对消费者购买意愿有何影响/);
    await expect(page.getByLabel("假设陈述").first()).toHaveValue("互动性正向影响购买意愿");
    await page.getByRole("button", { name: "保存假设卡片" }).click();
    await expect(page.getByText("假设卡片已保存")).toBeVisible();
    await page.getByLabel("版本备注").fill("AI 初稿");
    await page.getByRole("button", { name: "保存版本" }).click();
    await expect(page.getByText("版本已保存")).toBeVisible();
    await expect(page.getByText(/v1/).first()).toBeVisible();

    // 开题框架 + 版本
    await page.getByRole("button", { name: /开题报告/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByRole("button", { name: "生成开题框架" }).click();
    await expect(page.getByLabel("章节标题1")).toHaveValue("研究背景与问题");
    await expect(page.getByLabel("章节内容1")).toHaveValue(/AI 虚拟主播直播日益普及/);
    await page.getByLabel("版本备注").fill("框架初稿");
    await page.getByRole("button", { name: "保存版本" }).click();
    await expect(page.getByText(/v1/).first()).toBeVisible();
  } finally {
    await app.close();
  }

  // 重启验证持久化 + 恢复版本
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(/阶段4测试-/)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(/阶段4测试-/).click();
    await page2.getByRole("button", { name: /研究问题与设计/ }).click();
    await expect(page2.getByLabel("假设陈述").first()).toHaveValue("互动性正向影响购买意愿");
    await expect(page2.getByText(/v1/).first()).toBeVisible();
    await page2.getByRole("button", { name: "恢复此版本" }).click();
    await expect(page2.getByText(/已恢复版本 v1/).first()).toBeVisible();
    await expect(page2.getByLabel("研究问题")).toHaveValue(/AI 虚拟主播的互动性/);
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
