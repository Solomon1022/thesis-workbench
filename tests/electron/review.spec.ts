import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("审阅意见：新增→状态流转→筛选→修改说明→重启持久化", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("button", { name: "电子商务", exact: true }).click();
    await page.getByLabel("项目名称 *").fill("审阅测试-" + Date.now());
    await page.getByRole("button", { name: "问卷定量研究", exact: true }).click();
    await page.getByRole("button", { name: "创建项目" }).click();

    await page.getByRole("button", { name: /审阅与修改/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByText("审阅与修改工作流")).toBeVisible();

    // 新增两条意见（不同章节、不同来源）
    await page.getByLabel("意见章节").selectOption("writing");
    await page.getByLabel("意见来源").selectOption("导师");
    await page.getByLabel("意见内容").fill("研究背景缺少研究意义的论述");
    await page.getByLabel("修改建议").fill("补一段意义");
    await page.getByRole("button", { name: "添加意见" }).click();
    await expect(page.getByText("审阅意见已记录")).toBeVisible();

    await page.getByLabel("意见章节").selectOption("design");
    await page.getByLabel("意见来源").selectOption("自己");
    await page.getByLabel("意见内容").fill("假设 H2 的表述需要更可证伪");
    await page.getByRole("button", { name: "添加意见" }).click();
    await expect(page.locator(".lit-item").filter({ hasText: "假设 H2" })).toBeVisible();

    // 状态流转 + 修改说明（第一条）
    const firstItem = page.locator(".lit-item").filter({ hasText: "研究意义" });
    await firstItem.getByLabel("意见状态").selectOption("done");
    await firstItem.getByLabel("修改说明").fill("已补充意义段落并重新组织开头");
    await expect(firstItem.getByText("已补充意义段落并重新组织开头")).toBeVisible();

    // 筛选：只显示已完成
    await page.getByLabel("筛选状态").selectOption("done");
    await expect(page.locator(".lit-item")).toHaveCount(1);
    await expect(page.getByText("假设 H2 的表述")).toHaveCount(0);
    await page.getByLabel("筛选状态").selectOption("");
    await expect(page.locator(".lit-item")).toHaveCount(2);

    // 删除第二条
    await page.locator(".lit-item").filter({ hasText: "假设 H2" }).getByRole("button", { name: "删除" }).click();
    await expect(page.locator(".lit-item")).toHaveCount(1);
  } finally {
    await app.close();
  }

  // 重启：意见仍在
  const app2 = await electron.launch({ args: ["."], env });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(/审阅测试-/)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(/审阅测试-/).click();
    await page2.getByRole("button", { name: /审阅与修改/ }).click();
    await expect(page2.locator(".lit-item").filter({ hasText: "研究意义" })).toBeVisible();
    await expect(page2.locator(".lit-item").filter({ hasText: "研究意义" }).getByText("已补充意义段落并重新组织开头")).toBeVisible();
  } finally {
    await app2.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
