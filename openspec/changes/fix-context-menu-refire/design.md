# Design

## Context

`src/renderer/src/components/ContextMenu.tsx:238-241` 的根节点同时承担两个职责:菜单的点击穿透遮罩(`onClick={close}`)与右键兜底(`onContextMenu`)。遮罩铺满视口,菜单打开时 `pointerEvents:'auto'`,因此 `document.elementFromPoint` 在卡片位置返回的是遮罩而非卡片。

实测(dev 桥,真实命中路径):

- 第一次右键 card0 后:`{"sel":["a8192"],"ctx":"a8192","menus":1}`
- 对 card1 中心做 `elementFromPoint` 返回 `DIV`(无 class,即遮罩)
- 在 card1 上派发右键后:`{"sel":["a8192"],"ctx":null}`  只关了菜单,选中未变

仓库里只有 ContextMenu 用「全屏遮罩」这一模式:`SettingsMenu.tsx:86-95` 与 `Dropdown.tsx:87-105` 都用 `document` 级 `pointerdown` 捕获 + Escape,并把浮层 `createPortal` 到 body。因此该缺陷的成因是本组件独有的,修复也只应落在这里,不去改另外两处的既有模式。

## Goals / Non-Goals

**Goals**:菜单已打开时,一次右键即完成「关闭旧菜单 + 选中新目标 + 弹出新菜单」。

**Non-Goals**:不改 `Dropdown` / `SettingsMenu` 的关闭方式;不把遮罩换成 `document` 级监听(那会改变既有的「点遮罩关闭」语义,超出本次范围);不动 `Card.onContextMenu` 的选中逻辑。

## Decisions

1. **在遮罩上转发,而不是让卡片穿透**。备选方案是给卡片加 `pointer-events:auto` 或提高层级,但那会破坏「点遮罩关闭」的既有交互,且卡片数量大、层级调整影响面广。转发只在右键这一条路径上生效,影响面收敛在一个处理器内。

2. **临时置 `none` 再 `elementFromPoint`,而不是用 `e.composedPath()` 或坐标反查卡片**。`composedPath` 在遮罩命中时只给出遮罩自身;按坐标反查卡片需要知道网格的 DOM 结构,把组件的耦合面扩大。`elementFromPoint` 复用浏览器自身的命中测试,结果就是「用户实际点到的东西」。

3. **还原为改写前的值而非 `'auto'`**。菜单关闭后 `ctxMenu` 为 `null`,遮罩在退场期间本就该是 `'none'`;硬写 `'auto'` 会让一次右键在菜单已关闭的瞬时被遮罩吞掉,成为同一类缺陷的另一种表现。

4. **命中仍在遮罩内就不转发**。转发的事件会冒泡回同一个处理器,若不设这条边界,在菜单自身区域右键会无限递归。

## Risks / Trade-offs

- 合成事件由 `dispatchEvent` 派发,不携带原事件对象的 `isTrusted`。卡片与菜单的处理器都只读坐标与被点元素,不校验 `isTrusted`,因此无影响。
- 转发的是 `contextmenu`,不含 `pointerdown`/`mousedown`。`Card.onContextMenu` 只需要 `contextmenu` 就能完成选中,已实测通过。

## Open Questions

无。
