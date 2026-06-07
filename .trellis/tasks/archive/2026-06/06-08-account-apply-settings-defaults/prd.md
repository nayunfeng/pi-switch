# 修复启用账号不更新 Pi 默认项

## Goal

修复账号列表点击“启用”后 Pi `settings.json` 默认供应商仍保留旧值的问题，确保用户手动改乱 `defaultProvider` 后，重新启用账号能把 Pi 切回该账号对应供应商。默认模型在后端能可靠找到来源时也要同步修正。

## Requirements

- 启用任意账号时，后端必须更新 Pi `settings.json.defaultProvider`。
- 若账号带 `providerSnapshot`，继续使用快照写入 `defaultProvider/defaultModel/enabledModels`。
- 若账号没有 `providerSnapshot`，后端应从 Pi Switch `config.json` 的供应商列表中按账号 provider 匹配默认模型。
- 若没有快照且也找不到匹配供应商默认模型，只更新 `defaultProvider`，不猜测 `defaultModel`。
- 保留 `settings.json` 中其他未知字段。

## Acceptance Criteria

- [x] OpenAI API Key 账号没有 `providerSnapshot` 时，启用后 `settings.json.defaultProvider` 从乱写值恢复为 `openai`。
- [x] 同一场景下，如果 `config.json` 有 OpenAI 供应商默认模型，`settings.json.defaultModel` 和 `enabledModels` 同步恢复。
- [x] 账号带 `providerSnapshot` 的既有测试仍通过。
- [x] 自定义账号无快照时仍不写 `settings.json` 默认项。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --lib` 通过。
- [x] `npm run build` 通过。

## Technical Approach

- 扩展后端 `build_account_settings_json`，让它接收当前 app config。
- 新增后端 helper：优先从 `providerSnapshot` 构建 settings 默认项；缺少快照时，从 `config.providers` 匹配账号 provider 并提取 `defaultProvider/defaultModel/enabledModels`。
- 在 `apply_account_to_pi` 中读取 `config.json`，将 config 传入 settings 构建逻辑。
- 为用户描述场景添加 Rust 回归测试，覆盖默认供应商和默认模型。

## Out of Scope

- 不改变新增账号是否自动启用。
- 不改变前端列表 UI。
- 不为无快照且无供应商配置的账号猜测默认模型。

## Technical Notes

- 用户复现场景：只有一个 OpenAI 账号，手动把 Pi `settings.json.defaultProvider` 改成乱值，点击账号“启用”后值仍未恢复。
- 当前根因：`build_account_settings_json` 在 `provider_snapshot == None` 时直接返回 `None`，导致官方账号启用不会写 `settings.json`。
- 相关文件：`src-tauri/src/lib.rs`、`.trellis/spec/frontend/account-contracts.md`。
