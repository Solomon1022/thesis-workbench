import { expect, test, _electron as electron } from "@playwright/test";

/**
 * 阶段 1 主流程验证：
 * 创建项目（选学科+研究方法）→ 模板字段随方法变化 → 填写内容自动保存 →
 * 关闭应用 → 重新启动 → 项目与内容仍在。
 * 测试数据使用唯一名称，避免多次运行互相干扰。
 */
test("创建项目→模板差异→保存→重启恢复", async () => {
  const launchEnv = { ...process.env, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const runName = "测试-化学实验-" + Date.now();

  const app = await electron.launch({ args: ["."], env: launchEnv });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));

    // 等待界面出现
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 新建化学实验项目
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill(runName);
    await page.getByText("化学与材料", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("chemistry-experiment");
    await page.getByRole("button", { name: "创建项目" }).click();

    // 带材料为空 → 从「前期检索与选题」开始；进入研究设计阶段看模板字段
    await page.getByRole("button", { name: /研究问题与设计/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByLabel("样品与材料体系")).toBeVisible();
    await expect(page.getByLabel("对照与处理设计")).toBeVisible();
    // AI 方法的字段不应出现在化学模板里
    await expect(page.getByLabel("数据集来源与许可")).toHaveCount(0);

    // 填写并自动保存
    await page.getByLabel("研究假设或设计目标").fill("测试假设：处理组优于对照组");
    await page.getByLabel("样品与材料体系").fill("样品 A / 对照 B");
    await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10_000 });

    // 标记阶段完成，验证状态持久化
    await page.getByRole("button", { name: "标记完成" }).click();
  } finally {
    await app.close();
  }

  // 重启验证持久化
  const app2 = await electron.launch({ args: ["."], env: launchEnv });
  try {
    const page2 = await app2.firstWindow();
    await expect(page2.getByText(runName)).toBeVisible({ timeout: 30_000 });
    await page2.getByText(runName).click();
    await expect(page2.getByText("下一步")).toBeVisible();
    await page2.getByRole("button", { name: /研究问题与设计/ }).click();
    await expect(page2.getByLabel("研究假设或设计目标")).toHaveValue("测试假设：处理组优于对照组");
    await expect(page2.getByLabel("样品与材料体系")).toHaveValue("样品 A / 对照 B");
    await expect(page2.getByText("已完成", { exact: false }).first()).toBeVisible();
  } finally {
    await app2.close();
  }
});
