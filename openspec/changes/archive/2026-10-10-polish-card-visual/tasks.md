# Tasks

## 1. 比例收敛（极端素材的瀑布流排版）

- [x] 1.1 新建 `src/renderer/src/data/thumb-ratio.ts`：导出 `MIN_THUMB_AR = 1/2`、`MAX_THUMB_AR = 21/9`、`FALLBACK_THUMB_AR = 4/3` 与 `thumbRatio(width?, height?)`（无尺寸返回 `undefined`，否则 clamp）；文件头注释写明「必须被 Card 与 Grid 两处一致消费」；验证：`npm run typecheck` exit 0
- [x] 1.2 `src/renderer/src/components/Card.tsx:62-65` 改为 `const ratio = thumbRatio(a.width, a.height)` + `const ar = view === 'grid' || a.type === 'model' || ratio == null ? undefined : ratio.toFixed(4)`；验证：真实 UI 路径（dev 调试桥）读取卡片 `.thumb` 的 `style.getPropertyValue('--ar')`，1200x172 的素材为 `2.3333`（旧值为 `` 即缺省 4/3 之外不写，实际旧实现写的是 `6.98`）
- [x] 1.3 `src/renderer/src/components/Grid.tsx:20-24` 的 `estHeight` 改为消费同一个 `thumbRatio`（`?? FALLBACK_THUMB_AR`），删掉旧的 `Math.min(3, Math.max(0.5, ar))` 本地 clamp；验证：dev 桥实测瀑布流列内相邻卡间隙与改前一致（`-2~1px`），无错位
- [x] 1.4 确认收敛只影响瀑布流：网格视图 `.v-grid .thumb{aspect-ratio:4/3}` 与列表视图 `.v-list .thumb{width:96px;height:58px}` 两条规则优先，未被 `--ar` 覆盖；验证：dev 桥实测网格视图缩略图 `207x155`、列表视图 `96x58`

## 2. 卡片视觉（信息区、浮层按钮、徽章、渐变）

- [x] 2.1 `src/renderer/src/styles/grid.css:109` `figcaption{padding:12px 10px 11px}`  `7px 10px`；验证：dev 桥读计算样式为 `7px 10px`
- [x] 2.2 `src/renderer/src/components/Grid.tsx:18` `CAPTION_H` 由 `61` 改 `44`（缩略图 : 信息区 = 80 : 20），注释写明与 `figcaption` 内边距、`.name`/`.meta-row` 行高硬耦合；验证：dev 桥实测 `capH 44`，瀑布流相邻卡间隙 `-1.6~1.6px`
- [x] 2.3 `src/renderer/src/styles/grid.css:113` `.meta-row` 颜色 `var(--t3)`  `var(--t2)`（与列表视图 `.v-list .lc` 同一色阶，夜间对比度 3.38:1  8.51:1）；验证：dev 桥读 `.meta-row` 计算色为 `rgb(180,192,210)`
- [x] 2.4 `src/renderer/src/styles/grid.css:79` `.qa button` 底色 `rgba(10,12,16,.55)`  `.72` 并新增 `border:1px solid rgba(255,255,255,.18)`；`:80` hover 底色 `.8`  `.88`；验证：截图像素采样底色 `#4E5053`（alpha 0.72 预测值 `#4F5053`），白图标对比度 4.35:1  8.09:1
- [x] 2.5 `src/renderer/src/styles/grid.css:82-83` `.qa .fav.on` 加 `background:rgba(10,12,16,.82)`，新增 `.qa .fav.on .ic{fill:currentColor;stroke:currentColor}`（实心心 + 更深底，不依赖颜色辨别）；验证：截图实测已收藏态底色 `#36383B`、图标 `fill`/`stroke` 均为 `rgb(255,122,147)`，粉心对比度 1.75:1  3.26:1
- [x] 2.6 `src/renderer/src/styles/grid.css:39` `.thumb::after` 渐变 `transparent 62%,rgba(0,0,0,.28)`  `transparent 78%,rgba(0,0,0,.34)`（纯白缩略图被压暗面积 38%  22%）；验证：截图实测遮罩自 y279 起（154px 高的 78%），纯白区保持 `#FFFFFF`
- [x] 2.7 `src/renderer/src/styles/grid.css:60` `.type-chip` 字号 `9.5px`  `10.5px`、`letter-spacing:.08em`  `.06em`、`padding:0 6px`  `0 7px`、`border-radius:5px`  `6px`；`:62` `.dur` `border-radius:5px`  `6px`；验证：dev 桥读 chip 计算样式 `fontSize 10.5px`/`borderRadius 6px`

## 3. 测试

- [x] 3.1 新增 `tests/thumbRatio.test.ts`（纯函数单层，5 个用例）：常规比例不动（1920x1080  16/9、1080x1350  0.8）、超宽帧收敛（1200x172  `MAX_THUMB_AR`，并断言 232px 列宽下高度 > 90px）、超高截图收敛（1080x6400  `MIN_THUMB_AR`）、竖屏在界内（1080x1920  0.5625）、无尺寸返回 `undefined` 且 `FALLBACK_THUMB_AR` 为 4/3；验证：`npx vitest run tests/thumbRatio.test.ts` 5/5 通过

## 4. 验证

- [x] 4.1 `npm run typecheck`（node + web 两侧 `tsc --noEmit`）无输出、exit 0
- [x] 4.2 `npx vitest run` 全量回归：22 个文件 145/145 通过（含并行的 `fix-selection-model` 的 `tests/uiStore.test.ts` 23 用例）
- [x] 4.3 真实 UI 路径验证（dev 调试桥 `tools/hhead.mjs` 走 9223 + 窗口截图）：232px 列宽下卡片 `thumbH 173 / capH 44 / cardH 219`（缩略图占 79.0%）；1200x172 视频卡 `thumbH 99 / cardH 145`（68.3%）；9:16 竖屏卡 `thumbH 393 / cardH 439`（89.5%）；真实库 35 张渲染卡占比均值 83.9%；瀑布流 3 列、列内相邻卡间隙 `-1.6~1.6px`
- [x] 4.4 视图回归：列表视图 `firstRowH 70`、`.v-list .meta-row{display:none}` 未受影响；验证后已切回 `waterfall`
- [x] 4.5 收尾：验证期间临时注入的 `.qa` 常显 / `.fav.on` DOM 样式已从页面还原（未改源码），无遗留 debug 输出
