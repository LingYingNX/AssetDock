# Design

## Context

改动前的真机事实（`node tools/hhead.mjs` 经 dev 无头调试桥 `127.0.0.1:9223` 取计算样式与 DOM，逐行格式为「图标左沿 / 文字左沿 / 高 / font-size / 图标宽 / gap」）：

- 侧栏分组标题 `.side-title`：图标 12px(`--ic-xs`)、gap 6px、文字左沿 36px；导航条目 `.nav-item`：图标 16px、gap 9px、文字左沿 43px；「管理标签」`.side-add`：图标 14px(`--ic-sm`)、gap 8px、高 28px(`--h-sm`)、文字左沿 40px。同一列三种左沿、三种图标档、两种行高。
- 筛选条 `.filterbar` 自身未声明 `font-size`，`.cbtn` / `.tb-btn` / `.zoomer` 因此继承 `tokens.css` 的 `body{font:13px/1.5}`，而同排 `.filterbar .btn` / `.searchbox .input` 显式声明 `--fs-body`(12.5px)；`.zoomer .ic` 是筛选条里唯一的 14px。
- 侧栏计数两种口径并列：`Sidebar.tsx` 的「全部素材」用 `c.all.toLocaleString('en-US')`（「4,084」），文件夹行与其它计数用裸 `{n.count}`（「4074」）。
- `.filterbar .btn .dot` 就地覆盖为 7px，而全局 `.dot` 是 8px。
- 侧栏「颜色筛选」分组的连带面：`data/dataset.ts` 的 `SWATCHES`、`store/ui.ts` 的 `swatches`/`toggleSwatch`/`clearSwatches`、`data/query.ts` 的 `QueryOptions.swatches` 与过滤分支、四个消费组件（`ColorStrip` / `Filmstrip` / `FilterBar` / `Grid`）的入参、三处测试参数。
- `uiPrefs` 只持久化 `view`/`colw`/`inspHidden`/`cbarOpen`/`nav`/`collapsedFolders`，**不含** `swatches`，删除状态字段不涉及持久化迁移。
- 测试边界（`tests/AGENTS.md`）：渲染层组件不做渲染测试，React 与真实窗口走 9223 桥；`tests/` 无 `@testing-library`，无独立 vitest 配置。
- 令牌真值（`tokens.css`）：`--h-xs` 24 / `--h-sm` 28 / `--h-md` 32 / `--h-bar` 42；`--ic-xs` 12 / `--ic-sm` 14 / `--ic-md` 16 / `--ic-lg` 20 / `--ic-xl` 30；`--fs-micro` 10.5 / `--fs-cap` 11 / `--fs-body` 12.5 / `--fs-sub` 13 / `--fs-title` 14。`glass-theme` 明写「同一层级的同类控件 SHALL 取同一档」与「基础字号 13px/行高 1.5」。

## Goals / Non-Goals

**Goals:**

- 侧栏同一列的文字左沿、图标档位、行高收敛到单一档位，不再并存 12/14/16px 与三种左沿。
- 筛选条内所有控件的字号与图标档位与同排显式声明者一致，不再依赖 `body` 继承。
- 侧栏计数统一为同一格式化口径。
- 删除侧栏「颜色筛选」分组及其全部连带链路，仓库零残留。

**Non-Goals:**

- 不动 `body` 的 13px 基准与偏好设置的 13px 密度（两套密度需另开 change）。
- 不动 `.searchbox` 的 34px 高度（星云输入框已由用户验收）、`.fresult` 的 `--fs-cap` 11px 层级、`.dot` 的 6/7/8px 分档语义、网格视图 4:3 容器几何。
- 不删颜色构造浮层与色带单选筛选（`stripColor`、`--grad-rainbow`），只删侧栏那套多选圆点。

## Decisions

### D1：侧栏图标统一到 `--ic-md`(16px)，而不是把标题图标放大到与条目不同的档

分组标题、条目、「管理标签」取同一档后，三处文字左沿在 9px 间距下自动对齐到 43px（10px padding + 16px 图标 + 9px gap = 35px 图标区，加 `.side-scroll` 的 8px 内边距与行内 10px padding 形成实测 43px）。唯一例外 `.side-title-add` 保留 `--ic-sm`：它位于 24px 方形按钮内，比例 14/24  0.58，与筛选条 `.cbtn` 的 16/28  0.57 同族。

### D2：不新增 `--fs-mark:9px` 令牌，不改 9/10px 角标字号

`.cs em`(9px)、`.palette .pal em`(10px)、`.palette .pal span`(9px)、`.pv-reel-mark`(9px) 都是叠加在图形上的角标，尺寸受容器约束，属既有设计；新增令牌只会扩大面而收益为零（YAGNI）。列为已知不改动项。

### D3：不动 `body` 的 13px，改在 `.filterbar` 上收拢

`glass-theme` 规定基础字号 13px/行高 1.5，`body` 的 13px 是主界面基准。收拢点选在 `.filterbar` 一处，后代继承即可覆盖 `.cbtn` / `.tb-btn` / `.zoomer` 三个纯图形控件（它们内部无文字，视觉影响为零，但满足「界面样式 SHALL 引用令牌，SHALL NOT 就地写同一语义的字面值」）。

### D4：删「颜色筛选」删到底，不保留空壳

保留 `SWATCHES` 或 store 字段只会留下无人读的死状态；而 `QueryOptions.swatches` 一旦保留，`queryAssets` 就继续携带一个永不非空的过滤分支。故 store 字段、query 入参、消费组件参数、测试参数一并删除。反向确认：删除后对 `src` 与 `tests` 全量检索 `swatches|SWATCHES|toggleSwatch|clearSwatches` 零命中。

### D5：颜色构造浮层与侧栏圆点是两套机制，只删后者

侧栏圆点走 `swatches`（多选、`paletteHasColor` 逐色匹配）；筛选条的颜色构造浮层走 `stripColor`（单选色带块）并消费 `aggregatePalette`。用户只要求删前者。`--grad-rainbow` 的现存消费者只剩筛选条色轮按钮 `.cball`（`content.css`），因此 `glass-theme` 里「色轮按钮与「全部颜色」色块」的并列措辞必须改写。

### D6：规格换形用 REMOVED + ADDED，不用「保留场景名、改写场景正文」

`侧栏导航` 与 `共享视觉常量唯一真源` 各含一条描述已删行为的场景（「颜色多选与清空」「两处彩虹色带起点一致」）。`openspec` 的校验器（`dist/core/parsers/requirement-blocks.js` 的 `diffScenarioNames` 与 `validator.js`）把「MODIFIED 块丢弃主 spec 仍有的场景」判为 `ERROR`，validate 与 archive 共用同一判断，且**没有场景级删除机制**。仓库既有先例是 `2026-09-19-titlebar-menu-compact`：`## REMOVED Requirements` 撤旧名 + `## ADDED Requirements` 增改名后的新 requirement。本次沿用该机制：`侧栏导航`  `侧栏导航与分组`，`共享视觉常量唯一真源`  `彩虹色带与星色令牌唯一真源`，两条幸存场景原样带过。

### D7：`palette` 的 Purpose 直接改主 spec

`specs-apply.js` 对既有 spec 的 delta `## Purpose` 只 `warn` 并忽略，提示「Edit <target> directly to change it」。故 `openspec/specs/palette/spec.md:3` 的「颜色构造浮层与侧栏颜色圆点筛选」直接去掉后半句，并在 `tasks.md` 留证据。

### D8：顺手校正 `条目高 29px`

`asset-browser` 的「侧栏导航」正文写「条目高 29px」，而实现是 `.nav-item{height:var(--h-md)}` = 32px，真机实测 32px。本 change 的主题正是排版统一，把该值校正为 `--h-md`(32px) 并写进 delta。

### D9：齿轮菜单去掉上下内边距与分组分隔线

`.settings-menu` 原为 `padding:6px 0`：菜单项高 32px，其上、下各留 6px 无高亮的菜单底色，悬停首末项时高亮不贴边，读成「高亮没占满」。且该菜单只有一组项，`.settings-menu-divider` 在这里没有分组语义。故 `padding` 归零、删分隔线规则与 `SettingsMenu.tsx` 里的分隔线 JSX；`.settings-menu-submenu` 的 `top:-7px` 原是为抵消父菜单那 6px 内边距，随之改为 `-1px`（抵消菜单自身 1px 边框，使子菜单首项与父项顶对齐）。`.settings-menu-item` 的 `margin:0 -1px` 水平出血是原有行为，未改；`.menu .sep` 等其它 `--sep` 消费者不受影响，`glass-theme` 的「分隔线令牌」要求只约束令牌本身，不要求某个菜单必有分隔线。

## Risks / Trade-offs

- **REMOVED + ADDED 会改动 requirement 名**：`侧栏导航` 与 `共享视觉常量唯一真源` 改名后，历史归档里引用旧名的文字会指向旧名。仓库已有同类改名先例（`库标签页`  `库标签页与紧凑菜单`），且旧名不再描述新契约，改名优于保留错名。
- **侧栏颜色筛选是不可回退的用户可见功能**：按主色筛选的入口从侧栏移到筛选条的「颜色构造」浮层，交互从多选变为单选色带块。这是需求明确要求的行为变化（**BREAKING**），已在 proposal 标注。
- **计数千分位是行为变化**：文件夹行由「4074」变「4,074」，与「全部素材」口径一致；用户截图里两种口径并列，属可见的排版不一致，故统一而非保留。
- **未做像素级比对**：dev 实例只暴露 9223 表达式执行桥（`webContents.executeJavaScript`），无 CDP 端口；验证依靠 DOM 属性与计算样式真值，没有像素证据。`mcp__blender__look` 在本机不可用（Blender 未连接），无法看图。

## Migration Plan

- 无数据迁移：`uiPrefs` 未持久化 `swatches`；旧的持久化偏好里即使残留该键，读取路径也不再消费。
- 调用方迁移：`queryAssets(assets, opts)` 的 `opts` 去掉 `swatches`，传 `{ nav, search, filters, stripColor }` 即可；`paletteHasColor` 保留（`stripColor` 分支仍在用）。

## Open Questions

- 无。侧栏三组的构成、图标档位、间距与计数口径均已按需求落地并取证。