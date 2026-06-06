# Repository Guidelines

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

## 项目结构与模块组织

Pi Switch 是一个 Tauri + React + TypeScript 桌面应用。前端代码位于 `src/`：`App.tsx` 是主界面，`commands.ts` 封装 Tauri 调用，`domain.ts` 定义共享类型，`i18n.ts` 管理中英文文案，`styles.css` 放 Tailwind 样式。Rust 后端位于 `src-tauri/src/`，负责配置读写、Pi 文件生成、命令执行等逻辑；Tauri 配置在 `src-tauri/tauri.conf.json`。脚本和 Node 测试在 `scripts/`。产品、设计和技术文档在 `docs/`，静态原型在 `prototypes/ui/`，字体在 `src/fonts/`，应用图标在 `src-tauri/icons/`。

## 构建、测试与本地开发命令

- `npm install`：安装前端、Tauri CLI 和脚本依赖。
- `npm run dev`：只启动 Vite 前端开发服务。
- `npm run tauri dev`：启动完整桌面应用。
- `npm run build`：运行 `tsc` 类型检查并构建 Vite 产物。
- `npm run test:auth`：运行 `scripts/*.test.mjs` 的 Node 测试。
- `cd src-tauri && cargo test`：运行 Rust 后端测试。
- `npm run tauri build`：生成发布包，输出到 `src-tauri/target/release/bundle/`。

## 编码风格与命名约定

TypeScript/JavaScript 使用 2 空格缩进；Rust 代码使用 `cargo fmt`。TypeScript 变量和函数使用 `camelCase`，React 组件和导出类型使用 `PascalCase`，provider ID 使用 kebab-case。涉及 provider、model、auth、settings 的数据结构优先在 `domain.ts` 中定义明确类型。新增 UI 文案放入 `i18n.ts`，不要在组件中直接写散落的双语文本。React 前端不要直接读写本地配置文件，应通过 `commands.ts` 和 Tauri commands 调用后端。

## 测试指南

脚本测试使用 Node 内置 test runner，测试文件命名为 `*.test.mjs`，并尽量放在对应脚本逻辑附近。修改 Rust 后端的配置生成、凭证合并、文件写入、命令执行逻辑时，应补充或更新 `src-tauri/src/` 附近的 Rust 测试。涉及 UI 或类型变更时至少运行 `npm run build`；涉及完整桌面流程时使用 `npm run tauri dev` 手动验证。

## 提交与 Pull Request 规范

近期提交信息采用简洁的中文祈使句，例如 `修正账号页移动端布局`、`增加 Codex 空账号首登入口`。除非分支已有英文约定，继续使用这种风格。PR 应包含问题和解决方案摘要、已运行的验证命令、关联 issue；有可见 UI 改动时附截图或录屏。

## 安全与配置注意事项

API key、OAuth token、`~/.pi/agent/auth.json` 和 `~\PiSwitch\config.json` 都应视为敏感数据。编辑 Pi 配置时保留未知字段和 OAuth 条目。不要在日志、测试输出或 PR 描述中暴露原始凭证；除非审计任务明确需要，也不要贴未脱敏的命令输出。
