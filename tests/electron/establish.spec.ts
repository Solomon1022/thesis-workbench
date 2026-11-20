import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("第 0 项可编辑 + 项目知识汇总 + 设置三块布局", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 建项目（新建时信息进入第 0 项）
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("第0项测试");
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("button", { name: "创建项目" }).click();

    // 第 0 项：新建时填写的信息都在，可修改
    await page.getByRole("button", { name: /建立项目与要求/ }).click();
    await expect(page.getByText("项目信息（新建项目时填写的内容，这里可以随时修改）")).toBeVisible();
    await expect(page.getByLabel("项目名称")).toHaveValue("第0项测试");
    // 修改研究方法 + 截止日期 + 学科
    await page.getByLabel("研究方法").selectOption("ai-algorithm");
    await page.getByLabel("截止日期").fill("2027-06-30");
    await page.getByRole("button", { name: "人工智能与计算机", exact: true }).click();
    await page.getByRole("button", { name: "保存修改" }).click();
    await expect(page.getByText("第 0 项信息已保存")).toBeVisible();

    // 项目知识汇总可见（含项目信息）
    await page.getByText("项目知识汇总（AI 调用时读取的完整上下文，随时更新）").click();
    await expect(page.locator(".knowledge-pre")).toContainText("第0项测试");
    await expect(page.locator(".knowledge-pre")).toContainText("ai-algorithm");

    // 设置三块布局：侧栏保留 + 中间三个模块 + 右侧内容
    await page.getByRole("button", { name: "服务与模型设置" }).click();
    await expect(page.getByText("服务与模型设置", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "模型服务" })).toBeVisible();
    await expect(page.getByRole("button", { name: "任务角色" })).toBeVisible();
    await expect(page.getByRole("button", { name: "搜索服务" })).toBeVisible();
    await page.getByRole("button", { name: "任务角色" }).click();
    await expect(page.getByText(/五个任务角色可分别指定线路/)).toBeVisible();
    await page.getByRole("button", { name: "返回项目" }).click();
    await expect(page.getByText("论文研究，从这里开始")).not.toBeVisible();
  } finally {
    await app.close();
  }

  // 重启：第 0 项修改持久化
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText("第0项测试")).toBeVisible({ timeout: 30_000 });
    await page2.getByText("第0项测试").click();
    await page2.getByRole("button", { name: /建立项目与要求/ }).click();
    await expect(page2.getByLabel("研究方法")).toHaveValue("ai-algorithm");
    await expect(page2.getByLabel("截止日期")).toHaveValue("2027-06-30");
  } finally {
    await app2.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
