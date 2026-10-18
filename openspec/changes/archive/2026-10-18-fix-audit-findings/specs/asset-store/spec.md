# Spec Delta

## MODIFIED Requirements

### Requirement: 查询 IPC
渲染层 SHALL 经 IPC(invoke/handle)获取素材列表、侧栏计数与单条记录;过滤(侧栏/五筛选/搜索/颜色)语义与 Change 1 的 `queryAssets` 保持一致;未绑定任何库时 SHALL 进入空状态并提供新建素材库引导，SHALL NOT 回退演示数据集。

#### Scenario: 演示模式回退
- **WHEN** 首次启动且尚未建库
- **THEN** 界面进入空状态并显示「新建素材库」引导，不显示示例素材
