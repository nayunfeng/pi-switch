# Pi Switch PRD

## 1. 产品结论

Pi Switch 是一个面向 Pi Coding Agent 的桌面配置控制台。

第一版目标不是做通用 AI 网关，也不是做 Pi 的完整替代界面，而是解决一个具体痛点：

> 用户不想手动编辑 Pi 配置文件，但需要频繁在不同模型供应商、中转站和模型组合之间切换。

第一版采用强管控模式：

- GUI 配置是权威来源。
- Pi 配置文件是 GUI 生成或更新的结果。
- 用户不需要直接编辑 Pi 配置文件。

## 2. 目标用户

第一版目标用户：

- 先服务开发者自己。
- 代码结构按未来开源发布来设计。

这意味着：

- 不写死本机绝对路径。
- 不写死个人 API Key 或中转站地址。
- 数据结构保持通用。
- 先保证本机使用闭环，不优先处理大众发布所需的完整引导、隐私说明、安装器、自动更新等能力。

## 3. MVP 范围

第一版必须支持：

- 管理多个 Profile。
- 每个 Profile 包含一个 provider 和多个模型。
- 每个 Profile 设置一个默认模型。
- 支持官方 API Key provider。
- 支持自定义 provider / 中转站。
- 支持把当前激活 Profile 应用到 Pi 全局配置。
- 支持通过 `pi -p "ping"` 测试当前 Profile。
- 支持中文和英文界面。
- 支持浅色/深色，默认跟随系统。

第一版不支持：

- 一键启动交互式 `pi`。
- 自动备份或手动备份恢复。
- 导入/导出 Profile。
- 在线管理 OAuth token。
- 完整在线拉取所有官方 provider 模型列表。
- 项目级 `.pi/` 配置写入。
- 配置预览。
- 应用成功提示。

## 4. 配置文件职责

### 4.1 GUI 自己的配置文件

路径：

```text
~\PiSwitch\config.json
```

Windows 实际示例：

```text
C:\Users\<User>\PiSwitch\config.json
```

规则：

- 目录不存在时自动创建。
- 不硬编码具体用户名。
- 保存全部 Profile。
- 保存真实 API Key。
- 使用 JSON。
- 使用 2 空格缩进。
- 包含 `schemaVersion`。

示例：

```json
{
  "schemaVersion": 1,
  "language": "zh-CN",
  "theme": "system",
  "activeProfileId": "profile_9f3a2c",
  "profiles": []
}
```

### 4.2 Pi `models.json`

路径：

```text
~\.pi\agent\models.json
```

职责：

- 保存自定义 provider / 中转站定义。
- 保存自定义 provider 的真实 API Key。
- 当前激活 Profile 是自定义 provider 时，写入该 provider。
- 当前激活 Profile 是官方 provider 时，写入空 providers。

官方 provider 激活时：

```json
{
  "providers": {}
}
```

自定义 provider 激活时：

```json
{
  "providers": {
    "my-relay": {
      "name": "My Relay",
      "baseUrl": "https://relay.example.com/v1",
      "api": "openai-completions",
      "apiKey": "sk-...",
      "models": [
        { "id": "deepseek-chat" },
        { "id": "gpt-4o" }
      ]
    }
  }
}
```

规则：

- GUI 完整接管 `models.json`。
- 不保留手写 provider。
- 不自动备份。
- 写入必须原子化。

### 4.3 Pi `settings.json`

路径：

```text
~\.pi\agent\settings.json
```

职责：

- 写入当前默认 provider。
- 写入当前默认 model。
- 保留其他非 GUI 管理字段。

GUI 只更新：

```json
{
  "defaultProvider": "my-relay",
  "defaultModel": "deepseek-chat"
}
```

规则：

- 不完整覆盖 `settings.json`。
- 必须读取旧文件，且只合并更新模型相关字段。
- 保留 theme、skills、extensions、packages、sessionDir 等其他字段。
- 如果 `settings.json` 不存在，创建新的 JSON object。
- 如果 `settings.json` 是合法 JSON object，只浅层 upsert `defaultProvider` 和 `defaultModel`。
- 如果 `settings.json` 不可解析，停止写入并报错，不覆盖旧文件。
- 如果 `settings.json` 根节点不是 object，停止写入并报错，不覆盖旧文件。
- `settings.json` 在写入流程中最后写。

### 4.4 Pi `auth.json`

路径：

```text
~\.pi\agent\auth.json
```

职责：

- 管理官方内置 provider 的 API Key。
- 不管理 OAuth token。
- 保留非 API Key / OAuth / 未知类型条目。

官方 provider API Key 示例：

```json
{
  "openai": {
    "type": "api_key",
    "key": "sk-..."
  }
}
```

规则：

- OpenAI、Anthropic、Google Gemini、OpenRouter、Groq、Mistral、xAI 的 API Key 写入 `auth.json`。
- 自定义中转站 key 不写 `auth.json`。
- 写入时读取现有 `auth.json`；文件不存在时使用空 object。
- 只 upsert 当前官方 Profile 对应 provider 的 `{ "type": "api_key", "key": "..." }`。
- 未被当前应用动作管理的 provider 条目原样保留。
- 非 `type = "api_key"` 的条目原样保留。
- OAuth/token/未知结构条目原样保留。
- 删除 Profile 不删除 `auth.json` 条目。
- 不误删 OAuth token。

## 5. Profile 模型

### 5.1 Profile 规则

- 支持多个 Profile。
- 每次只应用一个 Profile 到 Pi。
- 一个 Profile 只允许一个 provider。
- 一个 Profile 可以包含多个模型。
- 每个 Profile 必须指定一个默认模型。
- 默认模型写入 `settings.json`，不依赖模型列表顺序。

### 5.2 Profile ID

规则：

- 创建时生成随机稳定 ID。
- 改名不改变 ID。
- 删除后 ID 不复用。
- Profile ID 不写入 Pi provider ID。

示例：

```json
{
  "id": "profile_9f3a2c",
  "name": "Relay Daily"
}
```

## 6. Provider 类型

### 6.1 官方 Provider

第一版内置：

- OpenAI
- Anthropic
- Google Gemini
- OpenRouter
- Groq
- Mistral
- xAI

规则：

- 这些 provider 的 key 写入 `auth.json`。
- 默认 provider/model 写入 `settings.json`。
- 不写入 `models.json` provider 定义。

### 6.2 自定义 Provider / 中转站

字段：

- Profile 名称
- Provider ID
- 显示名称
- Base URL
- API 类型
- API Key
- 模型列表
- 默认模型

规则：

- Provider ID 由用户填写。
- Provider ID 不能为空。
- Provider ID 不能和内置 provider ID 冲突。
- Provider ID 自动移除空格。
- Provider ID 允许中文。
- 自定义 provider key 写入 GUI 配置和 `models.json`。
- 不写入 `auth.json`。

内置 provider ID 至少包括：

```text
openai
anthropic
google
openrouter
groq
mistral
xai
```

## 7. 字段处理规则

### 7.1 API Key

规则：

- 保存前 trim 前后空格。
- GUI 配置明文保存。
- Pi 配置明文保存。
- UI 默认脱敏显示。
- 用户可以切换明文显示。
- 不显示风险提示。
- 测试输出和错误信息不脱敏。

### 7.2 Base URL

规则：

- 保存前 trim 前后空格。
- 不自动补 `/v1`。
- 不改协议。
- 不删除结尾斜杠。

### 7.3 API 类型

输入方式：

- 下拉预设。
- 允许手动输入。

预设值：

```text
openai-completions
openai-responses
anthropic-messages
google-generative-ai
```

规则：

- GUI pass-through 写入 `api` 字段。
- 具体协议执行交给 Pi。
- Pi 未来新增类型时，用户可以手动输入。

### 7.4 模型 ID

规则：

- 完全不处理。
- 用户输入什么就原样保存。
- 不 trim。
- 不限制中文、空格、特殊符号。
- 默认模型 ID 必须能匹配模型列表中的一个原始 ID。

## 8. 模型列表管理

### 8.1 官方 Provider

规则：

- 使用本地预设模型列表。
- 允许用户手动添加模型 ID。
- 本地预设只是快捷项，不是完整官方目录。

### 8.2 自定义中转站

规则：

- 尝试调用 `/models` 自动拉取。
- 失败后允许手动添加。
- 拉取结果显示为可搜索候选列表。
- 用户勾选后才加入 Profile。
- 不自动把所有模型加入 Profile。

OpenAI-compatible 拉取规则：

```text
GET {baseUrl}/models
Authorization: Bearer <apiKey>
```

示例：

```text
baseUrl = https://relay.example.com/v1
models endpoint = https://relay.example.com/v1/models
```

## 9. 写入流程

### 9.1 保存 Profile

按钮：

```text
保存 Profile
```

行为：

- 只写 GUI 配置：

```text
~\PiSwitch\config.json
```

- 不写 Pi 配置。

### 9.2 应用到 Pi

按钮：

```text
应用到 Pi
```

行为：

- 将当前 Profile 写入 Pi 全局配置：

```text
~\.pi\agent\models.json
~\.pi\agent\auth.json
~\.pi\agent\settings.json
```

写入顺序：

```text
1. models.json
2. auth.json
3. settings.json
```

原因：

- `settings.json` 最后写，避免默认模型指向尚未写好的 provider/key。
- 开始写入任何文件前，先在内存中生成三个目标 JSON，并完成结构校验和引用校验。

失败处理：

- 失败就显示错误。
- 不回滚。
- 不继续写后续文件。
- 错误信息必须包含失败文件。
- 错误信息必须包含本次已写成功的文件列表。
- 错误信息必须提示用户可修正问题后重新点击“应用到 Pi”。

成功处理：

- 完全不提示。

### 9.3 原子写入

虽然不做备份，但单个文件必须原子写入：

```text
生成完整 JSON
写入临时文件
校验 JSON 可解析
替换目标文件
```

不做：

- 自动备份。
- 手动备份。
- 恢复功能。

## 10. 测试流程

按钮：

```text
测试
```

流程：

```text
点击测试
  ↓
保存当前 Profile 到 GUI 配置
  ↓
应用当前 Profile 到 Pi 配置
  ↓
在用户 home 目录执行 pi -p "ping"
  ↓
15 秒超时
  ↓
显示 stdout/stderr
```

规则：

- 启动 GUI 时不检测 Pi。
- 用户点击测试时才检测/执行 Pi。
- 测试 prompt 固定为 `ping`。
- 测试通过时显示模型输出。
- 测试失败时显示 stdout/stderr。
- 测试超时时终止进程并显示超时。
- 测试输出不保存日志。
- 测试输出和错误信息不脱敏。

命令：

```powershell
pi -p "ping"
```

超时：

```text
15 秒
```

限制：

- 测试在用户 home 目录执行。
- 测试只证明全局配置大体可用。
- 如果某个项目目录存在项目级 `.pi/settings.json`，真实项目中的 Pi 行为可能不同。

## 11. UI 设计

### 11.1 布局

第一版采用：

```text
左侧 Profile 列表
右侧当前 Profile 编辑表单
```

左侧：

- Profile 列表
- 新建
- 复制
- 删除

右侧：

- Profile 名称
- 类型：官方 provider / 自定义 provider
- Provider 字段
- API Key
- 模型列表
- 默认模型
- 保存 Profile
- 应用到 Pi
- 测试
- 测试输出

### 11.2 官方 Provider 表单

字段：

- Profile 名称
- Provider 下拉
- API Key
- 模型列表
- 默认模型

### 11.3 自定义 Provider 表单

字段：

- Profile 名称
- Provider ID
- 显示名称
- Base URL
- API 类型
- API Key
- 拉取模型
- 模型列表
- 默认模型

### 11.4 删除 Profile

规则：

- 删除前二次确认。
- 弹窗文本：

```text
确定删除 Profile "<name>"？
```

- 不做撤销。

### 11.5 反馈规则

保存成功：

- 不提示。

应用成功：

- 不提示。

测试成功：

- 显示模型输出。

失败：

- 显示错误。

不显示：

- 配置预览。
- 成功摘要。
- 风险提示。

## 12. 国际化

第一版支持：

- 中文 `zh-CN`
- 英文 `en-US`

默认语言：

```text
系统语言 zh-* → zh-CN
其他系统语言 → en-US
用户手动切换后 → 记住选择
```

GUI 配置字段：

```json
{
  "language": "zh-CN"
}
```

## 13. 主题

第一版支持：

- 浅色
- 深色
- 默认跟随系统

配置值：

```text
system
light
dark
```

默认：

```text
system
```

## 14. 技术栈

第一版技术栈：

```text
Tauri + React + TypeScript
```

UI：

```text
React + Tailwind + lucide-react
```

职责划分：

React / TypeScript：

- 表单。
- Profile 列表。
- i18n。
- 主题。
- 状态展示。
- 调用 Tauri commands。

Rust / Tauri：

- 读写 `~\PiSwitch\config.json`。
- 写 `~\.pi\agent\models.json`。
- 写 `~\.pi\agent\settings.json`。
- 写 `~\.pi\agent\auth.json`。
- 原子写入。
- 执行 `pi -p "ping"`。
- 15 秒超时。

## 15. 校验规则

前端和后端都要校验。

前端：

- 实时提示。
- 避免明显错误。

后端：

- 写文件前最终校验。

至少校验：

- Profile 名称不能为空。
- Profile 类型合法。
- 官方 provider 必须在内置列表中。
- 自定义 provider ID 不能为空。
- 自定义 provider ID 不能和内置 provider ID 冲突。
- 自定义 provider ID 自动去除空格。
- API Key trim 后不能为空。
- 自定义 provider 的 baseUrl trim 后不能为空。
- 自定义 provider 的 api 字段不能为空。
- 模型列表至少一个模型。
- defaultModelId 必须存在于模型列表中。

不校验：

- 模型 ID 格式。
- 模型 ID 空格。
- 模型 ID 特殊字符。

## 16. 非目标

第一版明确不做：

- 不做 Pi 交互式启动器。
- 不做项目级配置写入。
- 不做配置备份恢复。
- 不做导入导出。
- 不做日志文件。
- 不做 API Key 脱敏输出。
- 不做配置预览。
- 不做 OAuth token 管理。
- 不做所有 provider 的在线模型目录。
- 不做云同步。
- 不做团队共享。
- 不做安装 Pi 的引导流程。
- 不做完整隐私/安全提示体系。

## 17. 风险和待确认

### 17.1 Pi 配置文件格式可能变化

风险：

- Pi 仍在发展，`models.json`、`settings.json`、`auth.json` 字段可能变化。

缓解：

- `api` 字段允许手动输入。
- GUI 配置加 `schemaVersion`。
- `settings.json` 只合并更新模型相关字段。

### 17.2 中文 provider ID 兼容性

风险：

- 用户允许中文 provider ID，但 Pi 内部或部分路径/显示逻辑可能存在隐藏限制。

当前决策：

- 按用户要求允许中文。
- 只禁止空格和内置 provider ID 冲突。

### 17.3 不备份导致误覆盖

风险：

- GUI 完整接管 `models.json`，不备份，可能覆盖用户手写配置。

当前决策：

- 接受该风险。
- 通过原子写入避免半写坏文件。

### 17.4 明文保存 API Key

风险：

- GUI 配置和 Pi 配置均明文保存 API Key。
- 测试输出不脱敏。

当前决策：

- 接受该风险。
- 第一版不显示风险提示。

### 17.5 测试目录不是实际项目目录

风险：

- 测试在用户 home 目录执行，不能代表某个项目目录中的 Pi 行为。

当前决策：

- 接受该限制。
- 第一版不支持选择测试工作目录。

## 18. 参考资料

- Pi settings 文档：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md>
- Pi models 文档：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md>
- Pi providers 文档：<https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md>

