# Spec Delta

## ADDED Requirements

### Requirement: 文档格式筛选

格式筛选 SHALL 增加文档分组，覆盖能力注册表中的全部文档格式。选中某个文档格式后 SHALL 只显示该规范格式；文档扩展名别名 SHALL 归一到同一筛选项。

#### Scenario: 按 DOCX 筛选

- **WHEN** 用户在格式下拉选择 DOCX
- **THEN** 网格只显示 DOCX 文档，不混入 DOC、TXT 或其它格式

#### Scenario: 文档分组

- **WHEN** 用户展开格式筛选
- **THEN** 文档格式位于独立分组，并与图片、视频、三维、代码分组区分

#### Scenario: 别名归一

- **WHEN** 库中同时存在 `.md` 与 `.markdown`
- **THEN** 选择 Markdown 筛选项后两者都显示

### Requirement: 文档卡片信息

文档卡片 SHALL 显示文档格式徽章、名称、大小与可用的文档结构信息。TXT、Markdown、DOC、DOCX 可显示页数，XLSX 可显示工作表数，PPTX 可显示幻灯片数；信息不可用时 SHALL 显示破折号而非伪造数字。

#### Scenario: XLSX 卡片

- **WHEN** 用户浏览含三个工作表的 XLSX 卡片
- **THEN** 卡片显示 XLSX 徽章、文件大小和工作表数量

#### Scenario: 信息不可用

- **WHEN** 文档页数或工作表数无法读取
- **THEN** 卡片显示破折号，不显示猜测值

### Requirement: 文档筛选语义

文档 SHALL 参与格式、评分、标签、搜索、收藏与回收站筛选。文档 SHALL NOT 参与图片形状与尺寸筛选；选择任一形状或尺寸条件时，文档素材 SHALL NOT 被误判为方形、小图或其它图片语义。

#### Scenario: 方形筛选

- **WHEN** 用户选择“方形”形状筛选
- **THEN** 文档不会仅因缺少宽高而被归为方形

#### Scenario: 尺寸筛选

- **WHEN** 用户选择“小”或“大”尺寸筛选
- **THEN** 文档不按缺失的图片分辨率被错误纳入或排除规则；界面 SHALL 明确文档不适用该筛选

### Requirement: 文档能力提示

检查器 SHALL 显示文档的能力等级：内置只读预览、需外部办公软件转换、仅入库或解析失败。需要外部软件时 SHALL 显示具体缺失项与外部打开入口，不得只显示空白封面。

#### Scenario: 内置文档

- **WHEN** 用户选中 DOC、DOCX、XLSX、PPTX、TXT、Markdown 或 CSV
- **THEN** 检查器显示“内置只读预览”

#### Scenario: 外部依赖文档

- **WHEN** 用户选中 PPT、WPS 或 ET 且没有可用转换器
- **THEN** 检查器显示“需外部办公软件转换”和缺失说明
