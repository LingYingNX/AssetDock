## 1. 依赖与资源

- [x] 1.1 安装 `three`(0.185.1 + @types/three 0.185.4);vite 侧放置 Draco 解码器(`three/examples/jsm/libs/draco/` → renderer public/gltf/draco/);`npm run typecheck` 通过

## 2. Viewer3D 组件

- [x] 2.1 `Viewer3D.tsx`:renderer/scene/camera/RoomEnvironment 装配,alpha 透出舞台背景,包围盒自适应取景;挂载即渲、卸载全量释放(rAF/dispose/监听);断言:开关 10 次帧循环归零
- [x] 2.2 GLB/glTF 加载:media:// fetch arrayBuffer → GLTFLoader.parse,Draco 解码接入;进度显示;坏文件 onError → 占位舞台回退;断言:正常 GLB 渲染、损坏文件回退
- [x] 2.3 转台(绕 Y 0.35 rad/s,默认开;reduced-motion 默认暂停)、线框遍历切换、前/侧/顶定格 + 5 格预设条联动;断言:四控制路径状态互斥正确

## 3. 灯箱接线

- [x] 3.1 Lightbox 3D 分支:GLB/glTF → Viewer3D,FBX/OBJ → 现有占位舞台;控制条/预设条状态桥接 Viewer3D;徽章文案随格式
- [x] 3.2 视觉核对:舞台蓝玻璃底/线框地面/徽章不回归(截图对照 Change 1 灯箱)

## 4. 验证收尾

- [x] 4.1 typecheck/build/test 全绿;灯箱 3D 无泄漏开关断言(dev 桥:toggle 10 次 GPU/帧计数)
- [x] 4.2 对照 specs 逐 scenario 勾稽,偏差记录入 change 目录
