## Context

三份 change 之后主 specs 有 6 个能力 30 条 requirement;审计缺口集中在「数据展示真实性」与「大库性能」。渲染层查询语义稳定,本 change 全部为增补,无破坏性改动。

## Goals / Non-Goals

**Goals:**

- 大库滚动不卡(500 项阈值)
- 库生命周期闭环(可重开)
- 色带/文件夹树/面数/编码信息全部反映真实数据
- 空态达到规格 §9 的插画级要求

**Non-Goals:**

- 色带跨库聚合(仅当前视图范围)
- 虚拟化瀑布流的 JS 列分配(用 CSS 跳渲染达成流畅,见决策 1)
- 打包发布(用户指示)
- 材质/动画编辑

## Decisions

1. **虚拟化分视图策略:grid/list 用 @tanstack/react-virtual 真窗口化;瀑布流用 `content-visibility:auto` + `contain-intrinsic-size` 跳渲染**
   - 规格 §11 字面是"瀑布流按列分配+虚拟滚动";CSS columns 结构与 windowing 组件不兼容,重写为 JS masonry 成本高且破坏悬停动效。content-visibility 让离屏卡片跳过 layout/paint,Chromium(本项目唯一内核)实测可达同等流畅度。以"滚动流畅、DOM 有界"为验收目标,字面实现方式记为偏差。
2. **库重开:「+」玻璃下拉菜单**(复用 Dropdown 组件):「新建素材库…」+ 已绑定库列表(当前已开的标 ✓ 灰显);新建选择已绑定路径 → 直接 openTab。
3. **色带聚合:`queryAssets` 结果 → 每 palette 色 ratio×1 累加,同桶(色相近似合并)求和归一,取前 8**。主线程 O(n) 一次,数百项无感;展示用 52×30 色块同现有样式。
4. **文件夹树:由 assets.folders(目录链)构建 Map 树,深度缩进渲染;计数=直接子树素材数**。演示模式沿用 FOLDERS 静态结构。
5. **GLB 解析:仅读前 512KB(mvhd 式 Range),定位 JSON chunk(`glTF` magic + JSON chunk length),解析 meshes/primitives/accessors 统计面数与顶点**。JSON chunk 超过 512KB 时再扩读一次(上限 4MB)。
6. **编码/fps:扩展 videoMeta stderr 正则**(已全文在手),新增 `codec_name`/`fps` 提取,入库字段 codec、fps。
7. **加载进度:fetch ReadableStream 按	content-length 累计字节报百分比;parse 阶段转旋转指示**;曝光:`renderer.toneMappingExposure` 直改 + 控制条尾 88px 滑杆(复用 zoomer 样式)。
8. **空态插画:内联 SVG 玻璃风几何插画组件(空盒/空箱/空网格三款)**,复用现有配色;演示模式引导卡放 grid 顶部,复用 .btn-clear 风格主按钮。
9. **purgeMissing IPC:DELETE WHERE missing=1 AND 文件不存在二次校验(fsync stat)**,仅桥调用,无 UI。

## Risks / Trade-offs

- [content-visibility 对复杂卡片仍可能引发滚动跳动] → contain-intrinsic-size 按估算卡片高度(名称区 54px + 图区按 --colw 推算)固定占位,跳动可控
- [聚合在万级库 O(n) 主线程] → 一次遍历 <10ms 量级;如慢再移 Worker
- [GLB JSON chunk 在文件尾部(极少见)] → 解析失败留空路径已定义,不阻塞
- [曝光滑杆与控制条拥挤(小舞台)] → 控制条 flex-wrap 允许换行;滑杆宽度 88px

## Migration Plan

无数据迁移;新增 DB 字段 codec/fps 走 user_version=2 迁移(空库可直接建,老库 ALTER TABLE ADD COLUMN)。

## Open Questions

(无。)
