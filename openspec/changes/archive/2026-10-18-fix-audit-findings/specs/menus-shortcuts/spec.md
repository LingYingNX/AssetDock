# Spec Delta

## ADDED Requirements

### Requirement: Ctrl+C 复制选中素材

当焦点不在可编辑控件或模态对话框内时，Ctrl+C SHALL 通过既有复制能力复制当前选中素材。没有选中素材时 SHALL 不拦截系统复制行为。

#### Scenario: 复制选中文件

- **WHEN** 用户选中两个库内素材并按 Ctrl+C
- **THEN** 系统剪贴板写入这两个文件，与右键菜单“复制”的结果一致

#### Scenario: 无选中不抢占复制

- **WHEN** 当前没有选中素材
- **THEN** Ctrl+C 保持系统默认行为
