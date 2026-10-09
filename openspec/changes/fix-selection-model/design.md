# Design

## Context

`store/ui.ts` 的 `clickCard` 一度把“单击”和“加选”合并成同一个分支：无 `shift` 时对 `selectedIds` 做 toggle。这个设计在只有“选中一张后点另一张”时看不出问题，
但两张以上就会积累选区，且“取消”与“单选”共用一个入口，无法表达“把选择收回到这一张”。右键则完全不碰 `selectedIds`，`ContextMenu` 只能在渲染时推断作用范围（已选则整组，否则单张），但视觉与检查器都没跟上。

## Goals / Non-Goals

- 目标：三个选择入口（单击、Shift+单击、Ctrl/Cmd+单击）行为与桌面惯例一致；右键自选中；`activeId` / `focusedCardId` 在每个分支都与 `selectedIds` 同步。
- 非目标：不改空白区 marquee 的替换语义（已正确）；不改 `ContextMenu` 的 `targetIds`（已正确）；不改拖拽起始的 `selectedIds` 过滤；不为“双击进灯箱”加延时定时器。

## Decisions

### 1. 三态而不是二态：默认分支改为单选替换

```ts
clickCard: (id, options) => set((s) => {
  const order = options?.order ?? s.assets.map((a) => a.id)
  if (options?.shift)   { /* 从 selectionAnchorId 重算区间并整体替换，锚点不动 */ }
  if (options?.toggle)  { /* 对 id 单项 toggle，其它卡片不动 */ }
  return { selectedIds: [id], selectionAnchorId: id, activeId: id, focusedCardId: id }
})
```

- Shift 分支不更新 `selectionAnchorId`，这样连续 Shift 能从同一锚点扩展与收窄；默认与 toggle 分支都把锚点落到 id。
- Shift 分支从“在副本 Set 上累加”改为“直接赋值为区间”：否则连点三次 Shift 会得到三段的并集，退不回去。

### 2. `selectOnly` 独立于 `clickCard`

Space 与右键都只需要“单选这一张”，不需要顺序表也不需要区间算法。若让它们走 `clickCard(id)`，每次都会在无 `order` 时构造 `s.assets.map(...)` 全量 id 数组（万级素材每按一次空格建一次）。单独一个 action 也让“右键选中”语义不依赖 `clickCard` 的未来变化。

### 3. 右键选中写在 `Card.onContextMenu`，不写进 `setCtxMenu`

`setCtxMenu` 还有第二个调用方：`Card.tsx` 列表视图的“更多操作”按钮（`setCtxMenu({ x, y, assetId })`）。若在 store 里统一改写选区，该按钮也会被静默附加选中副作用，且未来任何新入口都会继承。右键选中是“在素材上右键”这个手势的语义，应留在手势发生地。

### 4. 已在选区内的右键保留整组

`if (!selectedIds.includes(a.id)) selectOnly(a.id)`。这与 `ContextMenu` 的 `targetIds` 一致：右键已选中项之一时，菜单仍作用于整组，不会把用户剚开的多选单归并成一张。

## Risks / Trade-offs

- 双击进灯箱会先触发两次 `onClick`（各走一次单选）再触发 `onDoubleClick`；因 `openLightbox` 会重写 `activeId/focusedCardId`，最终态一致，无需 click-defer延时。
- Shift 区间改为替换会破一次旧肌肉记忆，在 proposal.md 已标为行为变更。

## Open Questions

- 无。
