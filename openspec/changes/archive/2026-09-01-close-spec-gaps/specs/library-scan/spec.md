## Purpose

扫描阶段的视频元数据增补:编码与帧率入库,补齐检查器展示。

## ADDED Requirements

### Requirement: 视频编码信息
扫描视频时 SHALL 经 ffmpeg 解析视频编码(如 H.264/HEVC/ProRes)与帧率(fps)入库;检查器文件信息 SHALL 在时长行以 small 标注 fps、在类型行以 small 标注编码;解析失败留空不阻塞。(三维面数/顶点解析按用户指示撤销,不做。)

#### Scenario: 检查器编码标注
- **WHEN** 查看库内 MP4 素材的检查器
- **THEN** 类型行显示「MP4 视频 H.264」样式 small 标注,时长行显示 fps
