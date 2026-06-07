# 调整账号启用和新增行为

## Goal

账号新增只负责保存账号，不再隐式改 Pi 当前配置；账号列表通过明确的“启用”动作切换 Pi 当前账号，并移除“已应用到 Pi”列，降低误解和误操作。

## Requirements

- 账号列表显示“启用”操作，用于把该账号应用到 Pi。
- 已启用账号也允许再次点击“启用”，用于重新写入 Pi 或同步刷新后的凭据。
- 新增 OAuth 账号后只保存账号，不自动应用到 Pi。
- 新增 API Key 账号后只保存账号，不自动应用到 Pi。
- 账号列表移除“已应用到 Pi”列。
- 保留现有账号是否已应用的内部状态，用于排序、删除确认和当前 Pi 信息等其他既有逻辑。

## Acceptance Criteria

- [x] 新增 OAuth 账号成功后不会调用 `apply_auth_account`。
- [x] 新增 API Key 账号成功后不会调用 `apply_auth_account`。
- [x] 账号列表不再有“已应用到 Pi / Active in Pi”这一列。
- [x] 每个账号行有“启用 / Enable”操作，点击后调用现有应用账号逻辑。
- [x] 已启用账号行的“启用 / Enable”操作仍可点击。
- [x] `npm run build` 通过。
- [x] `npm run test:auth` 通过。

## Definition of Done

- 前端文案集中在 `src/i18n.ts`。
- 改动范围限定在账号 UI 和新增账号后的前端副作用。
- 不改后端账号存储契约，不清理 `activeInPi` 字段。

## Technical Approach

- 在 `src/App.tsx` 中移除 `addOAuthAccount` 和 `addApiKeyAccount` 成功后的 `applyAuthAccount` 调用。
- 继续刷新账号列表并聚焦新账号，关闭添加面板。
- `AccountRow` 使用“启用”按钮触发现有 `applySelectedAccount`。
- 从账号列表表头和行内容中删除“已应用到 Pi”列。
- 在 `src/i18n.ts` 调整新增成功提示和启用动作文案。

## Out of Scope

- 不移除 `AuthAccount.activeInPi` / `lastAppliedAt` 类型字段。
- 不改 Rust 后端的 `apply_auth_account` 行为。
- 不改供应商列表中使用的“已应用到 Pi”徽标。

## Technical Notes

- 相关规范：`.trellis/spec/frontend/account-contracts.md`、`.trellis/spec/frontend/state-management.md`、`.trellis/spec/frontend/quality-guidelines.md`。
- 主要相关文件：`src/App.tsx`、`src/i18n.ts`。
