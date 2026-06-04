目标：交付 Pi Switch MVP 桌面应用。

范围：
- 使用 Tauri + React + TypeScript 实现桌面应用
- 迁移当前静态原型为真实 React UI
- 支持 Profile 管理、官方 provider、自定义中转站、模型列表、默认模型
- 实现 Rust 后端读写 ~\PiSwitch\config.json
- 实现 Pi 全局配置写入：models.json、auth.json、settings.json
- 实现原子写入、校验、错误处理
- 实现 pi -p "ping" 测试，15 秒超时(验收使用codex cli当前配置，不再额外提供)
- 实现 /models 拉取候选模型
- 支持中文/英文、浅色/深色
- 完成基础验证并提交 Git

验收：
- 应用可启动
- 可保存 Profile
- 可应用官方 provider Profile
- 可应用自定义 provider Profile
- 可测试当前 Profile
- 不误删 auth.json 中 OAuth/未知条目
- settings.json 只更新 defaultProvider/defaultModel
- 工作区有清晰中文提交记录