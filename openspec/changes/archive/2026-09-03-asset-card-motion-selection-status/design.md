## Context

三维卡片的中央角标由 `Card.tsx` 的 `.orb` 渲染；悬停位移和缩放来自 `grid.css`。筛选条已有 `statsOf` 可统计任意素材集合。

## Approach

- 删除卡片 `.orb` 节点及其死样式；保留灯箱中的转台控件和三维自转。
- 删除 `.card:hover` 和 `.card:hover .thumb` 的 transform。
- `FilterBar` 订阅 `selectedIds`，选中集合非空时用 `statsOf` 统计选中素材并显示选中文案；空集合回退到当前筛选结果。

## Trade-offs

- 悬停只保留边框和控件显隐反馈，不做位移动画；这符合用户要求并减少网格滚动时的视觉扰动。
