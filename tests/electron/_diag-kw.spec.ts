import { expect, test, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// 真机诊断：底层 planKeywords 返回 + 前端关键词输出框渲染（验证后删除）
test("诊断：底层返回与前端区域", async () => {
  test.setTimeout(300_000);
  const userDataDir = mkdtempSync(path.join(tmpdir(), "tw-diag-kw-"));
  const env = { ...process.env, NODE_ENV: "test", TWB_TEST_USER_DATA: userDataDir, ELECTRON_DEV_URL: "http://localhost:5173" } as { [key: string]: string };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: ["."], env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (e) => { errors.push(e.message); console.log("PAGE-ERROR:", e.message); });
    await expect(page.getByText("论文研究，从这里开始")).toBeVisible({ timeout: 30_000 });

    await page.getByRole("button", { name: "新建项目" }).click();
    await page.getByRole("button", { name: "电子商务", exact: true }).click();
    await page.getByLabel("项目名称 *").fill("AI虚拟主播的直播互动性对消费者购买意愿影响分析");
    await page.getByRole("button", { name: "问卷定量研究", exact: true }).click();
    await page.getByRole("button", { name: "创建项目" }).click();

    // 填变量与候选问题
    await page.getByLabel("自变量（IV）变量1").fill("AI虚拟主播直播互动性");
    await page.getByLabel("因变量（DV）变量1").fill("购买意愿");
    await page.getByLabel("中介变量变量1").fill("社会临场感");
    await page.getByLabel("候选研究问题").fill("AI虚拟主播的直播互动性是否显著正向影响消费者购买意愿");
    await page.getByRole("button", { name: /文献综述与证据整理/ }).click();

    // ① 底层直连检查（绕过 UI）
    const pid = await page.evaluate(async () => (await window.thesisWorkbench.listProjects())[0].id);
    console.log("PID:", pid);
    const direct = await page.evaluate(async (id) => {
      try {
        const plan = await window.thesisWorkbench.reactPlanKeywords(id);
        return { ok: true, subject: plan.subject, result: plan.result, queries: plan.queries.length, note: plan.note };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }, pid as string);
    console.log("DIRECT-PLAN:", JSON.stringify(direct).slice(0, 600));

    // ② 前端检查：点击生成按钮后输出框状态
    const hasBox = await page.locator(".kw-output").count();
    console.log("KW-OUTPUT-BOX-EXISTS(点击前):", hasBox);
    await page.getByRole("button", { name: "生成关键词方案" }).click();
    await page.waitForTimeout(3000);
    const chips = await page.locator(".kw-chips .kw-tag").count();
    console.log("CHIPS(点击后):", chips);
    const chipTexts = await page.locator(".kw-chips .kw-tag").allTextContents();
    console.log("CHIP-TEXTS:", JSON.stringify(chipTexts.slice(0, 10)));
    const placeholder = await page.locator(".kw-chips .muted").allTextContents();
    console.log("PLACEHOLDER:", JSON.stringify(placeholder));
    const errBanners = await page.locator(".banner-error").allTextContents();
    console.log("ERROR-BANNERS:", JSON.stringify(errBanners.slice(0, 3)));
    const noteText = await page.locator(".react-box").first().textContent();
    console.log("BOX1-TEXT:", (noteText ?? "").replace(/\s+/g, " ").slice(0, 200));
    console.log("PAGE-ERRORS:", JSON.stringify(errors));
  } finally {
    await app.close();
    rmSync(userDataDir, { recursive: true, force: true });
  }
});
