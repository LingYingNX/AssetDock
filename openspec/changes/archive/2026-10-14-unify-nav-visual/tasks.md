# Tasks

## 1. 侧栏视觉统一（`styles/sidebar.css`）

- [x] 1.1 把分组标题的图标档与间距收进令牌：`.side-title{gap:6px}` 与 `.side-title-label{gap:6px}` 改 `gap:9px`，`.side-title .ic{--ic-xs}` 改 `--ic-md`；改后 `npm run typecheck` 通过
  - 证据：三处 `.Replace()` 均 `count=1` 命中；`.side-title-label` 必须同改「素材管理」的图标包在该 span 内，不同步则该组文字左沿比其他两组差 3px。
- [x] 1.2 把「管理标签」行并入同列节奏：`.side-add{gap:8px;height:var(--h-sm)}` 改 `gap:9px;height:var(--h-md)`，`.side-add .ic{--ic-sm}` 改 `--ic-md`；`.side-title-add .ic` 保持 `--ic-sm`（24px 方形按钮内的图标）；跑 `npm run typecheck` 通过
  - 证据：两处替换 `count=1`；`.side-add` 由 28px 变 32px，不再是与同列条目矮 4px 的异类行。
- [x] 1.3 侧栏计数统一千分位：计数格式化函数放在 `data/query.ts` 的「展示格式化」区（`formatBytes` / `statsOf` 旁），`Sidebar.tsx` 与 `FilterBar.tsx` 共用，并把「全部素材 / 最近导入 / 未分类 / 收藏 / 回收站 / 文件夹行 / 标签行」的计数全部改走它；跑 `npm run typecheck` 通过
  - 证据：`>{n.count}<` 命中 2 处（文件夹行）、`>{c.recent}<` / `>{c.untagged}<` / `>{c.fav}<` / `>{c.trash}<` / `>{info.n}<` 各 1 处、`>{c.all.toLocaleString('en-US')}<` 1 处（改为 `fmtCount(c.all)`）；全部替换成功。
  - 评审后修订：该函数原内联在 `Sidebar.tsx`，按评审结论上提到 `query.ts`；同区已有的 `formatFaces` 是逐字相同的 `n.toLocaleString('en-US')` 且全仓零调用方（面数功能撤销后的遗留），故直接改名并加注为 `fmtCount`，不新增第二份实现。`FilterBar.tsx` 的「已选中 / 筛选结果」两处计数与 `PreferencesDialog.tsx` 的内联 `toLocaleString('en-US')` 一并通过它格式化，同屏不再并存两种口径。

## 2. 删除侧栏「颜色筛选」分组及其连带链路

- [x] 2.1 删 `styles/sidebar.css` 里 5 条 swatches 规则（`.swatches` / `.sw` / `.sw:hover` / `.sw.on::after` / `.sw.all`），文件尾的 reduced-motion 注释保留；跑 `npm run typecheck` 通过
  - 证据：整块按 `\r\n` 归一后精确匹配删除，`count=1`；`sidebar.css` 由 98 行变 94 行。
- [x] 2.2 删 `src/renderer/src/data/dataset.ts` 的 `SWATCHES` 注释与 export（原 24-36 行），保留 `COLOR_STRIP`；跑 `npm run typecheck` 通过
  - 证据：`dataset.ts` 704  690 行。
- [x] 2.3 删 `src/renderer/src/data/query.ts` 的 `SWATCHES` import、`QueryOptions.swatches` 字段与注释、`opts.swatches` 过滤分支、`export` 尾参；`paletteHasColor` 与 `stripColor` 分支保留；跑 `npm run typecheck` 通过
  - 证据：`query.ts` 312  309 行（删 100/101/177 行），import 与 re-export 行内替换各 `count=1`。
- [x] 2.4 删 `src/renderer/src/store/ui.ts` 的 `swatches` / `toggleSwatch` / `clearSwatches` 接口三行、实现六行、`selectAllVisible` 的传参；`stripColor` / `cbarOpen` 保留；跑 `npm run typecheck` 通过
  - 证据：`ui.ts` 911  901 行；另核对 `persistUiPrefs()` 只持久化 `view/colw/inspHidden/cbarOpen/nav/collapsedFolders`，**不含** `swatches`，故无持久化迁移。
- [x] 2.5 删 `Sidebar.tsx` 的 `SWATCHES` import、三个 hook 与整个颜色筛选 `<section>`；跑 `npm run typecheck` 通过
  - 证据：`Sidebar.tsx` 490  462 行。中途一次调用写成 `Del-Lines $sb @(3,276,277,278) + @(462..485)`，PowerShell 把 `+` 右侧数组当独立表达式丢弃，实际只删了前三行；改为单个数组字面量后补删成功。
- [x] 2.6 删四个消费组件的 `swatches` 入参与依赖项：`ColorStrip.tsx`、`Filmstrip.tsx`、`FilterBar.tsx`、`Grid.tsx`（含 `resetKey` 里的 `${swatches.join(',')}|`）；跑 `npm run typecheck` 通过
  - 证据：`ColorStrip.tsx` 133  132、`Filmstrip.tsx` 152  151、`FilterBar.tsx` 229  228、`Grid.tsx` 462  461 行。`Grid.tsx` 的锚点含 `${...}`，在 PowerShell 单引号里被 `''` 转义写坏导致 `count=0`，改用双引号 + 反引号转义后 `count=1` 成功。
- [x] 2.7 删测试里的 `swatches` 参数：`tests/query.test.ts` 两处、`tests/uiStore.test.ts` 一处；跑 `npm run test -- tests/query.test.ts` 全绿
  - 证据：`tests/uiStore.test.ts` 765  764 行；`query.test.ts` 两处行内替换 `count=1`；全套测试最终 `Test Files 32 passed (32)` / `Tests 236 passed (236)`。
- [x] 2.8 全仓残留检索：对 `src` 与 `tests` 检索 `swatches|SWATCHES|toggleSwatch|clearSwatches`（大小写敏感），期望零命中
  - 证据：零命中。另核 `--grad-rainbow` 现存消费者只剩筛选条色轮按钮（`content.css` 的 `.cball`），`ContextMenu.tsx` 的 `child.swatch` 是无人传值的死字段（不在本次范围，未动）。

## 3. 规格同步

- [x] 3.1 新建 change `openspec/changes/unify-nav-visual/`（`.openspec.yaml` + `proposal.md` + `design.md` + `tasks.md` + 三个 delta）
  - 证据：目录与七个文件均已落盘；`.openspec.yaml` 为 `schema: spec-driven` + `created: 2026-10-14`（日期前缀由 archive 阶段添加，与既有归档目录一致）。
- [x] 3.2 `asset-browser` delta：`SQLite 数据集` 走 MODIFIED（四条 scenario 原样带过，正文的「颜色筛选」改为仍存在的「色带筛选」）；`侧栏导航` 走 REMOVED + `侧栏导航与分组` / `侧栏视觉统一` 走 ADDED
  - 证据：delta 由主 spec 原文程序化抽取后做定点替换，未改动句逐字一致；幸存的三条 scenario 与主 spec 字节相同。
  - 评审后修订：`侧栏视觉统一` 的「使三处文字左沿对齐」限定为「三组分组标题、无圆点前导的导航条目与「管理标签」」，并写明「标签行以 8px 色点起头，SHALL NOT 计入该对齐」。原文按字面读会涵盖标签行，而标签行的前导是 8px 色点、文字左沿 35px（导航条目为 43px），字面成立而实测不成立，会误导下一个按规格验收的人。
- [x] 3.3 `palette` delta：`筛选数据源切换` 走 MODIFIED，只留颜色构造浮层；主 spec 的 Purpose 按 `specs-apply.js` 提示直接编辑（delta 的 `## Purpose` 对既有 spec 只 warn 并忽略）
  - 证据：`openspec/specs/palette/spec.md:3` 现为「并让颜色构造浮层基于库内 palette 而非演示数据。」
- [x] 3.4 `glass-theme` delta：`共享视觉常量唯一真源` 走 REMOVED + `彩虹色带与星色令牌唯一真源` 走 ADDED（保留 `--star-off` 子句与「未选中星不比选中星更重」场景，新增「彩虹色带单点定义」场景）
  - 证据：`--grad-rainbow` 的唯一消费者已由侧栏色块变为筛选条色轮按钮，原「两处彩虹色带起点一致」场景失去可观测对象，故随 requirement 换形。
- [x] 3.5 `openspec validate unify-nav-visual --strict` 通过
  - 证据：`Change 'unify-nav-visual' is valid`，`exit=0`。首轮校验失败于 `$sql` 块重复带入 `### Requirement: SQLite 数据集` 头（我手工又加了一行），导致 MODIFIED 块被判「missing requirement text / 0 scenarios / duplicate」；改为只取正文与场景后消除。另有一条「Requirement text is very long (>500 characters)」警告，通过把统一契约拆成独立的 `侧栏视觉统一` requirement 消除。

## 4. 回归验证

- [x] 4.1 `npm run typecheck`，期望 exit 0 且无 `error TS`
  - 证据：node 与 web 两侧 `tsc --noEmit` 均通过；stderr 只有 npm 的 `better_sqlite3_binary_host_mirror` / `sharp_libvips_binary_host_mirror` 配置告警，与本次改动无关。
- [x] 4.2 `npm run test`，期望全绿；若出现工作进程原生层崩溃则重跑并如实记录两次结果
  - 第一次：`Test Files 31 passed (32)` / `Tests 222 passed (236)` / `Errors 1`，错误为 `Error: [vitest-pool]: Worker forks emitted error`  `Caused by: Error: Worker exited unexpectedly`（better-sqlite3 / sharp 双 ABI 原生层抖动，未打印用例名）。
  - 第二次：`Test Files 32 passed (32)` / `Tests 236 passed (236)`。
  - 结论：与本次改动无因果关系，属此前已记录过的 vitest 工作进程原生层抖动；未定位到具体文件、未能稳定复现。
- [x] 4.3 `npm run build`，期望构建成功且 CSS 产物无解析错误
  - 证据：`../../out/renderer/assets/index-Bd4wGK5P.css 79.22 kB`、`../../out/renderer/assets/index-CtsTOyl4.js 2,055.30 kB`、` built in 2.34s`，`exit=0`。仅有既有的两条 vite 提示（`theme-boot.js` 非 module 无法打包、`data/theme.ts` 动态与静态双导入），无 CSS 解析错误。
- [x] 4.4 经 9223 无头调试桥取改动后的 DOM 与计算样式真值，核对本 change 的三条契约
  - 证据：`{"titles":["浏览","素材管理","标签"],"sw":0,"counts":["4,084","0","0","0","12","4,074","8","2"]}`  侧栏只剩三组、颜色圆点节点 0 个、计数全部带千分位。计算样式：`.side-title` / `.side-title-label` / `.side-add` 的 `gap` 均为 9px，`.side-title .ic` / `.nav-item .ic` / `.folder-row .ic` / `.side-add .ic` 均为 16px，`.side-title-add .ic` 为 14px；`.filterbar` 的 `font-size` 为 12.5px，`.zoomer .ic` 为 16px，`.filterbar .btn .chev` 为 12px。
  - 桥用法：`node tools/hhead.mjs "<单行 js 表达式>"`，token 读 `%APPDATA%\MediaHub\debug-bridge-token`；无 token 直连返回 403。多行 here-string 表达式一律失败（`Script failed to execute`），必须单行；对 SVG 取 `.className` 会抛错（`SVGAnimatedString`），要用 `getAttribute('class')`。
- [x] 4.5 汇总未验证项
  - 未验证： 未做像素级截图比对dev 实例只暴露 9223 表达式执行桥（`webContents.executeJavaScript`），无 CDP 端口（`tools/cdp.mjs` 依赖的 9222 未监听），故只有 DOM 与计算样式真值； `mcp__blender__look` 在本机不可用（Blender 未连接），无法看图复核； `npm test` 出现过一次工作进程原生层崩溃（见 4.2），未定位、未复现。
  - 有意保留（不在本 change 范围）：`body` 的 13px 基准与偏好设置 13px 密度（需另开 change）、`.searchbox` 34px 高度、`.fresult` 的 `--fs-cap` 11px、`.dot` 的 6/7/8px 分档、网格视图 4:3 容器几何、叠加在图形上的 9/10px 角标字号。

- [x] 4.6 评审修复后复跑三项检查：`npm run typecheck`、`npm run test -- tests/query.test.ts tests/uiStore.test.ts`、`openspec validate unify-nav-visual --strict`
  - 证据（本轮实际输出）：typecheck 的 node 与 web 两侧 `tsc --noEmit` 均通过（`exit=0`）；`Test Files 2 passed (2)` / `Tests 38 passed (38)`，Duration 804ms（`exit=0`）；`Change 'unify-nav-visual' is valid`（`exit=0`）。stderr 只有既有的两条 npm 配置告警。只跑这两个测试文件是因为本次修复只触达 `query.ts` 的计数格式化与两个组件的调用点，测试面等价。
- [x] 4.8 归档前补跑全量测试与构建（4.6 只覆盖两个测试文件，归档是最后关口）
  - `npm run test` 第一次：`Test Files 31 passed (32)` / `Tests 222 passed (236)` / `Errors 1`，`Error: [vitest-pool]: Worker forks emitted error` ← `Caused by: Error: Worker exited unexpectedly`（与 4.2 同一种原生层抖动，未打印用例名），`exit=1`。
  - `npm run test` 第二次：`Test Files 32 passed (32)` / `Tests 236 passed (236)`，Duration 2.62s，`exit=0`。
  - `npm run build`：`out/renderer/assets/index-Bd4wGK5P.css 79.22 kB`、`out/renderer/assets/index-CiJnuFD0.js 2,055.32 kB`，`built in 2.40s`，`exit=0`。CSS 产物哈希与 4.3 相同（本轮修复未触达任何 CSS），JS 哈希因 `query.ts` 与两个组件的改动而变。
- [x] 4.8 归档前补跑全量测试与构建（4.6 只覆盖两个测试文件，归档是最后关口）
  - `npm run test` 第一次：`Test Files 31 passed (32)` / `Tests 222 passed (236)` / `Errors 1`，`Error: [vitest-pool]: Worker forks emitted error` ← `Caused by: Error: Worker exited unexpectedly`（与 4.2 同一种原生层抖动，未打印用例名），`exit=1`。
  - `npm run test` 第二次：`Test Files 32 passed (32)` / `Tests 236 passed (236)`，Duration 2.62s，`exit=0`。
  - `npm run build`：`out/renderer/assets/index-Bd4wGK5P.css 79.22 kB`、`out/renderer/assets/index-CiJnuFD0.js 2,055.32 kB`，`built in 2.40s`，`exit=0`。CSS 产物哈希与 4.3 相同（本轮修复未触达任何 CSS），JS 哈希因 `query.ts` 与两个组件的改动而变。
- [x] 4.7 评审修复的改动量核对
  - 证据：`git diff --numstat` 为 `FilterBar.tsx 4/5`、`PreferencesDialog.tsx 2/2`、`SettingsMenu.tsx 2/1`、`Sidebar.tsx 9/37`、`data/query.ts 5/6`、`styles/menu.css 9/4`（新增/删除行）。当前文件行数：`styles/menu.css` 125、`components/SettingsMenu.tsx` 143、`data/query.ts` 310、`components/Sidebar.tsx` 461、`components/FilterBar.tsx` 227、`components/PreferencesDialog.tsx` 450。

## 5. 齿轮菜单贴合行高（`styles/menu.css`、`components/SettingsMenu.tsx`）

- [x] 5.1 `.settings-menu` 的 `padding:6px 0` 改 `padding:0`；删 `.settings-menu-divider` 规则与 `SettingsMenu.tsx` 里的分隔线 JSX；`.settings-menu-submenu` 的 `top:-7px` 改 `top:-1px`；同批删掉把动效拖回 80ms 的 `prefers-reduced-motion` 覆盖（`glass.css` 已全局 `animation:none!important`，那条覆盖反而让要求减少动效的用户看到动效）
  - 证据：`menu.css` 125 行、`SettingsMenu.tsx` 143 行；每处删除都留一行注释说明动机，避免被当漏写补回。子菜单 `-1px` 补的是菜单自身 1px 边框，使子菜单首项与父项顶对齐。
  - 本节为评审后补记：改动在实现阶段已落盘，但漏记于 proposal / design / tasks，按评审结论补入 proposal 的 What Changes 与 Impact、design 的 D9 与本节。

## Workflow follow-up

- 归档：`openspec archive unify-nav-visual`；归档后确认 `asset-browser` 的 `侧栏导航` 已换为 `侧栏导航与分组` + `侧栏视觉统一`，`glass-theme` 的 `共享视觉常量唯一真源` 已换为 `彩虹色带与星色令牌唯一真源`，且四条幸存场景逐字未变。
- 归档后复核 `openspec/specs/palette/spec.md:3` 的 Purpose 已无「侧栏颜色圆点筛选」（本 change 已直接编辑主 spec，归档不应把它改回去）。
- 遗留（不在本 change 范围，需另开 change 才能动）：主界面 12.5px / 偏好设置 13px 两套密度的取舍；网格视图 4:3 容器几何。