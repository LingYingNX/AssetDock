# Spec Delta

## ADDED Requirements

### Requirement: 文档缩略图路由

文档缩略图 SHALL 由文档专用渲染路径生成，SHALL NOT 把 OOXML 或旧版 Office 文件交给普通图片解码器。缩略图 SHALL 使用与灯箱相同的文档渲染器或外部转换结果，避免卡片与灯箱呈现两套不同内容。

#### Scenario: DOCX 卡片封面

- **WHEN** 一个 DOCX 文档首次请求卡片缩略图
- **THEN** 应用渲染文档首页或开头内容并输出 640px JPG，不调用普通位图解码器

#### Scenario: PPTX 首张幻灯片

- **WHEN** 一个 PPTX 文档首次请求缩略图
- **THEN** 缩略图显示第一张幻灯片，而不是通用 PPTX 文件图标

#### Scenario: 外部转换演示文档

- **WHEN** 一个 PPT 文件通过外部转换器生成 PDF
- **THEN** 缩略图使用转换后 PDF 的第一页，并与 PDF 预览共享可重建缓存

### Requirement: 文档缩略图失败记录

文档缩略图清单 SHALL 记录失败类别，至少区分损坏、加密、缺少外部工具、超时、资源超限与解析不支持。失败结果 SHALL 与内容指纹和渲染器版本绑定；文件或渲染器变化后 SHALL 重新尝试。

#### Scenario: 加密文档封面

- **WHEN** 加密 DOCX 无法生成缩略图
- **THEN** 卡片显示文档占位图，清单记录“加密”，灯箱说明具体原因

#### Scenario: 渲染器升级

- **WHEN** 文档渲染器版本升级且旧缩略图来自旧版本
- **THEN** 下次请求重新生成缩略图，避免继续显示已知有缺陷的旧画面

### Requirement: 文档缓存清理

文档预览与转换缓存 SHALL 作为可重建派生数据存放于库的 `.mediahub` 目录。素材移入回收站、彻底删除或内容指纹变化时，对应文档派生缓存 SHALL 按现有缩略图清理语义处理，SHALL NOT 删除原始文档。

#### Scenario: 清空回收站

- **WHEN** 用户确认清空回收站
- **THEN** 文档缩略图、PDF 转换缓存与页面图片缓存被清理，原始 DOC、DOCX、XLSX、PPTX 等文件保留在库目录

#### Scenario: 删除缓存目录

- **WHEN** 用户删除 `.mediahub/previews/documents` 或等价派生缓存目录
- **THEN** 文档仍可重新解析或转换，标签、备注、评分与收藏不受影响
