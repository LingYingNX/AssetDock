# Proposal

## Why

右键菜单打开时,它在视口上铺了一层全屏遮罩(`ContextMenu.tsx` 根 `div`:`position:fixed;inset:0`,`pointerEvents` 由 `ctxMenu` 决定)。遮罩打开后 `pointer-events:auto`,第二次右键的 `contextmenu` 事件被遮罩接住,处理器只执行 `close()`;被点位置底下的卡片收不到这次事件。用户看到的是「在菜单打开状态下右键另一张素材,第一次只是菜单消失,要再右键一次才真正选中并弹菜单」多一次无意义的点击。

## What Changes

- 遮罩的 `onContextMenu` 在关闭菜单之后,把自身临时移出命中测试(`pointerEvents` 置为 `none`),用 `document.elementFromPoint` 取到该坐标下的真实元素,再把同坐标的 `contextmenu` 原样转发给它;于是这一次右键就直接完成「选中新目标 + 弹出新菜单」。
- 命中结果仍落在遮罩内部时(点在菜单自身或遮罩空白处)不转发,避免事件再次冒泡回同一处理器形成递归。
- `pointerEvents` 的还原值取改写前的实际值,不硬写 `'auto'`:菜单关闭后的退场期间 `ctxMenu` 为 `null`,遮罩自身就应是 `'none'`,硬写会让已关闭的遮罩继续吃掉一次点击。

## Capabilities

### Modified Capabilities

- `menus-shortcuts`:「右键菜单」补充「菜单已打开时再次右键」的行为要求直接作用于被点位置的素材并重建菜单,不要求用户先关闭再右键。

## Impact

**代码**:`src/renderer/src/components/ContextMenu.tsx` 一个事件处理器(第 241 行的 `onContextMenu`),无新增依赖、无接口改动。

**测试**:纯 DOM 事件时序,渲染层无组件单测(参见 `tests/AGENTS.md`:React 组件与真实窗口不在 vitest 范围)。走 127.0.0.1:9223 无头调试桥以真实命中路径验证。

## 行为变更(破坏性)

无。这是既有交互的缺陷修复:此前第二次右键总要先消耗在关菜单上,修复后一次右键即达意图。
