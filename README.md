# Pi Switch

## 这是什么

Pi Switch 是一个用于切换 Pi Coding Agent 模型供应商和默认模型的桌面配置工具。

它把原本需要手动修改配置文件的流程做成了图形界面，用户可以在 OpenAI、Anthropic、Google Gemini、OpenRouter、Groq、Mistral、xAI 以及自定义中转服务之间快速切换。

## 怎么跑

1. clone 仓库
2. 安装依赖：`npm install`
3. 启动完整桌面应用：`npm run tauri dev`
4. 只启动前端开发服务：`npm run dev`
5. 构建发布包：`npm run tauri build`

## 用了什么

- Tauri + React + TypeScript
- Rust 后端
- 主要功能：
  - 管理多个模型供应商和模型列表
  - 支持官方 API 和自定义 OpenAI-compatible 接口
  - 保存应用配置到 `~\PiSwitch\config.json`
  - 将当前启用的供应商写入 Pi Coding Agent 的全局配置
  - 保留已有 OAuth、未知字段和其他配置项，避免覆盖用户原有设置
