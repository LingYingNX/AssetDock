# Design

## Context

现状见 `proposal.md` - Why。实现约束：

- `src/renderer/src/components/Viewer3D.tsx` 已用 `FBXLoader.parse()` 加载内嵌贴图，随后经 `toStandardMaterial()`、`normalizeTransparency()`、`normalizeEmissive()` 统一为 `MeshStandardMaterial`。
- `node_modules/three/examples/jsm/loaders/FBXLoader.js` 的 `parseParameters()` 只把 `ReflectionFactor` 读成 `reflectivity` 数值，把 `ShininessExponent` 归入不支持贴图并跳过。真实样本中两者各连接 6 张贴图。
- Three 的 `MeshStandardMaterial` 不读取 `specularMap`；现有转换复制该字段没有着色效果。
- 真实 FBX 的 `TransparencyFactor` 贴图已进入 `alphaMap`，并因此启用透明混合；这会让本应不透明的表面呈半透明。
- Blender 5.2 FBX importer 的规则是：`ReflectionFactor` 贴图挂金属度，`ShininessExponent` 贴图挂粗糙度，`TransparencyFactor` 挂 alpha；标量粗糙度为 `1 - sqrt(shininess) / 10`。
- 不新增依赖；`three` 已是项目依赖。材质只在预览实例内修改，不写回源文件。

## Goals / Non-Goals

**Goals:**

- 在加载阶段恢复 FBXLoader 丢弃的金属度与粗糙度贴图连接。
- 按 Blender 公式转换无贴图材质的 `shininess` 与 `ReflectionFactor` 标量。
- 强制渲染模式不透明，同时保留 `alphaTest` 的镂空语义。
- 把映射逻辑做成可单测的纯函数，便于真实样本回归。

**Non-Goals:**

- 不改 FBX 几何、骨骼、动画、UV 或源文件。
- 不实现 Blender 节点编辑器、材质槽编辑 UI 或材质烘焙。
- 不承诺与 Blender/Cycles 逐像素一致，只对齐常用 FBX PBR 参数。
- 不新增 npm 依赖，不修改数据库、媒体协议或素材库结构。

## Decisions

### 1. 在应用层恢复 FBX 材质连接，不 fork `FBXLoader`

Three 的 `FBXTreeParser` 与连接表都不导出，直接 patch `node_modules` 会破坏可复现安装。实证后的最小路径是：

- 新增一个只读的二进制 FBX 节点扫描器，只提取 `Objects` 中的 Material/Texture ID 与 `Connections` 中的 `OP` 绑定，不解析几何。
- 在 `Viewer3D` 调用 `FBXLoader.parse()` 期间临时包裹 `TextureLoader.prototype.load`，收集 loader 已创建的 Texture；解析结束后立即恢复原型。
- 用 texture ID 取已加载的 Texture，按 material name 取得 `ReflectionFactor` / `ShininessExponent` 绑定，再交给材质转换函数。
- 只读取显式 `OP` 连接；拿不到连接或找不到 Texture 时保留现有行为，不按文件名猜贴图。

备选方案：复制整个 `FBXLoader.js` 到项目内并修改。否决，维护成本高，且会把上游升级变成手工合并。

### 2. 材质映射优先走显式字段，不按贴图文件名猜通道

映射只依据 FBX 的连接类型：

- `DiffuseColor` → `map`
- `NormalMap` → `normalMap`
- `EmissiveColor` → `emissiveMap`
- `TransparencyFactor` / `TransparentColor` → `alphaMap`
- `ReflectionFactor` / `ReflectionColor` → `metalnessMap`
- `ShininessExponent` → `roughnessMap`

ORSM 等打包贴图是否拆成 AO/Roughness/Metalness 通道，先作为真实样本验证项；在未确认通道顺序前不得写死。

### 3. 标量转换使用 Blender 公式

无 `roughnessMap` 时：

```text
roughness = clamp(1 - sqrt(max(shininess, 0)) / 10, 0, 1)
```

无 `metalnessMap` 时：

```text
metalness = clamp(ReflectionFactor, 0, 1)
```

缺字段时保留现有中性默认值，避免材质变成全金属或全镜面。

### 4. 渲染模式强制不透明

归一化统一执行：

- `transparent = false`
- `opacity = 1`
- `depthWrite = true`
- `needsUpdate = true`

`alphaMap` 可以继续保留以复用资源释放路径，但不得参与透明混合。`alphaTest > 0` 保留镂空。无 Base Color 但有法线、alpha 或自发光贴图的材质，仍视为合法源材质，不触发 clay 兜底。

### 5. 贴图生命周期继续走现有释放路径

新增的 `metalnessMap`、`roughnessMap` 与 `alphaMap` 仍由 `MATERIAL_TEXTURE_SLOTS` 枚举释放。转换材质时只搬引用，不复制贴图；换片和关闭灯箱继续走 `seenMaterials` 去重释放。

## Risks / Trade-offs

- [Three 未公开原始 FBX 连接表，应用层需要自行读取连接] → 只解析 Material/Texture ID 与 `OP` 绑定；真实样本已确认 6 个 `ReflectionFactor` 连接可读取。
- [ORSM 贴图通道含义可能因导出器而异] → 先按连接类型映射整张贴图，再以真实 FBX 与 Blender 对照确认；通道拆分单独立项。
- [强制不透明会隐藏源文件真正的半透明效果] → 这是用户明确要求；以真实 FBX 的透明材质数量与截图回归，镂空仍由 alphaTest 保留。
- [Blender 公式与 Three 的 PBR 响应不完全一致] → 目标是对齐常用材质观感，不承诺逐像素一致。
- [材质转换后贴图引用可能重复释放] → 继续复用 `MATERIAL_TEXTURE_SLOTS` 与 `seenMaterials`，测试连续开关灯箱的资源计数。

## Migration Plan

- 无数据迁移，无配置变更。
- 旧预览缓存不包含材质状态，无需清理。
- 回滚方式：删除新增映射函数与调用，恢复现有材质转换和透明归一化；不改源文件或数据库。
