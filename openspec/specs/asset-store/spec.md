## Purpose

定义素材数据的持久化契约:库内 SQLite 的表结构与字段、编辑操作的即时落库语义、渲染层查询 IPC,以及删除/恢复仅改数据不动磁盘文件的边界。

## Requirements

### Requirement: 数据库 Schema
应用 SHALL 在全局注册库维护 libraries，并在每个库的 `.mediahub/library.db` 维护 assets、tags、asset_tags 表;素材记录含库 id、相对路径、类型/格式、尺寸/时长/面数等元数据、大小、mtime、评分、收藏、待审、备注、来源、deletedAt、missing 标记与 palette JSON;路径以 UTF-8 存储,支持中文与空格。

#### Scenario: 重启数据完整
- **WHEN** 用户编辑评分/标签/备注/收藏后完全退出并重新启动应用
- **THEN** 全部编辑内容与库结构原样恢复

### Requirement: 编辑落库
检查器与灯箱的全部编辑操作(评分、收藏、待审、重命名记录、标签增删、备注、来源链接、删除/恢复)SHALL 即时写入数据库(事务),UI 联动不等刷新;写库失败 SHALL 提示且不产生半写状态。

#### Scenario: 编辑即持久
- **WHEN** 修改任一素材的评分或标签后立即杀进程再启动
- **THEN** 该编辑仍在(无「退出时保存」环节)

### Requirement: 查询 IPC
渲染层 SHALL 经 IPC(invoke/handle)获取素材列表、侧栏计数与单条记录;过滤(侧栏/五筛选/搜索/颜色)语义与 Change 1 的 `queryAssets` 保持一致;未绑定任何库时 SHALL 进入空状态并提供新建素材库引导，SHALL NOT 回退演示数据集。

#### Scenario: 演示模式回退
- **WHEN** 首次启动且尚未建库
- **THEN** 界面进入空状态并显示「新建素材库」引导，不显示示例素材

### Requirement: 删除与恢复
删除 SHALL 置 deletedAt(移入回收站视图),恢复 SHALL 清除标记;两者均只改数据库,SHALL NOT 移动或删除磁盘文件;回收站支持单条恢复与清空(清空仅删数据库记录,不动文件)。回收站内的彻底删除与清空回收站 SHALL 在执行前要求用户二次确认,确认文案 SHALL 说明受影响的记录数量以及「只清除数据库记录与缩略图缓存、不删除磁盘原文件」的后果;用户取消时 SHALL NOT 发出任何删除请求。

#### Scenario: 回收站恢复
- **WHEN** 在回收站对素材执行恢复
- **THEN** 素材回到原文件夹视图,磁盘文件始终未被动过

#### Scenario: 彻底删除需确认
- **WHEN** 用户在回收站对素材执行彻底删除并在确认框中选择确认
- **THEN** 该素材的数据库记录与缩略图缓存被清除,磁盘原文件保留在库文件夹中

#### Scenario: 取消彻底删除
- **WHEN** 用户在确认框中选择取消
- **THEN** 不发出删除请求,回收站内素材与磁盘文件均保持不变

#### Scenario: 清空回收站需确认
- **WHEN** 用户点击清空回收站并确认
- **THEN** 回收站内全部记录的数据库行与缩略图缓存被清除,库文件夹中的磁盘文件一个都不少

### Requirement: 格式规范值

素材的 `format` 字段 SHALL 使用规范格式名，不得直接用扩展名大小写或别名作为界面格式。多个扩展名映射同一格式时（如 glTF/GLB、JPG/JPEG、HEIC/HEIF）SHALL 归一存储并保留原始相对路径。

#### Scenario: glTF 归一

- **WHEN** 扫描一个 `.gltf` 文件
- **THEN** 素材记录的规范格式为三维格式，相对路径仍保留 `.gltf`

#### Scenario: JPEG 归一

- **WHEN** 扫描 `.jpg` 和 `.jpeg`
- **THEN** 两者都存为 JPG 格式，名称和路径保持原始文件事实

### Requirement: 所有格式共享元数据

任何成功入库的格式 SHALL 使用同一 assets 行和标签关联表保存评级、收藏、待审、备注、来源链接、回收站和文件夹信息。扩展格式 SHALL NOT 创建独立 JSON 元数据文件，也不得把标签或备注写入原始素材文件。

#### Scenario: AI 备注持久化

- **WHEN** 用户给 AI 素材填写备注、来源链接和标签
- **THEN** 数据写入当前库的 SQLite 表，重启后与 JPG 素材一样恢复

#### Scenario: BLEND 回收站

- **WHEN** 用户把 BLEND 素材移入回收站
- **THEN** 只更新素材记录的 deletedAt，不修改或移动 `.blend` 原文件

### Requirement: 格式能力状态

格式能力、外部工具依赖和失败原因 SHALL 作为可重建的派生缓存或运行状态保存，不得成为素材元数据的第二权威源。素材文件内容变化后，旧能力状态 SHALL 失效并重新探测。

#### Scenario: 安装 Blender 后

- **WHEN** 用户安装并配置 Blender，此前因缺少工具而占位的 BLEND 文件未变化
- **THEN** 系统重新探测能力并允许生成新的预览缓存
