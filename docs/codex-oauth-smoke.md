# Codex OAuth 多账号冒烟

目标：验证 Pi Switch 能保存多个 `openai-codex` OAuth 账号，并能通过账号切换更新 Pi 的当前认证。

## 前置

- 用 Tauri 启动应用：`npm run tauri -- dev`
- 不要手动打印或粘贴 `~/PiSwitch/accounts.json`、`~/.pi/agent/auth.json` 的原文内容。
- 验证时只使用脱敏命令：`npm run audit:auth` 或 `npm run verify:codex-accounts`。

## 步骤

1. 打开 Pi Switch，进入 `Accounts` tab。
2. Provider 选择 `OpenAI Codex`。
3. 点击 `Add OAuth account`，在浏览器中完成第一个 Codex 账号登录。
4. 回到应用，确认账号列表出现一个 `openai-codex OAuth` 账号，并显示 `Active in Pi`。
5. 重复第 3 步，使用另一个 Codex 账号登录。浏览器可能复用当前网页登录态；如果没有账号选择页，先切换/退出浏览器里的 Codex 账号，或使用无痕窗口完成第二个账号登录。
6. 账号列表应至少出现两个 `openai-codex` OAuth 账号，例如：
   - `openai-codex OAuth`
   - `openai-codex OAuth 2`
7. 逐个点击账号行里的 `Apply account`，确认 `Active in Pi` 跟随切换。

## 验收

运行：

```bash
npm run verify:codex-accounts
```

通过标准：

- 输出包含 `"ok": true`
- `codexOAuthAccountCount` 大于等于 `2`
- `appliedCodexOAuthAccountCount` 大于等于 `2`
- `codexOAuthIdentityCount` 大于等于 `2`
- `appliedCodexOAuthIdentityCount` 大于等于 `2`
- `activeOpenAICodexAccount.accountId` 指向当前应用的账号
- `activeOpenAICodexAccount.match` 应为 `exact` 或 `oauthIdentity`
- `accounts[*].credential.hasSecret` 可以是 `true`，但输出中不应出现 token/API key 原文

辅助排查：

```bash
npm run audit:auth
```

`identity` 字段如果存在，可用于确认多个 Codex 账号是否来自不同 email/account；它只应包含脱敏身份摘要，不应包含 token、refresh token、API key 或 authorization 值。

## 常见失败

- `missing ~/PiSwitch/accounts.json`：还没有成功保存账号。
- `expected at least 2 openai-codex OAuth accounts`：只保存了 0 或 1 个 Codex OAuth 账号。
- `expected at least 2 openai-codex OAuth accounts to have been applied`：保存了多个账号，但还没有逐个点击 `Apply account` 完成切换验证。
- `expected at least 2 distinct openai-codex OAuth identities`：保存的账号实际来自同一个 Codex 身份，通常是浏览器复用了上次网页登录态。
- `expected at least 2 distinct applied openai-codex OAuth identities`：保存了不同身份，但还没有分别应用这些不同身份。
- `missing openai-codex entry in Pi auth.json`：账号保存了，但还没有应用到 Pi。
- `current openai-codex Pi auth does not match a saved account`：Pi 当前认证和账号库无法匹配，尝试在 Accounts tab 重新应用目标账号。
- `current openai-codex Pi auth only matched the latest applied OAuth account`：只靠最近应用账号推断当前账号，证据不够强。重新应用目标账号，或确认 OAuth token 中是否能解析出账号身份。
- `current openai-codex Pi auth used unsupported match`：验收脚本遇到未知匹配方式，不能作为强证据通过。
