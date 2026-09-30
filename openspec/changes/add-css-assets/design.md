# Design

## Context

现状（见 proposal.md 的动机，此处只列约束）：

- 素材类型是 `ASSET_TYPE` 闭合联合：主进程 `ignore.ts` 的 `EXT_WHITELIST` / `detectKind` 决定入库，`scan.ts` 与 `watch.ts` 是两个独立入口，两边都整份复制了「按类型采集元数据」的分支。新增一种类型必须同时改这两处，否则扫描能进、监听进不来（或反之）。
- `assets.type` / `format` 是 TEXT 列且无 CHECK 约束，`upsertScanned` 是参数绑定写入，因此新增类型值不需要 schema 迁移；但 `src/main/services/store.ts` 的 `AssetRow.type` 与渲染层 `AssetType` 是硬编码联合，需要同步加成员，否则类型检查会挡住。
- 缩略图管道（`thumbs.ts`）当前假设输入是能被 sharp 解码的文件，抽象是 `ensureThumb(libPath, absPath, fingerprint, format, meta)`；失败时落格式占位图。它按指纹命名并维护 `index.json` 清单，移动/删除语义已经完整。**该文件当前有未提交的进行中改动（预热队列 + 进度推送），仍在验收。**
- `media://` 协议是渲染层唯一读盘通道，`realPathWithinRoot` 做符号链接/Junction 越界防护；`MIME` 表目前没有 css/html/text，返回 `application/octet-stream`。
- 预览需求本质是「CSS 规则需要 HTML 元素才可见」，而 CSS 规则不携带自己的 markup——这是格式本身的限制，不是实现选择。

## Goals / Non-Goals

**Goals:**

- CSS 作为一等素材：扫描、监听、缩略图、筛选、编辑、保存全链路可用，且复用既有文件夹/标签/回收站语义。
- 缩略图与编辑器预览共用同一份「CSS + 骨架」渲染逻辑，避免两套渲染路径产生视觉偏差。
- 保存回写是原子的，且严格限制在库根内。

**Non-Goals:**

- 不把 CSS 转成 HTML 或组件代码；不解析、不改写 CSS 规则本身。
- 不做 HTML/JS 素材的编辑（HTML 骨架只作为只读输入）。
- 不做多文件 CSS 的 `@import` / `url()` 依赖图解析：预览只注入目标文件本身，相对资源由协议解析且限定在库内。
- 不做完整的 CSS 语法高亮编辑器：先用原生 `<textarea>`，语法高亮是可选增强。

## Decisions

### 1. 新类型 `style` / 格式 `CSS`，而不是塞进 `image`

塞进 `image` 会让 `scan.ts` 去调 sharp 解析尺寸、`palette.ts` 去抽主色、`Lightbox` 走图片缩放路径，每个下游都要加特例。新增独立类型只需在枚举处加成员，之后所有 `type === 'image'` 分支自然把 CSS 排除在外。

代价：`store.ts`、`renderer/data/types.ts` 的联合类型要各加一项；`query.ts` 的 `matchFilters` 与 `infoRows` 需要显式分支。这些是有界改动。

### 2. 元数据采集：CSS 只记大小与 mtime

`collectEntry` 与 `upsertOne` 的元数据分支保持「非图片非视频则不采集」的默认路径，因此 CSS 天然跳过 sharp 与 ffmpeg。同时在 `queuePaletteRefresh` 与 `watch.ts` 的主色分支上用 `type === 'image'` 守卫（现状已是如此，属于验证点而非新代码）。

### 3. 缩略图：离屏渲染截图，接入现有管道

新增一个渲染函数（`cssPreview.ts`），输入 CSS 文本与骨架 HTML，输出一个自包含的 HTML 字符串；缩略图服务检测到 `type === 'style'` 时不走 sharp，而是把这个 HTML 交给一个隐藏的离屏 `BrowserWindow` 渲染，等 `did-finish-load` + 一帧后 `capturePage()` 取图，再交给 `sharp` 缩放编码成 640px JPG。

替代方案与取舍：
- 用 `webContents.capturePage()` 的离屏窗口：Electron 自带，无新依赖，能拿到真实渲染结果。缺点是需要串行化（窗口创建有开销）、需要超时兜底。→ 采用。
- 用 sharp 直接渲染：sharp 不执行 CSS 布局，做不到。
- 用第三方无头浏览器（Playwright/Puppeteer）：引入大依赖且要额外下载 Chromium，否决。
- 不做缩略图，只给 CSS 图标占位：能省掉整个渲染链路，但用户明确要求「显示该素材缩略图」，且渲染缩略图正是判断一段 CSS 效果的最直接方式。→ 不采用。

该渲染必须在缩略图串行队列内执行（复用 `thumbs.ts` 的 `enqueue`），否则批量导入 CSS 时会并发创建大量窗口。离屏窗口使用 `show: false`、`sandbox: true`、`nodeIntegration: false`、`javascript: false`（骨架里的脚本已被剥离，双保险），并设置渲染超时（建议 5s）后回退占位图。

### 4. 预览骨架来源：同名 HTML 优先，内置骨架兜底

`loader.css` → 找同目录 `loader.html` / `loader.htm`；找不到则用内置骨架。内置骨架覆盖常见选择器目标（标题、段落、按钮、输入框、开关、卡片、列表、表格、加载器、`::before`/`::after` 容器、`@keyframes` 动画元素），使绝大多数从素材站收集的「组件片段」都能呈现出预期效果。

骨架与 CSS 之间用 `<style>` 内联注入，不用 `<link href="media://...">`：后者会让预览依赖协议加载时序，且 `@import` 会被沙箱 CSP 拦住。内联后单次 `srcdoc` 即可渲染，缩略图与编辑器共用同一份生成函数。

### 5. 渲染隔离：iframe 沙箱 + 禁网

编辑器里用 `<iframe sandbox="allow-same-origin" srcdoc={html}>`（不给 `allow-scripts`，脚本不执行）。同时预览 HTML 的 `<head>` 注入 CSP：`default-src 'none'; style-src 'unsafe-inline'; img-src media: data:; font-src media: data:`，禁止一切外部网络请求。缩略图用的离屏窗口同样加载这份 HTML，因此两处策略一致。

不用 `webview` 标签（需要额外开关且权重更重），也不把预览 HTML 渲染进主文档（会被素材自身的 CSS 污染主应用样式，这是必须避免的）。

### 6. 编辑器布局：复用灯箱外壳，`style` 类型走分支

`Lightbox` 已经是「顶栏 + 舞台 + 右侧信息栏」的外壳，且已处理 Esc、左右切换、遮罩点击关闭。CSS 编辑器作为 `a.type === 'style'` 的舞台分支接入：`.pv-body` 在 style 模式下切成「左侧代码区 + 右侧预览」两列（右侧信息栏在窄窗口下可折叠）。不新建独立弹窗，避免重复实现关闭/快捷键/遮罩逻辑。

代码区用受控 `<textarea>`（等宽字体、保留缩进、Tab 键插入两个空格），不做语法高亮。改动经约 250ms 防抖更新 `srcdoc`，避免每次按键都重建 iframe。

### 7. 保存：先校验再原子写，随后刷新元数据

保存走新的 IPC（`assets:writeText`）：`scopeFor(libraryId)` → `realPathWithinRoot` 校验 → `writeFileAtomically`（已存在，Windows 下处理 EPERM/EEXIST）→ 重新计算指纹与大小 → `upsertScanned` 更新该行 → 队列化缩略图再生成 → `assets:changed` 通知渲染层。

用 `writeFileAtomically` 而不是直接 `writeFile`：编辑器保存是用户数据的写入路径，中断不能留下半截文件。不改变 `assets.id`、标签、评分、文件夹与导入时间（`upsertScanned` 现有语义已满足）。

未保存保护选最简单的方案：组件内跟踪 dirty 布尔值，关闭前 `confirm()`。不引入草稿持久化（关应用即丢弃，符合「像记事本一样」的预期）。

## Risks / Trade-offs

[与进行中缩略图工作冲突] → 不并行改 `thumbs.ts` 的队列结构，先合入并验收在途改动；CSS 缩略图只在类型分支上扩展。实施顺序见下节。

[离屏窗口开销与稳定性] → 复用缩略图串行队列、隐藏窗口、5s 超时、失败回退占位图；批量导入时不会并发开窗。

[恶意或畸形 CSS] → 沙箱 iframe 禁脚本、CSP 禁外网；CSS 本身无法逃出 iframe 沙箱。极端性能陷阱（超大 `box-shadow`、动画风暴）由超时兜底，只影响单张缩略图。

[内置骨架无法命中某些选择器] → 这是已知上限：骨架只能提高命中率，不能保证任意 CSS 都有效果。用户可用同名 HTML 精确控制。`ponytail:` 级别的取舍——不为此实现 DOM 推断或自动生成 markup。

[编辑器对超大 CSS 文件的性能] → 先按原样加载，超大文件不做特殊处理；若实测卡顿，再考虑按行虚拟化。

[主色/筛选语义变化] → CSS 无 palette，颜色筛选（侧栏色点、色带）会把它排除在外，这是符合直觉的行为，且不需要新代码。形状/尺寸筛选对无尺寸素材的既有行为需在实现中验证一次，避免 CSS 被意外过滤掉。

## Migration Plan

**协作与并行（用户提到另一个任务仍在验收）**：

1. 先合入并验收在途的缩略图改动（`thumbs.ts` / `ipc.ts` / `preload` / `thumbnails` spec）。CSS 缩略图要接它的队列，不能并行改同一文件。

2. 验收完成后实施本 change。可并行的独立块：
   - A 块（主进程识别）：`ignore.ts` → `scan.ts` / `watch.ts` → `store.ts` → `renderer/data/types.ts`。产出：CSS 能入库并显示在网格，缩略图暂为占位。
   - B 块（渲染与缩略图）：`cssPreview.ts` + `thumbs.ts` 类型分支 + `media.ts` MIME。依赖 A。
   - C 块（编辑器）：`ipc.ts` 写文本 handler + `preload` + `Lightbox` 分支 + `lightbox.css`。依赖 A，与 B 可并行（编辑器预览不依赖截图）。
   - D 块（筛选与信息）：`query.ts` + `FilterBar.tsx` + `Inspector.tsx` + `Card.tsx` 元信息。依赖 A。

3. 无数据库迁移：`type` 是 TEXT 列。回滚只需移除枚举成员与白名单项，已入库的 CSS 记录会成为无法识别的类型——回滚前应先清掉这些行（一条 `DELETE ... WHERE type = 'style'`）。

4. 既有库无需操作：重新打开库时扫描会自然带出 `.css` 文件。

## Open Questions

- 编辑器是否需要在右侧信息栏保留评分/标签操作？spec 未约束，实现时按最小改动处理（保留既有信息栏，窄窗口折叠）。
- 内置骨架的具体元素清单以实现时的素材样本为准调整，不影响 spec 场景。
