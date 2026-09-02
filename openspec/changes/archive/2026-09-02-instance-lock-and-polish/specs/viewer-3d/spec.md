## Purpose

影棚曝光的记忆:重启后恢复上次值。

## ADDED Requirements

### Requirement: 曝光持久化
影棚曝光值变更时 SHALL 写入应用状态;下次打开 3D 灯箱 SHALL 恢复上次曝光值(全局记忆,不区分素材)。

#### Scenario: 曝光重启保留
- **WHEN** 调整曝光后完全退出并重启应用,再打开任一 GLB 灯箱
- **THEN** 曝光为上次设定值
