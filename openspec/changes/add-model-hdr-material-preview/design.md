# Design

## Context

现状见 `proposal.md` - Why。实现层面的约束：

- `Viewer3D.tsx` 已是实体/渲染双模式：渲染模式从 `originalMaterials` 恢复源材质；HDR 经 `PMREMGenerator` 烘焙后写入 `scene.environment`，同一张 EXR 又写入 `scene.background`。
- 当前渲染器使用 `ACESFilmicToneMapping`、默认曝光 1、`environmentIntensity=1.35`，并额外添加环境光和一主一辅两盏方向光；这与 Blender 参考的单一环境照明明显不同。
- 材质枚举与释放已有可用骨架：`MATERIAL_TEXTURE_SLOTS` 按槽位名遍历贴图，卸载时用 `seenMaterials` 去重释放。
- 三维渲染器由 `LazyViewer3D` 懒加载，`Lightbox.tsx` 从 `uiPrefs` 读取并持久化实体/渲染模式与当前 HDR。
- 界面偏好统一走 `store/ui.ts` 的 `UI_PREFS_KEY`（`uiPrefs`）整体读写，字段逐项校验。
- 已安装 `three`（含 `examples/jsm/loaders/EXRLoader.js`），不新增 npm 依赖。
- Blender 官方世界 HDR 在 `release/datafiles/studiolights/world/` 下，共 8 个 1K EXR（`city`、`courtyard`、`forest`、`interior`、`night`、`studio`、`sunrise`、`sunset`），CC0；`/raw/` 直链只返回约 131 字节的 LFS 指针，必须走 `/media/branch/main/`，单文件约 98–553 KB，总计约 1.9 MB。
- Blender 5.2 当前视口基准为 `AgX`、曝光 0、`Studio` 照明、`Default` studio light、主题深灰背景，场景灯和 Scene World 均关闭。
- Blender 的 `Default` studio light 是 `basic.sl` 中定义的四灯参数，不依赖 EXR 背景；面板参考值包括旋转、强度、世界不透明度和模糊。

## Goals / Non-Goals

**Goals:**
- 渲染模式默认不透明，源文件里 `transparent=true` 且实际全不透明的材质不再显示成幽灵模型。
- 两种模式都以 Blender 视口为基准：`AgX`、曝光 0、主题深灰背景和模式互斥的照明栈。
- 内置 Blender 同款 8 个 HDR 环境，可切换、可持久化，切换即刷新反射与光照。
- 右上角材质球保留当前 HDR 预览与原生箭头；点击后一次展开完整面板，材质球横排直接可见。
- HDR 切换不重建 `WebGLRenderer`，切换时释放旧环境贴图与 PMREM 目标。

**Non-Goals:**
- 不实现 Blender 节点编辑器、纹理绘制、UV 编辑或材质烘焙。
- 不追求 EEVEE/Cycles 的逐像素一致，只对齐 Blender 视口的色彩管理、照明层级、背景和常用环境参数。
- 不引入 `three` 之外的渲染/加载依赖，不做 HDR 分辨率切换（只用 1K）。
- 不改动主进程 IPC、媒体协议与素材库结构。

## Decisions

### 1. HDR 资产随包内置，取 Blender 官方 1K EXR

把 8 个 EXR 落到 `src/renderer/public/hdri/`，附 `LICENSE.txt`（CC0，注明来源与 Poly Haven 原始作者）。用 `EXRLoader` 加载后交给 `PMREMGenerator.fromEquirectangular` 烘焙，默认只把烘焙结果用于 `scene.environment`。

- 备选：运行时从网络下载 —— 否决，桌面应用要能离线工作。
- 备选：继续用程序化 `RoomEnvironment` —— 否决，与 Blender 默认世界不一致，无法满足用户“一比一复刻”的要求。
- 备选：`/raw/` 直链脚本化下载 —— 否决，返回 LFS 指针而非 EXR，拿不到真实数据。

全部文件合计约 1.9 MB，直接进仓可接受。默认 World 不透明度为 0，因此舞台显示深灰主题背景和地面网格；只有用户提高世界不透明度时，才显示 HDR 背景。这样环境照明与背景可见度分离，和 Blender 的 `Scene World`、World Opacity 行为一致。

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

### 6. 持久化覆盖模式、HDR 与四项环境参数

`uiPrefs` 保留 `modelShade: 'solid' | 'render'`（默认 `solid`）与 `modelHdr: HdrPreset`（默认 `forest`），新增：

- `modelHdrRotation: number`，角度，默认 `0`，范围 `0..360`
- `modelHdrStrength: number`，默认 `1`，范围 `0..10`
- `modelHdrOpacity: number`，默认 `0`，范围 `0..1`
- `modelHdrBlur: number`，默认 `0.5`，范围 `0..1`

所有字段沿用现有逐项校验与整体写入逻辑；缺失或非法值回退默认。材质状态只属于当前加载实例，换片时重新归一化。

### 7. 浮层布局：舞台全幅，控件覆盖在画面内部

三维素材的 `pv-body` 去掉固定 16:9 与独立顶栏占位，舞台从顶部延伸到胶片带；返回按钮、模型名与格式、材质球横排和模式按钮全部绝对定位覆盖在舞台内部。

右上角折叠态保留当前 HDR 缩略球，并在球旁提供一个 native-looking 小箭头。点击材质球或箭头一次展开完整面板，面板固定在球下方右侧，不超出舞台边界。

面板结构固定为：顶部环境预览球、8 个 HDR 缩略球横排、旋转、强度、世界不透明度和模糊四行控制。横排沿用 Blender 的紧凑间距和蓝色选中描边，但打开面板时直接可见，不再要求先点击预览球展开第二层菜单。点击任一 HDR 后立即切换，面板保持打开；点击外部或按 Esc 关闭面板，不关闭灯箱。

### 8. 色彩管理与照明改为 Blender 视口基准

`WebGLRenderer` 改用 `AgXToneMapping`。Blender 曝光 `0.0` 对应 Three.js `toneMappingExposure=1.0`，不在基准外再乘曝光增益。渲染模型模式中 HDR 环境是唯一主光源；实体模式中四灯 Studio rig 是唯一主光源。两种模式都移除 `AmbientLight`、主方向光和补方向光。

实体模式不再依赖 HDR 或 Studio 环境贴图来“照亮” clay。使用 Blender `basic.sl` 的 `Default` studio light 四灯参数建立视空间方向光 rig；默认 clay 颜色取中性灰，保留高光和轮廓，但不得把材质推到纯白。

渲染模式使用同一套色彩管理，并继续使用模型源材质。HDR 只提供环境光照、反射和可选背景，避免与场景灯重复叠加。

### 9. 世界参数映射

- 旋转：旋转环境贴图，使用 `scene.environmentRotation` 与背景旋转同步，不旋转模型和相机。
- 强度：映射到 `scene.environmentIntensity`，默认 1，不再硬编码 1.35。
- 世界不透明度：0 时完全隐藏 HDR 背景并显示主题背景；大于 0 时按透明度混合 HDR 背景。
- 模糊：映射到背景 shader 的多点采样半径；世界不透明度为 0 时不渲染背景层。
- 背景默认值：深灰主题背景加世界空间中的 Blender 风格三维地面网格。网格跨度为模型包围盒对角线的 24 倍，随相机旋转、缩放和透视变化，不得使用固定 CSS 背景或屏幕空间贴图；网格不参与模型包围盒计算。
- 世界坐标：模型 SHALL 保留源文件中的原始世界坐标，不得为适配取景而按包围盒中心平移。默认地面网格固定在 `(0,0,0)` 世界原点并覆盖整个视口；相机的水平环绕中心固定在世界原点，只在垂直方向对齐模型包围盒中心，不移动模型。

### 10. 环境面板只控制环境

环境面板只控制 HDR 与四项环境参数，不修改模型材质、贴图、UV 或源文件。现有「实体模式/渲染模型」按钮仍负责材质路径切换。

## Risks / Trade-offs

- [8 个 EXR 使安装包增大约 1.9 MB] → 只放 1K；不引入 EXR 之外的格式转换链路。
- [HDR 球形缩略图需要额外静态文件] → 只生成 8 张低分辨率 PNG；运行时复用图片，不增加 WebGL 上下文。
- [首次打开需解码 540 KB EXR 并烘焙 PMREM，可能看到短时旧环境] → 先挂 `RoomEnvironment` 兜底，烘焙完成后再替换，不阻塞模型显示。
- [材质归一化可能改变源文件的高光表现] → 归一化只用于预览；不写回文件；实体模式仍提供 clay 检查。
- [卸载时重复释放同一张贴图] → 沿用现有 `seenMaterials` / 贴图槽遍历的去重释放，新增的转换材质与 HDR 纹理一并纳入同一释放路径。
- [Blender Studio 灯不是 Three.js 原生格式] → 按 `basic.sl` 的四灯方向、颜色和柔和度转成等价 lighting rig，并以截图和像素统计验收；不承诺逐像素一致。
- [世界不透明度需要和主题背景混合] → 将 HDR 背景作为独立透明层处理，避免把不透明度偷换成亮度。
- [完整面板增加 4 个持久化字段] → 统一走 `uiPrefs` 校验和默认值，损坏数据不影响模型预览启动。

## Migration Plan

- 无数据迁移。旧 `viewerExposure` 键不再读取，残留值被忽略，不需要清理脚本。
- `uiPrefs` 新增字段对老用户缺失时走默认值（实体模式、`forest`、旋转 0、强度 1、世界不透明度 0、模糊 0.5），无需写回迁移。
- 旧用户已保存的 `modelHdr` 继续生效，只是默认背景从 HDR 改为主题背景。
- 回滚方式：删除新增环境字段与面板代码，恢复 HDR 背景和原有 entry；不改模型源文件或数据库。
