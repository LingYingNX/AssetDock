<!-- Managed by agent: keep sections and order; edit content, not structure. Last updated: 2026-11-18 -->

# AGENTS.md — tests

**Precedence:** 本文件覆盖根 `AGENTS.md` 的通用约定；离改动文件最近的 AGENTS.md 优先。

## Overview

vitest 用例，直接 import `src/` 下的真实模块（无 fixtures 目录）。`vitest.config.mts` 将 `sharp` / `better-sqlite3` 外置给 Node 加载，因此**测试文件放 `tests/` 顶层**，import 路径用 `../src/...`。

覆盖对象是**主进程的纯逻辑与文件/库行为**，外加渲染层的纯函数（`query.ts`、`folder-drag.ts`、`ui.ts` 的 `rowToAsset`）。React 组件与真实 Electron 窗口不在测试范围内。

`vi.mock` 是例外而非常规：只有被测分支会牵动真实 Electron（`BrowserWindow` 离屏截图）时才用，目前仅 `cssThumb.test.ts` 一处。解码顺序改用导出的 `decodeThumbnailSourceWith()` 注入 decoder；其余一律注入或断言纯函数——**不要在别处照抄这个 mock 写法**。

## Key Files

| 文件 | 覆盖 |
|------|------|
| `scan.test.ts` / `scanFormats.test.ts` / `ignore.test.ts` / `fingerprint.test.ts` | 扫描分批与进度、扩展名白名单与忽略规则、缓存指纹 |
| `dbMigration.test.ts` / `libraryCreate.test.ts` | schema 迁移可重放、建库路径白名单/磁盘根拒绝/过期 |
| `watch.test.ts` | chokidar 监听：`usePolling:false`、外部重命名后回调 |
| `folders.test.ts` | 库内文件夹增删改移、素材移动、`exportLibraryAsset` 同名避让 |
| `moveAssets.test.ts` | 批量移动成功子集落库，保留 id、标签和评分 |
| `fileImport.test.ts` / `assetTransfer.test.ts` | 外部拖入路径归一化/同名避让/HTML 导入；跨库复制/剪切、元数据与 CSS 配套 HTML、嵌套库拒绝 |
| `libraryConsistency.test.ts` | 同名相对路径在不同库间隔离、`realPathWithinRoot` 越界拦截、迁移 |
| `store` 相关（`eagle` / `legacySourceMigration`） | Eagle 导入与旧库一次性迁移 |
| `palette.test.ts` / `meta.test.ts` | k-means 主色、ffmpeg 文本解析（纯函数） |
| `query.test.ts` / `folderDrag.test.ts` / `uiStore.test.ts` | 渲染层纯函数、筛选/灯箱导航与 `rowToAsset` 的 URL 拼装 |
| `menuFocus.test.ts` / `panClamp.test.ts` / `assetDrag.test.ts` | 菜单方向键落点与越界循环、缩放平移的双向边界、Windows/UNC 路径到 Chromium DownloadURL 的编码 |
| `emptyState.test.ts` / `filterBar.test.ts` / `duration.test.ts` / `modelUrl.test.ts` | 空态出口、标签菜单、时长进位、glTF 外部资源基准 URL |
| `cssPreview.test.ts` | 预览 HTML 拼接：脚本剥离、CSP 注入、`</style>` 转义、由选择器反推骨架、同名 HTML 优先、内置骨架兜底 |
| `cssThumb.test.ts` | CSS 缩略图分支：用 `vi.mock` 替掉离屏渲染器，断言「CSS 走渲染器而非 sharp」与失败回退占位图 |
| `textAssets.test.ts` | 文本素材读写：越界路径拒绝、原子回写后 size/fingerprint 同步 |
| `mime.test.ts` | `mimeForExtension` 的扩展名映射（含 CSS/HTML/TXT 与未知扩展名兜底） |
| `clipboardFiles.test.ts` | 剪贴板路径的 PowerShell 数组转义（单引号双写，路径含单引号时不致整条命令失败） |
| `thumbs.test.ts` | 缩略图缓存：指纹命名、清单对账、`fingerprintInUse` 不误删共用缓存、CSS 纳入预热集合 |
| `thumbsDb.test.ts` | 缩略图任务选行：CSS/位图纳入，SVG/HTML/视频/3D/回收站/缺失项排除；共享指纹延迟删缓存 |
| `cacheOrphans.test.ts` | 派生缓存孤儿清理：单文件/页图/转码 MP4 的指纹解析、活指纹保留、`tmp-` 目录跳过、目录缺失不抛错 |
| `htmlThumb.test.ts` | HTML 缩略图走原文件整页渲染，`.htm` 归一为 HTML |
| `thumbnailDecoder.test.ts` / `imagePreview.test.ts` | 按注册表路由缩略图解码、原生失败后 ffmpeg 回退、视频关键帧失败后首帧回退、PSD/HEIC 灯箱大图缓存 |
| `documentPreview.test.ts` / `documentMeta.test.ts` / `formats.test.ts` | 文档只读预览：TXT/MD/CSV、DOC、DOCX/DOCM、XLSX/XLSM、PPTX/PPTM、XLS/XLSB/ODS/FODS、RTF、ODT/OTT、ODP 的解析、缓存、失败分类与格式注册 |

## Setup & environment

- 前置：`npm run test` 会逐文件运行 `tools/run-tests.mjs`，避免原生模块跨测试进程累积。
- 只用内存库：`openMemoryDb()`（全局库）与 `openMemoryLibDb()`（每库库），不要碰真实 `userData`。
- 需要真实文件系统时用临时目录 + `afterEach` 清理：

```ts
let root = ''
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mediahub-xxx-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
```

## Running tests

- 全部：`npm run test`
- 单文件：`npm run test -- tests/folders.test.ts`（`--` 之后的参数转给 vitest）

## Code style & conventions

- 一个 `describe` 对应一个模块/能力，`it` 名直接描述预期行为，可用中文（现有用例混用中英）。
- 断言行为不测实现细节：`folders.test.ts` 断言返回值与磁盘结果，不 spy 内部函数。
- 每个用例自建数据、自清理，不共享可变状态（`beforeEach` 建临时目录，`afterEach` 删）。
- 需要伪造全局对象时用 `vi.stubGlobal`（见 `uiStore.test.ts` 给 `window.windowApi` 打桩），不要往模块里塞开关。
- 需要注入时间/IO 时，优先让被测模块把纯函数导出（如 `videoMeta.ts` 的 `parseVideoMetaText`），测试只测纯函数。
- 同一行为只在一层写测试：能用单元测试说清的，不再补 e2e。

## Security & safety

- 用例只碰 `mkdtemp(tmpdir())` 与内存库，绝不读写真实 `userData` 或用户的 `素材/` 目录。
- 不把真实凭据、绝对个人路径写进断言或 fixture（现有用例里出现的绝对路径仅为演示数据）。
- 测路径越界行为时用临时目录构造符号链接/`..` 场景（见 `libraryConsistency.test.ts`），不要拿真实目录试。

## Examples

```ts
// 好：每个用例自建临时目录并清理，断言行为
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'mediahub-folders-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
it('rejects moving a folder into itself', async () => {
  await expect(moveLibraryFolder(root, 'a', 'a/b')).rejects.toThrow('不能移动到自身或子文件夹')
})

// 坏：模块级共享目录 + 只断言内部调用次数，跨用例互相污染
```

## PR/commit checklist

- [ ] `npm run test` 全绿（贴出输出）
- [ ] 新增/改动的行为有对应用例；没有为了通过而放宽或删除断言
- [ ] 新用例无临时目录残留、无遗留 `console.log`
- [ ] 涉及原生模块的用例在 Electron 与 Node 两侧都可加载

## When stuck

- `ERR_DLOPEN_FAILED` / 打不开库 → 先重新安装依赖，确认 N-API 预编译包完整。
- 用例只在单独跑时通过 → 检查是否共享了模块级可变状态（如 `watch.ts` 的 `debounces` 表）；用到每库数据库句柄时按 `libraryConsistency.test.ts` 的做法在收尾调 `closeAllLibHandles()`。
- 用例依赖真实 Electron 能力（`protocol` / `BrowserWindow`）→ 那类行为不在本套件覆盖，改走根 `AGENTS.md` 里的 9223 无头调试桥验证。
