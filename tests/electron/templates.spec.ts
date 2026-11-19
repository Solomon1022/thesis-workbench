import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("三种方法模板与项目内容可在重启后恢复", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;
  const specs = [
    { name: "化学测试-" + Date.now(), discipline: "化学与材料", method: "chemistry-experiment", goal: "研究假设或设计目标", field: "样品与材料体系", exclusive: "数据集来源与许可", value: "样品记录" },
    { name: "AI测试-" + Date.now(), discipline: "人工智能与计算机", method: "ai-algorithm", goal: "设计目标或研究假设", field: "数据集来源与许可", exclusive: "样品与材料体系", value: "数据集版本记录" },
    { name: "电商测试-" + Date.now(), discipline: "电子商务", method: "questionnaire", goal: "研究问题", field: "理论构念", exclusive: "样品与材料体系", value: "消费者信任构念" },
  ];
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    const page = await app.firstWindow();
    const runtime = await app.evaluate(({ app }) => app.getPath("userData"));
    expect(path.resolve(runtime)).toBe(path.resolve(userDataDir));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30000 });
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByLabel("项目名称 *").fill("已有题目测试");
    await page.getByText("电子商务", { exact: true }).click();
    await page.getByLabel("研究方法 *").selectOption("questionnaire");
    await page.getByRole("checkbox", { name: "已有题目" }).check();
    await page.getByPlaceholder("粘贴或简要描述内容").fill("已知题目内容");
    await page.getByRole("button", { name: "创建项目" }).click();
    await expect(page.getByRole("heading", { name: "研究问题与设计" })).toBeVisible();
    for (const spec of specs) {
      await page.getByRole("button", { name: "新建项目" }).click();
      await page.getByLabel("项目名称 *").fill(spec.name);
      await page.getByText(spec.discipline, { exact: true }).click();
      await page.getByLabel("研究方法 *").selectOption(spec.method);
      await page.getByRole("button", { name: "创建项目" }).click();
      await page.getByRole("button", { name: /研究问题与设计/ }).click();
      await page.getByRole("button", { name: "开始此阶段" }).click();
      await expect(page.getByLabel(spec.field)).toBeVisible();
      await expect(page.getByLabel(spec.exclusive)).toHaveCount(0);
      if (spec.method === "chemistry-experiment") await expect(page.getByLabel("对照与处理设计")).toBeVisible();
      if (spec.method === "ai-algorithm") await expect(page.getByLabel("基线方法")).toBeVisible();
      if (spec.method === "questionnaire") await expect(page.getByLabel("变量角色")).toBeVisible();
      await page.getByLabel(spec.goal, { exact: true }).fill("持久化检查");
      await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10000 });
      await page.getByLabel(spec.field).fill(spec.value);
      await expect(page.getByText(/已自动保存/)).toBeVisible({ timeout: 10000 });
      // Verify navigation before a status update can reload and mask stale content.
      await page.getByRole("button", { name: /前期检索与选题/ }).click();
      await page.getByRole("button", { name: /研究问题与设计/ }).click();
      await expect(page.getByLabel(spec.goal, { exact: true })).toHaveValue("持久化检查");
      await expect(page.getByLabel(spec.field)).toHaveValue(spec.value);
      await page.getByRole("button", { name: "标记完成" }).click();
    }
    await app.close();
    app = undefined;
    app = await electron.launch({ args: ["."], cwd: process.cwd(), env });
    const restored = await app.firstWindow();
    for (const spec of specs) {
      await expect(restored.getByText(spec.name, { exact: true })).toBeVisible({ timeout: 30000 });
      await restored.getByText(spec.name, { exact: true }).click();
      await restored.getByRole("button", { name: /研究问题与设计/ }).click();
      await expect(restored.getByLabel(spec.goal, { exact: true })).toHaveValue("持久化检查");
      await expect(restored.getByLabel(spec.field)).toHaveValue(spec.value);
      await expect(restored.getByLabel(spec.exclusive)).toHaveCount(0);
      await restored.getByRole("button", { name: "项目首页" }).click();
    }
  } finally {
    if (app) await app.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
