# Proposal

## Why

素材卡片的视觉细节在三处偏离了它自己声称的规则，且都是「看得见但说不出」的那类问题：

1. **极端宽高比的素材把瀑布流排坏。** 卡片把原始 `width/height` 直接写进 CSS 变量 `--ar`，
   而虚拟化用的 `estHeight` 却把同一个比例 clamp 到 `[0.5, 3]` 来估高。两边算出的高度不一致，
   于是 1200x172 这类字幕条按真实比例渲染成 33px 高的一条横线，而列内占位按 0.5 下界预留了 464px：
   同一列里卡片互相错位、底部拖出一大截空档。（网格与列表视图强制 4:3 / 96x58，不受影响。）

2. **信息区挤占素材的画面空间。** 信息区上下内边距 12/11px 加上两行文字共占 **61px**，默认 232px 列宽下
   缩略图 174px、卡片 237px（含 1px 边框），只拿到 **73%**；诉求是缩略图 80%、信息区 20%。另外信息区底色用 `--t3`（`#7C8A9E`），
   在夜间主题下对底色 `#2F3845` 只有 **3.38:1**，低于 WCAG AA 的 4.5:1；同一份元信息在列表视图用的是
   `--t2`，两个视图两个色阶，本身也是一致性缺陷。

3. **收藏按钮的两种状态都看不清。** 悬停浮层按钮底色 `rgba(10,12,16,.55)` 合成后是 `#78797C`，
   白图标 **4.35:1** 贴线；已收藏态换成粉心 `#FF7A93` 后 **1.75:1**，用户点完收藏几乎看不出状态变了。

## What Changes

- 新增 `src/renderer/src/data/thumb-ratio.ts`：把「卡片该按什么比例显示」收成一个纯函数
  `thumbRatio(width, height)`，clamp 到 `[1/2, 21/9]`（`MIN_THUMB_AR` / `MAX_THUMB_AR`），
  无尺寸时返回 `undefined` 交给 CSS 的 `4/3` 兜底（`FALLBACK_THUMB_AR`）。
- `Card.tsx` 与 `Grid.tsx` 统一从它取值：前者写进 `--ar`（决定 CSS 真实高度），
  后者算列内定位高度（决定虚拟化占位）。**同源是这两个文件之间唯一的耦合点。**
- 信息区几何按 80 : 20 重排：`figcaption` 内边距 `12px 10px 11px`  `7px 10px`，`.name` / `.meta-row`
  行高显式写成 `15px` / `13px`，`Grid.tsx` 的 `CAPTION_H` 由 `61` 改 `44`。232px 列宽下缩略图 173px、
  信息区 44px，缩略图占 **79.0%**。
- 卡片视觉令牌回调：信息区元信息色 `--t3`  `--t2`；`.qa button` 底色 `.55`  `.72` 并加
  `1px solid rgba(255,255,255,.18)` 描边；`.qa .fav.on` 加深底色并让图标实心（不靠颜色区分状态）。
- 缩略图底部压暗渐变起点由 `62%` 推到 `78%`、强度 `.34`，纯白缩略图被压暗的面积从 38% 降到 22%。
- 类型徽章字号 `9.5px`  `10.5px`、字距 `.08em`  `.06em`、`border-radius:5px`  `6px`，
  与 `.dur` 及全仓主流圆角刻度（`6px` 出现 20 次）对齐。

## Capabilities

### New Capabilities

- 无新增能力；比例收敛落在既有的 `asset-browser` 能力内（卡片展示规则）。

### Modified Capabilities

- `asset-browser`:
  - 素材卡片：新增「缩略图展示比例 SHALL 收敛到 `[1/2, 21/9]`，超出的部分交给 `object-fit:cover` 裁切」
    与「信息区元信息 SHALL 使用二级文本色」两条约束；新增「极端比例缩略图」场景。
  - 三视图切换：说明瀑布流是唯一使用素材原始比例的视图，其列内定位高度 SHALL 与卡片实际渲染比例同源。

## Impact

`src/renderer/src/data/thumb-ratio.ts`（新增）、`src/renderer/src/components/Card.tsx`、
`src/renderer/src/components/Grid.tsx`、`src/renderer/src/styles/grid.css`、
`tests/thumbRatio.test.ts`（新增）、`openspec/specs/asset-browser/spec.md`。

不涉及主进程、IPC、协议、数据库、缩略图生成与缓存（`thumbnails` 能力不受影响）；
不新增依赖；不改变任何键位、选中语义或数据流。