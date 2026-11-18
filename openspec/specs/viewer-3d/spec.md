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

### Requirement: FBX PBR 贴图映射
FBX 材质 SHALL 将 `DiffuseColor`、`NormalMap`、`EmissiveColor`、`TransparencyFactor`、`ReflectionFactor` 和 `ShininessExponent` 贴图分别映射到 Base Color、法线、自发光、alpha、金属度和粗糙度槽位。映射 SHALL 保留源贴图的 UV、偏移与重复参数。

#### Scenario: 映射内嵌基础贴图
- **WHEN** 用户打开一个带内嵌 `DiffuseColor`、`NormalMap` 和 `EmissiveColor` 贴图的 FBX
- **THEN** 渲染模式显示对应的 Base Color、法线与自发光贴图

#### Scenario: 映射 ReflectionFactor
- **WHEN** FBX 材质将贴图连接到 `ReflectionFactor`
- **THEN** 该贴图进入金属度槽位并参与 PBR 着色，不因 loader 不支持而丢失

#### Scenario: 映射 ShininessExponent
- **WHEN** FBX 材质将贴图连接到 `ShininessExponent`
- **THEN** 该贴图进入粗糙度槽位并参与 PBR 着色

#### Scenario: 保留贴图变换
- **WHEN** FBX 贴图声明了 UV 偏移或重复
- **THEN** 映射后的 PBR 贴图沿用相同变换

### Requirement: FBX 标量材质转换
无对应贴图时，FBX 材质的 `shininess` SHALL 按 `1 - sqrt(max(shininess, 0)) / 10` 转换为粗糙度，并限制在 `0..1`；`ReflectionFactor` SHALL 转换为金属度。贴图存在时，贴图 SHALL 作为对应通道的数据来源。

#### Scenario: 高光指数转换为粗糙度
- **WHEN** 材质只有 `shininess=36` 且没有粗糙度贴图
- **THEN** 粗糙度为 `0.4`

#### Scenario: 负高光指数被钳制
- **WHEN** 材质带负的 `shininess`
- **THEN** 计算前按 `0` 处理，不产生非法 PBR 值

#### Scenario: 反射因子转换为金属度
- **WHEN** 材质只有 `ReflectionFactor=0.35` 且没有金属度贴图
- **THEN** 金属度为 `0.35`

### Requirement: 渲染模式强制不透明
渲染模式 SHALL 强制关闭透明混合，`TransparencyFactor`、`alphaMap` 或源材质的 `opacity < 1` SHALL NOT 使模型呈半透明。`alphaTest > 0` SHALL 继续产生镂空。

#### Scenario: alphaMap 不产生半透明
- **WHEN** FBX 材质带 `alphaMap`、`opacity=1` 且 `alphaTest=0`
- **THEN** 渲染模式按不透明显示，不启用透明混合

#### Scenario: 镂空材质
- **WHEN** FBX 材质的 `alphaTest > 0`
- **THEN** 渲染模式按 alpha 测试裁掉透明区域

#### Scenario: 半透明源材质
- **WHEN** 源材质 `opacity < 1`
- **THEN** 渲染模式仍按 `opacity=1` 不透明显示

#### Scenario: 无 Base Color 但合法材质
- **WHEN** 材质只有法线、alpha 或自发光贴图而没有 Base Color 贴图
- **THEN** 系统不得把它误判为缺贴图 clay

### Requirement: Blender 视口照明基线
三维预览 SHALL 使用 `AgXToneMapping`,Blender 曝光 `0.0` 对应 Three.js `toneMappingExposure=1.0`。实体模式 SHALL 使用 AmbientLight、主方向光和补方向光组成的 clay 基线灯。渲染模型模式 SHALL 叠加 HDR 环境光照,同时保留同一组基线灯,确保 HDR 强度为 `0` 时模型仍可见。默认背景 SHALL 为深灰主题背景与真实三维地面网格,不得直接显示 HDR 全景背景。

#### Scenario: 默认不叠加额外灯光
- **WHEN** 用户打开任意三维素材
- **THEN** 实体模式启用 AmbientLight、主方向光和补方向光,渲染模型模式保留这三盏灯并叠加 HDR

#### Scenario: HDR 强度归零仍可见
- **WHEN** 用户在渲染模型模式把 HDR 强度调到 `0`
- **THEN** 模型仍由基线灯照亮,不得显示为黑色剪影

#### Scenario: 高光保留细节
- **WHEN** 用户切换实体模式或渲染模型模式
- **THEN** 白色高光仍保留表面轮廓和转折,不出现整片纯白或看不到细节的过曝区域

#### Scenario: 三维网格跟随视角
- **WHEN** 用户旋转、缩放或平移相机
- **THEN** 地面网格按真实三维透视同步变化,不得像固定 CSS 背景一样停留在屏幕平面

#### Scenario: 保留模型世界原点
- **WHEN** 用户打开在 Blender 中位于世界原点的模型
- **THEN** 模型保持在原始世界坐标,地面网格固定在原点并覆盖视口,相机的水平环绕中心也保持在世界原点

### Requirement: HDR 环境参数
完整环境面板 SHALL 同时显示旋转、强度、世界不透明度和模糊四项控制,并即时影响当前模型。旋转 SHALL 只旋转环境,不旋转模型和相机;世界不透明度为 `0` 时 SHALL 完全隐藏 HDR 背景并显示主题背景。四项值与当前 HDR SHALL 跨重启保留。

#### Scenario: 调整环境参数
- **WHEN** 用户拖动旋转、强度、世界不透明度或模糊
- **THEN** 环境光照、反射或背景实时变化,模型和相机方向不移动

#### Scenario: 环境参数保留
- **WHEN** 用户修改四项参数后重启应用
- **THEN** 下次打开模型恢复上次的 HDR、旋转、强度、世界不透明度和模糊值

### Requirement: HDR 环境预设
材质球入口 SHALL 保留 8 个 Blender 官方 CC0 1K EXR 环境:`city`、`courtyard`、`forest`、`interior`、`night`、`studio`、`sunrise`、`sunset`,默认 `forest`。完整面板打开时 SHALL 立即显示横排预设,不需要第二层菜单;选择后更新环境光照、反射、顶部材质球和面板预览球。

#### Scenario: 切换 HDR 预设
- **WHEN** 用户展开完整面板并选择另一个 HDR
- **THEN** 当前环境、顶部材质球与预览球更新,面板保持打开,旧环境贴图和 PMREM 目标被释放

#### Scenario: 默认森林环境
- **WHEN** 用户首次打开三维模型
- **THEN** 当前 HDR 为 `forest`,背景仍保持主题背景,世界不透明度为 `0`
