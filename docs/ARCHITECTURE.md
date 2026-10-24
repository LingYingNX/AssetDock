# Architecture — MediaHub

MediaHub 素材管理器是一款本地优先的 Electron 桌面应用，用 electron-vite 组织主/预加载/渲染三段构建，React 驱动界面，better-sqlite3 管理素材库。

## Process Model

| Process | Entry | Role |
| --- | --- | --- |
| main | `src/main/index.ts` | 窗口/生命周期、创建 IPC handler（`ipc.ts`）、绑定事件（`events.ts`） |
| preload | `src/preload/index.ts` | 经 `contextBridge` 暴露受控 API；`index.d.ts` 声明类型 |
| renderer | `src/renderer/index.html` → `src/App.tsx` | React 界面，仅经 preload API 访问主进程 |

数据跨进程只有一种口子：preload API。跨进程共享的纯类型在 `src/shared/types.ts`，格式能力清单位于 `src/shared/formats.ts`。

## Main Process

IPC 与事件入口：`index.ts`、`ipc.ts`、`events.ts`。业务逻辑拆成 `src/main/services/`，每个模块职责单一：

- `db.ts` / `sqlite.ts` / `libraryDb.ts`：SQLite 库与工作库
- `scan.ts` / `media.ts` / `formatProbe.ts`：素材扫描、媒体协议与格式元数据探测
- `cacheFiles.ts` / `fingerprint.ts`：缩略图缓存与文件指纹
- `videoMeta.ts` / `ffmpeg.ts`：ffmpeg 视频元数据与受控子进程
- `thumbnailDecoder.ts` / `thumbs.ts` / `modelThumb.ts`：缩略图路由、缓存和三维离屏封面
- `aiPreview.ts` / `transcode.ts`：AI 页面缓存与视频按需转码
- `externalTools.ts` / `externalPreview.ts`：Blender/Cinema 4D 探测与 BLEND 预览缓存
- `eagle.ts` / `legacySourceMigration.ts`：Eagle 库导入与旧源迁移
- `folders.ts` / `ignore.ts` / `libResolve.ts`：目录、忽略规则、库解析
- `store.ts` / `watch.ts`：应用状态与 chokidar 文件监视

## Renderer

状态用 zustand（`src/renderer/src/store/ui.ts`）。数据访问走 `src/renderer/src/data/`（`dataset.ts`、`query.ts`、`types.ts` 及拖拽辅助）。组件在 `src/renderer/src/components/`：3D 预览（`Cube3D.tsx`、`Viewer3D.tsx`，基于 `three`）、网格/虚拟列表（`Grid.tsx` + `@tanstack/react-virtual`）、检视器/灯箱/过滤/偏好等面板。样式为多个分域 CSS（`styles/*.css`），`public/gltf/draco` 提供 GLTF Draco 解码器。

## Data & Build

- 库：better-sqlite3（自带 N-API 跨运行时预编译绑定，无需按 Electron ABI 重建）。
- 元数据：每个库仅使用 `.mediahub/library.db` 作为权威源；缩略图、AI 页面、BLEND GLB 和转码都是可重建缓存。
- 媒体：sharp、pdfjs-dist、ag-psd、heic-convert、three.js、ffmpeg-static；BLEND/C4D 可选依赖本机软件。
- 构建：electron-vite（main/preload/renderer 三入口），脚本见 `package.json`。
- 类型：`tsconfig.node.json`（main/preload）与 `tsconfig.web.json`（renderer）双侧。

## Agent Notes

- 改动先 `npm run typecheck`；涉及原生模块再跑 `npm run test` 与 Electron 冒烟。
- 跨进程通信只经 preload API；新增能力先理清 main/renderer 边界。
- 格式支持、缓存位置与已验证边界见 `docs/FORMAT_SUPPORT.md`。
- `AGENTS.md` 是索引，细节放这里。
