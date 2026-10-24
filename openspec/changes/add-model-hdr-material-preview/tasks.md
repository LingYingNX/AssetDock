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
- [x] 4.2 右上角放一个圆形 HDR 环境球，点击展开一排 8 个环境球，点击任一球切换环境；验证方式：无头展开后存在 8 个选项，点击后 `__threeStats.env` 与 `__threeStats.background` 同步变化（该交互已被 7.1–7.3 取代）
- [x] 4.4 `uiPrefs` 增加 `modelShade`、`modelHdr` 并接入读取/写入；验证方式：扩展 `tests/uiStore.test.ts` 覆盖两字段默认值与非法值回退，重启后恢复上次 HDR 与模式

## 5. 集成验证与文档

- [x] 5.1 跑 `npm run typecheck` 与 `npm run test`，贴出输出；验证方式：两侧 tsc 无错误、全部用例通过
- [x] 5.2 无头验证 FBX / GLB / OBJ 三种格式双模式 + HDR 切换，记录到本 change 的验证小节；验证方式：三种格式各出一条断言输出
- [x] 5.3 同步主规格（`openspec/specs/viewer-3d`、`openspec/specs/lightbox`）并清理 `Viewer3D.tsx` 中本 change 的临时探针与调试输出；验证方式：`openspec validate add-model-hdr-material-preview --strict` 通过且 grep 无残留探针

## 6. Blender 视口照明修正

- [x] 6.1 `Viewer3D` 改用 `AgXToneMapping`，以 Three.js `toneMappingExposure=1.0` 对应 Blender 曝光 `0.0`；验证方式：新增纯函数测试断言色彩基准，渲染器实例断言 tone mapping 与曝光值
- [x] 6.2 实体模式启用 Ambient、主光和补光三灯基线，渲染模型模式叠加 HDR 并保留基线灯；验证方式：无头读取 `__threeStats.lights` 为 3，且 HDR 强度为 0 时模型仍可见
- [x] 6.3 实体模式使用 `Default` studio light 的四灯方向、颜色和强度；验证方式：真实 FBX 截图保留灰色明暗分层，白色溢出像素接近零
- [x] 6.4 默认背景改为深灰主题背景与世界空间三维地面网格，网格跨度为模型对角线的 24 倍并固定在原点，模型保留源文件世界坐标，相机水平环绕原点；验证方式：真实 FBX 截图网格铺满视口，`target` 的 x/z 均为 0
- [x] 6.5 将旋转、强度、世界不透明度和模糊映射到环境与背景，切换 HDR 或关闭时释放旧贴图和 PMREM 目标；验证方式：连续切换 8 次后资源计数无累积增量

## 7. Blender 风格材质球面板（由第 9 节扩展为完整面板）

- [x] 7.1 右上角折叠态改为当前 HDR 材质球加 native-looking 小箭头，箭头点击展开环境面板；验证方式：无头点击箭头后面板可见，球本身仍打开 HDR 预设
- [x] 7.2 面板复刻 Blender Material Preview 布局：顶部环境预览球，下方旋转、强度、世界不透明度、模糊四行控制；验证方式：DOM 断言四项标签、数值格式和顺序，截图与参考图对照
- [x] 7.3 面板采用深灰实色、紧凑行高、蓝色数值和方形小圆角，不继承现有玻璃模糊样式；验证方式：样式断言无 `backdrop-filter`，面板宽度与边界在舞台内
- [x] 7.4 8 个 HDR 预设保留为顶部预览球展开的缩略球行；验证方式：点击预览球后出现 8 个预设，选择后照明、预览球和当前值同步更新
- [x] 7.5 `uiPrefs` 增加 `modelHdrRotation`、`modelHdrStrength`、`modelHdrOpacity`、`modelHdrBlur`，带范围校验；验证方式：扩展 `tests/uiStore.test.ts` 覆盖默认值、合法值和非法值回退

## 9. 完整面板直接展示材质球

- [x] 9.1 点击当前材质球或原生箭头后，一次展开完整面板：顶部预览球、8 个 HDR 材质球横排和四项参数同时可见，不再需要点击预览球打开第二层菜单；验证方式：无头展开后 `.blender-env-panel`、8 个 `.blender-env-preset` 与四项滑块同时存在
- [x] 9.2 选择任一材质球后立即切换 HDR，完整面板保持打开；验证方式：点击选项后 `__threeStats.env` 与顶部预览球同步更新

## 8. Blender 视口验收

- [x] 8.1 运行 `npm run typecheck`、`npm run test` 与 `npm run build`，记录完整结果；验证方式：类型检查、测试和构建通过，已知 `eagle.test.ts` worker flake 单独重跑 3/3 通过
- [x] 8.2 无头验证 FBX、GLB、OBJ 的实体与渲染模式，以及面板展开、四项参数和 HDR 切换；验证方式：三种格式均保留 `lights=3`，面板四项齐全、8 个预设可见
- [x] 8.3 对照 Blender 视口检查真实 FBX 截图与像素统计；验证方式：模型区亮度峰值 238/255、纯白溢出为 0，灰色明暗和轮廓可辨，面板布局与参考一致
- [x] 8.4 同步 `openspec/specs/viewer-3d` 与 `openspec/specs/lightbox`，清理临时探针；验证方式：change、viewer-3d 与 lightbox 严格校验均通过

## Previous Verification

- `npm run typecheck`：node/web 两侧 tsc 通过。
- `npm run test`：41/42 文件中先出现已知 `eagle.test.ts` worker 退出；单独重跑 `eagle.test.ts` 3/3 通过。HDR、材质与 uiStore 定向测试 49/49 通过。
- `npm run build`：main/preload/renderer 构建通过。
- 最终 FBX 无头验证：14 个材质、`transparent=0`、10 张 Base Color 贴图实际解码；右上 HDR 球 68×68、无文字、无 `.hdr-panel`。
- HDR 选择器：点击右上球展开 8 个 52×52 环境球并保持在舞台边界内；City → Forest 后画布 85.62% 像素变化，`__threeStats.env` 与 `__threeStats.background` 同步更新。
- 底部材质槽入口与右侧材质面板已移除，模式条只保留实体/渲染按钮。
- 资源释放：连续开关 10 次，`mounts` 与 `disposes` 各增加 23，未累积额外差值。
- `openspec validate viewer-3d --type spec --strict`、`lightbox --type spec --strict` 与 change 严格校验均通过。

旧版验证记录的是重新设计前的 HDR 横排入口与背景行为，不适用于本轮 Blender 视口和面板改造。

## Blender 视口验证

- `npm run typecheck`：node/web 两侧通过。
- `npm run test`：41/42 文件通过；`eagle.test.ts` 触发已知 worker 退出，单独重跑 3/3 通过。
- `npm run build`：main、preload、renderer 三段构建通过。
- FBX、GLB、OBJ：两种模式均保留 `lights=3`；HDR 强度为 `0` 时模型仍可见。FBX target 为 `[0, 5891.664, 0]`，网格跨度为 `700466.872`，背景保持主题深灰。
- 环境面板：四项标签顺序为旋转、强度、世界不透明度、模糊；8 个 HDR 预设齐全，面板无 `backdrop-filter` 且完全位于舞台内。
- 完整面板：点击球或箭头后预览球、8 个 HDR 材质球横排和四项参数一次展开，没有第二层菜单；选择材质球后顶部预览同步更新。
- HDR 连续切换：`envSwitches` 从 2 增至 10，`envDisposals` 从 0 增至 8，无资源计数停滞。
- 像素检查：真实 FBX 模型区平均亮度 83.81/255、峰值 238/255、纯白溢出 0。

## Workflow follow-up

- 完成 6–8 项实现与对照验收后再归档该 change。
- 归档后确认主规格中不再残留转台/线框/曝光相关条目。
