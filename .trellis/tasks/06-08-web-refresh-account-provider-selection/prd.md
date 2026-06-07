# Web Refresh and Account Provider Selection Fix

## Goal

Fix two frontend regressions: ordinary browser refresh must not crash on Tauri-only event APIs, and Add Account -> API Key -> custom provider selection must use the provider panel's saved provider list with clearer wording.

## Requirements

* In a non-Tauri browser runtime, refreshing the web page must not throw `Cannot read properties of undefined (reading 'transformCallback')`.
* OAuth event listening should only register when Tauri internals required by event callbacks are available.
* Opening OAuth URLs should keep working in Tauri and fall back to `window.open` in a regular browser.
* Add Account -> API Key custom provider source must list providers already added in the provider panel.
* The custom provider source wording should read as "已添加的供应商" / "Added providers".
* The source list should use the same persisted provider list as the provider panel, not only custom-provider entries.

## Acceptance Criteria

* [x] `npm run build` passes.
* [x] Web refresh no longer hits the Tauri `transformCallback` error path.
* [x] Tauri OAuth event listener is skipped outside Tauri runtime.
* [x] OAuth URL open action has a browser fallback.
* [x] API Key account custom source can select saved providers from `config.providers`.
* [x] Custom source text is changed to "已添加的供应商" / "Added providers".

## Definition of Done

* Existing unrelated workspace files are not touched.
* Frontend-only changes avoid backend command/schema churn.
* Existing auth tests still pass.

## Technical Notes

* Primary files: `src/App.tsx`, `src/commands.ts`, `src/i18n.ts`.
* Existing dirty changes in `src/App.tsx` and `src/commands.ts` are the web-refresh fix started before this PRD was created.
