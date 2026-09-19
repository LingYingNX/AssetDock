# AGENTS.md

> MediaHub 素材管理器 — Electron + React + TypeScript 桌面应用（electron-vite）。
> 本文档写给 AI 代理/自动化工具；人类可读文档见 `docs/`。

## Project

- **name:** mediahub — v0.1.0
- **stack:** Electron 33 · electron-vite 2 · React 18 · TypeScript 5.6 · Vite 5 · Vitest 4
- **key deps:** `better-sqlite3`（本地库）、`sharp`（缩略图）、`ffmpeg-static`（视频元数据）、`three`（3D 预览）、`zustand`（前端状态）、`lucide-static`（图标）、`@tanstack/react-virtual`（虚拟列表）、`chokidar`（文件监听）

## Commands

| Command | What it does |
|---------|--------------|
| `npm run dev` | 启动 Electron 开发（`electron-vite dev`） |
| `npm run build` | 构建到 `out/` |
| `npm run start` | electron-vite preview |
| `npm run test` | 先跑 `node tools/rebuild-native-dual.mjs --ensure`，再 `vitest run` |
| `npm run rebuild:native` | 为 better-sqlite3 electron-rebuild |
| `npm run rebuild:native:dual` | 双架构重建原生模块 |
| `npm run typecheck` | 先 node 后 web 两侧 `tsc --noEmit` |
| `npm run typecheck:node` / `typecheck:web` | 分侧类型检查 |

入口启动器：`启动.bat`（切到脚本所在目录后 `npm run dev`）。

## Structure

```
src/main/     Electron 主进程；services/ 含 db、scan、media、eagle、fingerprint、watch、videoMeta、store、sqlite 等
src/preload/  预加载脚本 + index.d.ts
src/renderer/ React UI（components/ data/ store/ styles/）；public/gltf/draco 为 GLTF Draco 解码器
src/shared/   主/渲染进程共享类型（types.ts）
tools/        开发工具脚本（mjs/cjs/ps1）
tests/        测试
docs/         文档
openspec/     OpenSpec 变更规范
```

## Conventions

- **进程模型：** 主进程（main）与渲染进程（renderer）经 preload 暴露的 IPC 通信；跨进程共享数据类型定义在 `src/shared/types.ts`。
- **原生依赖：** `better-sqlite3`、`sharp` 需按平台/架构重建，走 `npm run rebuild:native:dual`；二进制镜像配置在 `.npmrc`。
- **TypeScript：** src 分 `node`（main/preload）与 `web`（renderer）两个 tsconfig；改动类型边界后跑 `npm run typecheck`。
- **路径：** 工作区路径含中文与空格，PowerShell 下使用 `-LiteralPath`；文件 I/O 保持 UTF-8。

## Agent Guidelines

- 改动前先跑 `npm run typecheck`；涉及原生模块再跑 `npm run rebuild:native:dual`。
- 不要提交 `out/`、`node_modules/`、`artifacts/`、`素材/`（见 `.gitignore`）。
- 遵循 agent-rules 约定：通过 `generate-agents.sh` 生成时，仅 `<!-- GENERATED -->` 标记内由脚本覆盖，标记外的手工内容保留。
- 本文件由人工按 agent-rules 规范编写；agent-rules 的 `generate/verify-*.sh` 需 bash，当前环境（Windows PowerShell，无 bash）无法运行 bash 脚本，命令与文件均为手工核对。
