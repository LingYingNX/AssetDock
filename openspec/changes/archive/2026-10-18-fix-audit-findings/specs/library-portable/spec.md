# Spec Delta

## ADDED Requirements

### Requirement: 回退库按库隔离写入

使用全局回退数据库时，所有按素材 id 的编辑、标签增删、缺失标记和元数据更新 SHALL 同时限定 `library_id`。不属于当前库的 id SHALL 被拒绝，不得更新其它库的记录。

#### Scenario: 伪造跨库 id 被拒绝

- **WHEN** 渲染层向库 A 提交库 B 的素材 id
- **THEN** 主进程拒绝这次更新，库 B 的评分、标签和备注保持不变

### Requirement: 旧库清空不可由渲染层直接触发

旧库残留清理 SHALL 只由主进程在原生确认后执行。渲染层 SHALL NOT 直接调用清空全局资产表的接口；仍存在回退库时 SHALL 拒绝清理。

#### Scenario: 渲染层直接调用被拒绝

- **WHEN** 渲染层尝试清空旧库残留数据
- **THEN** 主进程拒绝请求，不删除全局资产表
