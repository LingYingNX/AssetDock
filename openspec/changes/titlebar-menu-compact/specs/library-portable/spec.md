## REMOVED Requirements

### Requirement: 索引入口菜单
**Reason**: 「+」菜单收敛为只新建素材库;索引入口改为更贴近目标的标签页右键菜单。
**Migration**: 使用新增的「标签页索引入口」契约。

## ADDED Requirements

### Requirement: 标签页索引入口
已打开库标签页 SHALL 支持右键打开紧凑上下文菜单并提供「索引目录到当前库…」项:选择外部目录挂到该标签页对应的库(语义见 `library-index`);无对应库时该项禁用;点击菜单项 SHALL 先激活该标签页,再打开系统目录选择对话框。

#### Scenario: 标签页右键发起索引
- **WHEN** 用户右键一个已打开库标签页,选择「索引目录到当前库…」并选定外部目录
- **THEN** 该标签页对应库新增索引,素材入网格(同 `library-index` 各场景)

## REMOVED Requirements

### Requirement: 迁移残留清理
**Reason**: 用户要求标题栏「+」菜单只保留新建素材库;迁移残留清理不再作为常规菜单入口。
**Migration**: 保留底层 IPC 与数据清理能力;后续如需恢复入口,应在独立维护界面或专用维护流程中提供。
