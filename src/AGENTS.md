<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-09-21 -->

# AGENTS.md — src

**Precedence:** 本文件覆盖根 `AGENTS.md` 的通用约定；离改动文件最近的 AGENTS.md 优先。

## Overview

Electron 三段式源码。数据跨进程只有一条口子：`preload` 暴露的 `windowApi`。

| 段 | 入口 | 职责 |
|----|------|------|
| main | `src/main/index.ts` | 单实例锁、窗口创建、`media://` 协议注册、退出前 checkpoint 各库 |
| main | `src/main/ipc.ts` | 全部 `ipcMain` handler；库作用域解析 `scopeFor()` 在此 |
| main | `src/main/events.ts` | 向渲染层推送（`library:scan` / `assets:changed` / `window:maximized`） |
| preload | `src/preload/index.ts` | `contextBridge.exposeInMainWorld('windowApi', api)`；`index.d.ts` 声明 Window 类型 |
| renderer | `src/renderer/src/App.tsx` | 启动引导、全局快捷键、Ctrl+滚轮列宽 |

## Key Files

`src/main/services/` 每个模块单一职责，改前先读对应模块：

| 模块 | 职责 |
|------|------|
| `db.ts` / `sqlite.ts` | 全局库（注册表 `libraries`、`app_state`）；`openSqlite` 按 ABI 选原生二进制 |
| `libraryDb.ts` | 每库 `.mediahub/library.db` 的建表与句柄；`mediaDir()` 给出该目录 |
| `store.ts` | 资产/标签/库的读写与 upsert（`AssetRow`、`upsertScanned`） |
| `libResolve.ts` | 库作用域解析：`isPathWithinRoot` / `realPathWithinRoot` / `libScopeDb` |
| `scan.ts` | 递归扫描入库（并发 8，每 20 个回调进度）；`scanPaths` 供 Eagle 复用 |
| `watch.ts` | chokidar 增量监听（`awaitWriteFinish` + 300ms 防抖，`usePolling:false`） |
| `ignore.ts` | 扩展名白名单与忽略规则（扫描/监听共用，勿另写一份） |
| `fingerprint.ts` | 缓存指纹 sha1(前 64KB + size + mtime) 截 20 位 |
| `folders.ts` | 库内文件夹增删改移、素材移动/导出，含 `..` 逃逸与保留名校验 |
| `media.ts` | `media://<libraryId>/<relPath>` 协议，支持 Range |
| `palette.ts` | k-means 主色提取（worker_threads） |
| `videoMeta.ts` | ffmpeg 抽视频元数据；解析函数与进程调用分离，便于测试 |
| `eagle.ts` / `legacySourceMigration.ts` | Eagle 库导入；旧库一次性迁移（**只读兼容层，勿扩展**） |

渲染层：`store/ui.ts`（zustand 单一 store，含 `restoreUiPrefs`）、`data/`（`dataset.ts` 演示快照 / `query.ts` 过滤与格式化 / `theme.ts` 主题）、`components/`（每个界面块一个文件）、`styles/`（按域分 CSS，令牌在 `tokens.css`）。

## Setup & environment

- `npm install` 后如原生模块报错，跑 `npm run rebuild:native:dual`；镜像已配在 `.npmrc`。
- 无 `.env`，无需环境变量；应用数据在 `app.getPath('userData')`。
- `npm run dev` 打开窗口，同时监听 `127.0.0.1:9223`（仅 dev，`tools/hhead.mjs` 可直接执行表达式断言）。

## Build & tests

- 类型检查：`npm run typecheck`（分 node/web 两侧，改类型边界后必跑）
- 测试：`npm run test`；单文件 `npm run test -- tests/xxx.test.ts`
- 原生重建：`npm run rebuild:native:dual`（动 better-sqlite3 / sharp 后必跑）
- 开发：`npm run dev`（dev 下 9223 是调试桥，`tools/hhead.mjs` 包了一层）

## Code style & conventions

- TS strict；主进程用 `node:` 前缀导入内置模块；ESM（`import.meta.url` + `createRequire` 解析原生包）。
- 中文注释写「为什么」与不变量（如指纹为何只读 64KB），不复述代码在做什么。
- 跨进程共享的纯类型放 `src/shared/types.ts`；只在一侧用的类型留在该侧。
- 渲染层不直接读盘：素材一律 `media://`（`store/ui.ts` 的 `rowToAsset` 负责拼 URL）。
- 新增界面状态默认持久化（`uiPrefs` / `preferences` / `app_state`），读取时逐字段校验、坏值回退默认。
- 新样式用 `tokens.css` 的 `--sheen-*` / `--surface` / `--dur-*` 令牌，别写字面颜色。

## Security & safety

- `media://` 与所有文件操作先经 `realPathWithinRoot` 校验真实路径在库根内，再读；库外一律 403。
- SQL 只用 `prepare` 参数绑定，不拼字符串。
- `contextIsolation: true` / `nodeIntegration: false`；渲染层能力必须显式加进 preload 的 `api` 对象。
- 外部链接经 `setWindowOpenHandler` 交给系统浏览器，不在应用内打开。

## Patterns to Follow

- **加一个 IPC 能力**：`ipc.ts` 加 handler（含 `libraryId` 作用域解析）→ `preload/index.ts` 的 `api` 暴露 → `windowApi` 类型自动跟随 → 改完**重启 Electron**（HMR 不重载 preload）。
- **加一个库内文件操作**：写进 `folders.ts`，复用 `libraryPath()` 做路径校验，不要在各 handler 里自己拼路径。
- **加一个可测的解析逻辑**：像 `videoMeta.ts` 那样把纯函数与进程调用分开导出，测试只测纯函数。
- 参照现有模块写法，别引入新范式；新增依赖前先看 `package.json` 是否已有等价能力。

## Examples

好与坏对照（本仓库真实约定）：

```ts
// 好：路径先过库根校验，再读
const real = await realPathWithinRoot(lib.path, abs)
if (!real) return new Response('forbidden', { status: 403 })

// 坏：直接 join 后读盘，`..` 可逃出库外
const abs = join(lib.path, relPath)
```

```ts
// 好：解析逻辑导出为纯函数，进程调用另包一层
export function parseVideoMetaText(out: string): VideoMeta { /* ... */ }
export function probeVideo(absPath: string): Promise<VideoMeta> { /* execFile */ }

// 坏：把 execFile 与解析写在一起，测试必须起真实进程
```

## PR/commit checklist

- [ ] `npm run typecheck` 通过（贴出输出）
- [ ] `npm run test` 通过；新逻辑有对应测试
- [ ] 改了原生依赖 → 跑过 `npm run rebuild:native:dual`
- [ ] 改了 preload → 完整重启验证过，不是只看 HMR
- [ ] 无遗留调试输出与临时断言
- [ ] 未提交 `out/`、`artifacts/`、`素材/`

## When stuck

- 先看 `docs/ARCHITECTURE.md` 与 `openspec/specs/<能力>/spec.md`，再看根 `AGENTS.md` 的「非显然的坑」表。
- 运行时报错且现象诡异（方法 undefined、库打不开）→ 多半是 preload 未重启或 better-sqlite3 ABI 不匹配，先按根文件那两条排查。
- 仓库里的旧 proposal / change delta 可能仍在描述已删除的「索引外部目录」语义，别照它实现。
