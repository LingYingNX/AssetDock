# Proposal

## Why

本轮 UI 一致性整改已经落盘并逐条真机取证，但其中四处行为与 `openspec/specs/` 的现行文字不一致：检查器的块间距契约写死「自上而下 16px」，超宽素材的填充仍规定 `object-fit:cover`，格式下拉新增了分组标题这一条目类型，设计令牌集比 spec 列举的多出一整层控件级阶梯。spec 是后续归档与验收的依据，现在不同步，下一次改检查器或缩略图的人会照着过期契约做。

## What Changes

- **检查器块间距语义**：首块（颜色构造 / 文件名）明确承担面板标题角色，用 `padding-bottom:14px` + 一条 `--sep` 分隔线与后续块分开；被标题化的块（评分与状态、文件信息、标签、来源链接、备注）各自带 `.insp-h` 标题。间距描述从「机械 16px」改为「块内元素 16px、块间由分隔线界定」。
- **超宽素材填充规则**：原始比例超过 `MAX_THUMB_AR`(21/9) 的素材在瀑布流与网格视图中改用 `object-fit:contain`，整条可见；比例在 `[1/2, 21/9]` 内的素材维持 `cover` 居中裁切不变。
- **下拉菜单分组标题**：筛选类下拉支持不可点的分组标题条目（格式下拉分为 图片 / 视频 / 三维 / 代码 四组）。
- **筛选条分组分隔线**：筛选组与「已选中 N 项」之间新增一条竖分隔线，`margin-left:auto` 归它承担，结果统计不再独自悬空。
- **设计令牌阶梯**：把本轮引入的控件级令牌记入 spec —— 圆角 4 档、控件高 4 档、图标 5 档、字号 5 档，以及 `--sep` 分隔线、`--grad-rainbow` 彩虹唯一真源、`--star-off` 未选中星色。
- **标签输入框 placeholder 标点**：`输入标签,Enter 添加` 的半角逗号改为全角，与界面其余中文标点一致（spec 与代码同改，是本 change 唯一的实现改动）。**BREAKING**：无。

## Capabilities

### New Capabilities

（无。本轮全部是对既有 capability 的规格收敛，不引入新能力。）

### Modified Capabilities

- `glass-theme`: 「设计令牌与壁纸」要求补充控件级令牌阶梯（`--r-xs/--r-sm/--r-md/--r-pill`、`--h-xs/--h-sm/--h-md/--h-bar`、`--ic-xs…--ic-xl`、`--fs-micro…--fs-title`）与新增语义令牌（`--sep`、`--grad-rainbow`、`--star-off`）。
- `asset-browser`: 「素材卡片」要求为超出 `MAX_THUMB_AR` 的素材增加 `contain` 例外，并同步「极端比例缩略图收敛」场景；「筛选条」要求补充筛选组与结果统计之间的竖分隔线；「三视图切换」要求把「统一 4:3」限定为容器几何。
- `inspector`: 「面板结构与内容」要求把首块改为面板标题角色 + 分隔线，并把间距描述从机械 16px 改为「块内 16px、块间分隔线」；placeholder 标点改为全角。
- `menus-shortcuts`: 「下拉菜单」要求增加分组标题条目类型及其渲染规则（不可点、`--fs-cap`、`--t3`、不参与单选互斥）。

## Impact

- 代码：`src/renderer/src/styles/tokens.css`、`inspector.css`、`grid.css`、`menu.css`、`content.css`；`src/renderer/src/components/Inspector.tsx`、`Card.tsx`、`Dropdown.tsx`、`FilterBar.tsx`。其中除 placeholder 标点外均已落地（本 change 对其只是把行为写回 spec）；`Inspector.tsx:129` 的 `placeholder="输入标签,Enter 添加"` 当前仍是半角逗号，需在 apply 阶段跟随 spec 改为全角。
- 规格：`openspec/specs/glass-theme/spec.md`、`asset-browser/spec.md`、`inspector/spec.md`、`menus-shortcuts/spec.md`。
- 无 API、依赖或数据结构改动；不改主进程与 `windowApi`。
- 已知不改动项：网格视图的 4:3 容器（`Grid.tsx` 的 `rowH` 与 `.grid.v-grid .thumb{aspect-ratio:4/3}`）与主界面 12.5px / 偏好设置 13px 两套密度按既有规格保留。
