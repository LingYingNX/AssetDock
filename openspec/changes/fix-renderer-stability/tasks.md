# Tasks

## 1. 记录解析容错

- [ ] 1.1 在 `src/renderer/src/store/ui.ts` 的行转换路径（`palette: JSON.parse((r.palette as string) || '[]')` 所在处）引入安全解析：非法 JSON、空字符串、`null`、非数组结果一律归一为空数组，并确保该解析不向外抛出；跑 `npm run typecheck` 通过
- [ ] 1.2 把安全解析抽为可被 vitest 直接 import 的纯函数（独立小模块或从 `ui.ts` 导出），并在 `tests/uiStore.test.ts` 加用例：非法 JSON 文本、空字符串、`null`、非数组 JSON、合法数组五种输入各断言输出，跑 `npm run test -- tests/uiStore.test.ts` 全绿
- [ ] 1.3 加批级用例：构造含一条损坏记录与多条正常记录的批次，断言全部记录都出现在结果中且仅损坏记录降级，跑 `npm run test -- tests/uiStore.test.ts` 全绿

## 2. 加载与破坏性操作的失败可见

- [ ] 2.1 给 `src/renderer/src/store/ui.ts` 的 `reloadActiveLibrary`（`++reloadSeq` 守卫所在处）补 `.catch`：提示失败且不把旧集合当当前结果；跑 `npm run typecheck` 通过
- [ ] 2.2 给同一文件的 `refreshFolders` 补 `.catch` 并提示失败；跑 `npm run typecheck` 通过
- [ ] 2.3 在 `tests/uiStore.test.ts` 加用例：用 `vi.stubGlobal('window', { windowApi: {...} })` 让加载请求 reject，断言出现失败提示且素材集合未被旧结果覆盖；再断言旧请求（较小代次）的失败不覆盖新标签页的集合，跑 `npm run test -- tests/uiStore.test.ts` 全绿
- [ ] 2.4 把 `src/renderer/src/App.tsx` 启动引导的空 `catch {}` 改为进入明确空状态并给出可读反馈，且偏好恢复失败不阻断启动（回退默认偏好后仍可打开库）；跑 `npm run typecheck` 通过
- [ ] 2.5 给破坏性操作补「失败即回读」：`src/renderer/src/store/ui.ts` 的重命名、彻底删除、清空回收站失败时提示原因并重新读取当前库数据；跑 `npm run typecheck` 通过

## 3. 刷选收尾与监听回收

- [ ] 3.1 把 `src/renderer/src/components/Grid.tsx:83-128` 的刷选相交判定抽成纯函数（输入：选框矩形与候选卡片矩形列表；输出：命中的素材 id 列表），组件只负责取矩形与连线；跑 `npm run typecheck` 通过
- [ ] 3.2 在 `tests/` 新建刷选纯函数用例：相交/相切/完全包含/完全不相交/空候选各断言一次，跑 `npm run test` 中该文件全绿
- [ ] 3.3 改写刷选的收尾路径：把 `mousemove` / `mouseup` 的摘除改为统一的「结束刷选」函数，覆盖鼠标在窗口外松手、拖动被取消、组件卸载三种情形，确保全局指针监听被移除且选框状态被清空；跑 `npm run typecheck` 通过
- [ ] 3.4 消除拖动期间对全量卡片的逐帧几何测量：改为在拖动开始时一次性采集可见卡片的矩形并在结束时释放该快照，避免每帧 `querySelectorAll` + `getBoundingClientRect`；跑 `npm run typecheck` 通过
- [ ] 3.5 在 9223 无头桥复验刷选四条路径并记录结果：空白拖拽选中、空白单击清空、卡片上按下不触发刷选、拖出窗口后松手再回到窗口内移动鼠标无残留选框与选中变更

## 4. 回收站破坏性操作二次确认

- [ ] 4.1 在 `src/renderer/src/store/ui.ts` 的 `emptyTrash` 与 `purgeAsset` 发 IPC 前加 `window.confirm`，文案含受影响记录数与「只清除数据库记录与缩略图缓存、不删除磁盘原文件」；取消时直接返回、不发出请求；跑 `npm run typecheck` 通过
- [ ] 4.2 在 `tests/uiStore.test.ts` 加用例：把 `window.confirm` 打桩为 `false` 时断言 `assets.purge` / `assets.emptyTrash` 未被调用；打桩为 `true` 时断言被调用一次；跑 `npm run test -- tests/uiStore.test.ts` 全绿
- [ ] 4.3 在 9223 无头桥复验确认文案与后果：清空回收站确认后库文件夹内磁盘文件数量不变，取消后回收站条目不变

## 5. 快捷键焦点作用域

- [ ] 5.1 把「事件目标是否处于可编辑上下文或模态对话框内」抽成纯函数（例如 `isEditableTarget(el: Element | null): boolean`），覆盖 `input`、`textarea`、`contenteditable` 及其后代；跑 `npm run typecheck` 通过
- [ ] 5.2 在 `tests/` 新建该纯函数用例：`input`、`textarea`、`contenteditable="true"`、`contenteditable` 内的子节点、普通 `div`、`null` 各断言一次，跑 `npm run test` 中该文件全绿
- [ ] 5.3 在 `src/renderer/src/App.tsx:113-121` 的按键分发前接入该判断：可编辑上下文中仅 Ctrl F 与 Esc 生效，其余动作不拦截、不 `preventDefault`；跑 `npm run typecheck` 通过
- [ ] 5.4 在 9223 无头桥复验：灯箱打开时在备注输入框内按 ←/→ 只移动光标、不切换素材；在备注框内按 Enter/Space 只输入文本、不打开预览、不改变选中

## 6. 订阅粒度与选择集判定

- [ ] 6.1 在 `src/renderer/src/store/ui.ts` 中随选中集同步维护一个成员索引（Set 或等价结构），与既有选中数组在同一动作内原子更新；跑 `npm run typecheck` 通过
- [ ] 6.2 在 `tests/uiStore.test.ts` 加用例：对一段动作序列（单选、加选、减选、全选、清空、删除选中、恢复选中）逐步断言索引与选中数组一致，跑 `npm run test -- tests/uiStore.test.ts` 全绿
- [ ] 6.3 把卡片与工具栏的选中判定改为读索引，使卡片只订阅「自身是否在集合内」；跑 `npm run typecheck` 通过
- [ ] 6.4 把 `src/renderer/src/App.tsx:23` 的整树订阅 `const s = useUI()` 改为按需选择器，并逐文件收敛 `src/renderer/src/components/*.tsx` 的宽订阅（动作用稳定动作选择器、字段用具体字段选择器、派生集合用浅比较）；每改完一个文件跑一次 `npm run typecheck`
- [ ] 6.5 在 9223 无头桥复验交互未回归：卡片单选/加选/框选、检查器联动、缩放滑块与 Ctrl 滚轮、三视图切换、进度浮层与 toast 并存

## 7. 卡片媒体加载分层与事件推送合并

- [ ] 7.1 按视口活跃度分层卡片缩略图请求：可见卡片的 `previewUrl` 带 `?thumb=1`、离屏卡片保留占位底不发起请求，沿用既有淡入过渡；跑 `npm run typecheck` 通过
- [ ] 7.2 在 9223 无头桥复验：滚动到千级素材库中段时可见卡片均有缩略图、离屏卡片无网络请求，灯箱大图与视频仍读原文件
- [ ] 7.3 把 `src/renderer/src/App.tsx:60` 的 `assets:changed` 处理器改为帧边界合并（同帧内多次事件合并为一次重载），把 `:64-67` 的 `thumbs:progress` 写入改为合并为一次进度快照；跑 `npm run typecheck` 通过
- [ ] 7.4 在 9223 无头桥复验：用脚本连续触发 20 次 `assets:changed`，断言重载只发生一次且最终素材集合正确；连续推送进度事件时浮层最终值与主进程进度一致

## 8. 三维贴图与环境贴图释放

- [ ] 8.1 在 `src/renderer/src/components/Viewer3D.tsx` 的释放遍历中对每个材质先枚举贴图槽位逐一 `dispose()`（`map`、`normalMap`、`roughnessMap`、`metalnessMap`、`emissiveMap`、`aoMap` 等）再 `dispose()` 材质，保持既有 `envRT` / `pmrem` / `ro` / `raf` 释放顺序不变；跑 `npm run typecheck` 通过
- [ ] 8.2 在 9223 无头桥复验释放：打开带多种贴图的 GLB 后连续开关灯箱 10 次，断言 `window.__threeStats` 的挂载数与释放数相等且 GPU 内存无持续上升

## 9. 窄窗可达与搜索框受控

- [ ] 9.1 调整窗口最小宽度约束：`src/main/index.ts:12` 的 `MIN_WINDOW = { width: 1440, height: 860 }`（被 `:46-47` 的恢复夹取与 `:108-109` 的 `minWidth`/`minHeight` 使用）改为允许收窄到小于设计基准的值；跑 `npm run typecheck` 通过
- [ ] 9.2 让标题栏、工具栏与内容区在窄窗下保持可达：工具栏右端控件不因固定宽度被裁切、素材网格按可用宽度重新排布（涉及 `src/renderer/src/components/Toolbar.tsx` 与 `src/renderer/src/components/Grid.tsx` 的布局样式），样式只使用 `tokens.css` 既有令牌；跑 `npm run typecheck` 通过
- [ ] 9.3 在 9223 无头桥复验窄窗：把窗口收窄到小于设计基准宽度，断言搜索框、视图下拉、缩放滑块与窗口控制按钮均可见可点击
- [ ] 9.4 把工具栏搜索框改为受控：输入框内容始终与当前搜索关键词一致，空结果态的「清空搜索」、Esc、切换库标签等入口改写关键词时输入框同步；跑 `npm run typecheck` 通过
- [ ] 9.5 在 9223 无头桥复验：有搜索关键词时点击空结果态的「清空搜索」，断言输入框内容同步为空且网格恢复完整列表

## 10. 集成验证

- [ ] 10.1 跑 `npm run typecheck` 与 `npm run test`，两者全绿并保留输出
- [ ] 10.2 跑 `openspec validate fix-renderer-stability --strict` 通过，确认七个 delta 与两份新能力 spec 均无警告
- [ ] 10.3 按 `src/AGENTS.md` 的 PRE 清单自查：无遗留调试输出与临时断言、无字面颜色、渲染层未直接读盘、通道白名单两处同步未被破坏
- [ ] 10.4 完整重启应用（改了 preload/主进程必须完整重启）后在 9223 无头桥走一遍端到端冒烟：打开库 → 搜索 → 框选 → 打开灯箱 → 回收站恢复与清空 → 关闭应用重启后状态恢复

## Workflow follow-up

- 本 change 的规划工件已完成；实现需等待用户新的 apply 请求（`openspec instructions apply --change fix-renderer-stability`）。
- 实现完成并通过 `openspec-verify-change` 的新鲜验证后，再归档该 change。
- P2/P3 缺陷不在本 change 范围内，另开 change 处理。
