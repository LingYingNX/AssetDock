# Spec Delta

## ADDED Requirements

### Requirement: 文档灯箱舞台

双击文档素材 SHALL 在灯箱中打开只读文档舞台。舞台 SHALL 保留当前顶栏、返回按钮、胶片带和检查器语义，并提供加载中、成功、失败与重试状态，不得出现空白画布或无限转圈。

#### Scenario: 打开 DOC 或 DOCX

- **WHEN** 用户双击一个有效 DOC 或 DOCX 卡片
- **THEN** 灯箱显示文档页面、文件名和格式，顶部返回按钮与底部胶片带保持可用

#### Scenario: 解析中

- **WHEN** 文档解析耗时超过瞬时渲染
- **THEN** 舞台显示明确的解析中状态，用户仍可返回或切换素材

#### Scenario: 解析失败

- **WHEN** 文档损坏、加密或缺少外部转换器
- **THEN** 舞台显示对应原因、重试按钮与外部打开入口

### Requirement: 文档页面导航

XLSX SHALL 提供工作表切换；PPTX SHALL 提供幻灯片上一张、下一张与页码；多页 DOC 与 DOCX SHALL 提供页导航或连续滚动定位。TXT、Markdown 与 CSV SHALL 提供连续滚动阅读。

#### Scenario: 切换工作表

- **WHEN** 用户在 XLSX 预览中点击另一个工作表标签
- **THEN** 舞台切换到该工作表的表格内容，当前标签同步高亮

#### Scenario: 切换幻灯片

- **WHEN** 用户在 PPTX 预览中点击下一张
- **THEN** 舞台显示下一张幻灯片，页码同步更新

#### Scenario: 文档内滚动

- **WHEN** 用户滚动 TXT、Markdown、CSV、长 DOC 或长 DOCX
- **THEN** 只滚动文档内容区域，不误触关闭灯箱

### Requirement: 文档预览交互

文档舞台 SHALL 支持适度缩放、适应窗口与重置缩放。缩放 SHALL 保持文档比例和可读性，SHALL NOT 让工具栏、页码或工作表标签随内容一起缩放到不可操作。

#### Scenario: 放大表格

- **WHEN** 用户放大 XLSX 预览
- **THEN** 表格内容放大并可滚动查看，工作表标签保持固定可操作尺寸

#### Scenario: 重置缩放

- **WHEN** 用户双击文档内容或点击重置缩放
- **THEN** 文档恢复适应窗口的初始比例
