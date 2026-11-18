# Proposal

## Why

FBX 文件中的内嵌 Base Color、法线与透明贴图已经能被 three.js 加载，但材质转换只迁移通用字段，导致 `ReflectionFactor` 与 `ShininessExponent` 的贴图连接被丢弃。模型因此缺少金属度与粗糙度信息，和 Blender 中的实际效果差距明显。

FBX 常把 `TransparencyFactor` 贴图连接到 `alphaMap`，Three 会因此启用透明混合。真实模型中的头发、裙摆和装饰因此出现半透明，用户无法检查不透明材质，也无法获得与 Blender 视口一致的实体观感。

## What Changes

- 将 FBX 的 `ReflectionFactor` 贴图映射到 PBR `metalnessMap`。
- 将 FBX 的 `ShininessExponent` 贴图映射到 PBR `roughnessMap`。
- 将无贴图时的 `shininess` 标量按 Blender 公式转换为 `roughness`：`1 - sqrt(shininess) / 10`。
- 渲染模式强制关闭透明混合，`TransparencyFactor` / `alphaMap` 不得使材质呈半透明。
- 保留 `alphaTest > 0` 的镂空语义。
- 不把 `specularMap` 继续复制到 `MeshStandardMaterial` 后当作无效贴图；Phong 的高光信息按上述规则映射。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `viewer-3d`: FBX 材质映射需要保留金属度与粗糙度，并强制渲染模式不透明，同时不破坏现有实体/渲染模式、HDR 和资源释放行为。

## Impact

- 渲染层：`src/renderer/src/data/material-preview.ts` 的材质转换与透明归一化。
- 渲染层：新增轻量 FBX 连接读取器，恢复 loader 未处理的材质贴图绑定。
- 渲染层接入：`src/renderer/src/components/Viewer3D.tsx` 的 FBX 材质归一化路径。
- 测试：`tests/materialPreview.test.ts` 增加 FBX 参数映射、roughness 公式与强制不透明断言。
- 依赖：继续使用现有 `three`，不新增 npm 依赖。
- 数据：不写回 FBX 源文件，不修改数据库或素材库结构。
