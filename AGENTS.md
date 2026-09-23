<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-09-21 -->

# AGENTS.md

MediaHub 素材管理器 — 本地优先的 Electron 桌面应用（Electron 33 · electron-vite 2 · React 18 · TS 5.6 · Vitest 4）。
写给 AI 代理；架构细节见 `docs/ARCHITECTURE.md`，能力规范见 `openspec/specs/`。

**Precedence:** 离改动文件最近的 `AGENTS.md` 优先（closest AGENTS.md wins）；根文件只放全局约定。

## Commands

| Task | Command | 说明 |
|------|---------|------|
| 开发 | `npm run dev` | electron-vite dev；dev 下 9223 是无头调试桥 |
| 类型检查 | `npm run typecheck` | node + web 两侧 tsc --noEmit |
| 测试 | `npm run test` | 先 ensure 原生双 ABI，再 vitest run |
| 单测 | `npm run test -- tests/xxx.test.ts` | 参数追加给 vitest，只跑一个文件 |
| 构建 | `npm run build` | 产物在 out/ |
| 原生重建 | `npm run rebuild:native:dual` | 动原生依赖后必跑 |
| 双击启动 | `启动.bat` | 先 cd 到脚本目录再跑 dev |

## Structure

```
src/main/           主进程：index.ts 生命周期/窗口、ipc.ts 全部 handler、events.ts 推送
src/main/services/  单一职责服务（db/store/scan/watch/media/folders/palette/…）
src/preload/        contextBridge 暴露 windowApi；src/renderer/src/ 为 React（components/data/store/styles）
tests/              vitest 用例   tools/ 开发与无头验证脚本   openspec/ 规范
```

## Scoped AGENTS.md (MUST read when working in these directories)

- [src/AGENTS.md](./src/AGENTS.md) — 主进程 / 预加载 / 渲染进程约定与模块地图
- [tests/AGENTS.md](./tests/AGENTS.md) — 测试约定

## 非显然的坑（改前必读）

| 症状 | 真相 |
|------|------|
| `node -e "require('better-sqlite3')"` 报 ERR_DLOPEN_FAILED | 双 ABI：默认二进制是 Electron ABI。查库用 npx electron 跑 .cjs 脚本，且脚本必须放在项目目录内才能解析依赖 |
| 新加的 windowApi 方法在渲染层是 undefined | HMR 只重载渲染层；改 preload 必须完整重启 Electron |
| 窗口拖不动 / 浮层点了没反应 | 标题栏拖拽由 Titlebar.tsx 的 openMenu 决定；任何覆盖顶部 48px 的浮层都会吃掉拖拽区 |
| 改了主题却玻璃发灰 | 新表面要用 tokens.css 的 --sheen-* / --surface 令牌；用了 backdrop-filter 就得补 :root[data-theme="dark"] 对应规则 |

## Boundaries

- 改动后跑 `npm run typecheck`；测试只写一层（集成测试能说清的不要再写 e2e），一次性验证用临时脚本且不进套件。
- 新增任何界面状态（开关 / 视图 / 面板可见性）默认走持久化（`uiPrefs` / `preferences` / `app_state`），重启后必须还在。
- 素材只经 `media://` 协议读（services/media.ts 用 realPathWithinRoot 兜底），不要让渲染层直接读盘。
- 不要提交 `out/`、`node_modules/`、`artifacts/`、`素材/`；路径含中文与空格，PowerShell 用 `-LiteralPath`。
- 别再造「索引外部目录」：该概念已删除，`index_sources` / `source_index_id` 仅是旧库迁移的兼容层。
