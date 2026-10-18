# Spec Delta

## ADDED Requirements

### Requirement: Eagle 导入默认复制

「导入 Eagle 素材」SHALL 把已登记的原始文件复制到当前素材库，并保留源 Eagle 库的原始文件与元数据。只有用户明确选择迁移语义时，才允许移动源文件。

#### Scenario: 导入后源库仍完整

- **WHEN** 用户从 Eagle 库导入素材到 MediaHub
- **THEN** 原 Eagle 库中的原始文件仍然存在，MediaHub 新库中出现复制件

#### Scenario: 复制失败不留下半成品

- **WHEN** 导入过程中某个目标文件复制失败
- **THEN** 已复制到目标的未完成文件被清理，数据库不登记该批素材，源文件保持不变
