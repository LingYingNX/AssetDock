# Spec Delta

## ADDED Requirements

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
