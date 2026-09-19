## MODIFIED Requirements

### Requirement: media 安全协议
渲染层 SHALL 经自定义 `media://` 协议读取当前资源库内的原始文件(灯箱大图/视频播放);协议 SHALL 仅放行该库目录本身及其真正子路径，拒绝库外任意路径、目录穿越、符号链接或 Junction 导向的越界路径，以及仅共享字符串前缀的相邻目录，并支持视频 Range 请求。

#### Scenario: 协议越界拒绝
- **WHEN** 以 media 协议请求库目录之外的路径，或请求经符号链接/Junction 逃逸到库外的路径
- **THEN** 请求被拒绝，不返回文件内容

#### Scenario: 相邻前缀目录拒绝
- **WHEN** 库根为 `C:\\Media`，请求最终实路径位于 `C:\\Media-backup`
- **THEN** 请求被拒绝，不因路径字符串以前者为前缀而放行
