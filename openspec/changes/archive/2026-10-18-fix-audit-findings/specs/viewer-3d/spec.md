# Spec Delta

## ADDED Requirements

### Requirement: 外部资源与多格式回退

GLB、glTF、FBX 和 OBJ 真实预览 SHALL 以原文件所在目录为基准解析外部 buffer 与贴图。任一格式解析失败时 SHALL 回退占位舞台并显示错误提示，不得显示空白或中断应用。

#### Scenario: glTF 外部 buffer

- **WHEN** 用户打开由 `.gltf` 与同目录 `.bin` 组成的模型
- **THEN** 模型正确加载，外部 buffer 能被解析

#### Scenario: 坏模型回退

- **WHEN** 外部资源缺失或模型损坏
- **THEN** 舞台显示占位模型和错误提示
