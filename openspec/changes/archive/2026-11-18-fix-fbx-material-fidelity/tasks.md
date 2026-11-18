# Tasks

## 1. 材质映射纯函数

- [x] 1.1 新增 `src/renderer/src/data/fbx-material-connections.ts`，只读解析二进制 FBX 的 Material/Texture ID 与 `OP` 连接，返回 material name → 属性 → texture ID；验证方式：新增单测用合成 FBX 二进制断言 `ReflectionFactor`、`ShininessExponent`、`TransparencyFactor` 绑定
- [x] 1.2 在 `src/renderer/src/data/material-preview.ts` 增加 FBX 材质参数映射函数，按连接类型把 `ReflectionFactor` 与 `ShininessExponent` 贴图分别写入 `metalnessMap` 与 `roughnessMap`；验证方式：`tests/materialPreview.test.ts` 断言两个贴图引用落到正确槽位
- [x] 1.3 同一模块实现 `roughnessFromShininess(shininess)`，按 `1 - sqrt(max(shininess, 0)) / 10` 计算并钳制到 `0..1`；验证方式：单测覆盖 `shininess=36 → 0.4`、负数与超大值
- [x] 1.4 同一模块实现 `ReflectionFactor` 到 `metalness` 的标量映射并钳制到 `0..1`；验证方式：单测断言 `0.35 → 0.35`、非法值回退
- [x] 1.5 更新 `toStandardMaterial()`，优先使用映射后的金属度/粗糙度贴图与标量，不再把无效的 `specularMap` 当作 PBR 高光来源；验证方式：单测断言 Phong 材质转换后的 `metalnessMap`、`roughnessMap`、`metalness`、`roughness`

## 2. 强制不透明

- [x] 2.1 修改 `normalizeTransparency()`：强制 `transparent=false`、`opacity=1`、`depthWrite=true`；验证方式：单测覆盖「alphaMap 不透明」「alphaTest 不透明」「opacity<1 仍不透明」
- [x] 2.2 确认无 Base Color 但有法线、alpha 或自发光贴图的材质不触发 clay 兜底；验证方式：单测断言这类材质不被 `fallbackMissingTextures()` 改写

## 3. Viewer3D 接入

- [x] 3.1 在 `src/renderer/src/components/Viewer3D.tsx` 的 FBX 加载路径临时收集 TextureLoader 产物并接入连接解析器，解析后恢复原型；验证方式：真实 FBX 打开后 `__threeStats` 记录 6 个 `ReflectionFactor` 贴图与对应 `metalnessMap` 材质
- [x] 3.2 保留贴图引用与现有 `MATERIAL_TEXTURE_SLOTS` 释放路径，不复制贴图对象；验证方式：连续开关灯箱 10 次，`mounts` 与 `disposes` 对齐且无 WebGL 警告
- [x] 3.3 保持实体/渲染模式、HDR 切换与其他格式加载行为不变；验证方式：真实 FBX、GLB、OBJ 各打开一次，实体/渲染模式与 HDR 切换正常

## 4. 真实 FBX 验证

- [x] 4.1 用 `素材\图\测试\测试\孙尚香战令皮.fbx` 验证内嵌贴图：10 个 Base Color、6 个 `ReflectionFactor`、透明材质数量与 alphaMap 状态；验证方式：无头读取材质统计并记录到任务结果
- [x] 4.2 对照 Blender 5.2 视口截图，检查金属高光、粗糙度与透明区域；验证方式：至少一张同视角截图，记录模型区亮度、纯白溢出与透明材质数量
- [x] 4.3 验证没有源贴图的合法材质仍正常显示，不被误判成 clay；验证方式：单测加真实 FBX 材质统计

## 5. 集成检查

- [x] 5.1 运行 `npm run typecheck`，验证 node/web 两侧 tsc 无错误
- [x] 5.2 运行 `npm run test`，验证全部测试通过；若 `eagle.test.ts` 出现已知 worker 退出，单独重跑并记录
- [x] 5.3 运行 `npm run build`，验证 main、preload、renderer 构建通过
- [x] 5.4 运行 `openspec validate fix-fbx-material-fidelity --strict`，验证 change 严格校验通过

## Workflow follow-up

- 完成实现与真实样本验证后再归档该 change。
- 归档前确认主规格已同步 FBX 材质映射与 alpha 语义。
