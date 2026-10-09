# Proposal

## Why

选中语义与桌面惯例相反：无修饰键单击目前是“加选 / 取消”（`clickCard` 对 Set 做 toggle），于是点第二张卡不会替换选区而是累加，用户无法用一次单击把选择收回到单张；同时右键只弹菜单、不动选区，被右键的素材实际没有被选中（检查器仍显示上一张）。

## What Changes

- `clickCard` 选项扩为 `{ shift?, toggle?, order? }`，三态：无修饰键单选替换、Shift 从锚点重算区间并替换、Ctrl/Cmd 对单项 toggle。
- 新增 `selectOnly(id)`：单选替换且不建全量顺序表，供右键与 Space 复用。
- `Card.onContextMenu` 先将被右键的素材设为唯一选中（已在选区内则保留整组），再弹菜单。
- `App.tsx` 空格键改调 `selectOnly`，避免“按空格取消自己”。

## Capabilities

### Modified Capabilities

- `asset-browser`: 素材卡片的点击选中语义（单选 / Shift 区间 / Ctrl 逐张）与空白区刷选互不得误触。
- `menus-shortcuts`: 右键菜单前的选中前置，以及 Space 的名称由“选中/取消”改为“单选焦点卡片”。

## Impact

`src/renderer/src/store/ui.ts`、`components/Card.tsx`、`App.tsx`、`tests/uiStore.test.ts`、`openspec/specs/asset-browser/spec.md`、`openspec/specs/menus-shortcuts/spec.md`。
不涉及主进程、协议、数据库、渲染样式；不新增依赖。

## 行为变更（破坏性）

- 原“依次单击两张卡片→两张均选中”的累加语义被单选取代；多选改为 Shift（区间）与 Ctrl/Cmd（逐张）。
- Shift 区间从“只增不减”改为“每次从锚点重算并替换”，与 Finder / Explorer / VS Code 一致，但会改变“Shift 累加多段不相邻区间”的旧习惯（该用法应走 Ctrl）。
