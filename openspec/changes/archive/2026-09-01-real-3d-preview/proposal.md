## Why

三维素材(GLB/glTF)目前在灯箱用 CSS 立方体示意,看不到模型本身。用户明确要求参考 GitHub 权威开源实现(three.js 为 WebGL 3D 加载的事实标准,glTF 是 Blender 等工具链的交换标准)引入真实 3D 预览。

## What Changes

- 新增 `three` 依赖;灯箱 3D 舞台改为 WebGL 实时渲染:
  - GLTFLoader 加载库内 GLB/glTF(经 media:// 流,支持 Draco 压缩解码)
  - 转台自动旋转(默认开,可暂停)、线框切换(全材质 wireframe)
  - 前视/侧视/顶视定格 + 舞台下方 5 格视角预设条(透视/前/侧/顶/背)
  - RoomEnvironment 影棚环境光 + 蓝调舞台背景,延续现有玻璃视觉
  - 加载进度与失败提示(坏文件回退现有占位)
- FBX/OBJ 维持占位舞台(不引入转换管线,记录后续方向)
- 卡片缩略图不变(仍是占位/抽帧管线;模型实时渲染只在灯箱)
- 渲染器生命周期管理:关闭灯箱释放 GPU 资源;`prefers-reduced-motion` 时转台默认暂停
- 明确排除:打包发布、FBX/OBJ 转换、材质编辑、动画播放

## Capabilities

### New Capabilities

- `viewer-3d`:灯箱内 three.js 实时 3D 渲染(加载/转台/线框/视角/环境/资源释放/失败回退)

### Modified Capabilities

- `lightbox`:「3D 转台舞台」requirement 由 CSS 立方体改为 WebGL 真实渲染(保留控制条/预设条/舞台视觉规格)

## Impact

- 新增依赖:`three`;渲染层新增 `Viewer3D` 组件(three.js 生命周期封装)
- 灯箱 3D 分支改造;`.glb/.gltf` 素材加载走既有 `media://` 协议(已支持流与 Range)
- 风险面:大模型内存(加 loading 与异常回退)、Draco 解码器资源路径打包(vite 静态资源)
