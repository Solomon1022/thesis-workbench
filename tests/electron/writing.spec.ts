import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 写作管线验证（测试夹具）：模拟模型返回带 [@ref_N] 引用与 gaps 的 JSON；
 * 验证正文渲染、材料清单映射真实文献、缺口清单、未列引用告警与草稿持久化。
 */

function startMockModel(): { server: Server; base: string } {
  const out = {
    stage: "正文草稿",
    content: "直播互动对消费者购买意愿具有显著影响 [@ref_1]。后续研究可进一步考察调节变量 [@ref_9]。",
    claims: [{ statement: "直播互动对消费者购买意愿具有显著影响", source_ids: ["ref_1"], status: "grounded" }],
    gaps: [{ claim: "调节变量选择缺乏依据", missing: "缺少相应文献", action: "请补充调节变量相关文献后重新生成" }],
    next_steps: ["补充调节变量文献", "人工核对正文引用"],
  };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
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
    { title: ["Live Streaming Commerce and Consumer Purchase Intention"], author: [{ given: "Wei", family: "Li" }], issued: { "date-parts": [[2023]] }, "container-title": ["J. Retail"], DOI: "10.5555/live-2023", URL: "https://example.org/live", abstract: "This paper examines how live streaming interaction affects purchase intention.", type: "journal-article" },
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

test("写作管线：接地文献库 → 正文/引用/缺口 → 草稿持久化", async () => {
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

    // 配置模型 + 写作角色
    await page.getByRole("button", { name: "服务与模型设置" }).click();
    await page.getByLabel("服务商模板（可选，快速填充）").selectOption("custom");
    await page.getByLabel("线路名称 *").fill("测试线路");
    await page.getByLabel("Base URL *").fill(model.base);
    await page.getByLabel("模型名 *").fill("test-model");
    await page.getByLabel("API Key").fill("sk-mock");
    await page.getByRole("button", { name: "添加线路" }).click();
    await expect(page.getByText(/已保存/).first()).toBeVisible();
    await page.getByRole("button", { name: "任务角色" }).click();
    await page.getByLabel("写作服务商").selectOption({ index: 1 });
    await expect(page.getByText("角色配置已保存")).toBeVisible();
    await page.getByRole("button", { name: "返回项目" }).click();

    // 建项目 → 入库真实文献
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("写作测试-" + Date.now());
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: /文献综述与证据整理/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("检索式").fill("live streaming");
    await page.getByRole("button", { name: "检索", exact: true }).click();
    await page.locator(".lit-candidate").filter({ hasText: "Live Streaming Commerce" }).getByRole("button", { name: "保存" }).click();
    await expect(page.getByText(/已保存：Live Streaming/)).toBeVisible();

    // 写作阶段
    await page.getByRole("button", { name: /初稿与完整稿/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByText("AI 写作（接地文献库的 RAG）")).toBeVisible();
    await page.getByRole("button", { name: "AI 写作" }).click();
    await expect(page.getByText(/生成完成/)).toBeVisible({ timeout: 30_000 });

    // 正文 + 引用 + 缺口 + 未列引用告警
    await expect(page.getByText(/直播互动对消费者购买意愿具有显著影响/).first()).toBeVisible();
    await expect(page.getByText("[@ref_1]", { exact: false }).first()).toBeVisible();
    await expect(page.getByText("缺口清单（gaps）")).toBeVisible();
    await expect(page.getByText(/调节变量选择缺乏依据/)).toBeVisible();
    await expect(page.getByText(/材料清单外的引用编号：ref_9/)).toBeVisible();
    await expect(page.getByText(/Live Streaming Commerce/).first()).toBeVisible();

    // 保存草稿 → 草稿字段出现
    await page.getByRole("button", { name: "保存到本阶段草稿" }).click();
    await expect(page.getByText("已保存到本阶段草稿")).toBeVisible();
    await expect(page.getByLabel("草稿与正文")).toHaveValue(/直播互动对消费者购买意愿具有显著影响/);
  } finally {
    await app.close();
  }

  // 重启：草稿持久化
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(/写作测试-/)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(/写作测试-/).click();
    await page2.getByRole("button", { name: /初稿与完整稿/ }).click();
    await expect(page2.getByLabel("草稿与正文")).toHaveValue(/直播互动对消费者购买意愿具有显著影响 \[@ref_1\]/);
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
