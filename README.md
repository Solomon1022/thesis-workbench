# 论文工作台（Thesis Workbench）

本科毕业论文全流程 AI 辅助桌面应用：从建立项目、选题、文献综述与证据管理，到开题报告、问卷与数据分析、论文写作与审阅，一条主流程跑通。**本仓库持续更新中，当前进度见下方「做到哪里」。**

> 适用对象：本科生（实证问卷类论文体验最佳）；数据全部本地存储，API 密钥用系统级加密，无云端依赖。

**English summary:** *Thesis Workbench is an Electron desktop app that walks undergraduate students through the whole thesis pipeline — project setup, topic selection, literature review & evidence management (AI-planned search across real academic sources, anti-hallucination pool re-ranking, GB/T 7714 citations, AI result backfill with source verification), thesis proposal generation (strict school-template layout, program-generated references & schedule, Word export), data analysis, and writing. All data stays local (SQLite + safeStorage). Built with Electron 45 + React 19 + TypeScript, covered by 83 unit tests and 11 Playwright Electron e2e tests. Actively maintained — see the progress checklist below.*

## 功能总览

### 核心主流程（已可用）
- **阶段 0 建立项目**：学科/学历/方法模板（问卷定量研究、实验、案例），一键生成阶段结构。
- **阶段 1 前期检索与选题**：变量编辑器（IV/DV/中介/调节）、AI 选题建议（不自动填入）、AI 对话（按项目+阶段记忆）。
- **阶段 2 研究问题与设计**：AI 设计草案、假设卡片（H1–H4）、版本管理（保存/恢复）。
- **阶段 3 文献综述与证据管理**（重点）：
  - **AI 检索论文**：把第 0/1/2 阶段内容整理成 Markdown 发给 AI 生成检索计划 → 真实学术数据源检索（知网/汉斯出版社/OpenAlex/Crossref，Google Scholar/BASE 提供跳转检索）→ 多轮不足改写 → **池内重排**（白名单校验 + 元数据只取自池内，AI 只排序不编造）→ 数量与关键词核验；全程可**取消**，进度接入左列「AI 任务状态」（后台继续、结果可恢复）；
  - 真实数据源：Crossref（polite pool）、OpenAlex、arXiv、PubMed、汉斯出版社（OA）；知网在校园网/VPN 环境防御式直抓题录，失败自动降级为官网跳转（不绕过验证码）；万方/维普为闭源库，提供官网跳转检索；
  - 证据卡片、GB/T 7714 引用复制、被引次数与期刊等级（CSSCI/北大核心/SCI/SSCI 静态表，可在用户目录 journal-rank.json 更新）、文献核验标记；
  - **导出第 0/1/2 阶段内容 MD**（含检索偏好，发给直聊 AI 找文献）与 **AI 结果回填**（粘贴直聊 AI 的文献列表 → 解析 → 逐条真实源核验 → 去重入库；未命中/限流失败的保留原始题录标「待核验」，零丢失不编造）；
  - 本地桥服务（127.0.0.1 + token，供浏览器扩展「一键回填」使用，扩展本体开发中）。
- **阶段 4 开题报告**（重点）：严格按学校《开题报告》表格架构生成——AI 只写「研究目的、意义（价值）及相关领域研究现状」「拟研究的主要问题、新颖性及拟采用的研究方法」两大块（按主研究方向，不包含候选研究方向）；**主要参考文献与整体进度安排由程序按文献库与截止时间自动生成**；MD 分节实时生成 + 左侧编辑/右侧预览 + 版本管理；「导出 Word」按模板样式排版（A4、页边距、黑体大标题、宋体正文、固定行距、信息表格，参数可在设置中修改）。
- **阶段 5–6 数据/写作/审阅**：数据导入与本地统计分析（描述/信效度/相关/回归/中介）、AI 结果解读（接地文献库）、写作生成（接地文献库 RAG）、审阅意见、备份快照、docx/pdf 导出。

### 系统能力
- **多线路模型配置**：4 种 API 风格、任务角色分配、三层连接测试、思考等级（DeepSeek 推理模型可用「思考 最大」）、密钥 safeStorage 加密。
- **AI 任务状态框**（左列）：所有 AI 任务后台继续、真实/模拟进度、完成/失败标记、返回页面自动恢复结果。
- **通用设置**：附件目录、输出目录（默认桌面）、界面语言、文字大小（Electron 原生缩放）、开题报告模板（可上传 .md/.txt）与 Word 格式参数。

## 技术栈
- **框架**：Electron 45（主进程/preload 上下文隔离/IPC）、React 19、TypeScript、Vite 6、tsup
- **存储**：node:sqlite（WAL + schema 迁移）、safeStorage 密钥加密
- **AI**：多服务商线路（OpenAI 兼容等 4 种风格）、ReAct 检索（LLM 计划 → 多轮检索 → 改写 → 池内重排）、防幻觉护栏（池白名单、元数据原值、数量不足如实报告）
- **文档**：自研轻量 Markdown 渲染；docx 生成（docx 库按模板排版）
- **测试**：Vitest 83 个单元测试、Playwright Electron 11 个端到端测试（mock 模型/数据源服务器）

## 做到哪里（进度标注，持续更新）
- ✅ 已可用：阶段 0–6 主流程、AI 检索论文（含取消/后台任务/池内重排防幻觉）、知网降级、AI 结果回填、开题报告（学校模板架构 + 程序生成参考文献/进度）、MD 导出与 Word 导出、通用设置。
- 🟡 开发中：浏览器扩展「一键回填」（本地桥服务已就绪，扩展本体未完成）。
- ⬜ 计划中：阶段 B 知网降级醒目提示 + NCPSSD 探针；阶段 C 浏览器半自动通道（内嵌有头窗口、手动登录、cookie 复用、验证码暂停、批量/超时/频率护栏）；AI 检索速度优化（合并规划步骤、降低思考等级选项）；MCP / 浏览器操作代理（远期，需多模态模型线路）。

## 实测数据（AI 结果回填）
- 解析：15 条混合格式文献（GB/T 7714 中文、带 DOI 英文、学位论文、报告、专著）**15/15 全部识别**；
- 导入速度：约 30–90 秒/15 条（每条 250ms 礼貌间隔 + Crossref 核验请求；遭遇 429 限流自动退避重试一次）；
- 入库策略：真实源命中 →「已核验」；未命中或核验请求失败 → 保留原始题录标「待核验」（零丢失、不编造）。

## 构建与运行
```bash
npm install
npm run build        # vite build && tsup
npm test             # vitest run
npm run e2e          # playwright test --config=playwright.electron.config.ts
npx electron-builder --dir   # 打包（Windows 建议配置 ELECTRON_MIRROR / ELECTRON_BUILDER_BINARIES_MIRROR 为 npmmirror 镜像）
```
运行 release/win-unpacked/Thesis Workbench.exe（勿带 ELECTRON_RUN_AS_NODE 环境变量）。

## 目录结构
```
src/
  main/          主进程：数据库、AI 服务、数据源适配器（cnki/hanspub/openalex/crossref/…）、池内重排、AI 任务注册表、本地桥服务、开题 docx 导出
  preload/       contextBridge 安全桥
  renderer/      React 界面（各阶段面板、AI 助手、任务状态框、通用设置）
  shared/        共享类型与常量（期刊等级表、文献类型、平台定义）
tests/
  unit/          Vitest 单元测试（83）
  electron/      Playwright Electron 端到端测试（11）
docs/requirements/  需求思维导图与功能架构图
```

## 说明与边界
- **防幻觉硬约束**：AI 只允许排序/改写/写作，文献元数据只能来自真实数据源或用户输入；数量不足时如实报告，绝不虚构文献。
- **合规**：知网仅做校园网环境下的题录解析并在失败时自动降级为官网跳转，不绕过验证码；万方/维普为闭源库，仅提供官网跳转；Crossref 使用 polite pool。
- 本仓库为个人学习与毕业设计用途，代码将持续更新，欢迎 Star 与 Issue。
