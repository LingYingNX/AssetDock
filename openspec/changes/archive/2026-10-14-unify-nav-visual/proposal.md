# Proposal

## Why

侧栏与筛选条处在同一视觉层级，却各自混着多档字号、多档图标尺寸，侧栏同一列里还有三套不同的文字左沿（分组标题 36px、条目 43px、「管理标签」40px），并且并列着「全部素材 4,084」与「图 4,074」两种计数口径。这既违反 `glass-theme` 已写明的「同一层级的同类控件 SHALL 取同一档」，也让下一个改侧栏的人没有可依的稳定基准。同时侧栏最后一组「颜色筛选」与筛选条的「颜色构造」浮层职责重叠，把侧栏从三组结构撑成四组。

## What Changes

- **侧栏图标同档**：分组标题、导航条目、「管理标签」按钮的图标统一到 `--ic-md`(16px)；`.side-title-add` 保留 `--ic-sm`(14px)（它是 24px 方形按钮内的图标，与筛选条 `.cbtn` 的比例一致）。
- **侧栏间距与左沿对齐**：`.side-title` / `.side-title-label` / `.side-add` 的图标文字间距统一 9px，三处文字左沿一律 43px；`.side-add` 高度由 `--h-sm`(28px) 并入 `--h-md`(32px)，不再是同列里唯一矮 4px 的行。
- **筛选条字号收拢**：在 `.filterbar` 上统一声明 `font-size:var(--fs-body)`，使此前继承 `body` 13px 的 `.cbtn` / `.tb-btn` / `.zoomer` 与同排显式声明字号的控件同档（不改 `body` 基准，`glass-theme` 规定基础字号 13px）。
- **筛选条图标同档**：`.zoomer .ic` 由 `--ic-sm`(14px) 并入 `--ic-md`(16px)；`.filterbar .btn .chev` 保持 `--ic-xs`(12px)，与侧栏 `.nav-item .chev` 同档。
- **色点回落单一真源**：删除 `.filterbar .btn .dot` 的 7px 就地覆盖，回落 `tokens.css` 的全局 `.dot` 8px。
- **计数统一千分位**：侧栏全部计数走同一个格式化函数，消除「4,084」与「4074」并列。
- **齿轮菜单贴合行高**：`.settings-menu` 去掉上下 6px 内边距与分组分隔线（该菜单只有一组项，线在这里没有分组语义），使菜单项高亮铺满菜单边缘，不再在首末项上方/下方各留一条无高亮暗带；子菜单随之由 `top:-7px` 收到 `-1px`（原先那 6px 是在补父菜单的内边距）。
- **删除侧栏「颜色筛选」分组**（**BREAKING**：侧栏颜色多选筛选不再可用，按主色找素材改走筛选条的「颜色构造」浮层）：删除该分组及其全部连带链路`SWATCHES` 数据集、store 的 `swatches` / `toggleSwatch` / `clearSwatches`、`QueryOptions.swatches` 与对应过滤分支、四个消费组件（`ColorStrip` / `Filmstrip` / `FilterBar` / `Grid`）的入参、三处测试参数。颜色构造浮层与色带单选筛选（`stripColor`、`--grad-rainbow`）**保留**。

## Capabilities

### New Capabilities

（无。本轮是对既有 capability 的规格收敛与一处能力删除，不引入新能力。）

### Modified Capabilities

- `asset-browser`：「侧栏导航」由四组改三组，并写入统一后的图标档位 / 间距 / 计数契约（原 requirement 含已删行为的场景，故以 REMOVED + ADDED 换形）；「SQLite 数据集」的过滤语义描述去掉已删的「颜色筛选」，改为仍存在的「色带筛选」。
- `palette`：「筛选数据源切换」只覆盖颜色构造浮层；Purpose 里的「侧栏颜色圆点筛选」一并去掉（delta 改不了既有 spec 的 Purpose，按 CLI 提示直接编辑主 spec）。
- `glass-theme`：「共享视觉常量唯一真源」不再把已删除的「全部颜色」色块列为 `--grad-rainbow` 的引用点（同样 REMOVED + ADDED 换形，保留 `--star-off` 子句）。

## Impact

- 样式：`src/renderer/src/styles/sidebar.css`、`src/renderer/src/styles/content.css`、`src/renderer/src/styles/menu.css`
- 组件：`src/renderer/src/components/Sidebar.tsx`、`FilterBar.tsx`、`Grid.tsx`、`ColorStrip.tsx`、`Filmstrip.tsx`、`SettingsMenu.tsx`、`PreferencesDialog.tsx`
- 数据与状态：`src/renderer/src/data/dataset.ts`、`src/renderer/src/data/query.ts`、`src/renderer/src/store/ui.ts`
- 测试：`tests/query.test.ts`、`tests/uiStore.test.ts`
- 规格：`openspec/specs/asset-browser/spec.md`、`openspec/specs/palette/spec.md`、`openspec/specs/glass-theme/spec.md`
- 无新增依赖、无主进程改动、无数据结构与 IPC 改动（`uiPrefs` 从未持久化 `swatches`，无需迁移）。