# Spec Delta

## ADDED Requirements

### Requirement: 缩略图参数受限

`media://` 缩略图请求的 `v` 参数 SHALL 只接受内容指纹格式。包含路径分隔符、`.`、`..` 或其它非法字符的值 SHALL 返回 403，SHALL NOT 参与文件路径拼接。

#### Scenario: 拒绝指纹路径穿越

- **WHEN** 请求携带 `v=../../Windows/file` 的缩略图参数
- **THEN** 协议返回 403，不读取或写入目标路径

### Requirement: Range suffix

`media://` 的 Range 解析 SHALL 按 HTTP 语义处理 `bytes=-N`，返回文件最后 N 字节；起始位置大于结束位置的请求 SHALL 返回 416，而不是返回 500。

#### Scenario: 请求最后一段

- **WHEN** 客户端请求 `bytes=-200`，文件大小为 1000 字节
- **THEN** 响应返回 801 到 999 字节

#### Scenario: 非法区间

- **WHEN** 客户端请求 `bytes=900-100`
- **THEN** 响应返回 416
