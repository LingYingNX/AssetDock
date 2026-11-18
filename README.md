# AssetDock · 素材管理器

本地优先的桌面素材管理器。扫描本地目录建立素材库，管理标签、评分与文件夹，并直接预览图片、视频、3D 模型和常见文档。所有数据保存在本机，不上传。

## 功能

- 多库管理：新建、切换本地素材库，按目录增量扫描并监听变化
- 浏览视图：瀑布流 / 网格 / 列表，长列表虚拟化渲染
- 组织素材：文件夹树、标签（分组、批量打标）、评分、收藏、回收站
- 多格式预览：图片（含 PSD、HEIC、AVIF）、视频转码播放、PDF / Office / Markdown / HTML / CSS、glTF / FBX / OBJ 等 3D、HDR 环境贴图
- 筛选：格式、形状、尺寸、评分、标签、主色；格式菜单按当前文件夹实际存在的格式分组，分组可折叠
- 其他：拖拽导入、跨库移动与复制、缩略图与派生缓存清理

## 技术栈

Electron 44 · electron-vite 6 · React 18 · TypeScript · Zustand · better-sqlite3 · three.js · sharp · ffmpeg-static · Vitest

## 开发

要求 Node.js `^20.19.0 || >=22.12.0`。

```bash
npm install
npm run dev        # 开发模式（Windows 也可双击 启动.bat）
npm run typecheck  # 类型检查（node + web 两侧）
npm run test       # 逐文件运行 vitest
npm run build      # 构建到 out/
npm start          # 预览构建产物
```

## 目录结构

```
src/main/           主进程：生命周期、IPC、扫描/监听/缩略图/预览等服务
src/preload/        contextBridge 暴露 windowApi
src/renderer/src/   React 界面：组件、纯视图逻辑、zustand store、样式
src/shared/         跨进程共享的纯逻辑（无 fs / 无 electron）
tests/              Vitest 用例
tools/              开发与无头验证脚本
openspec/           能力规范与变更记录
```

架构与格式支持细节见 `docs/ARCHITECTURE.md`、`docs/FORMAT_SUPPORT.md`，能力规范见 `openspec/specs/`。

## 说明

仓库不包含素材文件、构建产物与本地数据库（见 `.gitignore`）。