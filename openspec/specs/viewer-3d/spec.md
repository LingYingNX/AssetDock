## Purpose

定义 GLB/glTF/FBX/OBJ 灯箱的真实渲染、交互控制、HDR 环境、材质呈现和资源释放，保证三维素材能稳定预览并检查真实材质。

## Requirements

### Requirement: GLB/glTF 真实渲染
灯箱展示库内三维素材 SHALL 用 three.js WebGL 渲染真实模型:GLB/glTF 经 GLTFLoader 和 Draco 加载,FBX 经 FBXLoader 加载,OBJ 经 OBJLoader 并按 mtllib 加载 MTL 与贴图;模型自动居中并按包围盒适配取景;加载失败 SHALL 回退占位舞台并提示错误。

#### Scenario: 打开库内 GLB
- **WHEN** 用户双击一个库内 GLB 素材打开灯箱
- **THEN** 舞台渲染真实模型,可拖拽旋转和滚轮缩放,不显示 CSS 立方体

#### Scenario: 打开库内 FBX 或 OBJ
- **WHEN** 用户打开 FBX 或 OBJ 素材
- **THEN** 舞台渲染真实几何体;OBJ 存在 MTL 时显示材质与贴图,缺失时显示实体 clay 预览

#### Scenario: 坏文件回退
- **WHEN** 模型文件损坏或外部材质不可读
- **THEN** 显示错误提示与占位舞台,应用不崩溃

### Requirement: 资源释放
关闭灯箱、切换素材或切换 HDR SHALL 释放 three.js 渲染器、几何体、材质、材质贴图、HDR 环境贴图及其 PMREM 渲染目标,并断开尺寸观察和动画循环;不得残留旧模型或旧环境引用。

#### Scenario: 关闭灯箱释放
- **WHEN** 关闭三维灯箱后连续开关 10 次
- **THEN** GPU 内存与帧循环次数回落,无明显泄漏增长

#### Scenario: 环境贴图与渲染目标释放
- **WHEN** 用户切换 HDR 或关闭灯箱
- **THEN** 旧 HDR 贴图、PMREM 目标和材质引用被释放,画布与尺寸观察被清理

#### Scenario: 材质贴图随模型释放
- **WHEN** 打开带基础色、法线或金属粗糙度贴图的模型后关闭灯箱
- **THEN** 这些贴图与其所属材质一并被释放,重复开关不持续增加 GPU 占用

### Requirement: 外部资源与多格式回退

GLB、glTF、FBX 和 OBJ 真实预览 SHALL 以原文件所在目录为基准解析外部 buffer 与贴图。任一格式解析失败时 SHALL 回退占位舞台并显示错误提示，不得显示空白或中断应用。

#### Scenario: glTF 外部 buffer

- **WHEN** 用户打开由 `.gltf` 与同目录 `.bin` 组成的模型
- **THEN** 模型正确加载，外部 buffer 能被解析

#### Scenario: 坏模型回退

- **WHEN** 外部资源缺失或模型损坏
- **THEN** 舞台显示占位模型和错误提示

### Requirement: 实体模式与渲染模型
三维舞台 SHALL 提供「实体模式」和「渲染模型」两个互斥模式,默认实体模式。实体模式 SHALL 用不透明 clay 材质显示几何;渲染模型模式 SHALL 使用模型源材质与贴图;模式选择 SHALL 持久化。

#### Scenario: 默认实体模式
- **WHEN** 用户首次打开任意三维模型
- **THEN** 模型以不透明实体 clay 显示,不继承源材质的 alpha 透明

#### Scenario: 切换渲染模型
- **WHEN** 用户点击「渲染模型」
- **THEN** 模型切换为源材质与贴图,模型贴图正常显示

#### Scenario: 渲染模式默认不透明
- **WHEN** 源模型材质带 `transparent=true` 且 `opacity=1`
- **THEN** 若源材质没有实际透明信息,渲染模式按不透明显示

### Requirement: HDR 环境选择器
模型预览右上角 SHALL 提供一个圆形 HDR 环境球。点击环境球 SHALL 展开一排 8 个环境球,分别对应 `city`、`courtyard`、`forest`、`interior`、`night`、`studio`、`sunrise`、`sunset` 的 Blender 官方 CC0 1K EXR,默认 `forest`。点击任一小球 SHALL 切换当前环境。当前 HDR SHALL 同时用于 GLB/glTF/FBX/OBJ 的环境光照、材质反射和场景背景。

#### Scenario: 显示 HDR 环境球
- **WHEN** 用户打开任意三维素材
- **THEN** 右上角显示一个代表当前环境的圆形球,点击后展开一排可选的 HDR 环境球

#### Scenario: 使用 Blender 默认森林
- **WHEN** 用户首次打开三维模型
- **THEN** HDR 环境为 `forest`,与 Blender 默认世界预览一致

#### Scenario: 点击切换 HDR
- **WHEN** 用户展开环境球并点击另一个环境球
- **THEN** 场景背景、环境光照、材质反射和环境球缩略图同步更新,旧环境贴图与 PMREM 目标被释放

#### Scenario: HDR 出现在场景背景
- **WHEN** 用户选择任意 HDR 环境
- **THEN** 模型后方显示该 HDR 的球面背景,不再只显示在模型材质的反射中

#### Scenario: HDR 选择保留
- **WHEN** 用户选择 HDR 后重启应用
- **THEN** 下次打开三维模型仍使用上次选择的 HDR

### Requirement: 加载进度
三维加载 SHALL 按 media 流内容长度显示百分比,解析阶段显示进度提示,完成后隐藏加载提示并显示模型。

#### Scenario: 大模型加载进度
- **WHEN** 用户打开 30MB 以上的 FBX 或 GLB
- **THEN** 舞台显示加载百分比,完成后提示消失且模型可见
