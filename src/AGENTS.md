<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-11-06 -->

# AGENTS.md — src

**Precedence:** 本文件覆盖根 `AGENTS.md` 的通用约定；离改动文件最近的 AGENTS.md 优先。

## Overview

Electron 三段式源码。数据跨进程只有一条口子：`preload` 暴露的 `windowApi`。

| 段 | 入口 | 职责 |
|----|------|------|
| main | `src/main/index.ts` | 单实例锁、窗口创建、`media://` 协议注册、退出前 checkpoint 各库 |
| main | `src/main/ipc.ts` | 薄注册壳：按域组装 handler，并导出 watcher/thumb 启动入口 |
| main | `src/main/ipc/*` | `libraries` / `assets` / `context` / `watch` / `thumbs` 分域实现；`scopeFor()` 在 `context.ts` |
| main | `src/main/events.ts` | 向渲染层推送；通道白名单同步在 `preload/index.ts` 的 `on:` 联合类型里，**加事件要两处都改**（当前：`library:scan` / `assets:changed` / `window:maximized` / `thumbs:progress`） |
| preload | `src/preload/index.ts` | `contextBridge.exposeInMainWorld('windowApi', api)`；`index.d.ts` 声明 Window 类型 |
| renderer | `src/renderer/src/App.tsx` | 启动引导、全局快捷键、Ctrl+滚轮列宽 |

## Key Files

`src/main/services/` 每个模块单一职责，改前先读对应模块：

| 模块 | 职责 |
|------|------|
| `db.ts` / `sqlite.ts` | 全局库（注册表 `libraries`、`app_state`）；`openSqlite` 使用 N-API 预编译绑定 |
| `libraryDb.ts` | 每库 `.mediahub/library.db` 的建表与句柄；`mediaDir()` 给出该目录 |
| `store.ts` | 资产/标签/库的读写与 upsert（`AssetRow`、`upsertScanned`） |
| `libResolve.ts` | 库作用域解析：`isPathWithinRoot` / `realPathWithinRoot` / `libScopeDb` |
| `libraryCreate.ts` | 建库路径白名单：只接受目录选择器近期返回的路径，并拒绝磁盘根与不存在目录 |
| `scan.ts` | 递归扫描入库（并发 8，每 20 个回调进度）；`scanPaths` 供 Eagle 复用 |
| `watch.ts` | chokidar 增量监听（`awaitWriteFinish` + 300ms 防抖，`usePolling:false`） |
| `ignore.ts` | 扩展名白名单与忽略规则（扫描/监听共用，勿另写一份） |
| `fingerprint.ts` | 缓存指纹 sha1(前 64KB + size + mtime) 截 20 位 |
| `cacheFiles.ts` | 原子写（临时文件 + rename）与 `isWithinRoot`；**所有落盘都走它，别自己 writeFile** |
| `folders.ts` | 库内文件夹增删改移、素材移动/导出，含 `..` 逃逸与保留名校验 |
| `media.ts` | `media://<libraryId>/<relPath>` 协议，支持 Range；`mimeForExtension` 是导出的纯函数 |
| `thumbs.ts` | 缩略图缓存 `<库>/.mediahub/thumbs/`：指纹命名 + `index.json` 清单；`ensureThumb` 串行队列，CSS 走离屏截图分支 |
| `palette.ts` | k-means 主色提取（worker_threads） |
| `videoMeta.ts` | ffmpeg 抽视频元数据；解析函数与进程调用分离，便于测试 |
| `textAssets.ts` | 文本素材（CSS）读写：原子替换回写 + 同步 size/fingerprint/mtime |
| `clipboardFiles.ts` | 把文件写进系统剪贴板（CF_HDROP）；**绕开 Electron clipboard，走 PowerShell Set-Clipboard** |
| `cssPreview.ts` | CSS 预览骨架的主进程侧：定位同目录同名 `.html`（纯拼接逻辑在 `src/shared/`） |
| `cssThumb.ts` | CSS 缩略图：离屏 `BrowserWindow` 渲染真实效果后截图 |
| `eagle.ts` / `legacySourceMigration.ts` | Eagle 库导入；旧库一次性迁移（**只读兼容层，勿扩展**） |
| `documentPreview.ts` | 文档只读预览唯一入口 `ensureDocumentPreview`：TXT/MD/CSV、DOC、DOCX/DOCM、XLSX/XLSM、PPTX/PPTM、XLS/XLSB/ODS/FODS、RTF、ODT/OTT、ODP；旧版 DOC 用内置 `@file-viewer/doc`，解析结果按指纹缓存在 `.mediahub/previews/documents/` |
| `documentZip.ts` / `documentMeta.ts` | OOXML 解包与解压上限、OLE 加密识别；扫描期低成本结构探测（页数/工作表数/幻灯片数） |

`src/shared/` 是跨进程共享的纯逻辑层（无 fs / 无 electron）：`types.ts` 共享类型、`cssPreview.ts` 纯字符串拼接（主进程截图与渲染层预览共用，保证两条路径视觉一致）。约定：**新文件若要被两侧同时引用，放 `src/shared/`，并确认它在两个 tsconfig 的 include 里**（当前两侧都已含 `src/shared/**/*.ts`）。

渲染层：`store/ui.ts`（zustand 单一 store，含 `restoreUiPrefs` / `showToast`）、`data/`（纯视图逻辑：`query.ts`、`empty-state.ts`、`filter-menu.ts`、`model-url.ts`、主题、预览缓存、焦点/帧批处理/框选/视口、拖拽编解码）、`components/`（每个界面块一个文件）、`styles/`（按域分 CSS，令牌在 `tokens.css`）。浮层键盘行为统一走 `components/useMenuFocus.ts`；`data/menu-focus.ts` 与 `data/pan-clamp.ts` 是不碰 DOM 的纯函数，可直接单测。`dataset.ts` 只保留标签色与推荐标签，不再提供演示素材。

## Setup & environment

- `npm install` 会下载 Electron 与 N-API 预编译模块；镜像已配在 `.npmrc`。
- 无 `.env`，无需环境变量；应用数据在 `app.getPath('userData')`。
- `npm run dev` 打开窗口，同时监听 `127.0.0.1:9223`（仅 dev，`tools/hhead.mjs` 可直接执行表达式断言）。

## Build & tests

- 类型检查：`npm run typecheck`（分 node/web 两侧，改类型边界后必跑）
- 测试：`npm run test`；单文件 `npm run test -- tests/xxx.test.ts`
- 构建：`npm run build`（main / preload / renderer 三段）
- 开发：`npm run dev`（dev 下 9223 是调试桥，`tools/hhead.mjs` 包了一层）

## Code style & conventions

- TS strict；主进程用 `node:` 前缀导入内置模块；ESM（`import.meta.url` + `createRequire` 解析原生包）。
- 中文注释写「为什么」与不变量（如指纹为何只读 64KB），不复述代码在做什么。
- 跨进程共享的纯类型放 `src/shared/types.ts`；只在一侧用的类型留在该侧。
- 渲染层不直接读盘：素材一律 `media://`（`store/ui.ts` 的 `rowToAsset` 负责拼 URL）。
- 新增界面状态默认持久化（`uiPrefs` / `preferences` / `app_state`），读取时逐字段校验、坏值回退默认。
- 新样式用 `tokens.css` 的 `--sheen-*` / `--surface` / `--dur-*` 令牌，别写字面颜色。
- 菜单、下拉、右键菜单、对话框一律接 `useMenuFocus`：挂载时**不主动聚焦**（悬停自动展开会抢键盘焦点），用户按 Tab/方向键才进入；Esc 只由最上层消费，关闭后焦点回到打开前的元素。
- 仅 hover 显形的操作按钮必须同时响应 `:focus-within`；`:focus-visible` 焦点环不得被父级 `overflow` 裁掉。灯箱图片不要加 `tabindex`/`role="button"`，否则整张图外缘会出现焦点框。

## Security & safety

- `media://` 与所有文件操作先经 `realPathWithinRoot` 校验真实路径在库根内，再读；库外一律 403。
- 建库只能消费 `dialog:pickFolder` 写入的短期白名单，并再次校验真实目录、拒绝磁盘根，见 `libraryCreate.ts`。
- SQL 只用 `prepare` 参数绑定，不拼字符串。
- `contextIsolation: true` / `nodeIntegration: false`；渲染层能力必须显式加进 preload 的 `api` 对象。
- 外部链接经 `setWindowOpenHandler` 交给系统浏览器，不在应用内打开。

## Patterns to Follow

- **加一个 IPC 能力**：在 `ipc/<domain>.ts` 加 handler（含 `libraryId` 作用域解析）→ `ipc.ts` 确认注册 → `preload/index.ts` 的 `api` 暴露；事件白名单改 `src/shared/types.ts` 的 `EventChannelMap` → 改完**重启 Electron**（HMR 不重载 preload）。
- **加一个库内文件操作**：写进 `folders.ts`，复用 `libraryPath()` 做路径校验，不要在各 handler 里自己拼路径。
- **加一个素材类型**（如已有 `.css`）：五处联动，缺一处就出现「能扫到但用不了」——
  1. `ignore.ts` 的 `EXT_WHITELIST` 加扩展名，并扩 `AssetKind` 联合类型；
  2. `src/shared/types.ts` 的 `AssetKind`/`AssetRow.type` 与 `renderer/src/data/types.ts` 的 `AssetType`/`AssetFormat` 跟随；
  3. `media.ts` 的 `MIME` 表加映射（漏了会被当 `application/octet-stream`，Chromium 只当下载）；
  4. 无位图的类型要绕开 sharp：`thumbs.ts` 的 `ensureThumb` 按 `format` 分支，并经 `thumbJobRows` 纳入预热；
  5. 渲染侧 `query.ts` 的 `matchFilters`/`infoRows`、`Card.tsx`、`FilterBar.tsx` 的格式项。
- **加一个可测的解析逻辑**：像 `videoMeta.ts` 那样把纯函数与进程调用分开导出，测试只测纯函数。
- 参照现有模块写法，别引入新范式；新增依赖前先看 `package.json` 是否已有等价能力。

## 复用清单（需要什么 → 用哪个，别重写）

| 需要 | 用这个 | 位置 | 陷阱 |
|------|--------|------|------|
| 校验路径在库根内（需解析符号链接） | `realPathWithinRoot` | `libResolve.ts` | 返回真实路径或 `null`；**文件操作一律用它**，`join` + `startsWith` 挡不住 Junction 逃逸 |
| 校验路径在根下（纯字符串，不碰盘） | `isPathWithinRoot` | `libResolve.ts` | 与 `cacheFiles.ts` 的 `isWithinRoot` 是**两个近似但不同用途**的函数：这个用于库作用域早期拒绝，那个用于缓存目录内部；改一处别以为改了全部 |
| 落盘写入 | `writeFileAtomically` | `cacheFiles.ts` | 自己 `writeFile` 会在中断时留半截文件 |
| 判断文件存在 | `fileExists` | `cacheFiles.ts` | 别用 `try { await stat() } catch`，各处写法要统一 |
| 删除文件并清理空目录 | `removeFileAndPrune` | `cacheFiles.ts` | 场景是缩略图缓存清理，别用于素材文件 |
| 扩展名 → 类型/格式 | `detectKind` / `isIgnored` | `ignore.ts` | 返回 `{ type, format }` 或 `null`（不在白名单）。扫描与监听共用，**别在别处再写一份白名单** |
| 扩展名 → MIME | `mimeForExtension` | `media.ts` | 未知扩展名兜底 `application/octet-stream`；别在协议 handler 里内联判断 |
| 内容指纹 | `fingerprint(absPath, size, mtimeMs)` | `fingerprint.ts` | 只读前 64KB + size + mtime；改算法等于全库缓存失效 |
| IPC 层库作用域解析 | `scopeFor` / `releaseScope` | `ipc/context.ts` | 每个 handler 取到 scope 后必须在 `finally` 释放；遗漏会让库句柄无法被驱逐 |
| 素材行 upsert | `upsertScanned(d, libraryId, entries)` | `store.ts` | 返回逐条结果数组；保留 id/标签/评分/文件夹，只更新变化字段 |
| 预览 HTML 拼接 | `buildPreviewHtml` / `stripScripts` / `shellFromCss` | `src/shared/cssPreview.ts` | 主进程截图与渲染层预览**必须共用这一份**，否则两条路径视觉漂移 |
| 浮层键盘导航与焦点归还 | `useMenuFocus` / `nextMenuIndex` | `renderer/src/components/useMenuFocus.ts`、`renderer/src/data/menu-focus.ts` | 挂载时不要主动聚焦；嵌套浮层的 Esc 只由栈顶消费，关闭时焦点回到触发元素 |
| 缩放后平移的边界 | `clampPanOffset` | `renderer/src/data/pan-clamp.ts` | 变换原点不在中心时上下界不对称；`scale <= 1` 必须把偏移归零 |
| 界面偏好持久化 | `persistUiPrefs` / `parseNav` | `renderer/src/store/ui.ts` | 模块私有函数；读取时逐字段校验、坏值回退默认 |

## 缩略图缓存约定

`<库>/.mediahub/thumbs/` 是**缓存**，权威来源始终是库内数据库的 `assets` 表。

| 规则 | 原因 |
|------|------|
| 文件名 = `${指纹}-${THUMB_SIZE}.jpg`（内容 + 尺寸寻址） | 原图移动/改名后缓存继续有效；改尺寸自然生成新文件，旧尺寸变孤儿由对账清理 |
| 删除前先查 `fingerprintInUse` | 同内容素材共用一张图，直接删会误伤仍在引用的素材 |
| `index.json` 记 `version` + `size`，不匹配即整体作废 | 换渲染算法或尺寸时不致新旧混淆、网格出现模糊图 |
| 写入走 `cacheFiles.ts` 的原子路径 | 中断不会留下半截 JPEG |

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
- [ ] 改了原生依赖 → `npm run test` 与 Electron 冒烟均通过
- [ ] 改了 preload → 完整重启验证过，不是只看 HMR
- [ ] 无遗留调试输出与临时断言
- [ ] 未提交 `out/`、`artifacts/`、`素材/`

## When stuck

- 先看 `docs/ARCHITECTURE.md` 与 `openspec/specs/<能力>/spec.md`，再看根 `AGENTS.md` 的「非显然的坑」表。
- 运行时报错且现象诡异（方法 undefined、库打不开）→ 先确认 preload 已完整重启、原生预编译包安装完整。
- 仓库里的旧 proposal / change delta 可能仍在描述已删除的「索引外部目录」语义，别照它实现。
