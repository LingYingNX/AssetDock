## Purpose

定义 GLB/glTF 灯箱的真实渲染、交互控制、资源释放和曝光设置，保证三维素材能稳定预览，并在重启后保留用户最近一次调整的影棚曝光值。

## Requirements

### Requirement: GLB/glTF 真实渲染
灯箱展示 GLB/glTF 素材 SHALL 用 three.js WebGL 渲染真实模型:经 GLTFLoader 从 media 协议流加载,支持 Draco 压缩;场景含影棚环境光(RoomEnvironment)与蓝调舞台背景,模型自动居中并按包围盒适配取景;加载中显示进度,解析/解码失败 SHALL 回退现有占位舞台并提示错误。

#### Scenario: 打开库内 GLB
- **WHEN** 用户双击一个库内 GLB 素材打开灯箱
- **THEN** 舞台渲染真实模型(可拖拽旋转/滚轮缩放),无 CSS 立方体

#### Scenario: 坏文件回退
- **WHEN** 加载损坏或不完整的 GLB
- **THEN** 显示错误提示与占位舞台,应用不崩溃

### Requirement: 转台与线框
转台 SHALL 默认开启(模型绕竖轴匀速自转),可暂停/继续;线框开关 SHALL 切换全部网格材质 wireframe;`prefers-reduced-motion: reduce` 时转台默认暂停。

#### Scenario: 转台暂停继续
- **WHEN** 用户点击「转台」再点击一次
- **THEN** 自转停止后恢复,其余交互不受影响

#### Scenario: 线框切换
- **WHEN** 用户点击「线框」
- **THEN** 模型切换线框显示,再次点击恢复实体

### Requirement: 视角定格与预设
前视/侧视/顶视 SHALL 将相机定格到对应正交向;舞台下方 5 格视角预设条(透视/前视/侧视/顶视/背视)点击定格并以蓝描边标示当前项;定格与转台互斥(定格即暂停自转)。

#### Scenario: 顶视定格
- **WHEN** 用户点击「顶视」或预设条顶视格
- **THEN** 相机切换到顶视角,转台暂停,预设条该项蓝描边

### Requirement: 资源释放
关闭灯箱或切换到非 3D 素材时 SHALL 释放 three.js 渲染器、几何体、纹理与事件监听,不残留 requestAnimationFrame 循环。释放 SHALL 覆盖材质持有的全部贴图(map、normalMap、roughnessMap、metalnessMap、emissiveMap、aoMap 等)以及场景环境贴图本身与 PMREM 生成器占用的渲染目标;释放完成后 SHALL 断开容器尺寸观察并使画布从容器移除。

#### Scenario: 关闭灯箱释放
- **WHEN** 关闭 3D 灯箱后连续开关 10 次
- **THEN** GPU 内存与帧循环次数回落,无明显泄漏增长

#### Scenario: 材质贴图随模型释放
- **WHEN** 打开一个带基础色贴图、法线贴图与金属粗糙度贴图的 GLB 后关闭灯箱
- **THEN** 这些贴图与其所属材质一并被释放,重复开关同一素材不产生持续上升的 GPU 内存占用

#### Scenario: 环境贴图与渲染目标释放
- **WHEN** 用户关闭 3D 灯箱
- **THEN** 场景环境贴图、生成它的渲染目标与 PMREM 生成器均被释放,画布从容器中移除且尺寸观察已断开

### Requirement: 加载进度与曝光
灯箱 3D 加载 SHALL 显示进度指示(media 流按 content-length 报百分比,解析阶段显示旋转指示),完成后淡入模型;控制条 SHALL 在「环境 · 影棚」旁提供曝光滑杆(默认 1.0,范围 0.4–1.6),拖动实时调节 renderer 曝光且不重建渲染器/场景;曝光值变更时 SHALL 写入应用状态,下次打开 3D 灯箱 SHALL 恢复上次曝光值(全局记忆,不区分素材)。

#### Scenario: 大模型加载进度
- **WHEN** 打开 30MB+ 的 GLB
- **THEN** 加载期间舞台显示百分比进度,完成后模型淡入

#### Scenario: 曝光调节
- **WHEN** 浅色模型过曝,用户把曝光滑杆调低
- **THEN** 模型亮度实时降低,渲染器与转台状态不受影响

#### Scenario: 曝光重启保留
- **WHEN** 调整曝光后完全退出并重启应用,再打开任一 GLB 灯箱
- **THEN** 曝光为上次设定值

### Requirement: 曝光持久化
影棚曝光值变更时 SHALL 写入应用状态;下次打开 3D 灯箱 SHALL 恢复上次曝光值(全局记忆,不区分素材)。

#### Scenario: 曝光重启保留
- **WHEN** 调整曝光后完全退出并重启应用,再打开任一 GLB 灯箱
- **THEN** 曝光为上次设定值

### Requirement: 外部资源与多格式回退

GLB、glTF、FBX 和 OBJ 真实预览 SHALL 以原文件所在目录为基准解析外部 buffer 与贴图。任一格式解析失败时 SHALL 回退占位舞台并显示错误提示，不得显示空白或中断应用。

#### Scenario: glTF 外部 buffer

- **WHEN** 用户打开由 `.gltf` 与同目录 `.bin` 组成的模型
- **THEN** 模型正确加载，外部 buffer 能被解析

#### Scenario: 坏模型回退

- **WHEN** 外部资源缺失或模型损坏
- **THEN** 舞台显示占位模型和错误提示
