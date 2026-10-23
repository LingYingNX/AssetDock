# Spec Delta

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 转台与线框
**Reason**: 模型预览已收敛为实体模式和渲染模型两种检查模式,转台与线框不再提供。
**Migration**: 使用鼠标左键旋转、滚轮缩放、按住滚轮拖拽平移,并在实体/渲染模式间切换。

### Requirement: 视角定格与预设
**Reason**: 视角预设条与转台工具栏已删除,自由导航取代固定视角。
**Migration**: 使用鼠标旋转、缩放和平移查看模型。

### Requirement: 加载进度与曝光
**Reason**: 曝光滑杆和全局曝光持久化已删除,HDR 环境成为新的光照控制入口。
**Migration**: 使用 HDR 预设切换环境光照;加载进度仍保留。

### Requirement: 曝光持久化
**Reason**: 曝光控制已移除,不再保存全局曝光值。
**Migration**: 使用 HDR 预设调整环境光照。

## ADDED Requirements

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

### Requirement: Blender 视口照明基线
三维预览 SHALL 使用 `AgXToneMapping`,Blender 曝光 `0.0` 对应 Three.js `toneMappingExposure=1.0`。渲染模型模式 SHALL 只使用 HDR 环境光照,不得叠加场景灯;实体模式 SHALL 只使用 `basic.sl` 四灯 Studio rig,不得叠加 HDR 或 Studio 环境贴图。默认背景 SHALL 为深灰主题背景与真实三维地面网格,不得直接显示 HDR 全景背景。

#### Scenario: 默认不叠加额外灯光
- **WHEN** 用户打开任意三维素材
- **THEN** 实体模式只启用四盏 Studio 灯,渲染模型模式场景灯数量为 0,且两种模式都没有额外 AmbientLight

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
环境设置 SHALL 提供旋转、强度、世界不透明度和模糊四项控制,并即时影响当前模型。旋转 SHALL 只旋转环境,不旋转模型和相机;世界不透明度为 `0` 时 SHALL 完全隐藏 HDR 背景并显示主题背景。四项值与当前 HDR SHALL 跨重启保留。

#### Scenario: 调整环境参数
- **WHEN** 用户拖动旋转、强度、世界不透明度或模糊
- **THEN** 环境光照、反射或背景实时变化,模型和相机方向不移动

#### Scenario: 默认世界不可见
- **WHEN** 用户首次打开模型
- **THEN** 世界不透明度为 `0.000`,背景为深灰主题背景与网格,HDR 仍参与环境光照

#### Scenario: 显示 HDR 背景
- **WHEN** 用户把世界不透明度提高到大于 `0`
- **THEN** HDR 背景按该不透明度显示,模糊值同步生效

#### Scenario: 环境参数保留
- **WHEN** 用户修改四项参数后重启应用
- **THEN** 下次打开模型恢复上次的 HDR、旋转、强度、世界不透明度和模糊值

### Requirement: HDR 环境预设
材质球面板 SHALL 保留 8 个 Blender 官方 CC0 1K EXR 环境:`city`、`courtyard`、`forest`、`interior`、`night`、`studio`、`sunrise`、`sunset`,默认 `forest`。点击面板顶部预览球 SHALL 展开这些预设,选择后更新环境光照、反射和预览球。

#### Scenario: 切换 HDR 预设
- **WHEN** 用户展开预览球并选择另一个 HDR
- **THEN** 当前环境与预览球更新,旧环境贴图和 PMREM 目标被释放

#### Scenario: 默认森林环境
- **WHEN** 用户首次打开三维模型
- **THEN** 当前 HDR 为 `forest`,背景仍保持主题背景,世界不透明度为 `0`

### Requirement: 加载进度
三维加载 SHALL 按 media 流内容长度显示百分比,解析阶段显示进度提示,完成后隐藏加载提示并显示模型。

#### Scenario: 大模型加载进度
- **WHEN** 用户打开 30MB 以上的 FBX 或 GLB
- **THEN** 舞台显示加载百分比,完成后提示消失且模型可见
