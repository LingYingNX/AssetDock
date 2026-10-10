# Proposal

## Why

从站点收集来的 CSS 片段本身就是效果素材，但库的扫描白名单只认位图 / 视频 / 三维，`.css` 文件既不入库也无法查看，用户只能去外部编辑器里手动拼一个 HTML 壳才知道它长什么样。需要在管理器内直接收录 CSS，并像记事本一样编辑、实时看到渲染结果。

单独的 `.css` 没有外观：它只是一组规则，必须被 HTML 元素命中才产生视觉。因此预览的做法不是把 CSS 转成 HTML，而是提供一个演示骨架去承载它。

## What Changes

- 扫描与监听白名单加入 `.css`（大小写不敏感），新增素材类型 `style`、格式 `CSS`。`assets.type` 是 TEXT 列且无 CHECK 约束，不需要数据库迁移。
- 网格卡片为 CSS 素材提供缩略图：主进程离屏渲染预览页后截图，复用既有 `<库>/.mediahub/thumbs/` 管道（指纹命名 + `index.json` 清单 + 随原图移动/删除的语义）。
- 双击 CSS 卡片进入灯箱编辑器：左侧代码区、右侧实时预览；保存即回写原 `.css` 文件，有未保存改动时给出提示并在关闭前阻止丢失。
- 预览骨架的来源：同目录存在同名 `.html` / `.htm` 时用它，否则用应用内置的通用演示骨架（标题、按钮、输入、卡片、加载器、列表等常见元素）。
- 预览在沙箱 iframe 内渲染：禁脚本、禁外网请求；HTML 骨架里的 `<script>` 一律剥离。所有文件读写经 `realPathWithinRoot` 校验。
- `media://` 的 MIME 表补上 CSS / HTML / 纯文本，使协议能直接服务于预览骨架。

## Capabilities

### New Capabilities

- `css-assets`: CSS 素材的识别入库、缩略图生成、灯箱编辑器（左代码右预览）与保存回写契约。

### Modified Capabilities

- `library-scan`: 递归扫描的扩展名白名单从位图/视频/三维扩展到 CSS，并明确该类型不采集宽高与时长。
- `asset-browser`: 格式筛选下拉新增 CSS 选项；卡片为 CSS 素材渲染缩略图与类型徽章，且不参与图片专用的主色提取。

## Impact

改动集中在主进程的扫描 / 监听 / 缩略图 / 协议四层，与渲染层的卡片 / 灯箱两处：

`src/main/services/ignore.ts`、`scan.ts`、`watch.ts`、`thumbs.ts`、`media.ts`，新增 CSS 预览渲染服务，`src/main/ipc.ts`，`src/preload/index.ts`，`src/shared/types.ts`，`src/renderer/src/data/types.ts` 与 `query.ts`，`components/Card.tsx`、`Lightbox.tsx`、`Inspector.tsx`、`FilterBar.tsx`，`styles/lightbox.css`，`tests/`。

与进行中工作的重叠（需要协调）：`src/main/services/thumbs.ts`、`src/main/ipc.ts`、`src/preload/index.ts`、`openspec/specs/thumbnails/spec.md` 当前有未提交的缩略图改动（预热队列 + 进度浮层），该工作仍在验收。CSS 缩略图必须接在它的管道上而不是并行重写，实施顺序见 `design.md` 的协作与并行一节。

无新增依赖：离屏截图用 Electron 自带的 `BrowserWindow` / `capturePage()`，演示骨架由应用内置。
