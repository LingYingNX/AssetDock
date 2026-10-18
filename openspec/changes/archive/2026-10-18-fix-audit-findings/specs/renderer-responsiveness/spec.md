# Spec Delta

## ADDED Requirements

### Requirement: 3D 运行时按需加载

Three.js、模型加载器和 Draco 解码器 SHALL NOT 进入首屏主包。只有用户打开真实 3D 素材或滚动到可见的 3D 卡片时，才 SHALL 加载这些资源。

#### Scenario: 纯图片库不加载 3D 代码

- **WHEN** 用户打开只含图片的素材库
- **THEN** 首屏不请求 Three.js 或模型加载器代码

#### Scenario: 打开 3D 素材才加载

- **WHEN** 用户首次双击一个 GLB 素材
- **THEN** 此时加载 3D 运行时并显示加载进度
