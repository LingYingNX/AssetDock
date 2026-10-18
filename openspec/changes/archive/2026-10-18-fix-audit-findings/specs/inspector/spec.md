# Spec Delta

## ADDED Requirements

### Requirement: 切换素材时编辑控件重置

检查器为备注和来源链接渲染输入控件时 SHALL 使用当前素材的值。用户从一个素材切换到另一个素材后，输入控件 SHALL NOT 保留上一条素材的文本。

#### Scenario: 备注不串到下一个素材

- **WHEN** 用户查看带备注的素材 A，再选中备注为空的素材 B
- **THEN** 备注框显示为空，失焦后不会把 A 的备注写入 B

#### Scenario: 来源链接跟随素材

- **WHEN** 用户从有来源链接的素材切换到没有链接的素材
- **THEN** 来源链接框立即清空
