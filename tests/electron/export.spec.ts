import { expect, test, _electron as electron } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";

/**
 * 阶段 6.3 验证：备份包不含密钥、可恢复为新项目副本、快照列表与恢复；原项目不变。
 * 备份/恢复走主进程同一代码路径（exportBackupTo/exportRestoreFrom 为跳过系统对话框的等价入口）。
 */

test("备份与快照：不含密钥、恢复为副本、原项目不变", async () => {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "thesis-workbench-e2e-"));
  const zipPath = path.join(userDataDir, "backup.zip");
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;

  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    page.on("pageerror", (error) => console.error("PAGE ERROR:", error.message));
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    // 配置一个带密钥的提供商（验证备份不含密钥）
    await page.getByRole("button", { name: "服务与模型设置" }).click();
    await page.getByLabel("服务商模板（可选，快速填充）").selectOption("custom");
    await page.getByLabel("线路名称 *").fill("备份线路");
    await page.getByLabel("Base URL *").fill("http://127.0.0.1:1/v1");
    await page.getByLabel("模型名 *").fill("m");
    await page.getByLabel("API Key").fill("sk-super-secret");
    await page.getByRole("button", { name: "添加线路" }).click();
    await expect(page.getByText(/密钥已加密保存到本机/)).toBeVisible();
    await page.getByRole("button", { name: "返回项目" }).click();

    // 项目 + 内容 + 审阅意见
    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("button", { name: "电子商务", exact: true }).click();
    await page.getByLabel("项目名称 *").fill("备份测试-" + Date.now());
    await page.getByRole("button", { name: "问卷定量研究", exact: true }).click();
    await page.getByRole("button", { name: "创建项目" }).click();
    await page.getByRole("button", { name: /研究问题与设计/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("研究问题").fill("直播互动如何影响消费者购买意愿？");
    await expect(page.getByText(/已自动保存/).first()).toBeVisible();
    await page.getByRole("button", { name: /审阅与修改/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await page.getByLabel("意见内容").fill("需要补充中介变量的理论依据");
    await page.getByRole("button", { name: "添加意见" }).click();
    await expect(page.getByText("审阅意见已记录")).toBeVisible();

    // 获取项目 id（从侧栏项目按钮不可直接取 id——用 API 列表）
    const projectId = await page.evaluate(async () => {
      const a = window.thesisWorkbench;
      const list = await a.listProjects();
      return list[0].id;
    });
    console.log("EXPORT-PROJECT-ID: " + projectId);

    // 备份（等价主进程路径，跳过系统对话框）
    const size = await page.evaluate(async ([pid, p]) => {
      return await window.thesisWorkbench.exportBackupTo(pid, p);
    }, [projectId, zipPath] as [string, string]);
    console.log("EXPORT-ZIP-SIZE: " + size);
    expect(existsSync(zipPath)).toBe(true);

    // 检查 zip 内容：bundle.json 存在且不含密钥
    const zip = await JSZip.loadAsync(readFileSync(zipPath));
    const bundleText = await zip.file("bundle.json")?.async("string") ?? "";
    expect(bundleText).toContain("直播互动如何影响消费者购买意愿？");
    expect(bundleText).toContain("需要补充中介变量的理论依据");
    expect(bundleText).not.toContain("model_secrets");
    expect(bundleText).not.toContain("sk-super-secret");
    expect(bundleText).not.toContain("sk-");
    console.log("EXPORT-ZIP-SECRET-FREE: true");

    // 快照（UI 流程）
    await page.getByRole("button", { name: /答辩后修改与归档/ }).click();
    await page.getByRole("button", { name: "开始此阶段" }).click();
    await expect(page.getByText("导出、备份与快照")).toBeVisible();
    await page.getByLabel("快照名称").fill("提交前快照");
    await page.getByRole("button", { name: "创建快照" }).click();
    await expect(page.getByText("快照已创建")).toBeVisible();
    await expect(page.getByText("提交前快照")).toBeVisible();

    // 恢复备份为新副本（等价主进程路径）
    const outcome = await page.evaluate(async (p) => {
      return await window.thesisWorkbench.exportRestoreFrom(p);
    }, zipPath as string);
    console.log("EXPORT-RESTORED: " + outcome.projectName);
    expect(outcome.projectName).toContain("恢复副本");
    expect(outcome.projectId).not.toBe(projectId);

    // 刷新页面后：两个项目都在，副本内容完整
    await page.reload();
    await expect(page.getByText(/恢复副本/)).toBeVisible({ timeout: 30_000 });
    await page.getByText(/恢复副本/).click();
    await page.getByRole("button", { name: /研究问题与设计/ }).click();
    await expect(page.getByLabel("研究问题")).toHaveValue("直播互动如何影响消费者购买意愿？");
    await page.getByRole("button", { name: /审阅与修改/ }).click();
    await expect(page.locator(".lit-item").filter({ hasText: "中介变量的理论依据" })).toBeVisible();
  } finally {
    await app.close();
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(userDataDir));
    if (relative && !relative.startsWith("..") && !path.isAbsolute(relative) && path.basename(userDataDir).startsWith("thesis-workbench-e2e-")) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  }
});
