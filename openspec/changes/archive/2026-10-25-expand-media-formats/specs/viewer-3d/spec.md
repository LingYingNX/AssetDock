# Spec Delta

## MODIFIED Requirements

### Requirement: 外部资源与多格式回退

所有内置三维格式真实预览 SHALL 以原文件所在目录为基准解析外部 buffer、材质与贴图，包括 GLB、glTF、FBX、OBJ、PMD、PMX、DAE、USDZ、3MF、AMF、VRML 和 VRM。任一格式解析失败时 SHALL 回退占位舞台并显示错误提示，不得显示空白或中断应用。

#### Scenario: glTF 外部 buffer

- **WHEN** 用户打开由 `.gltf` 与同目录 `.bin` 组成的模型
- **THEN** 模型正确加载，外部 buffer 能被解析

#### Scenario: PMX 外部贴图

- **WHEN** 用户打开带相对贴图路径的 PMX 模型
- **THEN** 系统以模型所在目录解析贴图，日文文件名和子目录不导致空白模型

#### Scenario: 坏模型回退

- **WHEN** 外部资源缺失或模型损坏
- **THEN** 舞台显示占位模型和错误提示

## ADDED Requirements

### Requirement: 内置多格式三维预览

应用 SHALL 为 GLB、glTF、FBX、OBJ、STL、PLY、3DS、DAE、USDZ、3MF、AMF、VRML/VRM 和 PMD/PMX 提供真实三维预览。预览 SHALL 复用现有转台、线框、视角预设、曝光和资源释放行为。

#### Scenario: 打开 STL

- **WHEN** 用户双击库内 STL 素材
- **THEN** 灯箱渲染真实网格，转台与线框控制可用

#### Scenario: 打开 PMX

- **WHEN** 用户双击库内 PMX 素材
- **THEN** 灯箱显示带材质的 MMD 模型，而不是 CSS 占位立方体

#### Scenario: 格式损坏

- **WHEN** 一个 USDZ 文件解析失败
- **THEN** 显示错误提示和占位舞台，其它素材仍可打开

### Requirement: MMD 模型资源

PMD/PMX 预览 SHALL 解析模型引用的纹理与材质，并处理日文路径或 Shift-JIS 文件名。纹理缺失时 SHALL 保留模型几何并显示材质缺失提示，不得整体崩溃。

#### Scenario: 日文纹理名

- **WHEN** PMX 引用 `髪.png` 等同目录纹理
- **THEN** 纹理能被正确找到并应用到模型

#### Scenario: 缺少纹理

- **WHEN** PMX 引用的纹理文件不存在
- **THEN** 模型以缺失材质的实体模式显示，并提示资源不完整

### Requirement: HDR 与 EXR 环境预览

HDR 与 EXR 素材 SHALL 以环境贴图或环境球方式真实预览，并应用可调曝光和 tone mapping。预览 SHALL NOT 把高动态范围数据直接显示为未映射的普通图片。

#### Scenario: 打开 EXR

- **WHEN** 用户双击一个 EXR 环境图
- **THEN** 灯箱显示带高光细节的环境球，曝光滑杆可调节亮度

#### Scenario: 打开 HDR

- **WHEN** 用户双击一个 Radiance HDR 文件
- **THEN** 系统显示环境预览，并在解析失败时回退占位

### Requirement: 外部软件三维预览

BLEND 与 C4D 素材 SHALL 通过本机外部软件生成预览缓存。应用 SHALL 明确显示外部工具名称、是否可用和失败原因；未安装时 SHALL 提供外部打开入口。

#### Scenario: Blender 可用

- **WHEN** 用户打开 BLEND 且已配置有效 Blender
- **THEN** 应用生成并显示预览缓存，不把 Blender 窗口嵌入应用

#### Scenario: Cinema 4D 可用

- **WHEN** 用户打开 C4D 且已配置有效 Cinema 4D
- **THEN** 应用尝试调用其命令行渲染；不支持时显示外部打开，不谎称内置预览

#### Scenario: 外部工具超时

- **WHEN** 外部软件超过预设时间仍未完成
- **THEN** 任务被终止，灯箱显示超时提示和占位
