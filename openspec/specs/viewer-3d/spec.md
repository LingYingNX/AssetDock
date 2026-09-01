## Purpose

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
关闭灯箱或切换到非 3D 素材时 SHALL 释放 three.js 渲染器、几何体、纹理与事件监听,不残留 requestAnimationFrame 循环。

#### Scenario: 关闭灯箱释放
- **WHEN** 关闭 3D 灯箱后连续开关 10 次
- **THEN** GPU 内存与帧循环次数回落,无明显泄漏增长
