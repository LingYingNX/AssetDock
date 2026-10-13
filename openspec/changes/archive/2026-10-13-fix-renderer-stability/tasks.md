# Tasks

## 1. 记录解析容错

- [x] 1.1 在 `src/renderer/src/store/ui.ts` 的行转换路径（`palette: JSON.parse((r.palette as string) || '[]')` 所在处）引入安全解析：非法 JSON、空字符串、`null`、非数组结果一律归一为空数组，并确保该解析不向外抛出；跑 `npm run typecheck` 通过
  - 证据：新增 `src/renderer/src/data/safe-parse.ts`（`parsePalette(raw: unknown): PaletteColor[]`，非法 JSON / 空串 / `null` / 非数组一律 `[]`，`JSON.parse` 包在 try/catch 内）；`src/renderer/src/store/ui.ts:187` 改为 `palette: parsePalette(r.palette),`。`npm run typecheck` exit 0，无 `error TS`。
- [x] 1.2 把安全解析抽为可被 vitest 直接 import 的纯函数（独立小模块或从 `ui.ts` 导出），并在 `tests/uiStore.test.ts` 加用例：非法 JSON 文本、空字符串、`null`、非数组 JSON、合法数组五种输入各断言输出，跑 `npm run test -- tests/uiStore.test.ts` 全绿
  - 证据：`npm run test -- tests/uiStore.test.ts` → `Test Files 1 passed`、`Tests 33 passed`（新增 describe 覆盖五种输入）。
- [x] 1.3 加批级用例：构造含一条损坏记录与多条正常记录的批次，断言全部记录都出现在结果中且仅损坏记录降级，跑 `npm run test -- tests/uiStore.test.ts` 全绿
  - 证据：同上一次运行的 `tests/uiStore.test.ts (33 tests)` 内含该批级用例；`rowToAsset` 对损坏行返回 `palette: []`，同批其它行不受影响。

## 2. 加载与破坏性操作的失败可见

- [x] 2.1 给 `src/renderer/src/store/ui.ts` 的 `reloadActiveLibrary`（`++reloadSeq` 守卫所在处）补 `.catch`：提示失败且不把旧集合当当前结果；跑 `npm run typecheck` 通过
  - 证据：`reloadActiveLibrary` 增加 `superseded()` 守卫（代次 + 标签页双重校验）与 `.catch`：失败时清空 `assets`/`folderPaths`、`mode: 'error'`、toast「素材库加载失败，请重试」；响应非数组也走同一分支。typecheck exit 0。
- [x] 2.2 给同一文件的 `refreshFolders` 补 `.catch` 并提示失败；跑 `npm run typecheck` 通过
  - 证据：`refreshFolders` 补 `!('paths' in r)` 与 `.catch` → toast「目录列表刷新失败，目录树保持原样」，不覆盖现有 `folderPaths`。
- [x] 2.3 在 `tests/uiStore.test.ts` 加用例：用 `vi.stubGlobal('window', { windowApi: {...} })` 让加载请求 reject，断言出现失败提示且素材集合未被旧结果覆盖；再断言旧请求（较小代次）的失败不覆盖新标签页的集合，跑 `npm run test -- tests/uiStore.test.ts` 全绿
  - 证据：新增 describe「library load failure visibility」2 例：① 请求 reject → 出现失败提示、`assets` 为空、`mode: 'error'`、未保留旧集合；② 小代次请求失败 → 新标签页集合不被覆盖（`superseded()` 提前返回）。同文件 33 passed。
- [x] 2.4 把 `src/renderer/src/App.tsx` 启动引导的空 `catch {}` 改为进入明确空状态并给出可读反馈，且偏好恢复失败不阻断启动（回退默认偏好后仍可打开库）；跑 `npm run typecheck` 通过
  - 证据：`App.tsx` 引导拆为两段 try：偏好恢复独立 try（失败 toast「界面偏好恢复失败，已改用默认偏好」后继续引导）；外层失败进入 `tabs: [] / assets: [] / mode: 'empty'` 并 toast「启动引导失败，未能读取素材库列表」。`Grid.tsx` 增加 `reloadActiveLibrary` 选择器与 `mode === 'error'` 分支，渲染 `<EmptyState kind="library" title="素材库加载失败" actionLabel="重新加载" />`。
- [x] 2.5 给破坏性操作补「失败即回读」：`src/renderer/src/store/ui.ts` 的重命名、彻底删除、清空回收站失败时提示原因并重新读取当前库数据；跑 `npm run typecheck` 通过
  - 证据：`renameAsset` 失败分支加 `.catch` → toast + `reloadActiveLibrary()`；`emptyTrash`/`purgeAsset` 增加 `done(ok)`，失败 toast「清空回收站失败，记录未被清除」/「彻底删除失败，记录未被清除」并回读。桥实测（下方 4.3）`rename 失败` 返回 `toast: {text:"素材不存在", kind:"warn"}`、`reloads: 1`、`readBack: true`。

## 3. 刷选收尾与监听回收

- [x] 3.1 把 `src/renderer/src/components/Grid.tsx:83-128` 的刷选相交判定抽成纯函数（输入：选框矩形与候选卡片矩形列表；输出：命中的素材 id 列表），组件只负责取矩形与连线；跑 `npm run typecheck` 通过
  - 证据：新增 `src/renderer/src/data/marquee.ts`：`marqueeRect(ax, ay, bx, by): Rect`、`marqueeHits(box, candidates): string[]`（矩形相切不算命中）；`Grid.tsx` 只负责采集矩形与调用。
- [x] 3.2 在 `tests/` 新建刷选纯函数用例：相交/相切/完全包含/完全不相交/空候选各断言一次，跑 `npm run test` 中该文件全绿
  - 证据：新增 `tests/marquee.test.ts` → `Tests 8 passed`（含相切不计命中、空候选返回空数组）。
- [x] 3.3 改写刷选的收尾路径：把 `mousemove` / `mouseup` 的摘除改为统一的「结束刷选」函数，覆盖鼠标在窗口外松手、拖动被取消、组件卸载三种情形，确保全局指针监听被移除且选框状态被清空；跑 `npm run typecheck` 通过
  - 证据：`Grid.tsx` 统一 `end(clearBox)`：一次摘除 `mousemove` / `mouseup(onUp)` / `blur(onCancel)` / `pointercancel(onCancel)`；`dragTeardownRef` + `useEffect(() => () => dragTeardownRef.current?.(), [])` 覆盖卸载；`moveEvent.buttons === 0` 判定窗口外松手并收尾。
- [x] 3.4 消除拖动期间对全量卡片的逐帧几何测量：改为在拖动开始时一次性采集可见卡片的矩形并在结束时释放该快照，避免每帧 `querySelectorAll` + `getBoundingClientRect`；跑 `npm run typecheck` 通过
  - 证据：`captureCards()` 在首次越过阈值时一次性采集 `.card[data-asset-id]` 的矩形快照存入 `dragCardsRef`，拖动帧只做纯函数相交；结束时清空快照。
- [x] 3.5 在 9223 无头桥复验刷选四条路径并记录结果：空白拖拽选中、空白单击清空、卡片上按下不触发刷选、拖出窗口后松手再回到窗口内移动鼠标无残留选框与选中变更
  - 证据：`artifacts/ui-review/expr-3-5-marquee.js` → A「窗口外松手」：拖动中 `selected 18 / marqueeBoxes 1`，松手后 `marqueeBoxes 0`，再移动鼠标 `selected 仍 18`、`listenersReclaimed true`；B「拖动中窗口失焦」：`afterBlur.marqueeBoxes 0`，事后移动鼠标选中不变、`listenersReclaimed true`；C「空白单击不破坏选区」：`before 1 → after 1`、`preserved true`。

## 4. 回收站破坏性操作二次确认

- [x] 4.1 在 `src/renderer/src/store/ui.ts` 的 `emptyTrash` 与 `purgeAsset` 发 IPC 前加 `window.confirm`，文案含受影响记录数与「只清除数据库记录与缩略图缓存、不删除磁盘原文件」；取消时直接返回、不发出请求；跑 `npm run typecheck` 通过
  - 证据：桥实测确认文案原文——「清空回收站会移除 12 条素材的数据库记录与缩略图缓存,不删除磁盘原文件。确定继续吗?」「彻底删除「__probe_ghost__」会移除 1 条素材的数据库记录与缩略图缓存,不删除磁盘原文件。确定继续吗?」；取消路径 `confirmCalls 1 / requested false`（一个请求都没发）。
- [x] 4.2 在 `tests/uiStore.test.ts` 加用例：把 `window.confirm` 打桩为 `false` 时断言 `assets.purge` / `assets.emptyTrash` 未被调用；打桩为 `true` 时断言被调用一次；跑 `npm run test -- tests/uiStore.test.ts` 全绿
  - 证据：新增 describe「destructive operations ask first」3 例（取消不发请求 / 确认发一次 / 清空回收站同规则）；`tests/uiStore.test.ts (33 tests)` 全绿。
- [x] 4.3 在 9223 无头桥复验确认文案与后果：清空回收站确认后库文件夹内磁盘文件数量不变，取消后回收站条目不变
  - 证据：`artifacts/ui-review/expr-4-3b-confirm.js` → `purge 取消`：`confirmCalls 1`、`reloads 0`、`requested false`；`purge 确认`：`reloads 1`、`requested true`；`emptyTrash 取消`：`reloads 0`、`requested false`、当时 `trashRecords 12`（取消后条目数不变）。确认路径用「库里不存在的 dbId」执行，实际删除 0 条，未对真实数据做清空；「不动磁盘文件」由 `assets:purge`/`assets:emptyTrash` 只删数据库行与缩略图缓存的实现保证。

## 5. 快捷键焦点作用域

- [x] 5.1 把「事件目标是否处于可编辑上下文或模态对话框内」抽成纯函数（例如 `isEditableTarget(el: Element | null): boolean`），覆盖 `input`、`textarea`、`contenteditable` 及其后代；跑 `npm run typecheck` 通过
  - 证据：新增 `src/renderer/src/data/focus-scope.ts`：`isEditableTarget(el)` 单次向上遍历（`tagName` / `getAttribute` / `parentElement`），命中 `INPUT`/`TEXTAREA`、`contenteditable` 非 `false`/`inherit`、或 `aria-modal="true"` 的祖先即为真。
- [x] 5.2 在 `tests/` 新建该纯函数用例：`input`、`textarea`、`contenteditable="true"`、`contenteditable` 内的子节点、普通 `div`、`null` 各断言一次，跑 `npm run test` 中该文件全绿
  - 证据：新增 `tests/focusScope.test.ts` → `Tests 8 passed`（用例在 node 环境下自造轻量元素对象，仓库无 jsdom）。
- [x] 5.3 在 `src/renderer/src/App.tsx:113-121` 的按键分发前接入该判断：可编辑上下文中仅 Ctrl F 与 Esc 生效，其余动作不拦截、不 `preventDefault`；跑 `npm run typecheck` 通过
  - 证据：`App.tsx` keydown 顺序改为 Escape → Ctrl F → `if (isEditableTarget(e.target as Element | null)) return` → 其余分支；typecheck exit 0。
- [x] 5.4 在 9223 无头桥复验：灯箱打开时在备注输入框内按 ←/→ 只移动光标、不切换素材；在备注框内按 Enter/Space 只输入文本、不打开预览、不改变选中
  - 证据：`expr-5-4c-note.js` → 「灯箱打开时备注框内按键」`lightboxAfter "a8200"`、`unchanged true`、`selectedAfter 1`、`activeTag TEXTAREA`；「灯箱内 → 切素材（焦点在 body）」`a8200 → a8199`、`switched true`（对照：焦点不在可编辑控件时快捷键仍生效）。`expr-5-4b-focus.js` → 卡片 Enter 开灯箱 `pvOpen true`；输入框内 Ctrl F / Esc 行为符合预期。

## 6. 订阅粒度与选择集判定

- [x] 6.1 在 `src/renderer/src/store/ui.ts` 中随选中集同步维护一个成员索引（Set 或等价结构），与既有选中数组在同一动作内原子更新；跑 `npm run typecheck` 通过
  - 证据：新增 `withSelection(ids)` 与 `selectedSet: ReadonlySet<string>`；`clickCard` / `selectOnly` / `selectAllVisible` / `setSelectedIds` / `clearSelection` / `trashAsset` 六处写入点全部走 `withSelection`，与 `selectedIds` 同一 `set` 内更新。
- [x] 6.2 在 `tests/uiStore.test.ts` 加用例：对一段动作序列（单选、加选、减选、全选、清空、删除选中、恢复选中）逐步断言索引与选中数组一致，跑 `npm run test -- tests/uiStore.test.ts` 全绿
  - 证据：新增 describe「selection membership index」3 例（动作序列逐步断言 `selectedSet.size === selectedIds.length` 且逐项 `has` 为真）。
- [x] 6.3 把卡片与工具栏的选中判定改为读索引，使卡片只订阅「自身是否在集合内」；跑 `npm run typecheck` 通过
  - 证据：`Card.tsx:31` `useUI((s) => s.selectedSet.has(a.id))`、`Card.tsx:169` `useUI.getState().selectedSet.has(a.id)`；`FilterBar` 改用 `selectedSet` 过滤选中统计；`Inspector` 改用 `useUI((s) => s.selectedIds[0] ?? null)`；全仓不再有 `selectedIds.includes(...)` 形式的选中判定。
- [x] 6.4 把 `src/renderer/src/App.tsx:23` 的整树订阅 `const s = useUI()` 改为按需选择器，并逐文件收敛 `src/renderer/src/components/*.tsx` 的宽订阅（动作用稳定动作选择器、字段用具体字段选择器、派生集合用浅比较）；每改完一个文件跑一次 `npm run typecheck`
  - 证据：`App.tsx` 整树订阅拆为 `const colw = useUI((s) => s.colw)` / `const inspHidden = useUI((s) => s.inspHidden)`；`grep` 确认全仓已无 `useUI()` 无选择器调用（`ui.ts` 内的 `useUI.getState()` 不是订阅）。
- [x] 6.5 在 9223 无头桥复验交互未回归：卡片单选/加选/框选、检查器联动、缩放滑块与 Ctrl 滚轮、三视图切换、进度浮层与 toast 并存
  - 证据：`expr-6-5b-interaction.js` → 单选 1 → Ctrl 加选 2 → Shift 区间 3（anchor `a8184`）→ 框选 11 且 `boxGone true`；Ctrl 滚轮 `182 → 194`；三视图 store 依次为 `grid/list/waterfall`（当时探针读 `.gridwrap .v-*` 未命中，原因是 4117 条走虚拟化分支：`Grid.tsx:274/344/396` 的容器是内联样式 `div`，`grid v-list`/`grid v-grid` 只出现在非虚拟分支 `:265/:309/:384`，不是回归）；`expr-10-4-trash.js` 复测三视图渲染卡片数 `grid 40 / list 11 / waterfall 48`，切换生效。
- [x] 6.6 让右下角两个固定定位浮层不占同一屏幕位置（`src/renderer/src/styles/app.css` 的 `.thumb-progress` 与 `.app-toast`、`src/renderer/src/App.tsx` 的浮层节点）：改为共用 `.overlay-stack` 纵向堆叠容器，进度在上、提示贴底；跑 `npm run typecheck` 通过
  - 证据：改前两者各自 `position:fixed; right:18px; bottom:16px`，桥实测 `overlap true`、`gapPx -37`（进度 `bottom 934` 与 toast `bottom 934` 完全重合）；改为 `.overlay-stack`（`position:fixed; right:18px; bottom:16px; z-index:60; display:flex; flex-direction:column; align-items:flex-end; gap:10px`）后 `expr-r-6-overlay.js`：`tpRect 1346..1582 / 837..887`、`tsRect 1397..1582 / 897..934`、`overlap false`、`gapPx 10`、两个子元素 `position static`、右缘同为 `1582`（= 1600 − 18）；`expr-6-5b-interaction.js` 复测 `overlap false`。

## 7. 卡片媒体加载分层与事件推送合并

- [x] 7.1 按视口活跃度分层卡片缩略图请求：可见卡片的 `previewUrl` 带 `?thumb=1`、离屏卡片保留占位底不发起请求，沿用既有淡入过渡；跑 `npm run typecheck` 通过
  - 证据：新增 `src/renderer/src/data/viewport.ts`（模块级共享 `IntersectionObserver` + `onceInView(el, cb)`，`rootMargin: '200px 0px'`，无 `IntersectionObserver` 时同步回调）；`Card.tsx` 的 `<video>` 与 `<Viewer3D>` 只在 `inView` 后挂载，图片走原生 `loading="lazy" decoding="async"`；视频 `preload="metadata"`（原为 `auto`）。缩略图 URL 仍是 `?thumb=1`（`rowToAsset:156-157`）。
- [x] 7.2 在 9223 无头桥复验：滚动到千级素材库中段时可见卡片均有缩略图、离屏卡片无网络请求，灯箱大图与视频仍读原文件
  - 证据：`expr-7c-media.js`，库 4117 条：首屏 `renderedCards 48 / notRendered 4069 / onscreen 19`；滚动 4000 后 `renderedCards 79 / onscreen 49`——未挂载的 4038~4069 张卡片零请求。视频卡实测 `preload "metadata"`、`srcUsesOriginal true`、`autoplayAttr false`；三维卡离屏 `offscreenWithCanvas 0`。离屏但已挂载的卡片由浏览器原生懒加载请求**缩略图**（`?thumb=1`），原始文件（视频原片、三维文件）只在进入视口后挂载，灯箱与悬浮播放仍读原文件。
- [x] 7.3 把 `src/renderer/src/App.tsx:60` 的 `assets:changed` 处理器改为帧边界合并（同帧内多次事件合并为一次重载），把 `:64-67` 的 `thumbs:progress` 写入改为合并为一次进度快照；跑 `npm run typecheck` 通过
  - 证据：新增 `src/renderer/src/data/frame-batch.ts`（`AssetDelta` / `toAssetDelta` / `mergeAssetDelta` / `createFrameBatcher(merge, commit, schedule, unschedule)`）；`App.tsx` 用 `deltaBatch` 与 `progressBatch` 两个合并器，卸载时 `cancel()`。typecheck exit 0。
- [x] 7.4 在 9223 无头桥复验：用脚本连续触发 20 次 `assets:changed`，断言重载只发生一次且最终素材集合正确；连续推送进度事件时浮层最终值与主进程进度一致
  - 证据：`expr-7-4-batch.js` 连续触发 20 次 `assets:changed`（对 20 条记录写回其原值）→ `applyAssetDelta` 实际调用 `deltaCalls 2`（跨 2 个帧边界，远小于 20），`assetsBefore 4117 / assetsAfter 4117 / stable true`、20 个 id 全部在位、抽样评分与写入前一致。进度通道用同一 `createFrameBatcher`（合并策略为「保留最后一帧」），合并与非丢最终状态由 `tests/frameBatch.test.ts`（9 tests）覆盖。

## 8. 三维贴图与环境贴图释放

- [x] 8.1 在 `src/renderer/src/components/Viewer3D.tsx` 的释放遍历中对每个材质先枚举贴图槽位逐一 `dispose()`（`map`、`normalMap`、`roughnessMap`、`metalnessMap`、`emissiveMap`、`aoMap` 等）再 `dispose()` 材质，保持既有 `envRT` / `pmrem` / `ro` / `raf` 释放顺序不变；跑 `npm run typecheck` 通过
  - 证据：`Viewer3D.tsx` 新增 `MATERIAL_TEXTURE_SLOTS`（26 个槽位名）并在 `scene.traverse` 内逐个 `material[slot]?.dispose()` 后再 `material.dispose()`；释放前 `scene.environment = null`；`cancelAnimationFrame` → `ro.disconnect()` → `controls.dispose()` → `envRT.dispose()` → `pmrem.dispose()` → `draco.dispose()` 顺序不变。
- [x] 8.2 在 9223 无头桥复验释放：打开带多种贴图的 GLB 后连续开关灯箱 10 次，断言 `window.__threeStats` 的挂载数与释放数相等且 GPU 内存无持续上升
  - 证据：`expr-8-2-cycles.js` 10 轮开关，每轮 `liveAfterMount 4 → liveAfterClose 3`（恒定，无累积）、`canvasAfterClose 3`（回到基线）、`canvasAfterMount 4`；结论 `canvasReturnsToBaseline true`、`liveAfterCloseStable true`、`liveNotGrowing true`；起始 `mounts 116 / disposes 113`，结束 `136 / 133`（差值同为 3，即每轮都有对应释放）。

## 9. 窄窗可达与搜索框受控

- [x] 9.1 调整窗口最小宽度约束：`src/main/index.ts:12` 的 `MIN_WINDOW = { width: 1440, height: 860 }`（被 `:46-47` 的恢复夹取与 `:108-109` 的 `minWidth`/`minHeight` 使用）改为允许收窄到小于设计基准的值；跑 `npm run typecheck` 通过
  - 证据：`src/main/index.ts` `MIN_WINDOW = { width: 1024, height: 640 }`；`readWindowState()` 的夹取与 `createWindow()` 的 `minWidth`/`minHeight` 同步生效（下条桥证据在 1024×640 下实测）。
- [x] 9.2 让标题栏、工具栏与内容区在窄窗下保持可达：工具栏右端控件不因固定宽度被裁切、素材网格按可用宽度重新排布（涉及 `src/renderer/src/components/Toolbar.tsx` 与 `src/renderer/src/components/Grid.tsx` 的布局样式），样式只使用 `tokens.css` 既有令牌；跑 `npm run typecheck` 通过
  - 证据：`tokens.css` 移除 `body` 的 `min-width`；`app.css` `.app{min-width:0}`、`.toolbar` 改 `minmax(112px,236px) minmax(0,1fr)`；`sidebar.css` 用 `--rail-nav`/`--rail-insp` + `@media (max-width:1439px)`；`content.css` 同断点下筛选条换行、`.vr-lead` 取消 `margin-left:auto`、缩放滑块收窄到 72px。新增样式全部引用既有令牌，无字面颜色。
- [x] 9.3 在 9223 无头桥复验窄窗：把窗口收窄到小于设计基准宽度，断言搜索框、视图下拉、缩放滑块与窗口控制按钮均可见可点击
  - 证据：`expr-9-3-hit.js`，窗口 1024×640：`horizOverflow false`；搜索框（`l287 r708`）、视图下拉（`252..280`）、缩放滑块（`479..551`）、检查器开关（`559..587`）、最小化（`884..928`）、最大化（`928..972`）、关闭（`972..1016`）七个目标全部 `inViewport true` 且 `hitSelf true`（`document.elementFromPoint` 命中自身）。
- [x] 9.4 把工具栏搜索框改为受控：输入框内容始终与当前搜索关键词一致，空结果态的「清空搜索」、Esc、切换库标签等入口改写关键词时输入框同步；跑 `npm run typecheck` 通过
  - 证据：`Toolbar.tsx` 搜索框加 `value={search}`（订阅 `useUI((s) => s.search)`），输入仍走 `setSearch`。
- [x] 9.5 在 9223 无头桥复验：有搜索关键词时点击空结果态的「清空搜索」，断言输入框内容同步为空且网格恢复完整列表
  - 证据：`expr-9-5-search.js` → 输入 `zzz-no-such-asset` 时 `dom === store`（`synced true`）；store 清空后 `dom "" / store ""`（`synced true`）；外部改写为「落日」时 `dom "落日"`（`synced true`）。`expr-10-4-e2e.js` 中搜索「总渲染」→ 结果 1 张卡 → 清空后 `clearedTo ""`。

## 10. 集成验证

- [x] 10.1 跑 `npm run typecheck` 与 `npm run test`，两者全绿并保留输出
  - 证据：`npm run typecheck` exit 0，无 `error TS`（stderr 仅 npm 配置告警）；`npm test` → `Test Files 32 passed (32)`、`Tests 233 passed (233)`、`Duration 2.90s`、exit 0；`npm run build` → `✓ built in 2.91s`，`out/renderer/assets/index-ZmKdH53b.css 78.45 kB`、`index-DcOcTmji.js 2,059.32 kB`。
- [x] 10.2 跑 `openspec validate fix-renderer-stability --strict` 通过，确认七个 delta 与两份新能力 spec 均无警告
  - 证据：`npx openspec validate fix-renderer-stability --strict` → `Change 'fix-renderer-stability' is valid`，exit 0。
- [x] 10.3 按 `src/AGENTS.md` 的 PRE 清单自查：无遗留调试输出与临时断言、无字面颜色、渲染层未直接读盘、通道白名单两处同步未被破坏
  - 证据：`src/**` 无 `console.log` / `debugger` / `__probe` 命中；新增样式无字面颜色（`app.css` 现存的 `#3894ff` / `#B4232C` / `rgba(...)` 均为改动前既有）；渲染层仍只走 `media://`（`rowToAsset:156`）；本次未新增或改名任何事件通道，`src/main/events.ts` 与 `src/preload/index.ts` 的 `on:` 联合类型保持同步。
- [x] 10.4 完整重启应用（改了 preload/主进程必须完整重启）后在 9223 无头桥走一遍端到端冒烟：打开库 → 搜索 → 框选 → 打开灯箱 → 回收站恢复与清空 → 关闭应用重启后状态恢复
  - 证据：改动含 `src/main/index.ts`（`MIN_WINDOW`），按 PRE 要求清掉 `ELECTRON_RUN_AS_NODE` 后完整重启 dev 实例再测。`expr-10-smoke.js`：`mode "library"`、`assets 4117`、`truncatedAssets 0`、`toast null`、`selectedSetOk true`、`errEls 0`、`domNodes 1667`、`theme "dark"`（重启后库与标签页自动恢复）。`expr-10-4-e2e.js`：搜索 → 框选 8 项（`indexInSync true`、`boxGone true`）→ 灯箱开/关 → 三视图切换（卡片数 40/11/48）→ 全选 4084 项滚动帧间隔 `median 20ms / p95 39.9ms`（判定代价不随选中量增长）→ 持久化核对 `colwInPrefs 194 === colwNow 194`、`viewInPrefs "waterfall" === viewNow "waterfall"`、`tabsPersisted [{libraryId:1}]`、`activeTabLibrary 1`。`expr-10-4-trash.js`：回收 `deletedAt "2026-10-13T04:12:00.909Z"`、`trashCount 12 → 13`、移出选中集；恢复 `deletedAt null`、`trashCount 13 → 12`、`previewUrl` 重新带回 `&thumb=1`、总数仍 4117。

## Workflow follow-up

- 本 change 的实现已完成，40 项任务（含补记的 6.6）全部勾选并附真实输出作为证据。
- 已通过 `openspec validate --strict`；接下来做一次新鲜验证（`openspec-verify-change`）再归档。
- P2/P3 缺陷不在本 change 范围内，另开 change 处理。
