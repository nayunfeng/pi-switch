# OAuth 添加账号改为内联授权链接流程

## Goal

把「添加账号」对话框的 OAuth 授权方式，从「点按钮 → 自动打开浏览器 → 弹窗粘 code」改造成参考图那种**内联授权链接式**流程：用户选择供应商后，对话框内直接出现授权链接（只读字段 + 复制按钮）和「在浏览器中打开」按钮，下方有「手动输入回调地址」字段 + 「我已授权，继续」按钮，并提示「完成授权后，此窗口将自动更新」。目的：让 OAuth 授权过程更可控、可见（链接可复制/手动打开），并显式支持粘贴回调地址兜底。

## What I already know

### 现有 OAuth 实现（前端 src/App.tsx）
* OAuth 添加账号入口：`addOAuthAccount(providerId)` → 调用阻塞式 `loginOfficialProviderOAuth(providerId, "")`（commands.ts → Tauri `login_official_provider_oauth`）。
* 全局事件监听（useEffect, ~line 199）：监听 `oauth-login-event`：
  * `type:"auth"` → 取 `url`，**自动 `openUrl` 打开浏览器**（line 205-207，`openedOAuthUrlsRef` 去重）。
  * `type:"deviceCode"` → 取 `verificationUri` 自动打开。
  * `type:"manualCode"` → 弹出全局 `oauthManualCodeDialogRef` 对话框让用户粘贴 code/URL。
* `oauthState`（providerId/running/events）驱动按钮 disabled 与事件列表 `OAuthEventList`。
* 其它 OAuth 入口：Provider 卡片的 `loginOAuthProvider`（line 464）、`CodexAccountReadiness`「添加首个 Codex 账号」（打开添加对话框并选中 codex）。
* manual code 弹窗（line 1102-1135）：`submitOAuthManualCode(loginId, code)`。

### 现有 OAuth 实现（后端 src-tauri/src/lib.rs）
* `login_official_provider_oauth`（line 2090）：仅支持 `anthropic / github-copilot / openai-codex`（line 2097）；起 `node --input-type=module -e <script>` 子进程跑 Pi SDK；逐行读子进程 stdout 的 JSON 事件并 `window.emit("oauth-login-event", ...)`；子进程退出后从 temp `auth.json` 读凭证创建账号。**整个调用阻塞直到子进程退出**。
* `oauth_login_script`（line 2223）：`auth.login(providerId, { onAuth, onDeviceCode, onPrompt, onSelect, onProgress, onManualCodeInput })`。
  * `onAuth(info)` → emit `auth` 带 `url`（授权 URL 由 Pi SDK 产生，**只在 login() 启动后才有**）。
  * `onManualCodeInput: waitForManualCode` → emit `manualCode`（提示 "Paste the final redirect URL or authorization code."），然后轮询 temp 文件直到拿到值。
  * openai-codex 的 `onSelect` 固定返回 `"browser"`（line 2275）。
* `submit_oauth_manual_code_to_session`（line 733）：把提交内容 trim 后写入 temp 文件给子进程读。**测试证实可直接传完整回调 URL**（line 4827-4843）。
* `OAuthLoginSessions`（line 674）：按 `loginId` 记录 `manual_code_files`。每个事件都带 `loginId`（脚本 line 2240）。

### 代码里没有的
* 没有本地回调服务器 / 端口 1455 的痕迹（grep 仅命中测试里的 8080）。回调捕获完全交给 Pi SDK 自己处理（参考图里的 `localhost:1455` 是 OpenAI codex SDK 自带的本地回调端口）。
* 没有「取消进行中的 OAuth 登录」命令——当前模型下登录要么成功要么失败返回，前端无法主动中止子进程。

## Key constraint（决定整体架构）

授权 URL **只在 `auth.login()` 启动（子进程跑起来、SDK 调 `onAuth`）之后**才由 `auth` 事件产生。因此「选完供应商就出现授权链接」**必须在选供应商/打开对话框时就启动登录子进程**，并让该子进程在用户去浏览器授权期间持续运行（等待自动捕获或粘贴回调）。这引入了**子进程生命周期管理**：切换供应商需重启、关闭对话框/切到 API Key tab 需取消——而当前后端没有取消能力。

## Assumptions (temporary, validate in Q&A)

* 范围仅改「添加账号」对话框的 OAuth 授权 tab 的交互；不新增参考图里的 Token/JSON、导入 tab。
* 改造适用于全部支持 OAuth 的供应商（保留供应商下拉），不是只做 Codex。
* 「在浏览器中打开」改为手动按钮，去掉 `auth` 事件的自动 `openUrl`（至少在该对话框模式下）。
* 自动更新依赖 Pi SDK 自身回调捕获；手动粘贴回调地址是兜底。

## Open Questions

* ~~Q1（trigger/生命周期）~~ **已定**：选完供应商 → 点「开始 OAuth 授权」按钮 → 启动子进程并显示链接（不随选供应商自动启动）。详见 Decisions。
* Q2（取消机制）：自动启动需要新增后端 `cancel_oauth_login(loginId)` 杀子进程吗？切换供应商/关闭对话框如何收尾？
* Q3（手动粘贴 UI）：内联「手动输入回调地址」字段常驻还是仅在收到 `manualCode` 事件后出现？是否保留/替换原全局弹窗（它还服务 Provider 卡片登录入口）？
* ~~Q4（范围）~~ **已定**：适用全部 OAuth 供应商（保留下拉）；维持现有 OAuth + API Key 两 tab，不新增 Token/JSON、导入。

## Requirements (evolving)

* 选择供应商后，OAuth 授权 tab 显示「开始 OAuth 授权」按钮；点击后启动登录子进程，`auth` 事件到达后内联展示授权链接（只读 + 复制按钮）。
* 提供「在浏览器中打开」按钮；不再自动弹浏览器。
* 提供「手动输入回调地址」字段 + 「我已授权，继续」按钮，提交走 `submitOAuthManualCode`（接受完整回调 URL）。
* 授权完成后对话框/账号列表自动更新。
* 适用全部 OAuth 供应商（保留供应商下拉）；维持 OAuth + API Key 两 tab。
* OAuth tab 状态机：idle（供应商下拉 +「开始 OAuth 授权」按钮）→ starting（生成链接中…）→ linkReady（授权链接 + 复制 + 在浏览器中打开 + 手动回调框 + 我已授权继续 + 自动更新提示）→ success / error / canceled。
* 关对话框 / 切供应商 / 切到 API Key tab / 点取消 → 调用 `cancel_oauth_login` 终止进行中的登录，状态回到 idle。
* 成功后沿用现 `addOAuthAccount` 收尾：保存 + 应用账号、关闭对话框、刷新列表、toast。

## Acceptance Criteria (evolving)

* [ ] 选中支持 OAuth 的供应商后，授权链接在对话框内可见且可复制。
* [ ] 「在浏览器中打开」点击后才打开浏览器，不自动打开。
* [ ] 粘贴完整回调地址并「我已授权，继续」后能完成登录并保存账号。
* [ ] 授权成功后对话框关闭/账号列表刷新，无需手动刷新。
* [ ] 切换供应商 / 关闭对话框不留下僵尸 node 子进程。
* [ ] 三个 OAuth 供应商都走新流程；API Key tab 与 Provider 卡片登录入口不受影响。
* [ ] 关对话框 / 切供应商 / 切 tab / 点取消后，`cancel_oauth_login` 被调用且无僵尸 node 进程。
* [ ] 后端 `cancel_oauth_login` 有 Rust 单测覆盖（kill + session 清理）。
* [ ] `tsc --noEmit` 与 `cargo build` / `cargo test` 通过。

## Definition of Done (team quality bar)

* 相关单测/集成测更新（后端 Rust 测试覆盖新命令；前端交互可手测）。
* lint / typecheck（`tsc --noEmit` + `cargo` 构建）通过。
* 行为变化点记录到文档/spec（如自动打开行为移除、新增取消命令）。
* 风险点（子进程泄漏、并发登录）有兜底。

## Out of Scope (explicit, tentative)

* 参考图里的 Token/JSON、导入 tab（已确认本次不做）。
* 新增本地回调服务器（沿用 Pi SDK 自带捕获）。
* 扩展 OAuth 到当前不支持的 provider。

## Decisions (ADR-lite)

### D1：授权链接的启动时机（Q1）
* Context：授权 URL 只在 `auth.login()` 子进程启动后由 SDK 的 `onAuth` 产生；选供应商即启动 vs 按钮启动两种走法都需要取消能力。每次启动都要 spawn node + 加载 Pi SDK（~0.5-2s）。
* Decision：**点按钮后启动**——选完供应商点「开始 OAuth 授权」才启动子进程并显示链接。
* Consequences：比参考图多一次点击；但避免切换供应商时反复 spawn node；子进程只在用户明确开始后运行。仍需「取消」能力收尾。

### D2：范围（Q2/Q4）
* Decision：新流程适用全部 OAuth 供应商（anthropic / github-copilot / openai-codex），保留供应商下拉；对话框维持 OAuth 登录 + API Key 两 tab，不新增 Token/JSON、导入。
* Consequences：Provider 卡片的 `loginOAuthProvider` 入口本次不改（保持自动打开 + 全局弹窗）。

### D3：进行中登录的取消（Q2 取消机制）
* Context：选 B 后子进程在用户去浏览器期间持续运行；关对话框 / 切供应商 / 切到 API Key tab 都可能放弃登录。当前后端无取消能力。
* Decision：新增后端 `cancel_oauth_login(loginId)` 命令，杀掉对应 node 子进程并清理 session；前端在关对话框、切换供应商、切到 API Key tab、点「取消」时调用。**关对话框即取消，不在后台保留登录会话**（Q4）。
* Consequences：需在 `OAuthLoginSessions` 里记录可中止句柄（child kill 通道）；避免僵尸进程。

### D4：手动回调输入的展示（Q3）
* Decision：点「开始 OAuth 授权」后，授权链接与「手动输入回调地址」字段同时常驻显示；提交走现有 `submitOAuthManualCode`（接受完整回调 URL）。新 tab 不再用全局弹窗（弹窗仅保留给 Provider 卡片入口）。
* Consequences：无论 SDK 是否自动捕获回调，用户都有稳定的手动完成路径；自动捕获成功时子进程退出 → 命令 resolve → 自动更新。

## 实现状态

* 后端（lib.rs）：新增 `OAuthCancelToken`（AtomicBool + Notify）、`OAuthLoginSessions.cancels`、`cancel_oauth_login` 命令、登录读循环改 `tokio::select!`（取消即 `start_kill` 并返回 `OAUTH_LOGIN_CANCELED`）；Cargo.toml tokio 加 `sync`/`macros`；新增同步单测。`cargo test --lib` → 55 passed。
* 前端（commands.ts / App.tsx / i18n.ts）：`cancelOAuthLogin` wrapper；监听器 inline 模式抑制自动打开+弹窗并捕获 loginId；`addOAuthAccount` 改为内联会话（非阻塞展示链接、取消静默）；新增 `submitOAuthCallback`/`cancelOAuthInline`/`changeAddMode`/`handleAddDialogClose`；OAuth tab 状态机 JSX（开始按钮→链接+复制+在浏览器打开+常驻回调框+我已授权继续+自动更新提示+取消）；dialog `onClose` 取消接线；新增 i18n 键。`tsc --noEmit` + `npm run build` 通过。
* 未自动验证：真实 GUI 的 OAuth 端到端（需 Pi CLI + node + 真实供应商交互），需人工跑 `npm run tauri dev` 验收。

## Technical Notes

* 前端：src/App.tsx（OAuth 监听 ~199、`addOAuthAccount` 488、manual 弹窗 1102、OAuth tab JSX ~1329、`AccountsPanel` props）、src/commands.ts、src/domain.ts（`OAuthLoginEvent` 43-60）、src/i18n.ts。
* 后端：src-tauri/src/lib.rs（`login_official_provider_oauth` 2090、`oauth_login_script` 2223、`OAuthLoginSessions` 674、`submit_oauth_manual_code` 1698/733）。
* 关键约束见上「Key constraint」。
