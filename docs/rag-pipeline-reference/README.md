# 参考资料：全流程论文制作 RAG 管线（原版）

来源：用户提供（Claude 会话输出）。

本目录是原版设计稿。落地实现为 TypeScript，位于：
- `src/main/writing-service.ts`：管线主体（系统提示词逐字一致；检索改为对应用文献库的确定性精准检索——题录标题加权 + 摘要 + 证据卡片原文定位加权，替代原版 Chroma + 嵌入向量，理由见 docs/技术决策记录.md D12）
- `src/renderer/components/WritingPanel.tsx`：写作界面（材料清单、可点击引用、缺口清单）

LLMClient 按你的自定义 API 实现：走应用「服务与模型设置」里配置的服务商与「写作」角色模型（你配置的 DeepSeek deepseek-v4-pro）。密钥经 safeStorage 加密，不落盘明文。

提示词中「正文/引用/gap」的约束保持与原版一致，未改动。