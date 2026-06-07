# 修复账号页操作和应用供应商默认项

## 背景

账号页仍保留了一些不再需要的操作入口，包括账号供应商筛选、刷新账号状态、当前 Pi 账号测试。另一个问题是：从已添加供应商创建 API Key 账号并应用到 Pi 后，Pi `settings.json` 的 `defaultProvider` 和 `defaultModel` 没有跟随该供应商。

## 目标

- 删除账号页供应商筛选入口及其前端状态/派生代码。
- 删除账号页刷新账号状态按钮及其前端处理代码。
- 删除当前 Pi 账号条中的测试入口及其账号页调用代码。
- 从已添加供应商创建 API Key 账号时，保存该供应商的 Pi provider 名称和默认模型快照。
- 应用这类账号时，同步更新 Pi `settings.json` 的 `defaultProvider` 和 `defaultModel`，使用来源供应商对应的 Pi provider 名称和默认模型。

## 非目标

- 不重新设计账号 OAuth 流程。
- 不恢复供应商面板的测试/查看输出功能。
- 不改变 OAuth 账号的应用语义。

## 验收

- 账号页不再出现供应商筛选、刷新账号状态、当前 Pi 账号测试入口。
- 删除后的相关 props、状态、工具函数不再残留为死代码。
- 从已添加供应商创建 API Key 账号并应用后，Pi `settings.json.defaultProvider` 等于来源供应商对应的 Pi provider 名称，`settings.json.defaultModel` 等于来源供应商 `defaultModelId`。
- 构建和相关测试通过。
