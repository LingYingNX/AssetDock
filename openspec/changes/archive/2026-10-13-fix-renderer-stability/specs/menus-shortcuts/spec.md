# Spec Delta

## MODIFIED Requirements

### Requirement: 全局键盘快捷键
应用 SHALL 支持:Ctrl F 聚焦搜索、Enter 打开预览、Space 将焦点卡片设为唯一选中、Esc 关闭灯箱与菜单、←/→ 灯箱切换、F2 重命名(进入检查器文件名编辑)、Ctrl I 文件信息(打开灯箱信息)、Del 删除选中素材(移入回收站)、Ctrl 滚轮缩放缩略图。快捷键 SHALL 只在焦点不处于可编辑控件(input、textarea、contenteditable)或模态对话框内时生效;除 Ctrl F 与 Esc 外,焦点位于可编辑控件时 SHALL NOT 触发任何上述动作,使方向键、Enter、Space、Del 等按键保留其编辑语义。

#### Scenario: Ctrl 滚轮缩放
- **WHEN** 光标位于素材网格上,用户按住 Ctrl 滚动滚轮
- **THEN** 缩略图列宽在 170–320px 范围内变化,效果与拖动缩放滑块一致

#### Scenario: Space 单选焦点卡片
- **WHEN** 用户按下 Space
- **THEN** 当前焦点卡片成为唯一选中项,不再因已选中而被取消

#### Scenario: 输入框内方向键不切灯箱
- **WHEN** 灯箱打开期间用户聚焦到备注或标签输入框并按下 ←/→ 移动光标
- **THEN** 光标在输入框内移动,灯箱不切换到上一条或下一条素材

#### Scenario: 编辑备注时 Enter 不打开预览
- **WHEN** 用户在检查器备注框中编辑文本并按下 Enter 或 Space
- **THEN** 按键作为文本输入被处理,不打开灯箱预览、不改变素材选中状态
