## REMOVED Requirements

### Requirement: 索引入口菜单
**Reason**: 「+」菜单收敛为只新建素材库;2026-09-10 索引概念整体移除后,应用不再提供任何把外部目录挂为素材来源的入口,原计划的标签页右键索引入口一并取消。
**Migration**: 无需替代契约;外部目录不再作为素材来源,语义见 `library-index`。

## REMOVED Requirements

### Requirement: 迁移残留清理
**Reason**: 用户要求标题栏「+」菜单只保留新建素材库;迁移残留清理不再作为常规菜单入口。
**Migration**: 保留底层 IPC 与数据清理能力;后续如需恢复入口,应在独立维护界面或专用维护流程中提供。
