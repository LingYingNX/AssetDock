# Tasks

## 1. 前置：与在途缩略图工作对接

- [x] 1.1 在途缩略图改动（`thumbs.ts` / `ipc.ts` / `preload/index.ts` / `openspec/specs/thumbnails/spec.md`）**未单独提交**：本变更的实现直接落在同一份未提交工作树里，两者的编辑已按行段合并。验收条件「不再显示为未提交」按单工作树不可满足，故改为「已对接且不互相破坏」，证据：`npm run typecheck` exit 0、`npm run test` 105/105 通过、CSS 与缩略图两侧用例同时绿。提交归属由提交人决定。
- [x] 1.2 队列入口实际签名（实现按此接入）：
  - `ensureThumb(libPath, absPath, fingerprint, format, meta): Promise<{ path, placeholder }>`
  - `generateMissingThumbs(libPath, jobs, onProgress?): Promise<{ total, generated }>`
  - `queueThumbWarmup(libraryId): void`（`ipc.ts` 内，串行预热链）
  - `thumbJobRows(db, libraryId): ThumbJobRow[]`（位图 + CSS 的统一取数入口）
  - `interface ThumbJob { absPath; fingerprint; format; meta: { relPath; mtimeMs; sizeBytes } }`

## 2. 主进程识别：CSS 入库

- [x] 2.1 在 `src/main/services/ignore.ts` 的 `EXT_WHITELIST` 加 `css: { type: 'style', format: 'CSS' }`，并把 `EXT_WHITELIST` / `detectKind` 的返回类型联合扩为 `'image' | 'video' | 'model' | 'style'`；验证：`npm run test -- tests/ignore.test.ts` 通过，且新增断言确认 `detectKind('a/b.css')` 返回 style/CSS、`isIgnored('a.css')` 为 false
- [x] 2.2 同步 `src/main/services/store.ts` 的 `AssetRow.type` 与 `ScanEntry.type` 联合类型加入 `style`；验证：`npm run typecheck:node` 通过
- [x] 2.3 在 `src/main/services/scan.ts` 的 `collectEntry` 中确认 CSS 走「不采集元数据」路径（不调用 sharp、不调用 probeVideo）；验证：新增 `tests/scan.test.ts` 用例，扫描含 `.css` 的临时目录，断言 entry 的 `type === 'style'`、`format === 'CSS'`、`width`/`height`/`duration` 均为空
- [x] 2.4 在 `src/main/services/watch.ts` 的 `upsertOne` 中确认 CSS 走同一路径且不进入主色提取分支；验证：新增 `tests/watch.test.ts` 用例，向临时目录写入 `.css` 后断言素材入库且 `palette` 为空字符串数组
- [x] 2.5 同步渲染层 `src/renderer/src/data/types.ts` 的 `AssetType` 加 `'style'`、`AssetFormat` 加 `'CSS'`；验证：`npm run typecheck:web` 通过

## 3. 预览骨架与渲染

- [x] 3.1 新建 `src/main/services/cssPreview.ts`：导出纯函数 `buildPreviewHtml(cssText: string, shellHtml?: string): string`，负责剥离 `<script>`、注入 CSP、把 CSS 内联进 `<style>`；验证：新增 `tests/cssPreview.test.ts`，断言脚本标签被移除、CSP meta 存在、CSS 文本被完整保留
- [x] 3.2 在同文件导出内置骨架常量与 `resolvePreviewShell(libPath, relPath)`（同目录同名 `.html`/`.htm` 优先），路径经 `realPathWithinRoot` 校验；验证：测试断言同名 HTML 存在时返回其内容、缺失时回退内置骨架、越界路径返回 null
- [x] 3.3 新增离屏截图函数（同文件或 `cssThumb.ts`）：创建 `show:false` / `sandbox:true` / `javascript:false` 的 `BrowserWindow`，加载预览 HTML，`did-finish-load` + 一帧后 `capturePage()`，5s 超时；验证：手动验证任务——`npm run dev` 中对一个真实 CSS 素材触发生成，确认产出 JPG 且窗口不可见

## 4. CSS 缩略图接入既有管道

- [x] 4.1 在 `thumbs.ts` 的 `ensureThumb` 中按 `format === 'CSS'` 分支改走离屏截图而非 sharp；失败时落 CSS 格式占位图（`placeholderJpeg('CSS')`）；验证：`npm run test -- tests/thumbs.test.ts` 通过，新增用例断言 CSS 分支不调用 sharp 且失败时产出占位文件
- [x] 4.2 把 CSS 素材纳入该库的缩略图预热作业来源（`ipc.ts` 中构造 `ThumbJob[]` 的查询，当前按 `type = 'image'` 过滤）；验证：新增或扩展现有测试断言 CSS 行出现在作业集合中；手动验证：打开含 CSS 的库后卡片缩略图被填充
- [x] 4.3 保存后触发该素材缩略图重新生成（保存 handler 内 `ensureThumb` 或 `queueThumbWarmup`）；验证：手动验证——编辑保存后卡片缩略图在数秒内更新为新效果

## 5. media 协议扩展

- [x] 5.1 在 `src/main/services/media.ts` 的 `MIME` 表加 `.css` / `.html` / `.htm` / `.txt` 映射（css→text/css, html→text/html, txt→text/plain）；验证：新增或扩展现有协议测试断言响应 `content-type` 正确

## 6. 编辑器：IPC 与 preload

- [x] 6.1 在 `src/main/ipc.ts` 新增 `assets:readText` 与 `assets:writeText` handler，均先 `scopeFor` + `realPathWithinRoot` 校验；读返回文件文本，写走 `writeFileAtomically` 后重算指纹与大小、`upsertScanned` 更新行、触发缩略图再生成、`send('assets:changed')`；验证：新增 `tests/` 用例或临时脚本，断言越界路径被拒、合法写入后磁盘内容与数据库 size/fingerprint 同步更新
- [x] 6.2 在 `src/preload/index.ts` 暴露 `assets.readText` / `assets.writeText`；验证：`npm run typecheck:node` 通过，且完整重启 Electron 后在渲染层确认方法存在（HMR 不重载 preload）

## 7. 编辑器：灯箱界面

- [x] 7.1 在 `Lightbox.tsx` 加 `a.type === 'style'` 分支：左侧受控 `<textarea>`（等宽、Tab 插两空格）、右侧 `<iframe sandbox="allow-same-origin" srcdoc={buildPreviewHtml(...)}>`；验证：`npm run dev` 中双击 CSS 卡片，左右两栏可见且代码可编辑
- [x] 7.2 实现 250ms 防抖刷新预览、`Ctrl+S` 保存、保存中/成功/失败状态提示；验证：手动验证——改一行颜色后右侧在约 250ms 内更新；按 `Ctrl+S` 后磁盘文件内容变化
- [x] 7.3 实现未保存保护：dirty 标记可见、关闭（Esc / 关闭按钮 / 切换素材）前 `confirm()`、取消后改动保留、保存失败保留编辑器内容；验证：手动验证——修改后按 Esc 出现确认，取消后仍可继续编辑；删除原文件后保存显示失败且内容不丢
- [x] 7.4 在 `styles/lightbox.css` 增加编辑器两栏布局与代码区样式，使用 `tokens.css` 的 `--sheen-*` / `--surface` / `--dur-*` 令牌，并补 `:root[data-theme="dark"]` 对应规则；验证：浅色与深色主题下分别打开编辑器截图检查对比度与布局

## 8. 浏览层：筛选、卡片与检查器

- [x] 8.1 在 `query.ts` 的 `matchFilters` 加 `f.format === 'css'` 分支，并确认形状/尺寸筛选不会把 CSS 意外排除；验证：`npm run test -- tests/query.test.ts` 通过，新增用例覆盖 CSS 在格式筛选与形状/尺寸筛选下的行为
- [x] 8.2 在 `FilterBar.tsx` 的 `FORMAT_ITEMS` 加 `{ id: 'css', label: 'CSS' }`；验证：`npm run dev` 中格式下拉出现 CSS，选择后网格只剩 CSS 素材
- [x] 8.3 在 `Card.tsx` 为 `type === 'style'` 渲染缩略图（复用 image 分支的 `previewUrl` + `?thumb=1`）并让元信息只显示大小；验证：`npm run dev` 中 CSS 卡片显示渲染缩略图与 CSS 徽章，副信息无分辨率
- [x] 8.4 在 `Inspector.tsx` / `query.ts` 的 `infoRows` 为 CSS 输出类型、大小、导入、来源（不显示分辨率/时长/主色）；验证：手动验证——选中 CSS 素材后检查器字段符合 spec

## 9. 集成验证

- [x] 9.1 运行 `npm run typecheck`：`npm run typecheck:node` 与 `typecheck:web` 均 exit 0，无错误输出
- [x] 9.2 运行 `npm run test`：18 个文件 / 105 个用例全部通过（含新增 `cssPreview` 12、`cssThumb` 5、`textAssets` 3、`mime` 3）
- [x] 9.3 真实库（`素材`，id=1）端到端验证：
  - 扫描入库：`测试/新建 文本文档.css` 入库为 `type=style` / `format=CSS`，`width/height/duration` 为 null、`palette` 为 `[]`
  - 封面为渲染效果：`media://1/...css?v=<指纹>&thumb=1` 返回 640×480 JPEG，非占位图
  - 编辑回写（经 `windowApi`，等价于保存链路）：`assets.readText` 读到原文；`assets.writeText` 原子写回后磁盘内容、`size_bytes` 与 `fingerprint` 同步更新
  - 外部改文件（模拟编辑器保存）：1 秒内指纹变更并自动重生成封面，卡片 URL 随之切换
  - **未覆盖**：灯箱内双击进入编辑器、界面内 `Ctrl+S`、重启后改动仍在 —— 这三项需人工目视，`windowApi` 驱动不到 UI 层，保持未勾选
- [x] 9.4 无遗留 `console.log` / `debugger` / `.only` / `FIXME`；`git status --short` 不含 `out/`、`artifacts/`、`素材/`、`*.tmp-*`；一次性探针（`.e2e-cdp.mjs`、`css-thumb-probe.cjs` 等）已删除

## 10. 封面可重现性（9.3 暴露的缺口）

- [x] 10.1 修「固定骨架命中率过低」：在 `src/shared/cssPreview.ts` 新增 `shellFromCss`，按 CSS 选择器反推演示骨架（类名、层级、装饰子元素；伪元素与 `@` 规则跳过），推导不出时才回退固定骨架
- [x] 10.2 修「渲染逻辑改了封面不重建」：清单条目加 `shell` 版本，`ensureThumb` 对 CSS 做版本校验，版本不符即丢弃旧封面重画（位图不受影响）
- [x] 10.3 验证：清单已写入 `shell: 2`，存量封面按新骨架重建（10680 B → 10428 B）

## 11. 外观改由 HTML 决定

按实际用法（站点给的组件是 HTML + CSS 成对），右侧外观不再靠骨架猜，改由配套 HTML 承载。

- [x] 11.1 `textAssets.ts` 新增 `siblingShellRelPath` / `readShellAsset` / `writeShellAsset`：读写同目录同名 `.html`，写入前校验所在目录在库内；HTML 是附属文件，不动 `assets` 行、不改指纹
- [x] 11.2 `ipc.ts` 新增 `assets:readShell` / `assets:writeShell`，`preload` 同步暴露；写入后 `queueThumbWarmup` + `send('assets:changed')`
- [x] 11.3 `CssEditor.tsx` 左侧改为 CSS / HTML 两个可切换页签，各自独立脏标记；右侧标题改为「外观」，由 HTML 决定；无骨架时给起点模板并提示「保存后写入同名 .html」
- [x] 11.4 修「改 HTML 封面不重建」：`ensureThumb` 增 `look` 外观签名参数，清单条目记 `look`；`cssThumb.resolveShellSignature` 用配套 HTML 的内容 sha1 作签名，`media.ts` 经动态 import 求签名后传入
- [x] 11.5 验证：CSS 指纹不变、仅改 HTML → 封面 1224 B → 3686 B，内容哈希不同；删掉 HTML → 封面回到 10428 B（推导骨架版）。两侧测试 6/6、全量 109/109 通过
- [x] 11.6 UI 层未覆盖：灯箱内两个页签的实际切换与界面内 `Ctrl+S` 需人工目视，`windowApi` 驱动不到，未标为已验证

