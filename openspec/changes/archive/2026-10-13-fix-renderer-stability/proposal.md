# Proposal

## Why

渲染层存在 5 条会直接导致卡死、整库加载失败或误删数据的缺陷（空白区刷选监听泄漏、素材行 `JSON.parse` 裸解析、IPC 失败全链路静默、破坏性操作无确认、卡片媒体元素无加载策略），另有 7 条同类性能与可用性问题会把它们放大（整 store 订阅、选择判定线性扫描、主进程事件零节流、键盘方向键职责重叠、输入框非受控、窄窗内容不可达）。这些行为在现有主 spec 里要么没有要求（失败可见、订阅粒度、媒体加载策略），要么要求与实际实现相互矛盾（刷选只说"拖拽结束更新选中"，未约束收尾与卸载；`app-shell` 声明"窗口最小宽度 1440px"，而实现把 1440px 写成 `body` 的 `min-width` 配合 `overflow:hidden`，反而裁掉了窄窗下的工具栏右端）。先把这批稳定性契约补成规格，再谈实现。

## What Changes

- **刷选收尾与清理**：矩形选框的结束不再只依赖一次 `mouseup`；组件卸载、鼠标离开窗口、拖动被中断时 SHALL 回收监听与选框状态，不残留 `mousemove` 监听与逐帧元素几何测量。
- **素材行解析容错**：调色板等 JSON 字段损坏时降级为空值，SHALL NOT 因单行坏数据中断整个素材库加载。
- **IPC 失败可见**：素材库加载、目录刷新、清空回收站、彻底删除、重命名等渲染层 IPC 失败 SHALL 给出用户可见提示并保持界面与磁盘一致；启动引导的失败 SHALL 可观测，不再整段吞掉。
- **破坏性操作二次确认**：清空回收站与彻底删除素材 SHALL 先确认再执行（**BREAKING**：这两个入口的交互从"点击即执行"变为"需确认"）。
- **卡片媒体加载策略**：网格卡片的图片 SHALL 懒加载并异步解码；视频卡片 SHALL NOT 以 `preload="auto"` 拉取原始文件；三维卡片 SHALL 只对真正可见的卡片建立渲染上下文。
- **订阅粒度与选择集查询**：组件 SHALL NOT 订阅整个 store；选择判定 SHALL 用集合查询而非对选中数组做线性扫描。
- **主进程事件合并**：`assets:changed` 与 `thumbs:progress` 在短时间内的连续推送 SHALL 合并后再触发界面重算与重渲染。
- **方向键职责边界**：进度条、滑块等局部控件消费方向键后，SHALL NOT 同时触发灯箱翻页等全局动作。
- **输入框受控**：工具栏搜索框与检查器文件名编辑框 SHALL 与 store 双向一致（store 侧清空/改写后输入框同步）。
- **窄窗可达**：窗口宽度小于 1440px 设计基准时，全部功能 SHALL 保持可达（不因固定 `min-width` 被裁切）。
- **三维资源释放**：释放范围从几何体扩展到材质与贴图。

## Capabilities

### New Capabilities

- `renderer-responsiveness`: 渲染层在万级素材库下的响应性契约——组件订阅粒度、选择集判定方式、卡片媒体元素加载策略、主进程事件合并与服务端推送节流。
- `renderer-resilience`: 渲染层数据加载与失败可见契约——素材行解析容错、IPC 请求失败的提示与界面一致性、启动引导失败的可观测性。

### Modified Capabilities

- `asset-browser`: 「素材空白区刷选」补充收尾与清理要求（拖拽结束、鼠标离开窗口、组件卸载、拖动被中断时回收监听与选框，不残留逐帧几何测量）。
- `app-shell`: 「无边框窗口与窗口控制」中"窗口最小宽度 1440px"改为可达性要求（窄窗下工具栏右端与内容不得被裁掉）；「工具栏」补充搜索框受控同步。
- `asset-store`: 「删除与恢复」补充清空回收站与彻底删除的二次确认要求。
- `menus-shortcuts`: 「全局键盘快捷键」补充方向键的作用域边界（局部控件消费后不再触发灯箱翻页）。
- `viewer-3d`: 「资源释放」从几何体扩展到材质与贴图（`map`/`envMap` 等纹理一并释放）。

## Impact

**代码**（均在渲染层，主进程不改）：

- `src/renderer/src/App.tsx`：整 store 订阅、启动 `catch {}`、`assets:changed`/`thumbs:progress` 订阅、全局方向键、Ctrl+滚轮缩放。
- `src/renderer/src/store/ui.ts`：`rowToAsset` 的 `palette` 解析、`reloadActiveLibrary`/`refreshFolders`/`emptyTrash`/`purgeAsset`/`renameAsset` 的失败分支、setter 的持久化时机。
- `src/renderer/src/components/Grid.tsx`：`startMarquee` 的收尾与卸载清理、选择集传参。
- `src/renderer/src/components/Card.tsx`：选择判定、媒体元素加载属性、三维卡片挂载条件。
- `src/renderer/src/components/Toolbar.tsx` / `Inspector.tsx`：输入框受控。
- `src/renderer/src/components/VideoControls.tsx`：进度条方向键的事件消费。
- `src/renderer/src/components/Viewer3D.tsx`：材质贴图释放。
- `src/renderer/src/components/ThumbProgress.tsx` / `Toast.tsx`：两处固定浮层坐标重叠（`styles/app.css:55`、`styles/app.css:74`）一并处理。
- `src/renderer/src/styles/tokens.css` / `styles/app.css`：`body { min-width: 1440px; overflow: hidden }`。
- 新增：破坏性操作确认对话框组件（复用 `PreferencesDialog` 已有的 `role="dialog" aria-modal` 范式）。

**测试**：`tests/uiStore.test.ts` 覆盖 `rowToAsset` 解析容错与 IPC 失败可见（纯函数/桩注入，符合 `tests/AGENTS.md`）；React 组件与真实窗口行为走 127.0.0.1:9223 无头调试桥验证，不进 vitest。

**依赖**：不新增第三方依赖。

**非目标**：不在本 change 处理 P2/P3 级问题（样式表深色覆盖、死代码、ARIA 细节、跨文件常量手工同步等），后续另开 change。
