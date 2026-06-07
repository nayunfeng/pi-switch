# Remove Add Account OAuth Help Copy

## Goal

Remove three helper-copy lines from the add-account OAuth login UI while keeping the OAuth login flow unchanged.

## Requirements

* Remove the add-account OAuth text beginning with "OAuth 登录后..." / "OAuth login extracts...".
* Remove the add-account OAuth text beginning with "添加第二、第三个 OAuth 账号前..." / "Before adding a second or third OAuth account...".
* Remove the add-account OAuth text "完成授权后，此窗口将自动更新。" / "After you authorize, this window updates automatically."
* Remove OAuth event-list copy for low-value log messages such as "Starting OAuth login...", "打开登录地址:", and "手动登录码".
* Keep OAuth provider selection, start authorization, manual callback, and device-code behavior unchanged.

## Acceptance Criteria

* [ ] Those three copy strings no longer render in the add-account OAuth flow.
* [ ] OAuth event lists no longer render the started/auth/manual-code log rows.
* [ ] Unused translation keys are removed if no remaining code references them.
* [ ] `npm run build` passes.

## Definition of Done

* Existing unrelated workspace files are not touched.
* No backend changes are needed.

## Technical Notes

* Located strings in `src/i18n.ts`: `oauthAccountHelp`, `oauthMultiAccountHelp`, `oauthAutoUpdateHint`.
* Need to inspect `src/App.tsx` for render sites before deleting keys.
