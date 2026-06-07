# 顶部标签工作台界面重构

## Goal

把 Pi Switch 主界面从「左侧栏 + 右内容」重构为 **顶部标签导航 + 满宽内容的工作台布局**，并把暖棕/米色品牌配色整体替换为 **中性清爽配色（冷灰面 + 单一暖橙强调色）**。这是一次**表现层重构**：布局、className、styles.css 配色大改，但**所有现有功能、状态、事件处理、对话框、OAuth 流程、i18n、主题切换逻辑必须 100% 保留**。

后端（`src-tauri`）、`src/commands.ts`、`src/domain.ts`、`src/i18n.ts` 的**逻辑不改**（i18n 如需新增个别文案 key 可加，但不删改现有）。

## 设计蓝图（必须照着实现）

完整高保真稿：`.trellis/workspace/nayunfeng/design-preview/workbench.html`
**实现前必须用 Read 打开它**，照其配色变量、间距、组件结构、交互来还原。下面是要点提炼，细节以该文件为准。

## 配色（替换 `src/styles.css` 的 `:root` 与 `.dark`）

采用蓝图的中性配色。**注意映射**：蓝图用 `html[data-theme="dark"]`，但本应用的主题机制是给 `documentElement` 切 `.dark` class（见 `App.tsx` 的 theme effect，**保持不变**）。所以：浅色变量写进 `:root`，深色变量写进 `.dark`，蓝图里 `html[data-theme="dark"] .x` 的规则改写成 `.dark .x`。

浅色 `:root`：
```
--bg:#f7f8fa; --surface:#ffffff; --surface-2:#fbfcfd; --surface-sunken:#f1f3f6; --surface-hover:#f5f7fa;
--text:#14171f; --text-soft:#3a4150; --muted:#6b7280; --faint:#99a0ad;
--border:#e7eaf0; --border-strong:#d6dbe4; --line:#eef0f4;
--accent:#d9622b; --accent-hover:#c4521f; --accent-soft:#fdeee4; --accent-soft-2:#fbf4ee; --accent-ink:#9c3e15; --accent-ring:rgba(217,98,43,.22);
--ok:#1f9d57; --ok-soft:#e6f6ec; --ok-ink:#136c3b; --info:#3b6fd4; --info-soft:#eaf0fc; --danger:#d23b30; --danger-soft:#fbeae8;
--shadow-xs/sm/md/lg、--radius(11px)/--radius-sm(8px)/--radius-lg(15px)/--pill(999px) 见蓝图。
```
深色 `.dark`：
```
--bg:#0e1014; --surface:#171a20; --surface-2:#1b1e25; --surface-sunken:#12151a; --surface-hover:#1f232b;
--text:#eef1f6; --text-soft:#c4cad6; --muted:#8d95a3; --faint:#5f6878;
--border:#272c35; --border-strong:#343a45; --line:#21252d;
--accent:#e57642; --accent-hover:#f08855; --accent-soft:#2c1c12; --accent-soft-2:#221811; --accent-ink:#f0a878; --accent-ring:rgba(229,118,66,.3);
--ok:#3fbd76; --ok-soft:#15281d; --ok-ink:#6fd49d; --info:#6a9bf0; --info-soft:#18202f; --danger:#f0726a; --danger-soft:#2c1715;
```
**兼容旧变量名**：现有 JSX 内联样式与 styles.css 里还引用了 `--surface-muted`、`--accent-weak`、`--terminal` 等旧名。为避免局部样式失效，请在 `:root`/`.dark` 里把旧名**别名**到新值（如 `--surface-muted:var(--surface-sunken)`、`--accent-weak:var(--accent-soft)`、`--terminal` 保留给测试输出 `pre`），或在重构到的地方直接换用新变量。最终不得有未定义变量。

## 结构改造

### 顶栏（取代现 header）
- 左：品牌（渐变方块 mark + 「Pi Switch」+ 副标题「账号切换与维护」）。原品牌旁的 loading spinner 移除或改为不抖动的细微指示。
- 中/左：**主标签导航**（`role="tablist"`）「账号 / 供应商」，带数量 pill 和选中下划线——这是唯一主导航，由现有 `activeTab` state 驱动。
- 右：**主题分段切换**（太阳/月亮，lucide `Sun`/`Moon`），点击把 `config.theme` 设为 `light`/`dark`；外加一个**设置齿轮**（lucide `Settings`/`Settings2`）点开小弹层（popover），里面放**语言**和**主题（含「跟随系统」）** 两个选择。即：把现在 header 里那两个原生 `<select>` 收进齿轮弹层。

### 账号屏（`activeTab==="accounts"`）
满宽单列，去掉左侧栏。结构：
- page-head：标题「账号」+ 副标题；右侧操作：账号范围筛选 + 刷新图标按钮 + 主按钮「添加账号」。
  - **筛选**：保留现有按供应商过滤的能力（`accountProviderFilter`：全部账号 + 各供应商），用蓝图的 `.scope` 分段或一个美化的下拉皆可，**功能不能退化**。
- pi-strip：**「当前应用到 Pi」**横幅，显示当前 `activeInPi` 账号（头像、名称、身份、供应商、默认模型、认证方式、「测试」按钮）。没有激活账号时给优雅占位。
- 账号列表：满宽富行（`.row`），列＝账号(头像+名称+身份) / 供应商 / 状态 / 操作。
  - 激活行用蓝图的渐变描边 + ring + 「已应用到 Pi」徽标。
  - 操作列：未激活行显示行内「应用账号」按钮（调 `applySelectedAccount`/现有 apply 逻辑）；尾部 **kebab「更多」菜单**（小 popover）放「重命名 / 复制 / 删除」，分别调现有 `renameSelectedAccount` / `duplicateSelectedAccount` / `deleteSelectedAccount`。（取代原先的「选中账号详情」操作区——该详情区可删除，操作并入 kebab。）
  - 头像底色按供应商区分（见蓝图 `.avatar.codex/anthropic/deepseek/relay/copilot`），用账号 providerId 映射，未知给中性色。
- 账号为空时：保留空状态，文案用现有 `noAccounts`/`noAccountsHelp` + 「添加账号」。
- **添加账号对话框**整体保留（OAuth 内联登录流程：授权链接/打开浏览器/手动回调输入/设备码/事件列表；API Key 表单：官方/自定义来源、provider、baseUrl、apiKey、显示隐藏），按新配色与卡片风格重排，功能与校验不变。

### 供应商屏（`activeTab==="providers"`）
满宽两栏 `prov-layout`（左 264px 列表 + 右编辑表单）。把原先在侧栏里的供应商列表与「新建/复制/删除」迁进内容区：
- page-head：标题「供应商」+ 副标题；右侧主按钮「新建供应商」（`addProvider`）。
- 左列 `prov-list`：分「官方/自定义」分组，列出 `config.providers`，每项＝色块首字母 + 名称 + 摘要（认证方式/默认模型或 baseUrl）；已应用到 Pi 的项带 live 圆点；选中项高亮（驱动 `activeProviderId`）。
- 右栏 `prov-form`：现有供应商编辑器重排进卡片：
  - form-top：图标 + 供应商名 + 「已应用到 Pi」徽标（命中时）+ 「测试」「查看输出」「复制」「删除」操作。
  - 卡片「基础信息」：名称、类型(official/custom 切换)、Base URL/API 类型（按 kind 显示对应字段，沿用 `OfficialProviderForm`/`CustomProviderForm` 的字段与校验）。
  - 卡片「认证方式」：official 时三张 radio 卡（使用 Pi 现有认证 / 使用账号 / 写入 API Key，驱动 `authMode`），选「使用账号」时显示绑定账号下拉（沿用现逻辑 + 「管理账号」入口）；选「写入 API Key」显示 SecretField + 「保存为账号并绑定」。OAuth 区块（`oauthLogin` 等）保留。
  - 卡片「模型列表」：沿用 `OfficialModelSelector`/`CustomModelSelector`（刷新可用模型/拉取模型/添加/编辑/删除/默认模型选择），重排进卡片风格；默认模型选择保留。
  - form-footer：保存供应商（`saveCurrentConfig`）+ 应用到 Pi（`applyCurrentProvider`）。
- 无供应商时：保留 `noProvider` 空状态 + 新建按钮。

### 其余对话框（全部保留）
output（测试输出 + 配置路径）、删除供应商确认、模型配置、供应商高级配置、重命名账号、删除账号、OAuth 手动码——结构基本不变，套用新配色变量与按钮/输入样式，使其与新界面一致。

## 实现要求

- 用 lucide-react 现有/新增图标替代蓝图内联 SVG（如 kebab→`MoreVertical`、拖拽手柄→`GripVertical`、主题→`Sun`/`Moon`、设置→`Settings`、应用→`ArrowRight`/`Check`）。按需补 import。
- 蓝图的组件级 CSS（`.topbar/.nav-tab/.pi-strip/.row/.card/.auth-cards/.model-item/.prov-list/.toast` 等）移植进 `src/styles.css` 并在 JSX 使用；可与 Tailwind 工具类混用，跟现有风格一致即可。
- 应用应**填满 Tauri 窗口**（顶栏固定高 + 主区 flex 滚动）；**不要**套用蓝图里那个居中、max 1208×820 的浮动卡片外壳（那是独立预览用的）。
- 保持无障碍：tab 用 `role="tab"`/`aria-selected`，kebab/弹层可键盘操作与点击外部关闭。
- 保留现有响应式（窄宽度降级，见 styles.css 的 `@media`），按新布局调整。

## Out of Scope
- 不改后端、`commands.ts`、`domain.ts` 的业务逻辑。
- 不新增/删除产品功能，仅重排与改配色。

## Acceptance
1. `npx tsc --noEmit`（或 `npm run build`）通过，无类型错误。
2. 账号/供应商两屏经顶部标签切换；账号可应用、重命名、复制、删除；添加账号（OAuth 内联 + API Key）全流程可用；供应商可新建/复制/删除/编辑/保存/应用/测试/查看输出/选模型。
3. 浅色与深色（含跟随系统）均正确、好看；语言中/英切换正常。
4. 视觉与 `workbench.html` 蓝图一致（顶栏、pi-strip、富行、卡片表单、配色）。
5. 无遗留未定义 CSS 变量、无控制台报错。
