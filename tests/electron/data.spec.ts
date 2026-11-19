import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * 阶段 5 验证（测试夹具）：CSV 导入 → 类型推断与缺失检查 → 描述统计/α/回归的本地计算
 * （数值与 numpy 独立参考值对照）→ AI 解释 → 重启持久化。
 */

const CSV = [
  "x1,x2,x3,x4,x5,y",
  "4,3,4,5,4,4.2",
  "4,4,3,5,4,3.9",
  "3,4,4,4,3,4.4",
  "5,4,5,5,4,4.9",
  ",3,4,5,4,4.1",
  "2,3,3,2,3,3.5",
  "4,4,4,5,5,4.6",
  "5,4,5,4,5,5.0",
  "3,4,3,4,3,3.7",
  "4,3,4,5,4,4.3",
  "4,4,5,4,4,4.5",
  "3,3,4,4,4,4.0",
].join("\n");

function startMockModel(): { server: Server; base: string } {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: "这些结果来自本地计算：x1 均值 3.727、标准差 0.905；Cronbach α 为 0.808 表示内部一致性良好（解释示例）。" } }] }));
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

test("阶段 5：数据导入 → 本地分析 → AI 解释 → 重启持久化", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const model = startMockModel();
  await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", () => resolve()));
  const env = {
    ...process.env,
    NODE_ENV: "test",
    TWB_TEST_USER_DATA: userDataDir,
    ELECTRON_DEV_URL: "http://localhost:5173",
  } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 配置模型 + 分析解释角色
    await page.getByRole("button", { name: "服务与模型设置" }).click();
    await page.getByRole("button", { name: "自定义 / OpenAI 兼容中转" }).click();
    await page.getByLabel("Base URL *").fill(model.base);
    await page.getByLabel("模型名 *").fill("test-model");
    await page.getByLabel("API Key").fill("sk-mock");
    await page.getByRole("button", { name: "保存配置" }).click();
    await expect(page.getByText(/已保存/).first()).toBeVisible();
    await page.getByRole("button", { name: "任务角色" }).click();
    await page.getByLabel("分析解释服务商").selectOption("custom");
    await page.getByRole("button", { name: "保存分析解释" }).click();
    await expect(page.getByText("角色配置已保存")).toBeVisible();
    await page.getByRole("button", { name: "返回项目" }).click();

    // 建项目 → 数据导入
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("数据测试-" + Date.now());
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: /资料收集/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByText("数据导入（保留原始文件，清洗为派生版本）")).toBeVisible();
    await page.getByLabel("粘贴CSV").fill(CSV);
    await page.getByRole("button", { name: "导入文本" }).click();
    await expect(page.getByText(/已导入：12 行 × 6 列/)).toBeVisible();
    // 变量字典：x1 有 1 个缺失
    const varRow = page.locator(".data-table tbody tr").filter({ hasText: "x1" });
    await expect(varRow).toContainText("数值");
    await expect(varRow).toContainText("1");

    // 分析阶段
    await page.getByRole("button", { name: /整理与分析/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByText("本地分析（受控计算模块，AI 只解释真实结果）")).toBeVisible();

    // 描述统计（全部数值列）
    await page.getByLabel("数据文件").selectOption({ index: 1 });
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByText("分析完成（描述统计）")).toBeVisible();
    await expect(page.getByText("3.727")).toBeVisible(); // numpy 参考均值
    await expect(page.getByText("0.905")).toBeVisible(); // numpy 参考标准差

    // Cronbach α（选择 5 个题项，不含 y）
    await page.getByLabel("分析方法").selectOption("cronbach");
    for (const name of ["x1", "x2", "x3", "x4", "x5"]) {
      await page.getByRole("button", { name, exact: true }).click();
    }
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByText("分析完成（内部一致性（Cronbach α））")).toBeVisible();
    await expect(page.getByText(/Cronbach α = 0.8373/)).toBeVisible();

    // 线性回归 y ~ x1 + x2
    await page.getByLabel("分析方法").selectOption("regression");
    await page.getByLabel("因变量").selectOption("y");
    await page.getByRole("button", { name: "x1", exact: true }).click();
    await page.getByRole("button", { name: "x2", exact: true }).click();
    await page.getByRole("button", { name: "运行分析" }).click();
    await expect(page.getByText("分析完成（线性回归（OLS））")).toBeVisible();
    await expect(page.getByText(/R² = 0.7266/)).toBeVisible();

    // AI 解释（对描述统计运行）
    await page.getByRole("button", { name: "AI 解释" }).first().click();
    await expect(page.getByText(/这些结果来自本地计算/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await app.close();
  }

  // 重启：数据文件与分析记录持久化
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(/数据测试-/)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(/数据测试-/).click();
    await page2.getByRole("button", { name: /整理与分析/ }).click();
    await expect(page2.getByText("分析记录（3）")).toBeVisible();
    await expect(page2.getByText(/Cronbach α = 0.8373/)).toBeVisible();
  } finally {
    await app2.close();
    await new Promise<void>((resolve) => model.server.close(() => resolve()));
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
