# Tasks

## 1. HDR 资产与预设清单

- [x] 1.1 从 `https://projects.blender.org/blender/blender/media/branch/main/release/datafiles/studiolights/world/<name>.exr` 下载 `city`、`courtyard`、`forest`、`interior`、`night`、`studio`、`sunrise`、`sunset` 共 8 个 EXR 到 `src/renderer/public/hdri/`；验证方式：每个文件不小于 98 KB 且以 `76 2F 31 01` 开头，任一是 131 字节即说明拿到了 LFS 指针，需重下
- [x] 1.2 新增 `src/renderer/public/hdri/LICENSE.txt`，写明 CC0 1.0、Blender 来源仓库路径与作者标注；验证方式：文件存在且列出 8 个文件名
- [x] 1.3 用现有 three.js 做一次性离线渲染，为 8 个 HDR 生成同尺寸球形 PNG 到 `src/renderer/public/hdri/thumbs/`；验证方式：8 个文件都是可解码 PNG，尺寸一致且显示各自环境差异
- [x] 1.4 新增 `src/renderer/src/data/hdr-presets.ts`：导出 `HDR_PRESETS`（8 项，含 `id`/`label`/`url`/`thumbUrl`）与 `DEFAULT_HDR = 'forest'`、`parseHdrPreset()`；验证方式：新增 `tests/hdrPresets.test.ts`，断言 8 个 id、8 个缩略图路径与默认值、非法输入回退 `forest`

## 2. 材质归一化（纯函数）

- [x] 2.1 新增 `src/renderer/src/data/material-preview.ts`：`normalizeTransparency(material)` 在 `opacity >= 1` 且 `alphaTest = 0` 时关闭透明混合，只有 `opacity < 1` 或 `alphaTest > 0` 保留真实透明；验证方式：`tests/materialPreview.test.ts` 覆盖「transparent+opacity=1 → 不透明」「alphaTest 保留」「只有 alphaMap 仍按不透明」「opacity<1 保留」
- [x] 2.2 同模块实现 `toStandardMaterial(material)`（Phong/Lambert/Standard 统一为 `MeshStandardMaterial`，迁移 color/map/normalMap/emissive/opacity/alphaTest/side/vertexColors）；验证方式：同一测试文件断言转换后字段保真

## 3. Viewer3D：环境切换与材质应用

- [x] 3.1 用 `EXRLoader` + `PMREMGenerator.fromEquirectangular` 替换固定 `RoomEnvironment`，保留其作为加载中/失败兜底，切换时释放旧 `envRT` 与纹理；验证方式：无头运行打开 GLB，`window.__threeStats` 记录 env 切换次数与释放数，连续切 8 次 HDR 后旧目标全部释放
- [x] 3.2 加载完成后统一材质并应用 `normalizeTransparency`；验证方式：打开该 FBX，渲染模式下 10 个 `transparent=true` 材质不再半透明
- [x] 3.3 渲染模式恢复模型源材质与贴图，不提供材质编辑状态；验证方式：切换实体/渲染模式后模型贴图正常显示
- [x] 3.4 卸载路径纳入新对象（HDR 纹理、PMREM 目标、转换后材质），沿用 `seenMaterials` 去重释放；验证方式：连续开关灯箱 10 次，`__threeStats.disposes` 与 `mounts` 对齐且无 WebGL 警告

## 4. Lightbox 布局与浮层面板

- [x] 4.1 三维素材舞台改为全幅（去 16:9 与独立顶栏占位），返回按钮、名称/格式、HDR 入口、模式按钮覆盖在舞台内部；验证方式：无头截图对比，舞台矩形与 `.pv` 内容区重合，左右无空白栏
- [x] 4.2 右上角放一个圆形 HDR 环境球，点击展开一排 8 个环境球，点击任一球切换环境；验证方式：无头展开后存在 8 个选项，点击后 `__threeStats.env` 与 `__threeStats.background` 同步变化
- [x] 4.4 `uiPrefs` 增加 `modelShade`、`modelHdr` 并接入读取/写入；验证方式：扩展 `tests/uiStore.test.ts` 覆盖两字段默认值与非法值回退，重启后恢复上次 HDR 与模式

## 5. 集成验证与文档

- [x] 5.1 跑 `npm run typecheck` 与 `npm run test`，贴出输出；验证方式：两侧 tsc 无错误、全部用例通过
- [x] 5.2 无头验证 FBX / GLB / OBJ 三种格式双模式 + HDR 切换，记录到本 change 的验证小节；验证方式：三种格式各出一条断言输出
- [x] 5.3 同步主规格（`openspec/specs/viewer-3d`、`openspec/specs/lightbox`）并清理 `Viewer3D.tsx` 中本 change 的临时探针与调试输出；验证方式：`openspec validate add-model-hdr-material-preview --strict` 通过且 grep 无残留探针

## Verification

- `npm run typecheck`：node/web 两侧 tsc 通过。
- `npm run test`：41/42 文件中先出现已知 `eagle.test.ts` worker 退出；单独重跑 `eagle.test.ts` 3/3 通过。HDR、材质与 uiStore 定向测试 49/49 通过。
- `npm run build`：main/preload/renderer 构建通过。
- 最终 FBX 无头验证：14 个材质、`transparent=0`、10 张 Base Color 贴图实际解码；右上 HDR 球 68×68、无文字、无 `.hdr-panel`。
- HDR 选择器：点击右上球展开 8 个 52×52 环境球并保持在舞台边界内；City → Forest 后画布 85.62% 像素变化，`__threeStats.env` 与 `__threeStats.background` 同步更新。
- 底部材质槽入口与右侧材质面板已移除，模式条只保留实体/渲染按钮。
- 资源释放：连续开关 10 次，`mounts` 与 `disposes` 各增加 23，未累积额外差值。
- `openspec validate viewer-3d --type spec --strict`、`lightbox --type spec --strict` 与 change 严格校验均通过。

## Workflow follow-up

- 实现完成并通过评审后归档该 change。
- 归档后确认主规格中不再残留转台/线框/曝光相关条目。
