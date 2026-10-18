# Spec Delta

## ADDED Requirements

### Requirement: 视频元数据探测不完整解码

视频元数据探测 SHALL 只读取文件头和元数据，SHALL NOT 解码完整视频。视频探测并发 SHALL 有界，避免大库扫描同时启动大量 ffmpeg 进程。

#### Scenario: 大库扫描只读视频头

- **WHEN** 库内包含一百个长视频
- **THEN** 扫描在读取元数据后继续，不把每个视频完整解码一遍

### Requirement: 扫描分批入库

递归扫描 SHALL 按批次把已发现的素材写入数据库并推送增量事件。扫描进行中用户 SHALL 能浏览已入库素材，不必等待整库扫描结束。

#### Scenario: 万级素材可见进度

- **WHEN** 用户首次扫描含一万个文件的目录
- **THEN** 网格逐步出现已入库素材，进度持续更新
