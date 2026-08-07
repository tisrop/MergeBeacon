# MergeBeacon — AGENTS.md

Tauri 2 + Vue 3 + Rust 跨平台 PR 评审与 Issue 管理桌面客户端（GitHub/GitLab/Gitee + AI 评审）。

## 代码规范

所有实现与代码评审必须遵循 [`CODE_STANDARDS.md`](CODE_STANDARDS.md)。该文件定义前端、
Rust/Tauri、跨平台语义、异步生命周期、安全、测试和合并门禁；本文件中的项目约束仍同时生效。

所有前端页面、组件和样式实现还必须遵循
[`FRONTEND_STANDARDS.md`](FRONTEND_STANDARDS.md)。该文件定义视觉语言、设计 Token、布局、
组件状态、交互、可访问性和视觉验收门禁。

## 开发者命令

```bash
pnpm run dev              # 仅前端 Vite dev server（port 1420）
pnpm run tauri dev        # 完整 Tauri 桌面应用（dev server + 原生窗口）
pnpm run build            # vue-tsc → Vite build → 400 KiB 入口包预算检查
pnpm run tauri build      # 生产构建，产物在 src-tauri/target/release/bundle/
pnpm run lint             # oxlint 静态检查
pnpm run lint:fix         # oxlint 安全自动修复
pnpm run format           # oxfmt 格式检查
pnpm run format:fix       # oxfmt 格式化
pnpm run check:version     # package / Cargo / Tauri 版本一致性
pnpm run check:updater     # updater 公钥、端点和产物配置检查
pnpm run check:ipc-contract # 前端 IPC 封装与后端命令注册表一致性
pnpm run check:bundle-size # dist 入口包、/pr 同步加载与 400 KiB 预算
pnpm run check:frontend    # 版本/updater/IPC + oxlint + oxfmt + 前端规范检查器
pnpm test                 # Vitest（Vue Test Utils + jsdom）
cd src-tauri && cargo fmt --all -- --check
cd src-tauri && cargo clippy --all-targets -- -D warnings
cd src-tauri && cargo test
cd src-tauri && cargo test github_adapter -- --nocapture
```

- `TAURI_DEV_HOST` 环境变量启用网络 HMR（默认仅 `localhost:1420`）。
- Node.js 24、pnpm 11.20.0 与 Rust 1.96.1 分别由 `.node-version`、`packageManager` 和
  `rust-toolchain.toml` 固定。
- 前端 IPC 封装在 `src/api/index.ts`（`invoke("command_name", {...})`）。**不要直接调用 Tauri API**。
- Vite 配置了 `@/` → `./src/*` 别名。

## 项目结构

```text
src/                 # Vue 3 前端（Composition API, <script setup lang="ts">）
  api/index.ts       # 唯一 IPC 入口
  types/index.ts     # 前端 TS 类型
  composables/       # useAsyncList/useAsyncRequest 等可复用请求与 UI 协调逻辑
  stores/            # 11 个 Pinia store（Auth / Capability / Repo / PR / Issue / Notification / 评审状态 / UI / Update）
  router/index.ts    # 11 条路由；/pr 首屏同步加载，其他页面按需加载
  pages/             # 9 个页面组件（含 PR/MR 创建/详情页和 Issue 创建/详情页）
  components/        # ai/ command/ diff/ inbox/ issue/ layout/ notification/ pr/ review/ shared/
  main.ts            # 挂载 Pinia + Router；HMR 时阻止恢复到 /settings
src-tauri/
  src/lib.rs         # Tauri Builder：注册 70 个 IPC 命令，设置原生菜单与桌面插件
  src/state.rs       # AppState + 更新协调与 AI/PR 状态可取消任务注册表
  src/vault.rs       # TokenVault：Keyring 优先、AES-256-GCM 文件降级
  src/local_store.rs # SQLite 评论快照缓存
  src/error_log.rs   # 脱敏错误日志、大小限制与安全轮转
  src/patch.rs       # 跨平台 patch 标准化
  src/file_content.rs # Diff 上下文与受限图片/视频媒体内容处理
  src/native_menu.rs # 本地化原生菜单与桌面入口
  src/single_instance.rs # 单实例窗口激活协调
  src/window_state.rs # 窗口位置、尺寸和最大化状态安全恢复
  src/platform/      # GitPlatform trait + GitHub/GitLab/Gitee adapter
  src/ai/            # OpenAI 兼容客户端、标准 SSE、Prompt、配置
  src/commands/      # auth / support / error_log / update / capabilities / native_menu / notification / inbox / pr / review / issue / ai
  tests/             # GitHub/GitLab/Gitee WireMock 集成测试
```

## Rust 后端要点

- `error.rs`：`CommandError` 向前端返回稳定错误码、中文消息、可重试状态、HTTP 状态和后端生成的
  `request_id`；`AppError → String` 仅保留给旧的非命令路径。
- `error_log.rs`：结构化错误同时输出到 stderr 和应用数据目录下的受限 JSONL 文件；单文件
  512 KiB、保留 3 个轮转归档，Unix 目录/文件权限分别为 `0700`/`0600`。日志只允许安全元数据，
  禁止写入 Token、API Key、仓库代码、远端正文或完整自托管地址。
- `vault.rs`：平台 Token 优先保存到系统 Keyring（service `com.mergebeacon`，账户
  `git-platform:{platform}`）；不可用时 AES-256-GCM 加密写入 `~/.mergebeacon/config.json`。
  旧 `com.mergepilot` Keyring、`~/.mergepilot/config.json` 和旧明文 Token 均采用“先成功写目标、再删旧值”迁移。不要重新引入明文 Token。
- Keyring 与凭据文件读写属于阻塞操作；异步 Tauri command 必须通过 `spawn_blocking` 执行，禁止
  阻塞 Tokio worker。
- Keyring 依赖必须保留 `apple-native`、`windows-native`、`sync-secret-service` features；无 feature
  时 keyring crate 会退化为不持久化的内存 Mock。
- `crypto.rs`：AES-256-GCM；密钥 = SHA256（应用固定值 + OS 用户名）。AI API Key 仍使用此方案。
- `platform/mod.rs`：统一 `GitPlatform` trait 和 API base 规范化；GitLab/Gitee 自托管地址要保留代理子路径。
- `capabilities_for` 是评审事件、合并策略、Fork、Issue 自动关闭和 Compare Diff 的静态能力唯一来源；
  前端不得重新维护一套平台能力常量。
- GitLab 项目路径必须编码完整 `owner/repo`，包括 nested subgroup 的每个 `/`。
- GitHub 支持 comment/approve/request_changes；GitLab/Gitee 仅支持 comment。前后端都必须拒绝不支持事件，禁止静默降级。
- GitHub、GitLab、Gitee 均支持行级评论；GitLab 创建评论前会重新获取 `diff_refs`，旧 `head_sha`
  必须明确报错并提示刷新 Diff。
- `review_inbox_list` 按平台查询“待我处理”或“我创建的”PR/MR；三个 adapter 必须保留各自的
  账号筛选语义，并返回统一的仓库上下文和分页模型。
- `pr_create_preview` 与 `pr_create` 支持三平台 PR/MR 创建；预览不完整必须显式返回状态，但不得
  将平台 Compare API 的截断变成合法大 PR/MR 的创建硬阻塞。Gitee 不支持 Draft，前后端都必须拒绝。
- PR/MR 元数据更新必须同时检查静态平台能力、Token 运行时权限和远端更新时间；部分字段写入失败
  必须保留成功结果并在详情页展示，不得把已创建的 PR/MR 伪装为整体失败。
- Issue 详情、评论和元数据管理支持三个平台；标题、描述、状态和标签写入必须检查 Token 运行时权限
  与远端更新时间。权限未知时不得开放编辑，旧详情不得覆盖远端新值。
- 收件箱条目必须保留具体 `relationships`：GitHub/GitLab 区分 Reviewer、Assignee，Gitee 区分
  评审人、测试人；“我创建的”使用 Author。重复条目合并时不得丢失关系来源。
- 三个平台的 PR / MR 搜索、筛选和排序必须统一使用 `PrListQuery`；标题、作者、标签、评审状态、
  负责人/测试者及排序语义由 adapter 映射到服务端查询。筛选、排序或仓库上下文变化时必须重置并
  隔离分页，迟到响应不得覆盖新结果。
- 普通 Open PR / MR 列表和收件箱必须复用统一状态摘要语义，区分总体合并状态、审批、CI/测试、
  Draft、冲突和具体阻塞原因；未知字段不得推断为可合并。需要补充的当前页状态统一通过
  `pr_list_statuses` 批量获取，每个批次使用 `request_id` 注册到 `AppState.pr_list_status_tasks`；新筛选、
  翻页、切换仓库或卸载时必须调用 `pr_list_statuses_cancel` 取消旧批次。GitLab/Gitee 优先使用列表字段；
  状态补充失败时必须保留基础条目并回退为未知，禁止退化为逐条 `pr_merge_readiness` 请求。
- Closed / Merged 列表不得继续请求实时审批和 CI/测试状态；详情页 `pr_merge_readiness` 仍是合并前
  的权威检查，列表摘要不得替代最终校验。
- `pr_merge_readiness` 汇总平台可提供的检查、审批、冲突、分支和权限状态；未知状态不得伪装成可合并。
- `pr_compare_diff` 的 base/head 必须通过提交版本格式校验且不得相同；`pr_file_content` 用于 Diff
  上下文展开和受限媒体预览，返回内容必须保留二进制与截断边界。普通内容上限为 1 MiB，只有受支持
  的图片/视频媒体预览可提升到 16 MiB。
- `pr_merge` 返回 `PrMergeOutcome`；合并成功后关闭关联 Issue 的失败属于部分成功，不得把合并改成失败。
- AI SSE 使用 `eventsource-stream`；事件携带 `request_id`，`AppState.ai_tasks` 管理取消句柄。
- AI Prompt 按 UTF-8 字符边界截断到约 64 KiB，禁止直接按字节切片。
- AI 结果解析只接受一个完整评审 JSON 对象；允许 Markdown fence 或前后说明，但出现多个完整对象时
  必须拒绝，避免选择冲突结果。
- Updater 只接受配置的官方端点和 Minisign 公钥；安装前必须复核用户确认的版本。Windows 便携版
  只允许打开版本化官方 ZIP，不执行应用内覆盖安装。
- 诊断信息必须脱敏自托管平台地址、非官方 AI 地址和凭证值；复制动作通过原生剪贴板插件完成。
- single-instance 必须是首个注册插件；窗口恢复只恢复位置、尺寸和最大化状态，并在显示前校正到可见区域。
- 原生菜单首次安装必须使用简体中文 fallback；界面语言变化后通过 `native_menu_set_labels` 同步完整菜单
  文案。菜单 JS bridge、路由入口和设置页 hash 必须保持一致，禁止出现仅菜单可达或跳转目标漂移。

## 前端要点

- **无 UI 框架**：手写 CSS + CSS 变量；未经沟通不要引入 Tailwind 或组件库。
- Pinia store 只能调用 `src/api/index.ts`，组件和 store 不直接 `invoke`。
- 认证、仓库选择、Fork 上下文、仓库分页均按平台隔离。切换到未登录平台时，登录链接必须携带目标平台，不能回退到其他已登录平台。
- PR/Issue/Inbox 异步请求需捕获平台、仓库、分类、筛选、排序、分页上下文和序列号；上下文改变或
  旧请求迟到时不得覆盖新状态。PR 当前页状态补充还必须校验 `request_id` 并取消旧批次。
- 仓库首次加载替换第一页；“加载更多”追加并按 `id + full_name` 去重；失败保留已有数据并可重试。
- 收件箱按平台独立维护 items/page/totalPages/loading/error/failedPage；跨平台合并按
  `platform + repository_full_name + number` 去重，并合并分类、关系来源和状态摘要；单平台失败不得
  清空其他平台数据。角色和合并状态筛选只作用于已加载条目，不得破坏平台分页与重试状态。
- 收件箱阅读状态、活动标记、筛选偏好和低频刷新属于本地增强；持久化写入必须节流，平台限流
  必须退避，通知权限撤销、轮询失败和发送失败不得静默。
- PR/MR 创建页必须隔离路由平台、目标仓库、源仓库、分支与异步请求序列；仓库级入口不得混入
  其他目标仓库，全局入口按需分页，不得串行预取全部仓库。
- AI 流式事件只消费当前 `request_id`；新评审和组件卸载必须取消旧请求并解除监听；取消不是错误提示。
- AI Panel 在详情页首次打开后保持挂载；切换页签、增量复审和建议操作不得丢失当前评审状态。
- AI 评审历史、仓库级规则和统一草稿按平台、仓库、PR/MR 与 `head_sha` 隔离保存在本地；规则是
  不可信用户输入，不得覆盖系统安全约束或触发远端操作。
- AI 结果必须记录评审 `head_sha`；提交版本变化后标记为过期，禁止定位旧建议或提交旧草稿。
- AI 建议定位使用显式请求/结果协议跳转到 Diff；路径需要兼容重命名前后名称，失败必须回到 AI
  页签并给出原因，不能把焦点留在无目标的 Diff。
- DiffViewer 使用后端标准化 patch；上下文展开通过 `pr_file_content` 获取 base/head 文件内容，
  二进制、截断或不可用内容必须显示明确限制，不得拼接出误导性 Diff。受支持的图片和视频只能在
  受限媒体上下文中预览；SVG 不得作为标记注入页面，object URL 必须及时释放，媒体加载的旧响应
  不得覆盖当前文件。
- 模型 ID、标题和错误正文等远端字符串只能作为文本渲染。Markdown 只允许通过共享
  `MarkdownRenderer` 的标签、属性和 URL 白名单清洗后使用受控 `v-html`；其他组件不得直接渲染
  远端 HTML。Markdown 视频附件只允许受限的 GitHub HTTPS host/path；加载失败必须保留原始安全链接，
  扩展来源时必须同步最小化审查 CSP `media-src`。
- oxlint 使用 `.oxlintrc.json`；禁止内联 `oxlint-disable`。oxfmt：双引号、分号、尾逗号、
  100 列宽。
- `src/main.ts` 有 `/settings` HMR 保护；原生菜单通过受控 JS bridge 跳转到新建 PR/MR、Issue、
  命令面板、设置、更新检查和诊断等入口，菜单文案必须随当前界面语言同步。
- `/pr` 是启动首屏，必须在 `src/router/index.ts` 保持静态导入；其他低频页面优先使用路由级动态导入。
  入口 JavaScript 必须保持在 400 KiB 预算内，除非评审中记录实测启动影响和不可拆分原因。
- 用户界面文案必须通过 `src/i18n/` 提供简体中文和英文资源，默认使用简体中文；AI 评审 Prompt
  必须按评审开始时捕获的意见语言生成。后端或远端返回的错误正文尚未本地化时仍按不可信文本展示。

## 测试

- 前端：Vitest + Vue Test Utils + jsdom，测试位于各模块 `__tests__/*.spec.ts`，运行 `pnpm test`。
- `.github/checks/__tests__/` 覆盖 IPC 契约和入口包体积门禁；修改命令注册、前端 IPC 封装、路由加载
  策略或包预算时必须同步更新这些测试。
- Rust：单元测试覆盖 TokenVault、UTF-8 截断、SSE、AI 响应解析、API base、patch、文件内容、
  updater 输入边界、诊断脱敏、单实例与窗口恢复；WireMock 覆盖三个平台 Adapter。
- 命名集成测试目标：`github_adapter`、`gitlab_adapter`、`gitee_adapter`。
- 涉及认证、平台切换、PR 搜索/排序/分页、状态批次取消、收件箱、Diff 上下文与媒体预览、Markdown
  附件来源、AI 生命周期/版本状态、原生菜单、更新流程或合并 outcome 时，必须同步增加回归测试。
- 提交前完整执行：

```bash
pnpm run check:frontend
pnpm run build
pnpm test
cd src-tauri
cargo fmt --all -- --check
cargo clippy --all-targets -- -D warnings
cargo test
```

## 构建与部署

- macOS bundle：`MergeBeacon.app`，identifier：`com.mergebeacon`。
- 构建前自动执行 `pnpm run build`；前端产物在 `dist/`，Rust/bundle 在 `src-tauri/target/`。
- Vite 必须生成 `dist/.vite/manifest.json`，供入口模块与包体积门禁读取；不得绕过
  `check:bundle-size` 或仅为通过检查直接提高预算。
- 生产 CSP 在 `src-tauri/tauri.conf.json`；修改网络或资源来源时同步审查 CSP，不得放宽远程脚本。
- macOS entitlement：`src-tauri/mergebeacon.entitlements`。

## 注意

- `.github/workflows/` 有 4 个工作流：`ci.yml`、`release.yml`、`issue-claim.yml`、`spam-comment-guard.yml`。
- 仓库使用 OpenSpec 工作流（`openspec/`）。规范或提案不得与当前能力声明冲突。
- 不要修改或提交无关文件；尤其不要把文档、生成物或全仓格式化混入功能提交。
- `.gitignore` 排除 `.opencode/`、`.reasonix/`、`reasonix.toml`。
