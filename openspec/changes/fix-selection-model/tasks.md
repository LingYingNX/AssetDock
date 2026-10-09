# Tasks

## 1. store 层

- [x] 1.1 `src/renderer/src/store/ui.ts:290` 的 `clickCard` 签名扩为 `options?: { shift?: boolean; toggle?: boolean; order?: string[] }`，并在其后新增 `selectOnly: (id: string) => void`；验证：`npm run typecheck` exit 0
- [x] 1.2 `clickCard` 实现改三态（`src/renderer/src/store/ui.ts:728`）：无修饰键返回 `{ selectedIds: [id], selectionAnchorId: id, activeId: id, focusedCardId: id }`；Shift 从 `selectionAnchorId` 重算 `order.slice(min, max+1)` 并整体替换、锚点不动；`toggle` 对单项翻转
- [x] 1.3 `selectOnly` 实现为纯赋值：不读 `order`、不走区间分支

## 2. 组件与快捷键

- [x] 2.1 `src/renderer/src/components/Card.tsx:116` 的 `onClick` 传 `{ shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey, order: selectionOrder }`
- [x] 2.2 `src/renderer/src/components/Card.tsx:148` 的 `onContextMenu` 在 `setCtxMenu` 前加“不在选区内则单选”：`if (!useUI.getState().selectedIds.includes(a.id)) selectOnly(a.id)`
- [x] 2.3 `src/renderer/src/App.tsx:128` 空格键由 `st.clickCard(st.focusedCardId)` 改为 `st.selectOnly(st.focusedCardId)`

## 3. 验证

- [x] 3.1 `tests/uiStore.test.ts` 新增两个用例：三态分支（替换 / 区间 / toggle）与 `selectOnly` 的同步字段；验证：`npm run test -- tests/uiStore.test.ts` 23/23 通过
- [x] 3.2 全量回归：`npm run test` 22 个文件 145/145 通过
- [x] 3.3 类型检查：`npm run typecheck` exit 0（node + web 两侧）
- [x] 3.4 真实 UI 路径验证（dev 调试桥 `tools/hhead.mjs`，向 DOM 派发真实 MouseEvent）：
  - `click card0` → `["a8200"]`；`click card1` → `["a8192"]`（无累加，上一次选中被替换）
  - `click card0` + `Shift+click card2` → `["a8200","a8192","a8191"]`（区间，`activeId`/`focusedCardId` = a8191）
  - `Ctrl+click card1`（当时已选）→ 移除 a8192；再次 `Ctrl+click` → 追加回来
  - 在未选中卡片上 `contextmenu` → `selectedIds=["a8192"]`、`activeId=a8192`、`ctxMenu.assetId=a8192`
  - 选中 {a8200, a8191} 后在已选的 a8191 上 `contextmenu` → 选区保持 `["a8200","a8191"]`，`ctxMenu.assetId=a8191`
  - 未覆盖：Space 单选（测试桥未模拟 window 的 `keydown`，仅有 store 层单测）与双击进灯箱的手感，需人工目视

## 4. 收尾

- [x] 4.1 无遗留 debug 输出；一次性补丁脚本 `tools/.tmp-selection-patch.mjs` / `.tmp-card-patch.mjs` / `.tmp-fix-call.mjs` / `.tmp-test-patch.mjs` 已删除
