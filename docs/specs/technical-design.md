# Pi Switch 技术设计

## 1. 设计结论

Pi Switch 第一版实现为一个 Tauri 桌面应用：

- 前端使用 React + TypeScript + Tailwind + lucide-react，负责 Profile 管理、表单、国际化、主题和状态展示。
- 后端使用 Rust/Tauri commands，负责本地文件读写、Pi 配置生成、原子写入、`pi -p "ping"` 测试命令执行和最终校验。
- GUI 自己的配置是权威来源，Pi 的 `models.json`、`auth.json`、`settings.json` 是应用当前 Profile 后生成或更新的结果。

本设计遵循 PRD 中的用户决策，即使这些决策存在安全或可用性风险，例如明文保存 API Key、不备份、不脱敏测试输出、不显示风险提示、允许中文 provider ID。

## 2. 架构概览

```text
React UI
  ├─ Profile 列表
  ├─ Profile 编辑表单
  ├─ 模型列表管理
  ├─ i18n / theme
  └─ 调用 Tauri commands

Tauri Rust 后端
  ├─ 读取/保存 GUI config.json
  ├─ 生成 Pi models.json
  ├─ 合并写入 Pi settings.json
  ├─ 合并写入 Pi auth.json
  ├─ 原子写入 JSON 文件
  ├─ 拉取自定义中转站 /models
  └─ 执行 pi -p "ping"

文件系统
  ├─ ~\PiSwitch\config.json
  └─ ~\.pi\agent\
      ├─ models.json
      ├─ auth.json
      └─ settings.json
```

核心原则：

- 前端不直接读写配置文件。
- Rust 后端是所有持久化和命令执行的唯一入口。
- 前端和后端都做校验；以后端校验为最终准入。
- Pi 配置写入不做备份和回滚，但单个文件必须原子写入。
- 应用 Profile 前，Rust 必须先在内存中生成三个目标 JSON 并完成结构校验，再开始替换任何文件。

## 3. 前后端职责

### 3.1 React / TypeScript

前端负责：

- 展示左侧 Profile 列表。
- 展示右侧当前 Profile 表单。
- 新建、复制、删除 Profile。
- 删除 Profile 前二次确认。
- API Key 默认脱敏显示，并允许切换明文。
- 官方 provider 本地预设模型选择。
- 自定义 provider `/models` 拉取结果展示、搜索和勾选。
- 维护页面级草稿状态。
- 保存 Profile、应用到 Pi、测试按钮的交互。
- 显示测试 stdout/stderr。
- 显示失败错误。
- 中文/英文国际化。
- 浅色/深色跟随系统主题。

前端不负责：

- 直接读写 `~\PiSwitch\config.json`。
- 直接读写 Pi 的三个配置文件。
- 执行 `pi` 命令。
- 判断 Pi provider 协议细节。
- 对测试输出或错误信息脱敏。

### 3.2 Rust / Tauri

后端负责：

- 解析用户 home 目录。
- 创建 `~\PiSwitch` 和 `~\.pi\agent` 目录。
- 读取 GUI 配置。
- 保存 GUI 配置。
- 写入 Pi 全局配置。
- 原子写入 JSON。
- 保留 `settings.json` 中非 GUI 管理字段。
- 保留 `auth.json` 中非 API Key / OAuth / 未知类型条目。
- 执行 `pi -p "ping"`，15 秒超时。
- 对所有写入动作做最终校验。
- 返回结构化错误给前端。

## 4. Tauri Commands

建议第一版暴露以下 commands。

### 4.1 `load_app_config`

用途：启动时读取 GUI 配置。

输入：无。

输出：

```ts
type LoadAppConfigResult = {
  config: AppConfig;
  resolvedPaths: ResolvedPaths;
};
```

行为：

- 如果 `~\PiSwitch\config.json` 不存在，返回默认配置，不立即写文件。
- 如果文件存在但 JSON 无法解析，返回错误。
- 如果 `schemaVersion` 不支持，返回错误，第一版不做迁移。

### 4.2 `save_app_config`

用途：保存 GUI 配置。

输入：

```ts
type SaveAppConfigInput = {
  config: AppConfig;
};
```

行为：

- 后端校验完整配置。
- 创建 `~\PiSwitch` 目录。
- 以 2 空格缩进写入 `~\PiSwitch\config.json`。
- 使用原子写入。

### 4.3 `apply_profile_to_pi`

用途：把指定 Profile 应用到 Pi 全局配置。

输入：

```ts
type ApplyProfileInput = {
  config: AppConfig;
  profileId: string;
};
```

行为：

- 保存前不隐式写 GUI 配置；由前端决定是否先调用 `save_app_config`。
- 后端从 `config.profiles` 找到 `profileId`。
- 校验 Profile。
- 在内存中生成 `models.json`、`auth.json`、`settings.json` 三个目标 JSON。
- 在写入前校验三个目标 JSON 的结构和引用关系。
- 按顺序写：
  1. `~\.pi\agent\models.json`
  2. `~\.pi\agent\auth.json`
  3. `~\.pi\agent\settings.json`
- 单个文件写失败时停止，不继续后续文件。
- 不回滚已写成功的文件。
- 错误结果必须包含失败文件和已写成功文件列表。
- 成功时返回空结果或 `{ ok: true }`，前端按 PRD 不显示成功提示。

### 4.4 `test_profile`

用途：测试当前 Profile。

输入：

```ts
type TestProfileInput = {
  config: AppConfig;
  profileId: string;
};
```

行为：

- 等价于：
  1. 校验 Profile。
  2. 应用 Profile 到 Pi。
  3. 在用户 home 目录执行 `pi -p "ping"`。
  4. 15 秒超时。
- 返回 stdout、stderr、exit code、是否超时。
- 不保存日志。
- 不脱敏 stdout/stderr。

输出：

```ts
type TestProfileResult = {
  status: "success" | "failed" | "timeout";
  exitCode?: number;
  stdout: string;
  stderr: string;
};
```

### 4.5 `fetch_custom_provider_models`

用途：为自定义中转站尝试拉取 `/models`。

输入：

```ts
type FetchCustomProviderModelsInput = {
  baseUrl: string;
  apiKey: string;
};
```

行为：

- `baseUrl` trim 前后空格。
- `apiKey` trim 前后空格。
- 请求 `GET {baseUrl}/models`。
- 请求头：`Authorization: Bearer <apiKey>`。
- 解析 OpenAI-compatible 响应中的 `data[].id`。
- 返回候选模型列表。
- 请求失败时返回错误，前端允许用户手动添加模型。

输出：

```ts
type FetchCustomProviderModelsResult = {
  models: string[];
};
```

### 4.6 `get_system_preferences`

用途：读取系统语言和主题偏好。

输出：

```ts
type SystemPreferences = {
  language: "zh-CN" | "en-US";
  colorScheme: "light" | "dark";
};
```

前端也可以用浏览器 API 读取语言和主题；该 command 可作为桌面环境下的统一入口。第一版可以先由前端读取，后续再下沉到 Rust。

## 5. TypeScript 数据模型

### 5.1 基础类型

```ts
export type Language = "zh-CN" | "en-US";
export type ThemeMode = "system" | "light" | "dark";

export type ProfileKind = "official" | "custom";

export type OfficialProviderId =
  | "openai"
  | "anthropic"
  | "google"
  | "openrouter"
  | "groq"
  | "mistral"
  | "xai";
```

### 5.2 AppConfig

```ts
export type AppConfig = {
  schemaVersion: 1;
  language?: Language;
  theme: ThemeMode;
  activeProfileId?: string;
  profiles: Profile[];
};
```

规则：

- `schemaVersion` 第一版固定为 `1`。
- `language` 为空时跟随系统语言：`zh-*` 使用 `zh-CN`，其他使用 `en-US`。
- `theme` 默认 `system`。
- `activeProfileId` 可以为空；没有 Profile 时为空。

### 5.3 Profile

```ts
export type Profile = OfficialProfile | CustomProfile;

export type BaseProfile = {
  id: string;
  name: string;
  kind: ProfileKind;
  models: ModelEntry[];
  defaultModelId: string;
};

export type OfficialProfile = BaseProfile & {
  kind: "official";
  providerId: OfficialProviderId;
  apiKey: string;
};

export type CustomProfile = BaseProfile & {
  kind: "custom";
  providerId: string;
  providerName?: string;
  baseUrl: string;
  api: string;
  apiKey: string;
};

export type ModelEntry = {
  id: string;
  name?: string;
};
```

关键规则：

- Profile ID 创建时生成随机稳定 ID，如 `profile_9f3a2c`。
- Profile 改名不改变 ID。
- 自定义 provider ID 由用户填写，保存时自动移除所有空格。
- 模型 ID 完全不处理，不 trim，不限制字符。
- `defaultModelId` 必须与 `models[].id` 中某个原始字符串完全相等。

### 5.4 常量

```ts
export const OFFICIAL_PROVIDER_IDS = [
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "groq",
  "mistral",
  "xai",
] as const;

export const API_PRESETS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
```

官方 provider 的本地模型预设放在前端常量或共享 JSON 中：

```ts
export const OFFICIAL_MODEL_PRESETS: Record<OfficialProviderId, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini"],
  anthropic: ["claude-sonnet-4", "claude-3-5-haiku"],
  google: ["gemini-2.5-pro", "gemini-2.5-flash"],
  openrouter: [],
  groq: [],
  mistral: ["mistral-large-latest", "codestral-latest"],
  xai: ["grok-4", "grok-code-fast"],
};
```

预设只是快捷项，不是权威目录；用户可以手动添加模型 ID。

## 6. Rust 数据模型

Rust 侧使用 `serde` 定义与 TypeScript 对齐的结构。

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub schema_version: u32,
    pub language: Option<Language>,
    pub theme: ThemeMode,
    pub active_profile_id: Option<String>,
    pub profiles: Vec<Profile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Profile {
    Official(OfficialProfile),
    Custom(CustomProfile),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseProfile {
    pub id: String,
    pub name: String,
    pub models: Vec<ModelEntry>,
    pub default_model_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficialProfile {
    #[serde(flatten)]
    pub base: BaseProfile,
    pub provider_id: OfficialProviderId,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProfile {
    #[serde(flatten)]
    pub base: BaseProfile,
    pub provider_id: String,
    pub provider_name: Option<String>,
    pub base_url: String,
    pub api: String,
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelEntry {
    pub id: String,
    pub name: Option<String>,
}
```

Pi 配置输出结构建议用 `serde_json::Value` 组合，而不是为 Pi 的所有字段建完整强类型模型。原因：

- `settings.json` 和 `auth.json` 需要保留未知字段。
- Pi 未来字段可能变化。
- GUI 只管理有限字段。

需要强类型输出的只有 `models.json` 中 GUI 生成的 custom provider。

```rust
#[derive(Debug, Serialize)]
pub struct PiModelsFile {
    pub providers: serde_json::Map<String, serde_json::Value>,
}
```

## 7. 文件路径解析

路径必须基于当前用户 home 目录解析，不能硬编码 `C:\Users\92176`。

建议 Rust 侧使用 `dirs` 或 Tauri path API：

```text
home = 用户 home 目录
app_config_dir = home / "PiSwitch"
app_config_file = home / "PiSwitch" / "config.json"
pi_agent_dir = home / ".pi" / "agent"
pi_models_file = home / ".pi" / "agent" / "models.json"
pi_auth_file = home / ".pi" / "agent" / "auth.json"
pi_settings_file = home / ".pi" / "agent" / "settings.json"
```

目录创建规则：

- 保存 GUI 配置时创建 `~\PiSwitch`。
- 应用到 Pi 时创建 `~\.pi\agent`。
- 不创建项目级 `.pi/`。

路径返回给前端时使用字符串展示即可，不作为用户可编辑项。

## 8. Pi 三个配置文件写入策略

### 8.1 `models.json`

GUI 完整接管该文件。

官方 provider Profile 激活时写入：

```json
{
  "providers": {}
}
```

自定义 provider Profile 激活时写入：

```json
{
  "providers": {
    "<providerId>": {
      "name": "<providerName>",
      "baseUrl": "<baseUrl>",
      "api": "<api>",
      "apiKey": "<apiKey>",
      "models": [
        { "id": "<modelId>" }
      ]
    }
  }
}
```

字段处理：

- `providerId` 保存前移除所有空格。
- `providerName` 有值才写入；为空可以省略。
- `baseUrl` trim 前后空格后写入。
- `api` 原样写入，但不能为空。
- `apiKey` trim 前后空格后写入。
- `models[].id` 原样写入。

不保留手写 provider，不备份，不回滚。

### 8.2 `auth.json`

GUI 管理官方 provider 的 API Key，但不管理 OAuth token。

写入规则：

- 读取旧 `auth.json`。
- 如果文件不存在，使用空 object。
- 如果文件存在但不可解析，停止写入并报错，不覆盖旧文件。
- 如果根节点不是 object，停止写入并报错，不覆盖旧文件。
- 只 upsert 当前官方 Profile 对应 provider 的 API Key。
- 保留所有未被当前应用动作管理的 provider 条目。
- 保留非 `type = "api_key"` 的条目。
- 保留 OAuth/token/未知结构条目。
- 对当前官方 provider 写入或更新：

```json
{
  "<providerId>": {
    "type": "api_key",
    "key": "<apiKey>"
  }
}
```

- 当前激活 Profile 是自定义 provider 时，不写该中转站到 `auth.json`。
- 当前激活 Profile 是自定义 provider 时，`auth.json` 仍按上述规则读取和原样保留，不清理任何条目。

删除规则：

- 第一版不提供单独凭据管理页，因此应用 Profile 时不主动删除其他官方 provider 的 API Key。
- 删除 Profile 只删除 GUI 配置里的 Profile，不自动清理 `auth.json`。

这样可以满足“管理 API Key”且降低误删 OAuth token 的风险。

### 8.3 `settings.json`

GUI 只更新模型相关字段。

写入规则：

- 读取旧 `settings.json`。
- 如果文件不存在，使用空 object。
- 如果文件存在但不可解析，停止写入并报错，不覆盖旧文件。
- 如果根节点不是 object，停止写入并报错，不覆盖旧文件。
- 保留所有其他字段。
- 只浅层 upsert 模型相关字段。
- 更新：

```json
{
  "defaultProvider": "<providerId>",
  "defaultModel": "<defaultModelId>"
}
```

- 对官方 provider，`defaultProvider` 是官方 ID，例如 `openai`。
- 对自定义 provider，`defaultProvider` 是用户填写并移除空格后的 provider ID。
- `defaultModel` 使用 Profile 的 `defaultModelId`，不依赖模型列表顺序。

`settings.json` 必须最后写。

项目级 `.pi/settings.json` 可能覆盖全局设置。第一版不检测项目级覆盖；测试在用户 home 目录执行，只验证全局配置的大体可用性。

## 9. 原子写入

虽然 PRD 明确不做自动备份、手动备份和恢复，单个文件仍必须原子写入，避免半写坏文件。

流程：

```text
1. 在内存中生成 serde_json::Value
2. serde_json::to_string_pretty 生成 2 空格缩进 JSON
3. 再次 parse 该字符串，确认 JSON 可解析
4. 写入同目录临时文件
5. flush
6. 替换目标文件
```

临时文件命名建议：

```text
<target>.tmp-<pid>-<timestamp>
```

Windows 上替换目标文件可使用：

- 如果目标文件存在，先使用原子替换能力；若标准库能力不足，采用 `tempfile` + `persist` 或等价方案。
- 替换必须在同一目录内完成，避免跨卷移动。

错误行为：

- 某个文件写入失败，立即返回错误。
- 不继续写后续文件。
- 不尝试恢复写入前状态。
- 已写成功的前置文件保持现状。
- 写入 Pi 配置失败时，错误必须包含失败文件和本次已写成功文件列表。
- 前端显示该错误，方便用户重新点击“应用到 Pi”或手动检查文件状态。

## 10. 校验规则

前端和后端都执行同一套核心校验。后端校验是最终准入。

### 10.1 AppConfig 校验

- `schemaVersion` 必须等于 `1`。
- `theme` 必须是 `system`、`light`、`dark`。
- `language` 如果存在，必须是 `zh-CN` 或 `en-US`。
- `activeProfileId` 如果存在，必须能匹配某个 Profile ID。
- Profile ID 不要求全局格式，但必须非空且不能重复。

### 10.2 Profile 通用校验

- Profile 名称不能为空。
- Profile 类型必须是 `official` 或 `custom`。
- 模型列表至少一个。
- `defaultModelId` 必须与某个 `models[].id` 完全相等。
- 模型 ID 不做 trim，不做格式限制，不阻止空格、中文、特殊符号。

### 10.3 官方 Profile 校验

- `providerId` 必须属于内置列表：

```text
openai
anthropic
google
openrouter
groq
mistral
xai
```

- `apiKey.trim()` 后不能为空。
- 写入前使用 trim 后的 API Key。

### 10.4 自定义 Profile 校验

- `providerId` 移除所有空格后不能为空。
- 移除空格后的 `providerId` 不能与内置 provider ID 冲突。
- 允许中文和其他非空格字符。
- `baseUrl.trim()` 后不能为空。
- `api` 不能为空。
- `apiKey.trim()` 后不能为空。
- 写入前使用 trim 后的 `baseUrl` 和 `apiKey`。
- 不自动补 `/v1`。
- 不修改协议。
- 不删除结尾斜杠。

### 10.5 用户决策风险

以下规则按 PRD 执行，不额外拦截：

- GUI 配置和 Pi 配置都明文保存真实 API Key。
- UI 不显示安全风险提示。
- 测试输出和错误信息不脱敏。
- 不自动备份、不手动备份、不恢复。
- 自定义 provider ID 允许中文。
- 模型 ID 完全原样保存。

## 11. `pi -p "ping"` 测试流程

测试命令由 Rust 后端执行。

流程：

```text
1. 前端调用 save_app_config 保存当前 Profile
2. 前端调用 test_profile
3. Rust 校验 Profile
4. Rust 应用 Profile 到 Pi 全局配置
5. Rust 在用户 home 目录执行 pi -p "ping"
6. 等待最多 15 秒
7. 返回 stdout/stderr/exit code/timeout 状态
8. 前端显示本次输出
```

命令参数必须分开传入，避免 shell 转义问题：

```rust
Command::new("pi")
    .arg("-p")
    .arg("ping")
```

不要拼成单个 shell 字符串。

成功判断：

- 退出码为 0：`status = "success"`。
- 退出码非 0：`status = "failed"`。
- 超过 15 秒：终止子进程，`status = "timeout"`。

输出规则：

- stdout 原样返回。
- stderr 原样返回。
- 不保存日志。
- 不脱敏 API Key。
- 前端可限制显示区域高度，但不得修改内容语义。

限制：

- 测试在用户 home 目录执行。
- 不代表存在项目级 `.pi/settings.json` 的真实项目目录行为。
- 启动 GUI 时不检测 `pi` 是否存在；点击测试时才暴露找不到命令的错误。

## 12. 错误处理

Rust 后端统一返回结构化错误。

```ts
type AppError = {
  code: string;
  message: string;
  details?: string;
  failedFile?: "models.json" | "auth.json" | "settings.json" | "config.json";
  writtenFiles?: string[];
};
```

建议错误码：

```text
CONFIG_PARSE_FAILED
UNSUPPORTED_SCHEMA_VERSION
VALIDATION_FAILED
APP_CONFIG_WRITE_FAILED
PI_MODELS_WRITE_FAILED
PI_AUTH_WRITE_FAILED
PI_SETTINGS_WRITE_FAILED
PI_COMMAND_NOT_FOUND
PI_TEST_FAILED
PI_TEST_TIMEOUT
MODEL_FETCH_FAILED
PATH_RESOLVE_FAILED
```

前端展示规则：

- 保存失败显示错误。
- 应用失败显示错误。
- 测试失败显示 stdout/stderr 和错误状态。
- 成功保存不提示。
- 成功应用不提示。
- 测试成功显示模型输出。
- 不对错误详情做 API Key 脱敏。

## 13. i18n 方案

第一版支持：

- `zh-CN`
- `en-US`

实现建议：

```text
src/i18n/
  index.ts
  zh-CN.ts
  en-US.ts
```

前端维护翻译字典：

```ts
type MessageKey =
  | "profile.save"
  | "profile.apply"
  | "profile.test"
  | "profile.deleteConfirm"
  | "error.validation";
```

语言选择规则：

- `config.language` 有值时使用该值。
- 否则读取系统/浏览器语言。
- `zh-*` 使用 `zh-CN`。
- 其他使用 `en-US`。
- 用户手动切换语言后写入 GUI config。

第一版不做复杂地区变体。

## 14. 主题方案

第一版支持：

- `system`
- `light`
- `dark`

实现建议：

- Tailwind 使用 `dark` class 策略。
- `theme = system` 时使用 `prefers-color-scheme`。
- `theme = light` 时移除 `dark` class。
- `theme = dark` 时添加 `dark` class。
- 默认值为 `system`。

UI 风格：

- 工具型、紧凑、安静。
- 左侧 Profile 列表，右侧表单。
- 按钮使用 lucide-react 图标。
- 不做配置预览。
- 不做成功摘要。

## 15. 目录结构建议

建议项目结构：

```text
D:\WorkSpace\pi-switch\
  docs\
    specs\
      pi-switch-prd.md
      technical-design.md
  src\
    app\
      App.tsx
      routes.tsx
    components\
      ProfileList.tsx
      ProfileEditor.tsx
      OfficialProviderForm.tsx
      CustomProviderForm.tsx
      ModelListEditor.tsx
      ApiKeyInput.tsx
      TestOutput.tsx
    domain\
      config.ts
      providers.ts
      validation.ts
      ids.ts
    i18n\
      index.ts
      zh-CN.ts
      en-US.ts
    theme\
      theme.ts
    tauri\
      commands.ts
    styles\
      globals.css
  src-tauri\
    src\
      main.rs
      commands.rs
      config.rs
      pi_config.rs
      paths.rs
      atomic_write.rs
      validation.rs
      models.rs
      errors.rs
      test_pi.rs
      fetch_models.rs
    Cargo.toml
    tauri.conf.json
  package.json
  tailwind.config.*
  vite.config.*
```

Rust 模块职责：

- `paths.rs`：home、GUI 配置路径、Pi 配置路径。
- `models.rs`：serde 数据结构。
- `validation.rs`：后端校验。
- `config.rs`：GUI config 读写。
- `pi_config.rs`：生成和写入 Pi 三个配置文件。
- `atomic_write.rs`：原子写入工具。
- `test_pi.rs`：执行 `pi -p "ping"`。
- `fetch_models.rs`：请求 `/models`。
- `errors.rs`：统一错误类型。
- `commands.rs`：Tauri command 入口。

## 16. 实现里程碑

### 里程碑 1：项目脚手架

- 创建 Tauri + React + TypeScript 项目。
- 接入 Tailwind。
- 接入 lucide-react。
- 建立基础目录结构。
- 跑通空白桌面应用。

验收：

- `npm run tauri dev` 能启动窗口。
- 前端能调用一个示例 Tauri command。

### 里程碑 2：数据模型和 GUI 配置

- 实现 TypeScript 数据模型。
- 实现 Rust 数据模型。
- 实现 `load_app_config`。
- 实现 `save_app_config`。
- 实现 `~\PiSwitch\config.json` 原子写入。
- 写入 JSON 使用 2 空格缩进。

验收：

- 新建 Profile 后能保存到 GUI 配置。
- 重启应用后能读取 Profile。

### 里程碑 3：核心 UI

- 左侧 Profile 列表。
- 右侧编辑表单。
- 官方 provider 表单。
- 自定义 provider 表单。
- 模型列表编辑。
- 默认模型选择。
- API Key 默认脱敏并可明文显示。
- 删除 Profile 二次确认。

验收：

- 能创建、编辑、复制、删除官方和自定义 Profile。
- 前端基础校验可用。

### 里程碑 4：Pi 配置写入

- 实现 `apply_profile_to_pi`。
- 实现 `models.json` 完整生成。
- 实现 `auth.json` API Key 合并写入并保留 OAuth/未知条目。
- 实现 `settings.json` 合并更新 `defaultProvider/defaultModel`。
- 实现写入顺序：models、auth、settings。
- 实现失败停止、不回滚。

验收：

- 官方 Profile 应用后 `models.json` 为 `{ "providers": {} }`。
- 官方 Profile 应用后 `auth.json` 写入对应 API Key。
- 自定义 Profile 应用后 `models.json` 写入 provider/key/models。
- `settings.json` 保留其他字段，只更新默认 provider/model。

### 里程碑 5：测试和模型拉取

- 实现 `test_profile`。
- 执行 `pi -p "ping"`。
- 15 秒超时。
- 显示 stdout/stderr。
- 实现 `fetch_custom_provider_models`。
- 自定义中转站 `/models` 候选列表、搜索、勾选。

验收：

- 找不到 `pi` 时能显示错误。
- 超时时能终止并显示超时。
- 成功时显示模型输出。
- `/models` 成功时展示候选模型，失败时允许手动添加。

### 里程碑 6：i18n 和主题

- 实现 `zh-CN` / `en-US` 字典。
- 默认跟随系统语言。
- 支持用户切换语言并保存。
- 支持 `system/light/dark` 主题。
- 默认跟随系统主题。

验收：

- 中文和英文界面可切换。
- 浅色和深色表现正常。

### 里程碑 7：回归验证

- 验证官方 provider 写入流程。
- 验证自定义中转站写入流程。
- 验证失败不继续后续文件。
- 验证模型 ID 原样保存。
- 验证 provider ID 去空格、允许中文、阻止内置 ID 冲突。
- 验证 API Key trim。
- 验证 Base URL trim 且不补 `/v1`。

## 17. 后续可扩展点

这些不进入第一版实现，但设计中预留空间：

- `schemaVersion` 迁移。
- 项目级 `.pi/` 配置写入。
- 手动备份/恢复。
- Profile 导入/导出。
- OAuth token 状态展示或登录引导。
- 一键启动交互式 `pi`。
- 选择测试工作目录。
- 安全模式：密钥脱敏、凭据管理器、日志过滤。
- 自动更新官方 provider 模型目录。

## 18. 与 PRD 决策的一致性说明

本技术设计明确遵循以下 PRD 决策：

- GUI 配置是权威来源。
- 每次只应用一个 Profile。
- 一个 Profile 只有一个 provider。
- 官方 provider key 写 `auth.json`。
- 自定义 provider key 写 GUI 配置和 `models.json`。
- 官方 provider 激活时 `models.json` 写空 providers。
- `settings.json` 只更新 `defaultProvider/defaultModel`，保留其他字段。
- 不做备份、恢复、导入、导出。
- 不做成功提示和配置预览。
- API Key 明文保存。
- UI 不显示风险提示。
- 测试输出和错误信息不脱敏。
- 自定义 provider ID 允许中文，自动移除空格。
- 模型 ID 完全原样保存。
- 测试通过 `pi -p "ping"` 完成，15 秒超时，在用户 home 目录执行。

这些选择会降低第一版复杂度并贴合个人使用流程，但在未来面向更多用户或开源发布时，应重新审视安全、备份、脱敏和可恢复性。
