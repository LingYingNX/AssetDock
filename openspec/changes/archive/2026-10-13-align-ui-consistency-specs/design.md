# Design

## Context

本轮 UI 一致性整改的代码已经全部落盘并通过 `npm run typecheck` / `npm test`(193/193) / `npm run build`，且逐条做过真机 DOM 取证。现在的状态是「实现领先于文档」：`openspec/specs/` 里四处文字描述的是整改前的行为。动机见 `proposal.md`，此处只记约束。

约束来自现有规格与代码，不是本 change 的自由选择：

- `openspec/specs/asset-browser/spec.md:98` 明写「网格视图缩略图统一 4:3 … SHALL NOT 受素材原始比例影响」，而卡片要求(`asset-browser/spec.md:109`)又明写缩略图按素材比例展示、超出 `[1/2, 21/9]` 走 `cover`。两条并存时，超宽素材的实际渲染结果由代码选择，规格没裁决。
- `openspec/specs/inspector/spec.md:8` 把间距写成「自上而下按 16px 间距渲染」，同时禁止面板页签；本轮给首块加了分隔线、给若干块加了标题，实测块间 31px。
- `openspec/specs/menus-shortcuts/spec.md:8` 规定下拉菜单条目形态(12.5px / 行高约 30 / 圆角 6)，没有分组标题这种条目。
- `openspec/specs/glass-theme/spec.md:8` 枚举的令牌集不含控件级圆角/高度/图标/字号阶梯，也不含 `--sep`、`--grad-rainbow`、`--star-off`。
- 归档历史 `openspec/changes/archive/2026-08-31-scaffold-glass-ui/` 里留着同一批 spec 的旧版本，说明这套 spec 是被"归档式增量"维护的：改行为就要开 change、写 delta，不能直接改主 spec。
- 类型系统已经把缩略图比例的边界固化成常量：`src/renderer/src/data/thumb-ratio.ts:20-21` 的 `MAX_THUMB_AR = 21/9`、`MIN_THUMB_AR = 1/2`，`thumbRatio()` 在 `:27` 做 clamp 并带 4:3 兜底。

## Goals / Non-Goals

**Goals:**

- 让 `openspec/specs/` 的四处文字与当前实现一致，改行为时有据可依。
- 保持 delta 粒度最小：只改与整改直接相关的 requirement，不动同文件其余条目。
- 把「规格没写但实现已经做了判断」的地方显式写进 spec（超宽素材的填充方式、筛选条分隔线的归属），让下一次改动不必重新猜。

**Non-Goals:**

- 不做任何**行为层面**的新设计：除 placeholder 标点外，本 change 视实现为已定稿，spec 是追认而非重新定义。
- 不动网格视图的 4:3 容器几何：`Grid.tsx` 的 `rowH = Math.round((colw * 3) / 4) + CAPTION_H` 与 `.grid.v-grid .thumb{aspect-ratio:4/3}` 保持原样，本 change 只在 spec 里说清「容器比例」与「容器内填充」是两件事。
- 不统一主界面 12.5px 与偏好设置 13px 两套密度（`--fs-body` 与 `--fs-sub`）：这是既有设计决定，不在本次范围。
- 不新增/改名/移动任何 capability，不碰 `openspec/specs/` 之外的归档目录。

## Decisions

**决策 1：超宽素材走 `contain`，用「原始比例 > MAX_THUMB_AR」作判定**

- 备选 A：保持 `cover`。否决——`cover` 对 1200×172(≈7:1) 素材只能保留中段，用户永远看不到素材整体，这类素材在素材库里存在的理由就是那条长条信息。
- 备选 B：把 `MAX_THUMB_AR` 调小(例如 3:1)。否决——会连带改掉瀑布流列内定位高度(`thumbRatio()` 是所有视图共用的求值入口)，波及虚拟滚动的行高估算，风险远大于收益。
- 采纳的判定是「素材原始比例」而不是「clamp 后的比例」：clamp 后所有超宽素材都是 21/9，用 clamp 值无法区分 3:1 与 20:1，无法只对真正极端的素材开例外。
- 例外限定在瀑布流与网格：列表视图缩略图是固定 96×58 的小图，`cover` 才是正确做法，给它 `contain` 只会得到一条看不清的细线。
- 落点：判定在渲染层(`Card.tsx`，只有那里同时拿到 width/height 与 view)，填充方式在 `grid.css` 的 `.thumb.uw img,.thumb.uw video{object-fit:contain}`。

**决策 2：把 4:3 契约读作「容器几何」，不当作「填充方式」**

`asset-browser/spec.md:98` 的「统一 4:3」「SHALL NOT 受素材原始比例影响」如果读成「像素怎么画」，则与同文件 `:109` 的按比例展示直接冲突(同一张 1200×172 素材，一条说必须 4:3，一条说必须 21:9)。解法是在 delta 里把两条的管辖范围切开：`:98` 管容器几何(网格单元格仍 4:3、仍不随素材变化)，`:109` 管容器内的填充。这样两条都不需要让步，也不需要新增第三个 requirement。

**决策 3：检查器间距从「机械 16px」改为「块内 16px + 块间分隔线」**

- 备选 A：严格回到处处 16px。否决——会把「文件名 + ✎ + 待审 + 星级」这一组同类信息与相邻语义块压成视觉上的一行，正是本轮要修的问题。
- 备选 B：不写间距，只描述分块。否决——`16px` 是能直接被断言的值，删掉它验收时无法核对同级元素间距。
- 采纳的措辞同时保留可断言的 16px(块内)和可断言的 `--sep` 分隔线(块间)，并把 31px 这个实测值表述为结果而非契约——契约是"由分隔线界定"，31px 只是当前实现的算术结果，将来调 `padding-bottom` 不必再开 change。

**决策 4：分组标题作为菜单"条目类型"写进 `menus-shortcuts`，而不是写进 `asset-browser`**

分组能力属于菜单组件本身(`Dropdown.tsx` 的 `MenuItem` 接口加 `heading?`)，格式下拉只是它的第一个调用点。写进 `menus-shortcuts` 的「下拉菜单」requirement 后，将来任何带分组的菜单都自动受这条约束；把"格式下拉分四组"这个具体编排留在 `asset-browser` 并不是必须的，但因为它同时约束了四个组的**名称与顺序**，作为该 capability 的场景保留价值更高，故只在 `menus-shortcuts` 里写通用规则与左对齐细节，避免两处都写产生第二份真源。

**决策 5：令牌集写进 `glass-theme` 的既有 requirement，而非新建 capability**

`glass-theme/spec.md:8` 已是"设计令牌"的归属地，"控件级阶梯"是同一件事的细化，不是新能力。若新建 `ui-tokens` capability，会让"圆角"这一个概念横跨两个 spec，归档后维护成本翻倍。

**决策 6：delta 用 MODIFIED 而非 ADDED，且整块复制原 requirement**

`inspector`、`menus-shortcuts`、`asset-browser` 的三条都是既有 requirement 的文字修正，按 schema 要求必须整块复制(header + 全部 scenario)再改，否则归档时会丢场景。`glass-theme` 的两条是**补充**新约束而非修正旧句，故走 ADDED，避免为了塞进 MODIFIED 而重写 `glass-theme:8` 的现有文字。

## Risks / Trade-offs

- [规格从此承认网格视图缩略图可以留白，而 4:3 容器的 `contain` 在视觉上是"更空的格子"] → 已在 delta 里把例外限定为「原始比例 > `MAX_THUMB_AR`」，界内素材行为一字不变；场景「界内比例仍按 cover 裁切」把这个边界钉成可测项。
- [31px 块间距与 spec 文字"16px"字面不一致，容易被下一个人当 bug 修掉] → delta 里显式写出"间距以分块为单位表达，SHALL NOT 理解为处处等差 16px"，并说明标题与分隔线的角色。
- [placeholder 标点是本 change 唯一的代码改动，容易在归档前被漏做] → `tasks.md` 把它列为独立任务；`proposal.md` 的 Impact 段已点名 `Inspector.tsx:129` 仍是半角逗号。
- [四处 delta 分散在同一次归档，若某条被讨论推翻，其余条目的场景可能连带失效] → 四条彼此独立：分别锚在 `glass-theme` / `asset-browser` / `inspector` / `menus-shortcuts` 的不同 requirement 上，去掉任意一条不影响其余三条的语义完整。
- [真机取证覆盖的是暗色主题下的 DOM/计算样式，不是像素级截图比对] → 本 change 只改文字与一处 placeholder，不引入需要视觉回归的改动；像素级核对作为遗留项记录在 tasks 的验收说明里。

## Migration Plan

1. 归档本 change：`openspec archive align-ui-consistency-specs` 会把四条 delta 合进对应主 spec，场景数增加(新增场景均为追加，不改已有场景名)。
2. 代码改动只有一处：把 `src/renderer/src/components/Inspector.tsx:129` 的 placeholder 逗号改为全角。
3. 回归：`npm run typecheck`、`npm test`(期望 193/193)、`npm run build`。
4. 回滚：本 change 除该 placeholder 外零代码改动，反悔只需 `git checkout` 该文件一处；spec 侧回滚依赖归档前的 git 历史。

## Open Questions

- 主界面 12.5px 与偏好设置 13px 两套密度是否要统一到单一一档：留待将来单独开 change，与本次四条 delta 无耦合。
- 网格视图是否值得为超宽素材把单元格也放宽：属于 4:3 容器之外的新设计，需要新的 scenario，不影响本次判定的正确性。
