# Pi Switch PRD 可实现性与风险审查

审查对象：`D:\WorkSpace\pi-switch\docs\specs\pi-switch-prd.md`

审查范围：可实现性、可用性风险、遗漏点，重点覆盖 Pi 的 `models.json`、`settings.json`、`auth.json` 边界，以及 Tauri/Rust 落地风险。

参考依据：

- Pi settings 文档：`~/.pi/agent/settings.json` 为全局配置，项目 `.pi/settings.json` 会覆盖全局；嵌套对象会合并。
- Pi models 文档：`models.json` 可定义自定义 provider，也可覆盖/合并内置 provider；`apiKey` 支持字面值、环境变量和命令解析。
- Pi providers 文档：`auth.json` 同时保存 API Key 和 OAuth token；认证优先级为 CLI `--api-key`、`auth.json`、环境变量、`models.json` custom provider key。

## 发现项

### P0. `auth.json` 接管边界仍不够精确

问题：PRD 说 GUI 接管官方 API Key，并保留 OAuth / 未知类型条目，但没有定义如何识别、合并、删除和保留 `auth.json` 中的非 API Key 条目。Pi 的 OAuth token 也存放在 `auth.json`，且会自动刷新；如果 GUI 写入逻辑误判 schema 或重建对象，可能破坏登录态。

影响：用户可能被意外登出 OpenAI Codex、Claude Pro/Max、GitHub Copilot 等订阅登录；也可能覆盖第三方 provider 的 auth 条目。因为 `auth.json` 优先级高于环境变量和 `models.json` custom key，错误凭据会直接影响 Pi 实际调用。

建议：在技术设计里明确 `auth.json` 合并规则：只更新 GUI 管理的内置 API Key provider，且只写 `{ type: "api_key", key }`；对未知 key、非 `api_key` 类型、OAuth/token 类型做字节级或 JSON value 级保留；删除 GUI profile 时也不要自动删除不确定来源的 auth 条目。写入后应保持用户级文件权限，Windows 下至少不要放宽 ACL。

是否阻塞 MVP：是。只要第一版写 `auth.json`，这个规则必须先定清楚，否则会直接破坏 Pi 认证状态。

### P0. 三文件写入无事务、无回滚，可能留下不一致配置

问题：PRD 决定写入顺序为 `models.json` → `auth.json` → `settings.json`，失败不回滚、不继续写。单文件原子写入只能防止半截 JSON，不能保证三个文件之间一致。

影响：例如 `models.json` 已清空或换成新 provider，但 `auth.json` 写失败，Pi 仍可能使用旧凭据；或者 `auth.json` 成功但 `settings.json` 未更新，用户以为已切换但 Pi 仍跑旧模型。失败后没有恢复路径，也没有备份，用户只能手工修。

建议：即使不做备份，也应在技术设计里增加“预写阶段”：先在内存中生成三个目标 JSON，并校验 provider/defaultModel/auth 引用关系；再逐个原子替换。失败时必须显示已完成和未完成文件列表。更稳的最低方案是：应用前读取三个文件快照保存在内存，当前进程内写失败时尝试恢复已替换文件，但不落盘长期备份。

是否阻塞 MVP：是。PRD 的写入策略是核心路径，必须定义失败后的可理解状态。

### P0. `settings.json` 合并策略过于笼统

问题：PRD 正确要求只更新 `defaultProvider`、`defaultModel` 并保留其他字段，但没有定义损坏 JSON、空文件、缺失文件、非对象根节点、并发修改、嵌套对象保留等情况。

影响：`settings.json` 包含 theme、skills、extensions、packages、sessionDir、enabledModels、retry、compaction 等关键设置。合并实现一旦粗糙，会破坏用户已有 Pi 行为。项目级 `.pi/settings.json` 还会覆盖全局，可能导致 GUI 写入成功但 Pi 在实际项目里不生效。

建议：技术设计需要写清楚：只对 JSON object 根节点做浅层 upsert 两个字段；其他字段原样保留；遇到不可解析文件时不自动覆盖，直接报错；缺失文件才创建新 object；写入前后校验 `defaultProvider/defaultModel` 非空。界面或测试结果里至少要区分“全局已写入”和“项目级配置可能覆盖”。

是否阻塞 MVP：是。否则“应用到 Pi”这个核心动作不可预测。

### P1. 内置 provider ID 冲突列表不足

问题：PRD 只把 `openai`、`anthropic`、`google`、`openrouter`、`groq`、`mistral`、`xai` 列为冲突 ID。但 Pi 官方 provider/auth key 远多于这些，例如 DeepSeek、NVIDIA、Cerebras、Cloudflare、Vercel AI Gateway、Kimi、MiniMax 等。

影响：用户创建自定义 provider 时如果填了 Pi 已有 provider ID，如 `deepseek`，GUI 会把它当 custom provider 写进 `models.json`；但 Pi 认证解析、内置模型、环境变量和 `auth.json` 可能按内置 provider 规则处理，造成难以解释的调用结果。

建议：把“内置 provider ID”拆成两层：MVP 表单内置的 7 个 provider；Pi 保留/已知 provider ID 完整冲突表。自定义 provider ID 至少应阻止与 Pi 官方 provider/auth key 冲突，或提供显式“覆盖内置 provider”的高级模式。

是否阻塞 MVP：否，但阻塞稳定可用。第一版如果只自己用可以接受，开源前应补。

### P1. `models.json` 强管控会删除 Pi 支持的高级配置能力

问题：PRD 决定完整接管 `models.json`，官方 provider 激活时写 `{ "providers": {} }`，自定义 provider 激活时只写当前一个 provider。Pi 的 `models.json` 不只用于中转站，还支持覆盖内置 provider、合并 custom models、`modelOverrides`、`headers`、`authHeader`、`compat`、thinking 相关配置等。

影响：用户已有的代理、兼容性修正、本地模型、OpenRouter routing、Anthropic/OpenAI compat 等配置会被无备份删除。即使第一版面向自己，后续开源也会让“点一次应用丢配置”成为高风险行为。

建议：如果坚持强管控，技术设计必须把“GUI 拥有整个 `models.json`”写成明确约束，并在首次发现现有非空 `models.json` 时至少阻止一次或要求用户手动确认。另一个低复杂度方案是引入 GUI 命名空间，例如只管理 `pi-switch-*` provider，但这会改变当前产品决策。

是否阻塞 MVP：否，如果目标真是个人强管控；但阻塞面向已有 Pi 用户发布。

### P1. 官方 provider 的“本地预设模型列表”可能和 Pi 内置模型表冲突

问题：Pi 文档说明内置 provider 的模型列表随 Pi 发布更新。PRD 又要求 GUI 本地维护官方 provider 预设模型，并允许手动添加模型 ID。

影响：GUI 可能把已经过期或 Pi 当前版本不支持的 model 写入 `settings.json.defaultModel`，导致测试失败。相反，Pi 已支持的新模型可能 GUI 里没有，用户只能手填，体验割裂。

建议：官方 provider 模型列表应标注为“快捷项”。测试前可调用 `pi --list-models` 或类似能力校验当前 provider/model 是否可见；如果暂不实现，至少把失败信息归类为“Pi 不认识该模型”。技术设计需要明确 preset 数据放在哪里、如何更新，以及是否随版本发布。

是否阻塞 MVP：否，但会影响第一版的可用性和维护成本。

### P1. 测试目录使用“GUI 程序当前目录”不可靠

问题：PRD 要在 GUI 程序当前目录执行 `pi -p "ping"`。Tauri 打包后当前目录可能是安装目录、启动器目录、快捷方式工作目录或开发目录，并不稳定。

影响：测试结果不可复现。若当前目录下存在 `.pi/settings.json`，会覆盖全局配置；若当前目录不可写或包含特殊路径，也可能影响 Pi 行为。用户真实使用时通常在项目目录运行 `pi`，测试却在另一个目录，误判概率较高。

建议：把测试工作目录改为明确的 `~\PiSwitch\test-workdir`，启动时确保该目录存在且无项目级 `.pi` 覆盖；或者在 UI 中提供可选测试目录。若坚持当前目录，技术设计必须说明如何获取、展示和诊断当前目录。

是否阻塞 MVP：是，若测试按钮被视为配置可用性的核心验证；否，若测试只作为粗略烟测。

### P1. 15 秒测试超时可能造成高误报

问题：PRD 固定 `pi -p "ping"` 15 秒超时。Pi 启动、加载包/扩展、模型首次请求、中转站冷启动、代理链路都可能超过 15 秒。

影响：可用配置会被判为失败，尤其是首次测试、新安装、慢模型、海外供应商或代理网络。用户可能错误地修改本来正确的配置。

建议：保留 15 秒默认值，但允许在 GUI 配置里设置测试超时；或者测试失败时明确标记“超时不代表配置错误”。技术设计中应确保超时终止子进程及其子进程树，避免 Windows 上残留 `pi` 进程。

是否阻塞 MVP：否，但会影响测试功能可信度。

### P1. 中文 provider ID 存在兼容性风险

问题：PRD 允许中文 provider ID，且只移除空格。JSON 本身允许 Unicode key，但 Pi 的 provider 匹配、命令参数、模型模式、终端显示、日志、第三方扩展不一定都按 Unicode provider ID 测过。

影响：`settings.json.defaultProvider` 写中文后，Pi 可能无法匹配、显示异常，或在命令行/终端编码下出现问题。错误会发生在 Pi 运行时，不一定能在 GUI 保存阶段发现。

建议：MVP 前做一条实测用例：中文 provider ID + 自定义 provider + `pi -p "ping"`。如果通过，再保留该规则；如果失败，至少改成“允许保存但测试阻止应用”或自动建议 ASCII ID。UI 上可用显示名称承载中文，provider ID 用稳定 ASCII 更稳。

是否阻塞 MVP：取决于实测结果。若中文 ID 跑不通，则阻塞。

### P1. 模型 ID 完全原样保存会放大不可见字符问题

问题：PRD 要求模型 ID 完全不处理，包括前后空格、空字符串、中文和特殊符号。虽然供应商模型 ID 确实不能限制太死，但完全不 trim 会让复制粘贴产生的不可见字符进入 `settings.json.defaultModel`。

影响：用户看到的模型名看似正确，Pi 却匹配失败。默认模型必须与模型列表原始 ID 精确匹配，这会让一个尾随空格导致整个 Profile 不可用。

建议：至少禁止空字符串模型 ID，并在 UI 用等宽字体和可见空白提示显示前后空格。若仍坚持不处理，测试失败时应显示当前 defaultModel 的 JSON 转义值，方便看出不可见字符。

是否阻塞 MVP：否，但会显著增加调试成本。

### P2. `/models` 自动拉取只覆盖 OpenAI-compatible 场景

问题：PRD 写自定义中转站尝试 `GET {baseUrl}/models`，但 `api` 字段允许 pass-through 任意 Pi 支持类型。`anthropic-messages`、`google-generative-ai` 或自定义协议未必支持这个 endpoint，也可能需要额外 header。

影响：用户可能误以为“拉取模型”是通用能力。失败后虽然允许手动添加，但错误信息如果不清楚，会被理解为 key/baseUrl 错误。

建议：按钮文案或逻辑应限定为“尝试 OpenAI-compatible /models”。只有 `openai-completions`、`openai-responses` 或用户显式选择兼容模式时才启用；其他 api 类型默认手动输入。

是否阻塞 MVP：否。

### P2. 明文 key 与不脱敏输出不阻塞个人 MVP，但阻塞开源发布

问题：PRD 明确 GUI 配置、Pi 配置都保存真实 key，测试输出和错误不脱敏，且不显示风险提示。

影响：个人本机使用可接受，但开源后容易造成误泄露：截图、录屏、错误粘贴、共享配置、远程协助都会暴露密钥。Tauri/Rust 执行 `pi` 的 stdout/stderr 也可能包含 provider 返回的敏感请求信息。

建议：MVP 可以保留该决策，但代码结构要把脱敏能力留成独立函数，默认可关闭。未来发布版至少应对当前 Profile 的 key 做输出替换，并在导出/日志等功能出现前建立密钥处理规则。

是否阻塞 MVP：否；阻塞公开发布。

### P2. Tauri/Rust 原子写入细节需要前置设计

问题：PRD 要求原子写入，但未定义 Windows 上的实现细节。原子替换要求临时文件与目标在同一目录、写入后 flush、替换操作处理已存在文件、权限继承和杀毒/同步软件占用。

影响：实现不当会导致写入失败、权限变化、文件短暂丢失，或在 Windows 上留下 `.tmp` 文件。三个 Pi 配置文件位于用户目录，可能被同步盘、杀毒软件或编辑器占用。

建议：技术设计明确使用 Rust 后端统一文件服务：同目录创建临时文件，`serde_json` 生成并重新解析校验，flush 后用平台可靠的 replace/rename 策略替换；失败返回具体 OS error。不要在前端拼路径或写文件。

是否阻塞 MVP：是。它是“不备份”策略下唯一的写入安全网。

### P2. 成功完全无提示会削弱可操作性

问题：PRD 要求保存成功和应用成功完全不提示。

影响：用户无法区分“点击没触发”“写入仍在进行”“已经完成”。失败会提示，但成功没有任何状态变化，在桌面 GUI 中容易造成重复点击，进一步增加多次写文件和测试状态混乱。

建议：不弹窗可以保留，但至少需要按钮 loading/disabled 状态，并在动作完成后恢复。若坚持没有成功文案，视觉状态也要表达操作已结束。

是否阻塞 MVP：否。

## 总体判断

PRD 的产品方向可实现，MVP 范围也基本闭合：Profile 管理、三文件写入、`pi -p "ping"` 测试、Tauri/Rust 后端都能落地。

主要风险不在界面，而在 Pi 配置边界：`auth.json` 不能粗暴接管，`settings.json` 必须谨慎合并，`models.json` 强管控必须接受会删除高级配置。若技术设计能把这些文件写入规则具体化，第一版可以进入脚手架和核心后端实现。

建议技术设计优先补齐：

1. `auth.json` 合并和保留 OAuth/未知条目的精确规则。
2. `settings.json` 读取、合并、损坏文件处理和项目级覆盖说明。
3. 三文件写入的失败状态、原子写入实现和测试工作目录策略。
