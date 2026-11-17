## 任务边界

Ponytail 技能已安装在本机，编码任务默认遵循其懒惰阶梯：YAGNI、优先复用已有代码、标准库、原生平台特性和已装依赖，写出最短可用实现；强度档位与开关以 `/ponytail [lite|full|ultra|off]` 命令为准。本条规则本身就是注入机制，不依赖额外 hook。

## Environment

- Shell is Windows PowerShell, not bash. Use `2>$null` / `-ErrorAction SilentlyContinue`, `Select-Object -First N`, `Select-String`, `Get-ChildItem`; not `2>/dev/null`, `head`, `grep`, `sed`, `ls -la`.
- Paths may contain CJK and spaces. Always use `-LiteralPath`; keep console/file I/O UTF-8.
- Approval is `never` and sandbox is `danger-full-access`. Nothing will stop you; your judgment is the only guardrail.

## Hard rules

- Never recursive-delete or move outside the stated target; resolve the absolute path first.
- Never `git push`, `git reset --hard`, or rewrite remote history unprompted.
- Never edit lockfiles or bump a major dependency unprompted.
- Never weaken, skip, or delete a test to make it pass.
- Never claim a check passed without running it and showing the output.
- Disclose unverified items and remaining risks; omitting them is a failure.

## Scope

- Change only what the task names. No drive-by refactors or reformatting.
- Before inventing a pattern, read at least 2 similar modules in the tree and match them.
- Reuse helpers already in the tree; add a dependency only when nothing installed covers it.
- After 3 failed attempts on the same error, stop and report: reproduction, hypotheses ruled out, blocker.

## Test hygiene

- Test one behavior at one layer only: if integration tests cover it, skip e2e; one-off verification uses throwaway scripts, not the suite.
- Closing checklist must include removing all debug output (console.log etc.) and temporary assertions from files touched in this change, not just cleaning temp directories.

## OpenSpec 接手

新会话开始处理任务前，如果项目根目录存在 `openspec/`，先运行 `openspec list --json` 和 `openspec list --specs --json` 查看当前进行中的 change 和已有 spec，结合任务判断是否需要继续某个 change 或创建新 change。已有 change 且 tasks 有未完成项时，使用 `openspec-apply-change` 继续；tasks 全部完成时提示用户归档。
<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-11-17 -->

# AGENTS.md

MediaHub 素材管理器 — 本地优先的 Electron 桌面应用（Electron 44 · electron-vite 6 · React 18 · TS 5.9 · Vitest 4）。
写给 AI 代理；架构细节见 `docs/ARCHITECTURE.md`，格式能力与验证记录见 `docs/FORMAT_SUPPORT.md`，能力规范见 `openspec/specs/`。

**Precedence:** 离改动文件最近的 `AGENTS.md` 优先（closest AGENTS.md wins）；根文件只放全局约定。

## Commands

| Task | Command | 说明 |
|------|---------|------|
| 安装 | `npm install` | 下载 Electron 与 N-API 预编译原生模块 |
| 开发 | `npm run dev` | electron-vite dev；dev 下 9223 是无头调试桥 |
| 类型检查 | `npm run typecheck` | node + web 两侧 tsc --noEmit |
| 测试 | `npm run test` | 逐文件运行 vitest，避免原生模块跨进程累积 |
| 单测 | `npm run test -- tests/xxx.test.ts` | 参数追加给 vitest，只跑一个文件 |
| 构建 | `npm run build` | 产物在 out/ |
| 预览 | `npm start` | 启动 electron-vite preview |
| 双击启动 | `启动.bat` | 先 cd 到脚本目录再跑 dev |
| 隔离实机验证 | `$env:MEDIAHUB_TEST_USER_DATA='<tmp>'; $env:MEDIAHUB_TEST_BRIDGE_PORT=9231; npx electron . --remote-debugging-port=9222` | 独立 userData + 调试桥；token 在 `<userData>/debug-bridge-token`，用 `http://127.0.0.1:9231/<token>/<js>` 驱动渲染层 |

## Structure

```
src/main/           主进程：index.ts 生命周期/窗口、ipc.ts 注册壳、ipc/* 分域 handler 与目录树缓存、events.ts 推送
src/main/services/  单一职责服务（库/扫描/监听/缩略图/文档与外部预览/导入/跨库传输/…）
src/shared/         跨进程共享的纯逻辑（无 fs / 无 electron），两侧 tsconfig 都 include
src/preload/        contextBridge 暴露 windowApi
src/renderer/src/   React：components（界面块）/ data（纯视图逻辑）/ store（zustand）/ styles
tests/              vitest 用例（69 个 .test.ts）   tools/ 开发与无头验证脚本   openspec/ 规范
```

## Scoped AGENTS.md (MUST read when working in these directories)

- [src/AGENTS.md](./src/AGENTS.md) — 主进程 / 预加载 / 渲染进程约定与模块地图
- [tests/AGENTS.md](./tests/AGENTS.md) — 测试约定

## 非显然的坑（改前必读）

| 症状 | 真相 |
|------|------|
| `npm install` 后 Electron 报 `failed to install correctly` | Electron 二进制未下载完整；重新执行 `npx install-electron`，`.npmrc` 已配置国内镜像 |
| 新加的 windowApi 方法在渲染层是 undefined | HMR 只重载渲染层；改 preload 必须完整重启 Electron |
| 窗口拖不动 / 浮层点了没反应 | 标题栏拖拽由 Titlebar.tsx 的 openMenu 决定；任何覆盖顶部 40px（`--h-title`）的浮层都会吃掉拖拽区 |
| 改了主题却玻璃发灰 | 新表面要用 tokens.css 的 --sheen-* / --surface 令牌；用了 backdrop-filter 就得补 :root[data-theme="dark"] 对应规则 |
| `npm run dev` 报 `Cannot read properties of undefined (reading 'registerSchemesAsPrivileged')` | 环境里带了 `ELECTRON_RUN_AS_NODE=1`，Electron 退化成纯 Node；启动前 `Remove-Item Env:ELECTRON_RUN_AS_NODE` |
| 生产构建卡片缩略图全 403 | `file://` 页面请求 `media://` 时 Chromium 会清空 Referer；`media.ts` 仅在无 `ELECTRON_RENDERER_URL` 的生产文档允许空 Referer，dev 仍校验精确 origin |
| 用 settings 写的 `background-image` 在菜单上不生效 | `.glass-menu` 的 `background` **简写**会把它重置成 none，且深色主题那条 `:root[data-theme="dark"] .glass-menu` 特异性更高。改用伪元素，别跟简写抢 |
| 状态已更新但组件不出现（如右键菜单） | Hook 被放在了 `if (!x) return null` 之后——两次渲染 hook 数量不一致，React 抛错并丢弃整个子树。所有 hook 必须在早退之前 |
| 菜单 Esc 一次关两层、关闭后焦点丢失 | 各浮层自己写 keydown 会互相抢事件。统一接 `useMenuFocus`（`src/renderer/src/components/`），它按栈只让最上层处理 Esc，并把焦点还给打开前的元素 |
| prod 构建里 `window.__ui` 是 undefined | 那是设计：`App.tsx` 用 `import.meta.env.DEV` 守卫，只在 dev 暴露 store。生产验证改走真实 UI 路径 |
| 切库/启动时侧栏目录树要等几秒 | `folders:list` 在主进程按库缓存（`src/main/ipc/folderListCache.ts`）；目录增删改名、导入、跨库传输、watcher 全量事件后必须 `invalidateFolderList(libraryId)`。别改成全局单缓存 |
| `assets:list` 比数据库少一批 | 有意过滤 `missing=1`（回收站除外）；`assets:rows` 同口径。缺失行只用于回收站清理，别为了“完整”放回主列表 |
| 启动/切库后仍慢、后台库把前台拖住 | 启动对账每库每次只跑一次且延迟 15s，root watcher 延迟 5s 挂载；`library:scan` / `assets:changed` 只刷新同库，后台库变更只标脏。别把对账/监听挪回启动同步路径 |
| 跨库剪切后丢评分/标签，或 CSS 只剩裸样式 | 统一走 `src/main/services/assetTransfer.ts`：复制 → 目标库入库 → 迁用户数据；CSS 会带同目录同名 `.html`；两库根互相嵌套直接拒绝。别在 handler 里手写 `copyFile` |
| 素材文件明明在盘上却一直显示缺失、侧栏 0 | `missing=1` 的行只有再被扫描写回才会复活；`upsertScanned` 判 `unchanged` 必须带上 `missing`，否则跳过 UPDATE 后缺口永远清不掉 |
| 移动/剪切后源库留一个 0 件空文件夹 | 搬完要摘空目录（`assets.ts` 的 `pruneEmptiedFolders`）并失效**源库**目录清单缓存；只失效目标库会让空壳在侧栏一直挂着 |
| HTML 缩略图/预览空白 | HTML 是网页：缩略图渲染原文件，预览回 `media://` 原文件给沙箱 iframe；不要走文档清洗（脚本会被剥掉） |

## Boundaries

- 改动后跑 `npm run typecheck`；测试只写一层（集成测试能说清的不要再写 e2e），一次性验证用临时脚本且不进套件。
- 新增任何界面状态（开关 / 视图 / 面板可见性）默认走持久化（`uiPrefs` / `preferences` / `app_state`），重启后必须还在。
- 素材只经 `media://` 协议读（services/media.ts 用 realPathWithinRoot 兜底），不要让渲染层直接读盘。
- 不要提交 `out/`、`node_modules/`、`artifacts/`、`素材/`；路径含中文与空格，PowerShell 用 `-LiteralPath`。
- 别再造「索引外部目录」：该概念已删除，`index_sources` / `source_index_id` 仅是旧库迁移的兼容层。
