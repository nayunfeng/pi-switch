# Pi Switch UI Flow

## 1. 设计结论

Pi Switch 第一版采用单窗口、双栏布局：

```text
左侧 Profile 列表
右侧当前 Profile 编辑表单
```

界面目标是减少配置文件操作，而不是展示配置细节。因此第一版不显示 JSON 预览、不显示应用成功摘要、不显示安全风险提示。

核心闭环：

```text
新建 Profile -> 填 provider/key/models -> 保存 Profile -> 应用到 Pi -> 测试 pi -p "ping"
```

## 2. 信息架构

### 2.1 主窗口区域

主窗口分为 4 个区域：

- 顶部栏：产品名、语言切换、主题状态。
- 左侧栏：Profile 列表和 Profile 操作。
- 右侧主区：当前 Profile 表单。
- 底部/右下状态区：错误、测试输出。

### 2.2 左侧 Profile 列表

左侧展示：

- Profile 名称。
- Profile 类型：官方 / 自定义。
- Provider 名称或 ID。
- 默认模型。
- 当前选中状态。

左侧操作：

- 新建 Profile。
- 复制 Profile。
- 删除 Profile。

删除必须二次确认。

### 2.3 右侧编辑区

右侧表单根据 Profile 类型切换：

- 官方 provider 表单。
- 自定义 provider / 中转站表单。

右侧固定动作：

- 保存 Profile。
- 应用到 Pi。
- 测试。

保存成功和应用成功不提示。失败时显示错误。

## 3. 用户流程

### 3.1 首次启动

如果 `~\PiSwitch\config.json` 不存在：

```text
打开应用
  -> 显示空 Profile 列表
  -> 右侧显示空状态
  -> 用户点击新建 Profile
```

空状态文案应短，不解释功能细节：

```text
暂无 Profile
```

允许用户直接点击左侧的新建按钮。

### 3.2 新建官方 Provider Profile

流程：

```text
点击新建
  -> 选择 Profile 类型：官方 provider
  -> 输入 Profile 名称
  -> 选择 provider：OpenAI / Anthropic / Google Gemini / OpenRouter / Groq / Mistral / xAI
  -> 输入 API Key
  -> 从本地预设添加模型，或手动添加模型 ID
  -> 选择默认模型
  -> 保存 Profile
```

保存 Profile 只写 GUI 配置，不写 Pi 配置。

应用到 Pi 时：

```text
models.json -> { "providers": {} }
auth.json -> upsert 当前官方 provider API Key
settings.json -> defaultProvider/defaultModel
```

### 3.3 新建自定义 Provider Profile

流程：

```text
点击新建
  -> 选择 Profile 类型：自定义 provider
  -> 输入 Profile 名称
  -> 输入 Provider ID
  -> 输入显示名称
  -> 输入 baseUrl
  -> 选择或输入 api 类型
  -> 输入 API Key
  -> 点击拉取模型，或手动添加模型 ID
  -> 勾选模型进入 Profile
  -> 选择默认模型
  -> 保存 Profile
```

Provider ID 规则：

- 自动移除空格。
- 不能为空。
- 不能与内置 provider ID 冲突。
- 允许中文。

模型 ID 规则：

- 完全原样保存。
- 不 trim。
- 不限制字符。

### 3.4 拉取自定义 Provider 模型

触发条件：

- 当前 Profile 是自定义 provider。
- 已填写 baseUrl。
- 已填写 API Key。
- api 类型适合 OpenAI-compatible `/models` 请求。

流程：

```text
点击拉取模型
  -> Rust command 请求 GET {baseUrl}/models
  -> 成功：显示可搜索候选列表
  -> 用户勾选模型
  -> 点击加入 Profile
  -> 候选模型加入模型列表
```

失败：

```text
显示错误
允许用户继续手动添加模型 ID
```

拉取结果只作为候选，不自动全部加入 Profile。

### 3.5 编辑 Profile

流程：

```text
点击左侧 Profile
  -> 右侧加载该 Profile
  -> 用户编辑字段
  -> 点击保存 Profile
```

未保存更改：

- 第一版不做复杂离开确认。
- 切换 Profile 前，如果当前表单脏，前端可以自动保存草稿状态在内存中，但只有点击保存才写入 GUI 配置。

如果实现时要简化：

- 切换 Profile 时直接加载目标 Profile。
- 未保存更改丢失。
- 后续版本再加脏状态提示。

### 3.6 复制 Profile

流程：

```text
选中 Profile
  -> 点击复制
  -> 生成新 Profile ID
  -> 名称追加 Copy / 副本
  -> 保留 provider、models、defaultModel、API Key
  -> 右侧选中新副本
```

Profile ID 不复用。

### 3.7 删除 Profile

流程：

```text
选中 Profile
  -> 点击删除
  -> 弹窗：确定删除 Profile "<name>"？
  -> 确认
  -> 从 GUI 配置删除
```

删除 Profile 不清理 `auth.json`。

删除后：

- 如果还有其他 Profile，选中相邻 Profile。
- 如果没有 Profile，右侧显示空状态。

### 3.8 保存 Profile

按钮：

```text
保存 Profile
```

流程：

```text
前端校验
  -> 调用 save_app_config
  -> Rust 后端校验
  -> 写 ~\PiSwitch\config.json
```

成功：

- 不提示。

失败：

- 显示错误。

### 3.9 应用到 Pi

按钮：

```text
应用到 Pi
```

流程：

```text
前端校验当前 Profile
  -> 调用 apply_profile_to_pi
  -> Rust 后端校验
  -> 内存生成三个目标 JSON
  -> 写 models.json
  -> 写 auth.json
  -> 写 settings.json
```

成功：

- 不提示。

失败：

- 显示失败文件。
- 显示已写成功文件列表。
- 提示可修正后重新点击“应用到 Pi”。

### 3.10 测试 Profile

按钮：

```text
测试
```

流程：

```text
点击测试
  -> 保存当前 Profile
  -> 应用当前 Profile 到 Pi
  -> 在用户 home 目录执行 pi -p "ping"
  -> 最多等待 15 秒
  -> 显示 stdout/stderr
```

成功：

- 显示模型输出。

失败：

- 显示 stdout/stderr 和错误状态。

超时：

- 终止进程。
- 显示测试超时。

测试输出不保存日志，不脱敏。

## 4. 状态模型

### 4.1 App 状态

```text
loading
ready
error
```

### 4.2 Profile 编辑状态

```text
clean
dirty
saving
saveError
```

第一版可以不显示 dirty 状态，但内部建议保留，便于后续加离开确认。

### 4.3 应用状态

```text
idle
applying
applyError
```

成功后回到 `idle`，不显示成功提示。

### 4.4 测试状态

```text
idle
running
success
failed
timeout
```

测试状态需要显示输出区域。

## 5. 错误展示

错误展示优先级：

1. 字段级校验错误。
2. 表单级错误。
3. 应用/测试命令错误。

字段级错误显示在字段附近。

应用失败显示：

```text
应用失败
失败文件：settings.json
已写成功：models.json, auth.json
```

测试失败显示：

```text
测试失败
stdout:
...
stderr:
...
```

不脱敏 API Key。

## 6. 语言和主题流程

语言：

```text
系统语言 zh-* -> zh-CN
其他 -> en-US
用户手动切换后写入 GUI config
```

主题：

```text
默认 system
跟随 prefers-color-scheme
支持 light / dark / system
```

第一版可以把语言和主题入口放在顶部右侧。

## 7. 非目标

第一版 UI 不做：

- 配置 JSON 预览。
- 成功摘要。
- 风险提示。
- 备份恢复入口。
- 导入导出入口。
- OAuth 登录入口。
- 一键启动交互式 Pi。
- 测试工作目录选择。

## 8. 原型验证问题

后续如果做可点击原型，需要验证这些问题：

- 左侧列表 + 右侧表单是否足够高效。
- 官方 provider 和自定义 provider 表单切换是否清楚。
- 模型列表添加/默认模型选择是否顺手。
- 测试输出区域是否干扰日常编辑。
- 成功不提示是否会让用户困惑。
- 不显示配置预览是否仍能让用户信任应用结果。
