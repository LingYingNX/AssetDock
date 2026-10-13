# Spec Delta

## MODIFIED Requirements

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
