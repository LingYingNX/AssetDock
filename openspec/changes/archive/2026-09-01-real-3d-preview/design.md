## Context

Change 2 已交付 media:// 流协议(Range 支持)与灯箱骨架(控制条/预设条/舞台视觉均为现成 CSS)。three.js 是 GitHub 上最权威的 WebGL 渲染库;glTF 2.0 是 Khronos 标准、Blender io_scene_gltf2 的交换格式,GLTFLoader+Draco 是其官方参考实现。

## Goals / Non-Goals

**Goals:**

- 灯箱内 GLB/glTF 真实渲染,视觉与现有玻璃舞台融合
- 转台/线框/三视角/预设条映射到 three.js 相机与材质操作
- 严格资源释放,开关灯箱无泄漏

**Non-Goals:**

- FBX/OBJ 转换管线(占位维持)、动画播放、材质编辑、多模型场景
- 卡片缩略图实时渲染(继续占位管线)
- 打包发布(用户指示)

## Decisions

1. **加载器:GLTFLoader + DRACOLoader(解码器经 vite 静态资源分发)**
   - three/examples/jsm 官方实现;Draco wasm 从 `three/examples/jsm/libs/draco/` 经 vite 复制到输出,`DRACOLoader.setDecoderPath` 指向打包后路径。替代 CDN(离线禁用)与自研解析(无意义)。
2. **取景:包围盒自适应**
   - 加载后计算 Box3,相机距离 = 包围盒对角线 × 1.6,模型居中到原点;不同尺寸模型自动适配,无需逐个调参。
3. **转台=模型组绕 Y 匀速旋转(而非相机环绕)**
   - 与既有 CSS 转台心智一致;定格=停止自转 + 相机切正交向(前/侧/顶),透视预设格用固定偏航角摆位。
4. **线框=遍历材质置 wireframe(保留原色)**
   - 替代整体换 LineSegments(丢材质感);开关可逆。
5. **环境:RoomEnvironment + PMREMGenerator**
   - three 官方影棚环境;背景保持蓝调渐变(舞台 CSS 背景 + alpha:true 渲染器透出),不改玻璃视觉。
6. **资源释放:onMount→onUnmount 对称清理**
   - 组件卸载时 cancelAnimationFrame、renderer.dispose/forceContextLoss、逐个 geometry/material/texture dispose、监听移除;灯箱切换素材时先卸载再挂载。
7. **媒体流:media:// 经 fetch 取 arrayBuffer → loader.parse**
   - 免去 loader 内部 XHR 对自定义协议的兼容问题;Range 不需要(全量读入)。

## Risks / Trade-offs

- [Draco 解码器路径在 dev/构建不一致] → vite `publicDir` 放置 draco 资源,dev 与 build 同路径
- [超大模型卡 UI] → 加载在主线程但解析可接受;失败/超大即回退占位;后续可移 Worker
- [无 GPU 环境] → renderer 创建失败即回退占位舞台,功能不损
- [每开关灯箱重建 WebGL 上下文开销] → 数十毫秒级,可接受;上下文数量上限内对称释放

## Migration Plan

不涉及数据迁移;纯渲染层新增 + 灯箱分支改造。

## Open Questions

(无。转台速度 0.35 rad/s、相机 FOV 45° 为实现默认,任务中固定。)
