# Design

## Context

现状见 `proposal.md` - Why。实现层面的约束：

- `Viewer3D.tsx` 已是实体/渲染双模式：渲染模式从 `originalMaterials` 恢复源材质；环境光固定为 `RoomEnvironment` 经 `PMREMGenerator` 烘焙，卸载时释放 `envRT` / `pmrem`。
- 材质枚举与释放已有可用骨架：`MATERIAL_TEXTURE_SLOTS` 按槽位名遍历贴图，卸载时用 `seenMaterials` 去重释放。
- 三维渲染器由 `LazyViewer3D` 懒加载，`Lightbox.tsx` 持有模式状态（当前是组件内 `useState`，切换素材即重置）。
- 界面偏好统一走 `store/ui.ts` 的 `UI_PREFS_KEY`（`uiPrefs`）整体读写，字段逐项校验。
- 已安装 `three`（含 `examples/jsm/loaders/EXRLoader.js`），不新增 npm 依赖。
- Blender 官方世界 HDR 在 `release/datafiles/studiolights/world/` 下，共 8 个 1K EXR（`city`、`courtyard`、`forest`、`interior`、`night`、`studio`、`sunrise`、`sunset`），CC0；`/raw/` 直链只返回约 131 字节的 LFS 指针，必须走 `/media/branch/main/`，单文件约 98–553 KB，总计约 1.9 MB。

## Goals / Non-Goals

**Goals:**
- 渲染模式默认不透明，源文件里 `transparent=true` 且实际全不透明的材质不再显示成幽灵模型。
- 内置 Blender 同款 8 个 HDR 环境，可切换、可持久化，切换即刷新反射与光照。
- HDR 切换不重建 `WebGLRenderer`，切换时释放旧环境贴图与 PMREM 目标。

**Non-Goals:**
- 不实现 Blender 节点编辑器、纹理绘制、UV 编辑或材质烘焙。
- 不引入 `three` 之外的渲染/加载依赖，不做 HDR 分辨率切换（只用 1K）。
- 不改动主进程 IPC、媒体协议与素材库结构。

## Decisions

### 1. HDR 资产随包内置，取 Blender 官方 1K EXR

把 8 个 EXR 落到 `src/renderer/public/hdri/`，附 `LICENSE.txt`（CC0，注明来源与 Poly Haven 原始作者）。用 `EXRLoader` 加载后交给 `PMREMGenerator.fromEquirectangular` 烘焙，`scene.environment` 使用烘焙结果。

- 备选：运行时从网络下载 —— 否决，桌面应用要能离线工作。
- 备选：继续用程序化 `RoomEnvironment` —— 否决，与 Blender 默认世界不一致，无法满足用户“一比一复刻”的要求。
- 备选：`/raw/` 直链脚本化下载 —— 否决，返回 LFS 指针而非 EXR，拿不到真实数据。

全部文件合计约 1.9 MB，直接进仓可接受。加载成功后同一张 EXR 同时赋给 `scene.environment` 的 PMREM 结果与 `scene.background`，让模型背后的世界环境可见，而不是只参与材质反射。

HDR 选择器需要球形缩略图，但浏览器 `<img>` 不能直接显示 EXR。实现时用一次性离线渲染生成 8 张同尺寸 PNG 球形缩略图，放进 `public/hdri/thumbs/`；运行时只加载 PNG 和当前 EXR，不额外创建 8 个 WebGL 上下文。大图与缩略图沿用同一套球面映射和中性照明，避免缩略图与实际环境效果不一致。

### 2. 环境切换走增量替换，不重建渲染器与场景

切换 HDR 时：加载新 EXR 纹理 → 烘焙新 `WebGLRenderTarget` → 替换 `scene.environment` → 释放上一份 `envRT` 与 `Texture`；`PMREMGenerator` 与 `WebGLRenderer` 复用。加载失败时保留当前环境，不把舞台打回空白。

`RoomEnvironment` 保留为首次加载中与全部 HDR 加载失败时的兜底环境，代价是首帧光照与最终环境可能不同，但可避免黑屏。

### 3. 材质只在加载阶段归一化，不暴露编辑面板

`Viewer3D` 加载完成后将各格式材质统一为 PBR，并清理源文件中错误的全透明标记。渲染模式直接恢复这份归一化后的源材质与贴图，React 状态不持有 three 对象。

- 理由：材质检查只需要可靠显示源资产，不引入跨生命周期的材质编辑状态。
- 备选：把材质对象放进 store —— 否决，卸载与释放路径会变得不可控。

### 4. 非 PBR 材质在加载时归一为 `MeshStandardMaterial`

FBX/OBJ 常导出 `MeshPhongMaterial` / `MeshLambertMaterial`，没有 metalness/roughness 字段。加载后按材质实例做一次转换：`color`、`map`、`normalMap`、`emissive`/`emissiveMap`、`opacity`、`transparent`、`alphaTest`、`side`、`vertexColors`、`skinning` 迁移到 `MeshStandardMaterial`，其余贴图槽按名字尽力搬运。

- 理由：让所有格式在实体模式与渲染模式下使用一致的 PBR 光照语义。
- 代价：高光强度、镜面贴图等 Phong 专属参数的原始表现会丢失近似，属可接受的检查视图差异。
- 备选：按材质类禁用不支持控件 —— 否决，会导致同一面板在不同模型上控件数量跳变，违背“槽位一致”的目标。

### 5. 透明归一化只在渲染模式生效，并保留 alphaTest 镂空

归一化条件：`material.transparent === true && material.opacity >= 1 && material.alphaTest === 0` → 置 `transparent = false`。

实测该 FBX 的 10 个半透明材质全部带 `alphaMap`、`opacity=1`、`alphaTest=0`：alphaMap 只参与混合，不提供镂空，保留 `transparent=true` 正是幽灵模型的来源。因此 alphaMap 不参与判断，只保护 `alphaTest > 0` 的树叶/毛发镂空；真正需要整片透明的槽位由用户显式开启透明开关恢复。

归一化结果不写回模型文件，随预览卸载丢弃；源材质自身的真实透明信息继续保留。

### 6. 持久化只覆盖模式与 HDR

`uiPrefs` 增加两个字段：`modelShade: 'solid' | 'render'`（默认 `solid`）与 `modelHdr: HdrPreset`（默认 `forest`），沿用现有逐项校验与整体写入逻辑。材质状态只属于当前加载实例，换片时重新归一化。

### 7. 浮层布局：舞台全幅，控件覆盖在画面内部

三维素材的 `pv-body` 去掉固定 16:9 与独立顶栏占位，舞台从顶部延伸到胶片带；返回按钮、模型名与格式、HDR 环境球和模式按钮全部绝对定位覆盖在舞台内部。右上角 HDR 默认显示一个直径 68px 的圆形环境球，不显示文字；点击后在下方展开一排 8 个圆形缩略球，点击任一项切换环境。底部只保留实体/渲染模式按钮。

## Risks / Trade-offs

- [8 个 EXR 使安装包增大约 1.9 MB] → 只放 1K；不引入 EXR 之外的格式转换链路。
- [HDR 球形缩略图需要额外静态文件] → 只生成 8 张低分辨率 PNG；运行时复用图片，不增加 WebGL 上下文。
- [首次打开需解码 540 KB EXR 并烘焙 PMREM，可能看到短时旧环境] → 先挂 `RoomEnvironment` 兜底，烘焙完成后再替换，不阻塞模型显示。
- [材质归一化可能改变源文件的高光表现] → 归一化只用于预览；不写回文件；实体模式仍提供 clay 检查。
- [卸载时重复释放同一张贴图] → 沿用现有 `seenMaterials` / 贴图槽遍历的去重释放，新增的转换材质与 HDR 纹理一并纳入同一释放路径。

## Migration Plan

- 无数据迁移。旧 `viewerExposure` 键不再读取，残留值被忽略，不需要清理脚本。
- `uiPrefs` 新增字段对老用户缺失时走默认值（实体模式、`forest`），无需写回迁移。
- 回滚方式：删除 `public/hdri/` 与新增字段，恢复 `RoomEnvironment` 单环境实现即可，无持久化污染。
