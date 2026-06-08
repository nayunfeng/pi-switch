# 落地应用图标

## Goal

将用户选定的轻微手写斜体 `Π` 橙色图标落地为 Pi Switch 的正式 Tauri 应用图标资源，并让 GUI 顶部品牌标识同步使用 `Π`。

## Requirements

* 使用已定稿图片：`C:\Users\92176\.codex\generated_images\019ea243-bc0a-7ac2-8770-b05d795c81a2\ig_03f11ec9e7585a32016a25c62aad04819a80c0c5d7381c53b8.png`。
* 保留橙色渐变方块、白色轻微手写斜体 `Π`、简约 UI 风格。
* 替换 `src-tauri/icons/` 下 Tauri 应用图标需要的 PNG/ICO/ICNS/Windows Store 图标资源。
* GUI 顶部 `brand-mark` 同步为白色 `Π`，继续使用现有橙色品牌方块风格。
* 不修改业务逻辑。

## Acceptance Criteria

* [x] `src-tauri/icons/icon.png` 使用选定图标。
* [x] `src-tauri/icons/32x32.png`、`128x128.png`、`128x128@2x.png` 更新为同一图标的正确尺寸。
* [x] `src-tauri/icons/icon.ico` 和 `icon.icns` 更新。
* [x] Windows Store/Square 图标同步更新。
* [x] 生成后的图标文件存在且尺寸合理。
* [x] GUI 顶部品牌标识显示为 `Π`。

## Definition of Done

* 图标资源已生成并放入项目。
* 检查生成文件尺寸。
* `npm run build` 通过。
* 不提交无关未跟踪文件。

## Out of Scope

* 不重新设计图标。
* 不修改业务逻辑。

## Technical Notes

* 项目图标目录：`src-tauri/icons/`。
* 当前项目已有 Tauri 多尺寸图标资源。
* 顶部品牌标识位于 `src/App.tsx` 的 `.brand-mark`，样式在 `src/styles.css`。
