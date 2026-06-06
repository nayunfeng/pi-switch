# Pi Coding Agent 官方文档 AI 上下文包

本文档用于喂给 AI 模型，帮助模型理解 Pi Coding Agent 的安装、配置、provider/model、session、扩展和程序化接口。内容根据官方文档整理，不是逐字转载。

## 元数据

- 官方文档入口: https://pi.dev/docs/latest
- 抓取日期: 2026-06-06
- 官方搜索索引生成时间: 2026-06-05T09:00:13.271Z
- 官方源码 SHA: `89a92207f1c9303d53d822fd9b0ac21578834cb4`
- 原始 Markdown 路径: `packages/coding-agent/docs/*.md`
- 覆盖页面数: 27
- 目标读者: 需要回答 Pi 使用、配置、开发、集成问题的 AI 模型

## 使用约束

- 本文只总结 `pi.dev/docs/latest` 官方文档和同一 SHA 下的官方 Markdown。
- 涉及版本、模型列表、provider 支持范围时，以当前官方文档为准；以后可能随 Pi release 改变。
- 涉及凭证、OAuth token、API key、session 文件时，模型应提示用户注意本地敏感数据。
- Pi 默认在当前工作目录运行并可修改文件。需要隔离时使用容器、OpenShell、Gondolin 或只启用 read-only 工具。

## 一句话概览

Pi 是一个最小核心的终端编码代理。它通过 TypeScript extensions、Agent Skills、prompt templates、themes 和 pi packages 扩展能力。它支持交互式 TUI、一次性 print 模式、JSON event stream 模式、RPC JSONL 模式和 Node.js SDK。

## 安装和卸载

安装:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
```

Linux/macOS 也可使用官方安装脚本:

```bash
curl -fsSL https://pi.dev/install.sh | sh
```

卸载使用对应包管理器。curl installer 和 npm global install 用:

```bash
npm uninstall -g @earendil-works/pi-coding-agent
```

卸载 CLI 不会删除 `~/.pi/agent/` 下的 settings、credentials、sessions 和已安装 pi packages。

## 核心目录和文件

| 路径 | 作用 |
| --- | --- |
| `~/.pi/agent/` | 默认全局配置目录 |
| `~/.pi/agent/settings.json` | 全局 settings |
| `.pi/settings.json` | 项目 settings，覆盖全局 settings |
| `~/.pi/agent/auth.json` | OAuth 和 API key 凭证 |
| `~/.pi/agent/models.json` | 自定义 provider/model 和内置 provider 覆盖 |
| `~/.pi/agent/keybindings.json` | 自定义快捷键 |
| `~/.pi/agent/trust.json` | 项目信任决策 |
| `~/.pi/agent/sessions/` | JSONL session 文件 |
| `~/.pi/agent/AGENTS.md` | 全局项目说明 |
| `AGENTS.md` / `CLAUDE.md` | 项目说明，受 project trust 控制 |
| `~/.pi/agent/SYSTEM.md` / `.pi/SYSTEM.md` | 替换默认 system prompt |
| `~/.pi/agent/APPEND_SYSTEM.md` / `.pi/APPEND_SYSTEM.md` | 追加默认 system prompt |

可用 `PI_CODING_AGENT_DIR` 覆盖默认 config 目录。

## Project Trust

Pi 在交互式启动时，如果项目目录包含项目本地输入且没有已保存的信任决策，会询问信任。信任项目后，Pi 可以读取项目 `AGENTS.md`/`CLAUDE.md`、加载 `.pi/settings.json` 和 `.pi` 资源、安装缺失的项目 package、执行项目 extension。

非交互模式 `-p`、`--mode json`、`--mode rpc` 不显示 trust prompt。没有已保存信任时，它们忽略项目本地输入，除非传入 `--approve` 或 `-a`。传入 `--no-approve` 或 `-na` 会在单次运行中忽略项目本地输入。

`/trust` 只写入 `~/.pi/agent/trust.json`，当前 session 不会自动重新加载，需要重启 Pi。

## 认证和 Provider

Pi 支持两大认证方式:

- subscription provider: 在 TUI 中运行 `/login`，走 OAuth/订阅登录。
- API-key provider: 通过环境变量、`auth.json` 或 `/login` 存储 API key。

内置 subscription 登录包括:

- ChatGPT Plus/Pro (Codex)
- Claude Pro/Max
- GitHub Copilot

凭证解析优先级:

1. CLI `--api-key`
2. `auth.json` 中的 API key 或 OAuth token
3. 环境变量
4. `models.json` 中自定义 provider key

SDK `AuthStorage` 额外支持 runtime override，其优先级高于 `auth.json`。

### API Key Provider 映射

| Provider | 环境变量 | `auth.json` key |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic` |
| Ant Ling | `ANT_LING_API_KEY` | `ant-ling` |
| Azure OpenAI Responses | `AZURE_OPENAI_API_KEY` | `azure-openai-responses` |
| OpenAI | `OPENAI_API_KEY` | `openai` |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek` |
| NVIDIA NIM | `NVIDIA_API_KEY` | `nvidia` |
| Google Gemini | `GEMINI_API_KEY` | `google` |
| Mistral | `MISTRAL_API_KEY` | `mistral` |
| Groq | `GROQ_API_KEY` | `groq` |
| Cerebras | `CEREBRAS_API_KEY` | `cerebras` |
| Cloudflare AI Gateway | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_GATEWAY_ID` | `cloudflare-ai-gateway` |
| Cloudflare Workers AI | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` | `cloudflare-workers-ai` |
| xAI | `XAI_API_KEY` | `xai` |
| OpenRouter | `OPENROUTER_API_KEY` | `openrouter` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | `vercel-ai-gateway` |
| ZAI | `ZAI_API_KEY` | `zai` |
| ZAI Coding Plan (China) | `ZAI_CODING_CN_API_KEY` | `zai-coding-cn` |
| OpenCode Zen | `OPENCODE_API_KEY` | `opencode` |
| OpenCode Go | `OPENCODE_API_KEY` | `opencode-go` |
| Hugging Face | `HF_TOKEN` | `huggingface` |
| Fireworks | `FIREWORKS_API_KEY` | `fireworks` |
| Together AI | `TOGETHER_API_KEY` | `together` |
| Kimi For Coding | `KIMI_API_KEY` | `kimi-coding` |
| MiniMax | `MINIMAX_API_KEY` | `minimax` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` | `minimax-cn` |
| Xiaomi MiMo | `XIAOMI_API_KEY` | `xiaomi` |
| Xiaomi MiMo Token Plan (China) | `XIAOMI_TOKEN_PLAN_CN_API_KEY` | `xiaomi-token-plan-cn` |
| Xiaomi MiMo Token Plan (Amsterdam) | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` | `xiaomi-token-plan-ams` |
| Xiaomi MiMo Token Plan (Singapore) | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` | `xiaomi-token-plan-sgp` |

### `auth.json`

`auth.json` 位于 `~/.pi/agent/auth.json`，文件权限为 `0600`。API key 记录形如:

```json
{
  "anthropic": { "type": "api_key", "key": "sk-ant-..." },
  "openai": { "type": "api_key", "key": "sk-..." }
}
```

`key` 支持四种取值:

- `!command`: 以 `!` 开头时执行整段命令，使用 stdout，进程生命周期内缓存。
- `$ENV_VAR` 或 `${ENV_VAR}`: 环境变量插值，可嵌入更长字符串。
- `$$` 和 `$!`: 分别转义字面量 `$` 和 `!`。
- 普通字面量: 直接使用。

旧的全大写 env-var-like 值会在启动时迁移为 `$MY_API_KEY` 形式。

### Cloud Provider 重点

- Azure OpenAI: 支持 `AZURE_OPENAI_BASE_URL` 或 `AZURE_OPENAI_RESOURCE_NAME`，root endpoint 会规范化到 `/openai/v1`。可设置 `AZURE_OPENAI_API_VERSION` 和 `AZURE_OPENAI_DEPLOYMENT_NAME_MAP`。
- Amazon Bedrock: 支持 AWS profile、IAM key、bearer token、ECS task role、IRSA。默认 region 为 `us-east-1`。应用 inference profile 可用 `AWS_BEDROCK_FORCE_CACHE=1` 启用 cache points。
- Cloudflare AI Gateway: 需要 `CLOUDFLARE_API_KEY`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_GATEWAY_ID`。可路由 OpenAI、Anthropic、Workers AI。
- Cloudflare Workers AI: 需要 `CLOUDFLARE_API_KEY` 和 `CLOUDFLARE_ACCOUNT_ID`。Pi 自动设置 `x-session-affinity` 以支持 prefix caching discount。
- Google Vertex AI: 使用 Application Default Credentials，设置 `GOOGLE_CLOUD_PROJECT`、`GOOGLE_CLOUD_LOCATION`，或 `GOOGLE_APPLICATION_CREDENTIALS`。

## `models.json` 自定义模型和 provider

文件位置: `~/.pi/agent/models.json`。

用途:

- 添加 Ollama、LM Studio、vLLM、SGLang、本地模型、代理服务。
- 为内置 provider 改写 `baseUrl`、headers 或模型字段。
- 配置 OpenAI-compatible、Anthropic-compatible、Google Generative AI 或 Responses API。

支持的 `api`:

| API | 含义 |
| --- | --- |
| `openai-completions` | OpenAI Chat Completions，兼容性最好 |
| `openai-responses` | OpenAI Responses API |
| `anthropic-messages` | Anthropic Messages API |
| `google-generative-ai` | Google Generative AI |

最小 provider 示例:

```json
{
  "providers": {
    "ollama": {
      "baseUrl": "http://localhost:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "llama3.1:8b" }
      ]
    }
  }
}
```

`apiKey` 对 Ollama 也必填，但 Ollama 会忽略，可填任意值。

`models.json` 在打开 `/model` 时重新加载，因此可在 session 中编辑后再打开 `/model` 生效。

### Provider 字段

| 字段 | 含义 |
| --- | --- |
| `baseUrl` | API endpoint URL |
| `api` | provider 默认 API 类型 |
| `apiKey` | API key，支持 `!command`、env 插值和字面量 |
| `headers` | 自定义 headers，值支持同样解析规则 |
| `authHeader` | `true` 时自动添加 `Authorization: Bearer <apiKey>` |
| `models` | model 配置数组 |
| `modelOverrides` | 内置 model 的字段覆盖 |
| `compat` | provider 级兼容性配置，可被 model 级覆盖 |

### Model 字段

| 字段 | 必填 | 默认 | 含义 |
| --- | --- | --- | --- |
| `id` | 是 | 无 | 发给 API 的模型 ID |
| `name` | 否 | `id` | UI 显示和 `--model` 匹配用名称 |
| `api` | 否 | provider `api` | model 级 API 类型覆盖 |
| `reasoning` | 否 | `false` | 是否支持 extended thinking |
| `thinkingLevelMap` | 否 | 省略 | Pi thinking level 到 provider 值的映射 |
| `input` | 否 | `["text"]` | `["text"]` 或 `["text", "image"]` |
| `contextWindow` | 否 | `128000` | context window token 数 |
| `maxTokens` | 否 | `16384` | 最大输出 token 数 |
| `cost` | 否 | 全 0 | 每百万 token 成本 |
| `headers` | 否 | 无 | model 级 headers |
| `compat` | 否 | provider `compat` | 兼容性覆盖 |

`thinkingLevelMap` 的 key 为 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`。值为字符串时发送该值；值为 `null` 时表示该 level 不支持并从 UI 隐藏或跳过。

### 内置 provider 覆盖和合并

只配置内置 provider 的 `baseUrl` 或 `headers` 时，保留全部内置模型，只改 endpoint/header。加入 `models` 数组时:

- 内置模型保留。
- 自定义模型按 `id` upsert。
- 自定义 `id` 与内置 `id` 相同时替换该内置模型。
- 新 `id` 添加到内置模型旁边。

`modelOverrides` 可不重定义完整模型列表，只覆盖内置 model 的 `name`、`reasoning`、`input`、`cost`、`contextWindow`、`maxTokens`、`headers`、`compat` 等字段。未知 model ID 会忽略。

### OpenAI 兼容性字段

`compat` 常见字段:

- `supportsStore`
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `supportsUsageInStreaming`
- `maxTokensField`: `max_completion_tokens` 或 `max_tokens`
- `requiresToolResultName`
- `requiresAssistantAfterToolResult`
- `requiresThinkingAsText`
- `requiresReasoningContentOnAssistantMessages`
- `thinkingFormat`: `openai`、`openrouter`、`deepseek`、`together`、`zai`、`qwen`、`qwen-chat-template`
- `cacheControlFormat`: 当前支持 `anthropic`
- `supportsStrictMode`
- `supportsLongCacheRetention`
- `openRouterRouting`
- `vercelGatewayRouting`

OpenAI-compatible 本地服务如果不支持 `developer` role，应设置 `supportsDeveloperRole: false`。如果不支持 `reasoning_effort`，设置 `supportsReasoningEffort: false`。

### Anthropic Messages 兼容性字段

- `supportsEagerToolInputStreaming`: 是否接受 `tools[].eager_input_streaming`。
- `supportsLongCacheRetention`: 是否接受 long cache retention。
- `sendSessionAffinityHeaders`: 是否发送基于 session id 的 `x-session-affinity`。
- `supportsCacheControlOnTools`: 是否接受 tool definitions 上的 cache control。
- `forceAdaptiveThinking`: 是否强制发送 adaptive thinking payload。
- `allowEmptySignature`: 是否允许 replay 空 thinking signature，仅对确实需要的兼容 provider 使用。

## `settings.json`

Pi 使用 JSON settings。全局 `~/.pi/agent/settings.json`，项目 `.pi/settings.json`。项目 settings 覆盖全局，嵌套对象会 merge。

模型和 thinking:

- `defaultProvider`: 默认 provider。
- `defaultModel`: 默认 model ID。
- `defaultThinkingLevel`: `off`、`minimal`、`low`、`medium`、`high`、`xhigh`。
- `hideThinkingBlock`: 是否隐藏 thinking block。
- `thinkingBudgets`: 自定义 thinking level token budgets。

UI 和显示:

- `theme`: `dark`、`light` 或自定义 theme 名称。
- `quietStartup`: 隐藏启动 header。
- `collapseChangelog`: 更新后显示压缩 changelog。
- `enableInstallTelemetry`: 控制匿名安装/更新 ping，不控制 update check。
- `doubleEscapeAction`: `tree`、`fork`、`none`。
- `treeFilterMode`: `/tree` 默认 filter。
- `editorPaddingX`: 输入编辑器水平 padding。
- `autocompleteMaxVisible`: autocomplete 最大可见项。
- `showHardwareCursor`: 显示硬件 cursor，常用于 IME。

Telemetry 和网络:

- `enableInstallTelemetry` 只控制 `https://pi.dev/api/report-install`。
- `PI_SKIP_VERSION_CHECK=1` 禁用 version check。
- `PI_OFFLINE=1` 或 `--offline` 禁用 startup network operations，包括 update checks、package update checks、install/update telemetry。

Compaction:

- `compaction.enabled`: 默认 `true`。
- `compaction.reserveTokens`: 默认 `16384`。
- `compaction.keepRecentTokens`: 默认 `20000`。
- `branchSummary.reserveTokens`: branch summary 预留 token。
- `branchSummary.skipPrompt`: `/tree` 导航时跳过 summary prompt。

Retry:

- `retry.enabled`: 默认 `true`。
- `retry.maxRetries`: 默认 `3`。
- `retry.baseDelayMs`: 默认 `2000`。
- `retry.provider.timeoutMs`: provider request timeout。
- `retry.provider.maxRetries`: 默认 `0`，通常保持为 0。
- `retry.provider.maxRetryDelayMs`: 默认 `60000`。

Message delivery:

- `steeringMode`: `all` 或 `one-at-a-time`。
- `followUpMode`: `all` 或 `one-at-a-time`。
- `transport`: `sse`、`websocket`、`websocket-cached`、`auto`。
- `httpIdleTimeoutMs`: HTTP idle timeout，`0` 表示禁用。
- `websocketConnectTimeoutMs`: WebSocket 连接 timeout，`0` 表示禁用。

Terminal 和 images:

- `terminal.showImages`
- `terminal.imageWidthCells`
- `terminal.clearOnShrink`
- `images.autoResize`: 默认自动 resize 到最大 2000x2000。
- `images.blockImages`: 禁止图片发送给 LLM。

Shell:

- `shellPath`: Windows 上自定义 bash。
- `shellCommandPrefix`: 每条 bash command 前缀，可用于启用 aliases。
- `npmCommand`: npm package lookup/install 使用的 argv。

Sessions:

- `sessionDir`: session 文件目录，支持绝对路径、相对路径和 `~`。
- sessionDir 优先级: `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` > settings `sessionDir`。

Resources:

- `packages`: npm/git/local pi packages。
- `extensions`: local extension 文件或目录。
- `skills`: local skill 文件或目录。
- `prompts`: local prompt template 文件或目录。
- `themes`: local theme 文件或目录。
- `enableSkillCommands`: 是否注册 `/skill:name`。

资源路径解析: 全局 settings 中相对路径相对于 `~/.pi/agent`，项目 settings 中相对路径相对于 `.pi`。数组支持 glob、`!pattern` 排除、`+path` 强制包含、`-path` 强制排除。

## 交互式使用

TUI 四个主要区域:

- Startup header: 快捷键、已加载上下文文件、prompt templates、skills、extensions。
- Messages: user/assistant/tool/notification/error/extension UI。
- Editor: 输入区域，边框颜色反映 thinking level。
- Footer: cwd、session name、token/cache/cost/context usage、当前 model。

编辑器能力:

- 输入 `@` fuzzy-search 项目文件。
- Tab 路径补全。
- Shift+Enter 多行，Windows Terminal 可用 Ctrl+Enter。
- 图片可 Ctrl+V 粘贴，Windows 可 Alt+V，部分终端支持拖拽。
- `!command` 运行 shell 并把输出送入模型上下文。
- `!!command` 运行 shell 但不把输出送入模型上下文。
- Ctrl+G 打开 `$VISUAL` 或 `$EDITOR`。

默认给模型的 built-in tools:

- `read`
- `write`
- `edit`
- `bash`

可通过 tool options 启用只读工具:

- `grep`
- `find`
- `ls`

## Slash Commands

| Command | 作用 |
| --- | --- |
| `/login`, `/logout` | 管理 OAuth 或 API key |
| `/model` | 切换 model |
| `/scoped-models` | 启用/禁用 Ctrl+P 循环模型 |
| `/settings` | thinking level、theme、message delivery、transport |
| `/resume` | 选择历史 session |
| `/new` | 新建 session |
| `/name <name>` | 设置 session display name |
| `/session` | 查看 session file、ID、message、tokens、cost |
| `/tree` | 跳到 session 任意位置继续 |
| `/fork` | 从早期 user message 创建新 session |
| `/clone` | 把当前 active branch 复制到新 session |
| `/compact [prompt]` | 手动 compact，可带自定义说明 |
| `/copy` | 复制最后一条 assistant 消息 |
| `/export [file]` | 导出 session HTML |
| `/share` | 上传 private GitHub gist 并生成 HTML link |
| `/reload` | 重载 keybindings、extensions、skills、prompts、context files |
| `/hotkeys` | 显示快捷键 |
| `/changelog` | 版本历史 |
| `/quit` | 退出 |

## CLI

基础:

```bash
pi [options] [@files...] [messages...]
```

模式:

| Flag | 作用 |
| --- | --- |
| default | 交互式 TUI |
| `-p`, `--print` | 输出回复后退出 |
| `--mode json` | 输出 JSONL events |
| `--mode rpc` | stdin/stdout RPC JSONL |
| `--export <in> [out]` | 导出 session HTML |

print mode 会读取 piped stdin 并合并到初始 prompt。

模型选项:

- `--provider <name>`
- `--model <pattern>`，支持 `provider/id` 和 `:<thinking>`。
- `--api-key <key>`
- `--thinking <level>`
- `--models <patterns>`，Ctrl+P cycling 用逗号分隔 pattern。
- `--list-models [search]`

Session 选项:

- `-c`, `--continue`
- `-r`, `--resume`
- `--session <path|id>`
- `--fork <path|id>`
- `--session-dir <dir>`
- `--no-session`
- `--name <name>`, `-n <name>`

Tool 选项:

- `--tools <list>`, `-t <list>`: allowlist built-in、extension、custom tools。
- `--exclude-tools <list>`, `-xt <list>`: 禁用指定工具。
- `--no-builtin-tools`, `-nbt`: 禁用 built-in tools，保留 extension/custom tools。
- `--no-tools`, `-nt`: 禁用全部 tools。

Resource 选项:

- `-e`, `--extension <source>`，可重复。
- `--no-extensions`
- `--skill <path>`，可重复。
- `--no-skills`
- `--prompt-template <path>`，可重复。
- `--no-prompt-templates`
- `--theme <path>`，可重复。
- `--no-themes`
- `--no-context-files`, `-nc`

其他选项:

- `--system-prompt <text>` 替换默认 prompt。
- `--append-system-prompt <text>` 追加到 system prompt。
- `--verbose`
- `-a`, `--approve`
- `-na`, `--no-approve`
- `-h`, `--help`
- `-v`, `--version`

文件参数:

```bash
pi @README.md "Summarize this"
pi -p @screenshot.png "What's in this image?"
pi @code.ts @test.ts "Review these files"
```

关键环境变量:

| 变量 | 作用 |
| --- | --- |
| `PI_CODING_AGENT_DIR` | 覆盖 config 目录，默认 `~/.pi/agent` |
| `PI_CODING_AGENT_SESSION_DIR` | 覆盖 session 目录 |
| `PI_PACKAGE_DIR` | 覆盖 package 目录，常用于 Nix/Guix |
| `PI_OFFLINE` | 禁用 startup network operations |
| `PI_SKIP_VERSION_CHECK` | 禁用 version update check |
| `PI_TELEMETRY` | 覆盖 telemetry 和 provider attribution headers |
| `PI_CACHE_RETENTION` | 支持时设置 long prompt cache |
| `VISUAL`, `EDITOR` | Ctrl+G 外部编辑器 |

## Message Queue

agent 运行时仍可提交消息:

- Enter: queue steering message，当前 assistant turn 的 tool calls 完成后送入。
- Alt+Enter: queue follow-up message，agent 所有工作完成后送入。
- Escape: abort，并把 queued messages 恢复到 editor。
- Alt+Up: 把 queued messages 取回 editor。

可用 `steeringMode` 和 `followUpMode` 配置 delivery。

## Sessions

Pi 自动保存 session 到 `~/.pi/agent/sessions/`，按 cwd 组织。session 文件是 JSONL tree。

常用:

```bash
pi -c
pi -r
pi --no-session
pi --name "my task"
pi --session <path|id>
pi --fork <path|id>
```

交互命令:

- `/resume`
- `/new`
- `/name <name>`
- `/session`
- `/tree`
- `/fork`
- `/clone`
- `/compact [prompt]`
- `/export [file]`
- `/share`

`/resume` picker 支持搜索、Ctrl+P 显示路径、Ctrl+S 切换排序、Ctrl+N 只显示 named sessions、Ctrl+R 重命名、Ctrl+D 删除。删除时如有 `trash` CLI，会尽量避免永久删除。

`/tree` 在同一个 session 文件内跳转到任意历史 entry。选择 user/custom message 会移动 leaf 到该 message 的 parent，并把消息文本放进 editor 以便编辑重发。选择 assistant/tool/compaction 等非 user entry 会移动 leaf 到该 entry，editor 为空。

`/tree`、`/fork`、`/clone` 区别:

| 功能 | `/tree` | `/fork` | `/clone` |
| --- | --- | --- | --- |
| 输出 | 同一 session 文件 | 新 session 文件 | 新 session 文件 |
| 视图 | 完整 tree | user-message selector | 当前 active branch |
| 典型用途 | 原地探索分支 | 从早期 prompt 开新 session | 复制当前工作后继续 |
| summary | 可选 branch summary | 无 | 无 |

## Session 文件格式

位置:

```text
~/.pi/agent/sessions/--<path>--/<timestamp>_<uuid>.jsonl
```

`<path>` 是工作目录路径，将 `/` 替换为 `-`。

版本:

- v1: legacy linear entries，加载时自动迁移。
- v2: tree structure，使用 `id`/`parentId`。
- v3: 将 `hookMessage` role 改名为 `custom`。

第一行是 session header:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path/to/project"}
```

如果来自 fork/clone/newSession parent，可包含 `parentSession`。

除 header 外，entry base:

- `type`
- `id`: 8 字符 hex ID。
- `parentId`: 父 entry ID，第一条为 `null`。
- `timestamp`: ISO timestamp。

主要 entry types:

- `message`: 包含 `AgentMessage`。
- `model_change`: 切换 model。
- `thinking_level_change`: 切换 thinking level。
- `compaction`: context compaction summary。
- `branch_summary`: `/tree` 切换分支时附加的 left branch summary。
- `custom`: extension state，不进入 LLM context。
- `custom_message`: extension-injected message，进入 LLM context。
- `label`: user-defined bookmark。
- `session_info`: session display name。

AgentMessage union:

- `UserMessage`
- `AssistantMessage`
- `ToolResultMessage`
- `BashExecutionMessage`
- `CustomMessage`
- `BranchSummaryMessage`
- `CompactionSummaryMessage`

content block 类型:

- text: `{ type: "text", text }`
- image: `{ type: "image", data, mimeType }`
- thinking: `{ type: "thinking", thinking }`
- toolCall: `{ type: "toolCall", id, name, arguments }`

`AssistantMessage` 包含 `api`、`provider`、`model`、`usage`、`stopReason`、可选 `errorMessage`、`timestamp`。

`Usage` 包含 input、output、cacheRead、cacheWrite、totalTokens 和对应 cost。

`buildSessionContext()` 从当前 leaf 走到 root:

1. 收集 path 上 entries。
2. 提取当前 model 和 thinking level。
3. 如有 `CompactionEntry`，先输出 summary，再输出 `firstKeptEntryId` 之后的 messages。
4. 将 `BranchSummaryEntry` 和 `CustomMessageEntry` 转成上下文消息。

SessionManager 关键能力:

- create/open/continueRecent/inMemory/forkFrom。
- list/listAll。
- newSession/setSessionFile/createBranchedSession。
- appendMessage/appendModelChange/appendThinkingLevelChange/appendCompaction/appendCustomEntry/appendCustomMessageEntry/appendLabelChange。
- getLeafId/getEntry/getTree/getChildren/branch/resetLeaf/branchWithSummary。
- buildSessionContext/getEntries/getHeader/getSessionName/getCwd/getSessionFile/isPersisted。

## Compaction 和 Branch Summary

Pi 有两种总结机制:

| 机制 | 触发 | 目的 |
| --- | --- | --- |
| Compaction | context 超过阈值或 `/compact` | 总结旧消息，释放 context |
| Branch summarization | `/tree` 导航 | 切换分支时保留离开分支的上下文 |

Auto-compaction 条件:

```text
contextTokens > contextWindow - reserveTokens
```

默认 `reserveTokens` 为 16384。默认 `keepRecentTokens` 为 20000。

compaction 流程:

1. 从最新消息向前找 cut point，保留最近 `keepRecentTokens`。
2. 收集上次 kept boundary 到 cut point 的消息。
3. 调 LLM 生成结构化 summary，可把 previous summary 作为迭代上下文。
4. append `CompactionEntry`，记录 `summary`、`firstKeptEntryId`、`tokensBefore`。
5. reload session，之后上下文为 summary + `firstKeptEntryId` 之后的 messages。

合法 cut point:

- User messages
- Assistant messages
- BashExecution messages
- Custom messages，包括 custom_message、branch_summary

不在 tool result 处 cut，因为 tool result 必须和对应 tool call 保持在一起。

`CompactionEntry` 核心字段:

- `type: "compaction"`
- `summary`
- `firstKeptEntryId`
- `tokensBefore`
- `fromHook?`
- `details?`

默认 compaction details 跟踪 `readFiles` 和 `modifiedFiles`。

Branch summarization 流程:

1. 找 old leaf 和 target 的 deepest common ancestor。
2. 从 old leaf 回溯到 common ancestor 收集 entries。
3. 按预算准备上下文，优先保留新内容。
4. 调 LLM 生成 summary。
5. 在导航位置 append `BranchSummaryEntry`。

`BranchSummaryEntry` 核心字段:

- `type: "branch_summary"`
- `summary`
- `fromId`
- `fromHook?`
- `details?`

compaction 和 branch summary 都会累计跟踪文件读写历史。

## Keybindings

自定义文件: `~/.pi/agent/keybindings.json`。编辑后运行 `/reload` 生效。旧版非 namespaced id 会自动迁移。

key 格式: `modifier+key`。modifier 包括 `ctrl`、`shift`、`alt`，可组合。key 支持字母、数字、常见特殊键、F1-F12 和常见符号。

重要默认快捷键:

- Enter: submit。
- Shift+Enter: newline。
- Ctrl+G: external editor。
- Escape: cancel/abort。
- Ctrl+D: editor 空时 exit。
- Ctrl+L: model selector。
- Ctrl+P: cycle model forward。
- Shift+Ctrl+P: cycle model backward。
- Shift+Tab: cycle thinking level。
- Ctrl+T: collapse/expand thinking blocks。
- Ctrl+O: expand/collapse tool output。
- Alt+Enter: queue follow-up。
- Alt+Up: restore queued messages to editor。

## Extensions

Extensions 是 TypeScript module，可订阅 lifecycle events、注册 LLM tools、添加 commands、注册快捷键和 flags、修改 tool calls/results、实现 custom UI、注册 custom providers。

安全规则: extension 以完整系统权限运行，可执行任意代码。项目 `.pi/extensions` 只在 project trusted 后加载。

自动发现位置:

- `~/.pi/agent/extensions/*.ts`
- `~/.pi/agent/extensions/*/index.ts`
- `.pi/extensions/*.ts`
- `.pi/extensions/*/index.ts`

settings 可额外配置 `extensions` 和 `packages`。

可用 imports:

- `@earendil-works/pi-coding-agent`: ExtensionAPI、ExtensionContext、events。
- `typebox`: tool parameter schema。
- `@earendil-works/pi-ai`: AI utilities。
- `@earendil-works/pi-tui`: TUI components。
- Node.js built-ins。
- extension 旁边或父目录 `node_modules` 中的 npm dependencies。

extension 形式:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {});
  pi.registerTool({ /* ... */ });
  pi.registerCommand("name", { /* ... */ });
  pi.registerShortcut("ctrl+x", { /* ... */ });
  pi.registerFlag("my-flag", { /* ... */ });
}
```

factory 可 async；Pi 会在 startup 继续前等待它完成。因此动态模型发现和 provider 注册应在 factory 中完成，而不是等 `session_start`。

### Extension 事件索引

Resource events:

- `resources_discover`

Session events:

- `session_start`
- `session_before_switch`
- `session_before_fork`
- `session_before_compact`
- `session_compact`
- `session_before_tree`
- `session_tree`
- `session_shutdown`

Agent events:

- `before_agent_start`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `context`
- `before_provider_request`
- `after_provider_response`

Model events:

- `model_select`
- `thinking_level_select`

Tool events:

- `tool_call`
- `tool_result`

`tool_call` 在 tool 执行前触发，可 block。`event.input` 可变，修改会影响实际 tool execution。默认 parallel tool execution 下，同一 assistant message 的 sibling tool calls 会先顺序 preflight，再并发执行。

`before_provider_request` 在 provider-specific payload 构建后、发送请求前触发。handler 返回非 `undefined` 时会替换 payload，后续 handler 和实际请求使用新 payload。

### ExtensionContext 关键方法

- `ctx.signal`: 当前 agent abort signal。
- `ctx.isIdle()`
- `ctx.abort()`
- `ctx.hasPendingMessages()`
- `ctx.shutdown()`
- `ctx.getContextUsage()`
- `ctx.compact()`
- `ctx.getSystemPrompt()`
- `ctx.ui.confirm/select/input/editor/notify/setStatus/setWidget/...`

Command handlers 使用 `ExtensionCommandContext`，额外支持:

- `ctx.getSystemPromptOptions()`
- `ctx.waitForIdle()`
- `ctx.newSession()`
- `ctx.fork()`
- `ctx.navigateTree()`
- `ctx.switchSession()`

session replacement 后，旧的 command ctx 和 session-bound 对象会 stale。`withSession` 回调中只能使用传入的新 ctx。

### Custom Tools

extension 可用 `pi.registerTool()` 注册 LLM 可调用工具。SDK 中也可用 `defineTool()` 创建 standalone tool，然后通过 `customTools` 传给 `createAgentSession()`。

如果使用 `tools` allowlist，必须包含自定义 tool 名称，例如 `tools: ["read", "bash", "my_tool"]`。

## Custom Providers via Extensions

`pi.registerProvider(name, config)` 可覆盖内置 provider 或注册新 provider。用途:

- 改写内置 provider 的 baseUrl 或 headers。
- 注册新 OpenAI-compatible/Anthropic-compatible/Google-compatible provider。
- 注册 OAuth/SSO provider。
- 实现非标准 streaming API。

只提供 `baseUrl` 或 `headers` 且没有 `models` 时，会保留原有 provider 模型。提供 `models` 时，会替换该 provider 的动态模型列表。

`pi.unregisterProvider(name)` 移除通过 extension 注册的 provider、dynamic models、API key fallback、OAuth provider 和 custom stream handler；被覆盖的内置行为会恢复。

ProviderConfig:

- `name?`: UI 显示名。
- `baseUrl?`: endpoint URL。
- `apiKey?`: 字面量、env 插值或 `!command`。
- `api?`: API 类型。
- `streamSimple?`: 非标准 API 的 custom streaming implementation。
- `headers?`: 自定义 headers。
- `authHeader?`: 是否添加 Bearer auth。
- `models?`: ProviderModelConfig 数组。
- `oauth?`: `/login` OAuth 支持。

ProviderModelConfig:

- `id`
- `name`
- `api?`
- `baseUrl?`
- `reasoning`
- `thinkingLevelMap?`
- `input`
- `cost`
- `contextWindow`
- `maxTokens`
- `headers?`
- `compat?`

OAuth provider 需要:

- `oauth.name`
- `login(callbacks)`
- `refreshToken(credentials)`
- `getApiKey(credentials)`
- 可选 `modifyModels(models, credentials)`

OAuthLoginCallbacks 支持打开 URL、显示 selector/input/confirm 等交互。OAuthCredentials 至少包含 access token、refresh token、expires 等实现所需数据。

`streamSimple` custom streaming API 需要把 provider 响应转换成 Pi 的 `AssistantMessageEventStream`，事件包括 text/thinking/toolcall start/delta/end、done、error。应正确填 usage 和 cost。

测试 custom provider 时，官方建议参考 built-in providers 的测试矩阵，包括 message request、tool use、cache control、thinking、image input、tool result edge cases、cross-provider handoff。

## Skills

Pi 实现 Agent Skills standard，作为可按需加载的能力包。模型启动时只看到 skill 名称和 description，匹配任务时再通过 `read` 读取完整 `SKILL.md`。

加载位置:

- `~/.pi/agent/skills/`
- `~/.agents/skills/`
- `.pi/skills/`，受 project trust 控制。
- `.agents/skills/`，从 cwd 和父目录递归到 git root 或 filesystem root，受 project trust 控制。
- packages 中的 `skills/` 或 `package.json` 的 `pi.skills`。
- settings 的 `skills`。
- CLI `--skill <path>`。

目录结构:

```text
my-skill/
  SKILL.md
  scripts/
  references/
  assets/
```

`SKILL.md` frontmatter:

- `name`: 必填，1-64 字符，小写字母、数字、hyphen。
- `description`: 必填，最多 1024 字符，决定模型何时加载。
- `license`: 可选。
- `compatibility`: 可选。
- `metadata`: 可选。
- `allowed-tools`: 可选，实验性。
- `disable-model-invocation`: 可选，`true` 时不放进 system prompt，只能手动 `/skill:name`。

skills 注册为 slash commands:

```text
/skill:brave-search
/skill:pdf-tools extract
```

## Prompt Templates

Prompt templates 是 Markdown snippets，通过 `/name` 扩展为完整 prompt。文件名去掉 `.md` 后是命令名。

加载位置:

- `~/.pi/agent/prompts/*.md`
- `.pi/prompts/*.md`，受 project trust 控制。
- packages 的 `prompts/` 或 `pi.prompts`。
- settings 的 `prompts`。
- CLI `--prompt-template <path>`。

可用 `--no-prompt-templates` 禁用自动发现。

frontmatter:

- `description`: 可选，缺省时使用第一条非空行。
- `argument-hint`: 可选，用于 autocomplete。

参数:

- `$1`, `$2`, ...
- `$@` 或 `$ARGUMENTS`
- `${@:N}`
- `${@:N:L}`

`prompts/` discovery 非递归。子目录模板需要在 settings 或 package manifest 中显式加入。

## Themes

Themes 是 TUI colors JSON 文件。内置 `dark` 和 `light`。自定义 theme 位置:

- `~/.pi/agent/themes/*.json`
- `.pi/themes/*.json`，受 project trust 控制。
- packages 的 `themes/` 或 `pi.themes`。
- settings 的 `themes`。
- CLI `--theme <path>`。

选择 theme:

```json
{ "theme": "my-theme" }
```

theme JSON 需要:

- `$schema`
- `name`: 唯一。
- `vars`: 可选可复用颜色变量。
- `colors`: 必须定义所有 51 个 token。

颜色 token 分组: core UI、backgrounds/content、markdown、tool diffs、syntax highlighting、thinking level borders、bash mode。当前 active custom theme 文件被编辑时会 hot reload。

## TUI Components

Extensions 和 custom tools 可以通过 `@earendil-works/pi-tui` 渲染自定义终端 UI。组件可以用于交互式 selector、dialog、side panel、状态面板、工具结果渲染等。

所有 component 实现:

```typescript
interface Component {
  render(width: number): string[];
  handleInput?(data: string): void;
  wantsKeyRelease?: boolean;
  invalidate(): void;
}
```

关键规则:

- `render(width)` 返回每行字符串数组。
- 每一行的可见宽度不能超过 `width`。
- 样式不会跨行继承；TUI 会在每行结尾追加 SGR reset 和 OSC 8 reset。
- `invalidate()` 必须清除 cache，theme 变更时 TUI 会调用它。
- 如需保留 ANSI 样式换行，使用 `wrapTextWithAnsi()`。

Focusable 和 IME:

- 需要显示文本 cursor 并支持中文、日文、韩文等 IME 的 component 应实现 `Focusable`。
- focus 时在 fake cursor 前输出 `CURSOR_MARKER`，TUI 会把硬件 cursor 定位到该位置。
- 硬件 cursor 默认隐藏；需要 visible cursor 时用 `showHardwareCursor`、`setShowHardwareCursor(true)` 或 `PI_HARDWARE_CURSOR=1`。
- container 如果包含 `Input` 或 `Editor` child，也应实现 `Focusable` 并把 focus state 传给 child。

使用入口:

- extension 中用 `ctx.ui.custom(componentOrFactory)`。
- custom tool 中可通过工具 context 的 UI custom 能力展示 component。
- 返回的 handle 可 `requestRender()` 和 `close()`。

Overlays:

- `ctx.ui.custom(..., { overlay: true })` 可在现有内容上方渲染 overlay。
- `overlayOptions` 支持 width/minWidth/maxHeight、anchor、offsetX/offsetY、row/col、margin、responsive `visible(termWidth, termHeight)`。
- overlay handle 支持 focus/unfocus、setHidden、hide。
- overlay close 后 component 已 dispose，不应复用旧实例。

内置 components:

- `Text`: 多行文本和 word wrapping。
- `Box`: padding 和背景色容器。
- `Container`: 垂直组合 children。
- `Spacer`: 空行。
- `Markdown`: markdown 和语法高亮。
- `Image`: 在 Kitty、iTerm2、Ghostty、WezTerm 等支持图片协议的终端渲染图片。

键盘输入:

- 用 `matchesKey(data, Key.enter)` 等判断按键。
- 常见 key: `Key.enter`、`Key.escape`、`Key.tab`、`Key.backspace`、`Key.delete`、`Key.up/down/left/right`。
- modifier: `Key.ctrl("c")`、`Key.shift("tab")`、`Key.alt("left")`、`Key.ctrlShift("p")`。
- 字符串形式也可用，例如 `"ctrl+c"`、`"shift+tab"`。

宽度工具:

- `visibleWidth(str)`: 计算忽略 ANSI 后的可见宽度。
- `truncateToWidth(str, width, ellipsis?)`: 截断到指定宽度。
- `wrapTextWithAnsi(str, width)`: 保留 ANSI 的 word wrap。

Theming:

- tool render hooks 中使用 `theme.fg(color, text)` 和 `theme.bg(color, text)`。
- Markdown renderer 可用 `getMarkdownTheme()`。
- 自定义 component 如缓存了带颜色的字符串，必须在 `invalidate()` 时重新构建，否则 theme 切换后会保留旧 ANSI 颜色。

Debug 和性能:

- 设置 `PI_TUI_WRITE_LOG=/tmp/tui-ansi.log` 可捕获原始 ANSI stream。
- render 输出应按 `width` cache；state 变化后调用 `invalidate()` 并通过 handle `requestRender()` 触发重绘。

## Pi Packages

Pi packages 打包 extensions、skills、prompt templates、themes，可通过 npm、git 或 local path 共享。

安装和管理:

```bash
pi install npm:@foo/bar@1.0.0
pi install git:github.com/user/repo@v1
pi install https://github.com/user/repo
pi install /absolute/path/to/package
pi install ./relative/path/to/package
pi remove npm:@foo/bar
pi list
pi update
pi update --extensions
pi update --self
```

默认写入 user settings。使用 `-l` 写入 project settings。项目 packages 在 project trusted 后自动安装缺失项。

source 类型:

- npm: `npm:@scope/pkg@1.2.3`，版本化 specs 被 pin，package 更新会跳过。
- git: `git:github.com/user/repo@v1`、SSH、HTTPS、protocol URL，refs pin 到 tag/commit。
- local path: 文件作为单 extension，目录按 package rules 加载。

package manifest:

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

没有 `pi` manifest 时，约定目录自动发现:

- `extensions/`: `.ts` 和 `.js`
- `skills/`: `SKILL.md` 目录和顶层 `.md`
- `prompts/`: `.md`
- `themes/`: `.json`

Pi 核心包作为 extension/skill peer dependencies，不应 bundle: `@earendil-works/pi-ai`、`@earendil-works/pi-agent-core`、`@earendil-works/pi-coding-agent`、`@earendil-works/pi-tui`、`typebox`。

## SDK

安装:

```bash
npm install @earendil-works/pi-coding-agent
```

主要入口:

- `createAgentSession()`: 创建单个 `AgentSession`。
- `createAgentSessionRuntime()`: 需要 new/resume/fork/import 等 session replacement 时使用 runtime 层。
- `AuthStorage`
- `ModelRegistry`
- `SessionManager`
- `DefaultResourceLoader`
- `defineTool`

`createAgentSession()` 默认使用 `DefaultResourceLoader` 发现 extensions、skills、prompts、themes、context files。可传入 `model`、`tools`、`sessionManager`、`authStorage`、`modelRegistry`、`customTools` 等。

`AgentSession` 关键方法和属性:

- `prompt(text, options?)`
- `steer(text)`
- `followUp(text)`
- `subscribe(listener)`
- `sessionFile`
- `sessionId`
- `setModel(model)`
- `setThinkingLevel(level)`
- `cycleModel()`
- `cycleThinkingLevel()`
- `agent`
- `model`
- `thinkingLevel`
- `messages`
- `isStreaming`
- `navigateTree(targetId, options?)`
- `compact(customInstructions?)`
- `abortCompaction()`
- `abort()`
- `dispose()`

`PromptOptions`:

- `expandPromptTemplates?`
- `images?`
- `streamingBehavior?`: `steer` 或 `followUp`
- `source?`
- `preflightResult?`

如果 agent 正在 streaming，调用 `prompt()` 但不指定 `streamingBehavior` 会报错。extension commands 可在 streaming 时立即执行；file-based prompt templates 会先展开。

SDK model resolution:

1. continuing session 中恢复。
2. settings default。
3. fallback 到第一个 available model。

`DefaultResourceLoader` 的 `cwd` 用于项目资源发现和 session 命名；`agentDir` 用于全局资源、settings、models、auth、sessions。传 custom ResourceLoader 后，`cwd` 和 `agentDir` 不再控制资源发现，但仍影响 session naming 和 tool path resolution。

## JSON Event Stream Mode

启动:

```bash
pi --mode json "Your prompt"
```

stdout 输出 JSON lines。第一行是 session header:

```json
{"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
```

随后输出 `AgentSessionEvent`:

- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `message_start`
- `message_update`
- `message_end`
- `tool_execution_start`
- `tool_execution_update`
- `tool_execution_end`
- `queue_update`
- `compaction_start`
- `compaction_end`
- `auto_retry_start`
- `auto_retry_end`

示例过滤:

```bash
pi --mode json "List files" 2>/dev/null | jq -c 'select(.type == "message_end")'
```

## RPC Mode

启动:

```bash
pi --mode rpc [options]
```

用途: headless agent，通过 stdin/stdout JSONL 集成 IDE、自定义 UI 或其他应用。Node.js 应用如果不需要 subprocess，可优先直接使用 SDK `AgentSession`。

协议:

- stdin: 每行一个 JSON command。
- stdout: response 和 events，每行一个 JSON object。
- command 可带 `id`，对应 response 带同样 `id`。
- events 不带 `id`。
- 严格 JSONL，以 LF `\n` 为唯一 record delimiter；客户端应只按 `\n` 切分，允许输入 `\r\n` 时剥离尾随 `\r`。

核心 commands:

- `prompt`: 发送用户 prompt；streaming 中必须指定 `streamingBehavior`。
- `steer`: queue steering message。
- `follow_up`: queue follow-up message。
- `abort`: abort 当前 agent operation。
- `new_session`: 新建 session。
- `get_state`: 获取 model、thinkingLevel、isStreaming、sessionFile、sessionId、sessionName、messageCount 等。
- `get_messages`: 获取所有 AgentMessage。
- `set_model`
- `cycle_model`
- `get_available_models`
- `set_thinking_level`
- `cycle_thinking_level`
- `set_steering_mode`
- `set_follow_up_mode`
- `compact`
- `set_auto_compaction`
- `set_auto_retry`
- `abort_retry`
- `bash`
- `abort_bash`
- `get_session_stats`
- `export_html`
- `switch_session`
- `fork`
- `clone`
- `get_fork_messages`
- `get_last_assistant_text`
- `set_session_name`
- `get_commands`

`bash` RPC command 会立即执行并返回 output，但不会立刻产生 event。内部创建的 `BashExecutionMessage` 会在下一次 `prompt` 时转成 user message 送给 LLM。多个 bash command 可在一个 prompt 前累积。

RPC events 包括 JSON mode 的 agent/tool/message/queue/compaction/retry events，另有 `extension_error`。`message_update.assistantMessageEvent` 可为 text/thinking/toolcall start/delta/end、done、error。

RPC extension UI:

- dialog 方法如 `select`、`confirm`、`input`、`editor` 会向 stdout 发 `extension_ui_request`，阻塞等待 stdin 的 `extension_ui_response`。
- fire-and-forget 方法如 `notify`、`setStatus`、`setWidget`、`setTitle`、`set_editor_text` 也发 `extension_ui_request`，但不等待响应。
- 部分直接 TUI 方法在 RPC 下不可用或降级，如 `custom()` 返回 `undefined`。

## Containerization

Pi 默认拥有完整权限。隔离有两类模式:

1. 整个 `pi` 进程在隔离环境中运行。
2. `pi` 在 host 上运行，把 tool execution 路由到隔离环境。

三种官方模式:

| Pattern | 隔离对象 | 适用 | 注意 |
| --- | --- | --- | --- |
| OpenShell | 整个 `pi` 进程 | policy-controlled sandbox | 需要 OpenShell gateway |
| Gondolin extension | built-in tools 和 `!` commands | host 保留 auth，本地 micro-VM 跑工具 | extension route tools |
| Plain Docker | 整个 `pi` 进程 | 简单本地容器 | provider API keys 进入容器 |

Plain Docker 需要注意: mount 当前目录到 `/workspace` 后，容器内写入会直接影响 host 文件。mount host `~/.pi/agent` 会暴露 host auth 和 sessions。

## 平台和终端

Windows:

- Pi 需要 bash。
- 查找顺序: settings `shellPath`、Git Bash、PATH 上的 `bash.exe`。
- Git for Windows 通常足够。

Termux:

- 需要 Termux 和 Termux:API。
- 安装依赖: `pkg install nodejs termux-api git`。
- clipboard 通过 `termux-clipboard-set/get`；image clipboard 不支持。
- 访问 shared storage 需 `termux-setup-storage`。

tmux:

- 推荐 `~/.tmux.conf`:

```tmux
set -g extended-keys on
set -g extended-keys-format csi-u
```

- 需要 tmux 3.2+ 和支持 extended keys 的 terminal。

Terminal:

- Pi 使用 Kitty keyboard protocol 检测 modifier keys。
- Kitty 和 iTerm2 开箱可用。
- WezTerm 需 `config.enable_kitty_keyboard = true`。
- VS Code integrated terminal 可把 Shift+Enter 映射为 `\u001b[13;2u`。
- Windows Terminal 可把 Shift+Enter/Alt+Enter 映射为 CSI-u 输入。
- xfce4-terminal、terminator、IntelliJ terminal 对 modified Enter 支持有限。

Shell aliases:

Pi 用 `bash -c` 非交互运行 shell command，不默认 expand aliases。可在 settings 设置 `shellCommandPrefix` 启用 aliases。

## Development

从源码开发:

```bash
git clone https://github.com/earendil-works/pi-mono
cd pi-mono
npm install
npm run build
```

从源码运行:

```bash
/path/to/pi-mono/pi-test.sh
```

测试:

```bash
./test.sh
npm test
npm test -- test/specific.test.ts
```

项目结构:

- `packages/ai/`: LLM provider abstraction。
- `packages/agent/`: agent loop 和 message types。
- `packages/tui/`: terminal UI components。
- `packages/coding-agent/`: CLI 和 interactive mode。

fork/rebrand 可在 `package.json` 的 `piConfig` 设置 `name` 和 `configDir`，影响 CLI banner、config paths、environment variable names。

## 官方来源映射

| 页面 | URL |
| --- | --- |
| Overview | https://pi.dev/docs/latest |
| Quickstart | https://pi.dev/docs/latest/quickstart |
| Using Pi | https://pi.dev/docs/latest/usage |
| Providers | https://pi.dev/docs/latest/providers |
| Containerization | https://pi.dev/docs/latest/containerization |
| Settings | https://pi.dev/docs/latest/settings |
| Keybindings | https://pi.dev/docs/latest/keybindings |
| Sessions | https://pi.dev/docs/latest/sessions |
| Compaction | https://pi.dev/docs/latest/compaction |
| Extensions | https://pi.dev/docs/latest/extensions |
| Skills | https://pi.dev/docs/latest/skills |
| Prompt Templates | https://pi.dev/docs/latest/prompt-templates |
| Themes | https://pi.dev/docs/latest/themes |
| Pi Packages | https://pi.dev/docs/latest/packages |
| Custom Models | https://pi.dev/docs/latest/models |
| Custom Providers | https://pi.dev/docs/latest/custom-provider |
| Session Format | https://pi.dev/docs/latest/session-format |
| SDK | https://pi.dev/docs/latest/sdk |
| RPC Mode | https://pi.dev/docs/latest/rpc |
| JSON Event Stream Mode | https://pi.dev/docs/latest/json |
| TUI Components | https://pi.dev/docs/latest/tui |
| Windows | https://pi.dev/docs/latest/windows |
| Termux | https://pi.dev/docs/latest/termux |
| tmux | https://pi.dev/docs/latest/tmux |
| Terminal Setup | https://pi.dev/docs/latest/terminal-setup |
| Shell Aliases | https://pi.dev/docs/latest/shell-aliases |
| Development | https://pi.dev/docs/latest/development |
