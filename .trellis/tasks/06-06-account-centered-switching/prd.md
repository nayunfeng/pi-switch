# 账号中心化切换与维护

## Goal

把 Pi Switch 从“供应商/Profile 配置控制台”调整为“便携的账号切换与账号维护工具”。主体验应围绕账号列表、添加账号、维护账号、应用账号展开，优先服务 Codex、Claude Code，以及二者常用的中转站/网关场景。

## What I Already Know

* 用户不满意当前以供应商配置为中心的产品形态。
* 用户的核心诉求是便携地切换账号和维护账号。
* 常用场景包括 Codex、Claude Code，以及 Codex/Claude Code 的中转站。
* 账号面板应以账号列表为主体。
* 账号列表上方需要一行操作栏，至少包含“添加账号”。
* 点击“添加账号”后应打开弹框，而不是在页面中展开大表单。
* 添加账号弹框有两个 tab：
  * OAuth 方式添加。
  * API Key 方式添加。
* API Key 添加流程通过选择供应商来添加账号，主要字段是 `baseUrl` 和 `apiKey`。
* 供应商分为两块：
  * 内置供应商。
  * 用户自定义供应商。
* 选择官方/内置供应商时，`baseUrl` 默认填充官方地址，但允许用户覆盖。
* 选择自定义供应商时，`baseUrl` 和 `apiKey` 默认填充用户在供应商里配置好的值。

## Repo Findings

* 当前 `src/App.tsx` 已有 `accounts` 主 tab，但默认入口仍是 `providers`。
* 当前账号页已支持 OAuth/API Key 账号能力，但添加表单直接嵌在页面内，API Key 部分藏在 `details` 中，不是操作栏加弹框。
* 当前账号页的 API Key 添加只选择 `OfficialProviderId` 并录入 `apiKey`，没有 `baseUrl` 字段。
* 当前 `src/domain.ts` 的 `AuthAccount` 前端视图只有 `providerId`、`label`、`kind`、`identity`、时间戳和 `activeInPi`，不包含 `baseUrl`。
* 当前 Rust 后端 `AuthAccount` 内部保存 `credential`，但 `create_api_key_account` 只接受官方 provider id、label、apiKey，并校验为官方 provider。
* 当前 `CustomProvider` 已能保存 `baseUrl`、`api`、`apiKey`、headers、compat、models 等中转站配置。
* 当前官方 provider 的高级配置已有 `advanced.baseUrl` 和 `advanced.apiKey`，可用于中转/覆盖场景。
* 当前产品文档 `docs/specs/pi-switch-prd.md` 和 `docs/specs/ui-flow.md` 仍围绕 Profile/Provider 配置，而不是账号中心化流程。

## Assumptions

* MVP 优先重排现有主界面，让账号成为默认入口；供应商配置退居为账号添加时的可选来源/模板。
* OAuth 账号主要面向支持 OAuth 的内置供应商，目前代码中已有 `anthropic`、`github-copilot`、`openai-codex`。
* API Key 账号需要支持两类来源：
  * 内置供应商模板：使用官方默认 `baseUrl`，可覆盖，并填写 `apiKey`。
  * 自定义供应商模板：复制/引用用户保存的自定义供应商配置，默认带出 `baseUrl` 和 `apiKey`。
* 添加 API Key 账号后，账号应能被直接应用到 Pi，不要求用户再进入供应商页手动绑定。

## Open Questions

* None.

## Requirements

* 主界面优先展示账号面板，账号列表成为第一工作区。
* 账号列表上方提供紧凑操作栏，至少包含“添加账号”和“刷新状态”。
* “添加账号”使用 modal dialog。
* 添加账号弹框提供 OAuth/API Key 两个 tab。
* OAuth tab 允许选择支持 OAuth 的内置供应商并发起登录。
* API Key tab 允许先选择供应商来源：
  * 内置供应商。
  * 用户自定义供应商。
* API Key tab 选择内置供应商时自动填入官方默认 `baseUrl`，用户可以覆盖。
* API Key tab 选择自定义供应商时自动填入该供应商当前配置的 `baseUrl` 和 `apiKey`，用户可以覆盖。
* API Key 账号保存自己的 `baseUrl` 和 `apiKey` 快照；供应商只作为创建账号时的默认值来源。
* API Key 账号保存后不依赖原供应商后续配置变化；用户修改或删除供应商不应破坏已保存账号。
* 应用 API Key 账号时只切换账号认证和 endpoint 配置，不同时切换默认模型。
* 添加账号弹框不要求选择模型或默认模型。
* MVP 中已保存 API Key 账号不支持编辑 `baseUrl` 或 `apiKey`；填错或需要轮换时，用户删除账号后重新添加。
* 添加成功后账号进入账号列表，并可直接应用到 Pi。
* 账号行应清楚展示账号名称、来源供应商、认证方式、是否当前应用到 Pi、必要的身份摘要。
* 供应商配置能力保留，但不再作为用户首要流程。
* 本轮只落地当前账号中心化 MVP，不把新增自定义供应商、账号导入/导出纳入添加账号弹框。

## Acceptance Criteria

* [ ] 启动应用后默认进入账号面板。
* [ ] 账号面板顶部有操作栏，包含“添加账号”入口。
* [ ] 点击“添加账号”打开弹框，弹框内可在 OAuth 和 API Key tab 间切换。
* [ ] OAuth tab 可以完成现有 OAuth 添加账号流程。
* [ ] API Key tab 选择内置供应商后能看到默认 `baseUrl`，且可编辑。
* [ ] API Key tab 选择自定义供应商后能自动带出该供应商的 `baseUrl` 和 `apiKey`，且可编辑。
* [ ] API Key 账号保存后，即使原自定义供应商被修改，账号仍保留创建时确认过的 `baseUrl`/`apiKey`。
* [ ] API Key 账号保存后能出现在账号列表，并能应用到 Pi。
* [ ] 应用 API Key 账号不会要求用户选择默认模型，也不会在添加账号时展示模型选择。
* [ ] 应用 API Key 账号时，Pi 的现有默认模型选择保持不被账号添加弹框改写。
* [ ] 已保存 API Key 账号详情不提供编辑 `baseUrl`/`apiKey` 的入口；账号可删除后重建。
* [ ] 添加账号弹框不包含新增自定义供应商流程，也不包含账号导入/导出流程。
* [ ] 账号列表和账号详情不泄露完整 API Key，除非用户显式点开显示。
* [ ] `npm run build` 通过。
* [ ] 涉及后端账号存储或 Pi 写入逻辑时，`cd src-tauri && cargo test` 通过。

## Technical Approach

* Frontend:
  * Make the accounts view the default primary workflow.
  * Replace the inline account creation area with a compact account toolbar and modal dialog.
  * Add OAuth/API Key tabs in the add-account dialog.
  * In API Key tab, derive defaults from built-in providers or existing custom provider entries, then save the confirmed values into the account snapshot.
  * Keep provider management available in the existing provider area, but make it secondary.
* Backend:
  * Extend API Key account creation/storage so account data can carry endpoint metadata such as `baseUrl`.
  * Preserve existing OAuth behavior and existing auth/account compatibility.
  * Update apply-account behavior for API Key accounts so authentication and endpoint configuration can be applied without changing default model selection.
  * Add or update Rust tests around API Key account snapshots and apply behavior.

## Implementation Plan

* PR1: Extend account data shape and backend command behavior for API Key account snapshots.
* PR2: Refactor accounts UI into list-first layout with toolbar and add-account dialog tabs.
* PR3: Wire built-in/custom provider default filling, update i18n/styles, and run build/Rust tests.

## Definition of Done

* Tests added/updated where behavior changes.
* Type-check/build passes.
* Rust tests pass if backend account/config behavior changes.
* Existing OAuth/token entries and unknown Pi config fields remain preserved.
* No raw credentials appear in logs, test output summaries, PRD, or final notes.

## Out of Scope (Initial)

* 大规模重做模型管理体验。
* 导入/导出账号包。
* 云同步账号。
* 完整密钥加密/系统钥匙串迁移。
* 新增目前 Pi/后端不支持的 OAuth provider。
* 删除账号时自动清理 Pi 当前认证。
* 在账号上保存或切换默认模型。
* 编辑已保存 API Key 账号的 `baseUrl` 或 `apiKey`。
* 在添加账号弹框里新建或维护自定义供应商。
* 账号导入/导出。

## Decision (ADR-lite)

**Context**: API Key 账号可以从内置供应商或自定义供应商创建，但用户诉求是便携地维护和切换账号。如果账号只引用供应商配置，后续修改/删除供应商会影响账号稳定性，产品仍会偏供应商中心。另一个边界是模型选择：如果账号也携带默认模型，添加账号流程会变成账号、endpoint、模型的混合配置，偏离本次的账号维护目标。已保存账号编辑也会扩出新的更新命令、密钥显示/隐藏状态和保存校验。新增自定义供应商、账号导入/导出也都属于相邻能力，但会显著扩大本轮范围。

**Decision**: API Key 账号保存自己的 `baseUrl` 和 `apiKey` 快照。内置供应商和自定义供应商只负责在创建时提供默认值，用户确认保存后账号成为独立实体。MVP 中应用账号只切换认证和 endpoint，不在账号上保存或切换默认模型。MVP 不支持编辑已保存 API Key 账号的 `baseUrl`/`apiKey`，需要修改时删除后重建。本轮只做当前账号中心化 MVP，不顺手加入新增自定义供应商或账号导入/导出。

**Consequences**: 账号切换更稳定，也更符合“账号中心化”；实现上需要扩展账号数据模型、前后端 command 输入输出和 Pi 应用逻辑。添加账号弹框保持轻量，不承担模型管理；账号详情也保持维护动作最小化。后续如果需要“同步供应商配置到账号”“账号携带默认模型”“编辑账号密钥”“新增自定义供应商”或“账号导入/导出”，应作为显式后续功能，而不是本次混入。

## Technical Notes

* Relevant frontend files:
  * `src/App.tsx`
  * `src/domain.ts`
  * `src/commands.ts`
  * `src/i18n.ts`
  * `src/styles.css`
* Relevant backend file:
  * `src-tauri/src/lib.rs`
* Existing tests in `src-tauri/src/lib.rs` cover account creation, duplicate, deletion binding cleanup, applying accounts, and preserving auth behavior.
* Current frontend spec index is `.trellis/spec/frontend/index.md`; detailed files are placeholders and should be read before implementation if changed.
