## ADDED Requirements

### Requirement: 主题持久化与首帧一致
应用 SHALL 把主题(浅色 / 夜间)同时记录在两处:`preferences` 键的 `theme` 字段是权威记录;localStorage 键 `mediahub.theme`(值为 `light` / `dark` 明文,不做 JSON 包装)是供首帧同步读取的镜像。`src/renderer/index.html` 的 `<head>` SHALL 在模块脚本之前执行一段同步内联脚本,读该镜像并在首个绘制帧之前落定根元素的 `data-theme`;`<meta name="color-scheme">` SHALL 声明为 `light dark`,不得为 `light`。镜像与权威记录不一致时以 `preferences` 为准,启动引导 SHALL 把镜像校正回权威值;镜像缺失或取值非法时 SHALL 回退浅色,不得抛错。

#### Scenario: 夜间启动不闪白
- **WHEN** 上次保存的主题为夜间,用户启动应用
- **THEN** 首个绘制帧即为夜间外观(窗口底色与根元素 `data-theme` 都按夜间),不出现先浅后深的白闪

#### Scenario: 权威记录优先于镜像
- **WHEN** `mediahub.theme` 与 `preferences` 的 `theme` 不一致(换机、清缓存或手工改过镜像)
- **THEN** 界面显示 `preferences` 的主题,且镜像被校正为该值,下一次启动不再回退

#### Scenario: 记录损坏回退浅色
- **WHEN** `preferences` 的 `theme` 或 `mediahub.theme` 取值不是 `light` / `dark`
- **THEN** 应用以浅色渲染并继续启动,不抛错、不阻塞其它偏好的恢复

#### Scenario: 打开面板不改变外观
- **WHEN** 已保存主题为夜间,用户打开偏好设置面板
- **THEN** 面板打开全过程外观保持夜间,不得先切成浅色再切回;勾选与实际外观一致

### Requirement: 偏好设置主题预览与回滚
主题单选 SHALL 与实际外观始终一致:切换单选即时预览该主题;关闭面板(不保存)时 SHALL 回到已保存的主题;保存时 SHALL 写入 `preferences` 并同步镜像。回滚 SHALL NOT 依赖面板关闭之后才返回的异步读取迟到的偏好值会把刚预览的主题错误覆盖。

#### Scenario: 取消后回到已保存主题
- **WHEN** 已保存主题为浅色,用户打开偏好设置切到夜间,随后关闭面板而不保存
- **THEN** 外观回到浅色,再次打开面板时单选同样为浅色

#### Scenario: 保存后重启一致
- **WHEN** 用户选择夜间并保存
- **THEN** 外观为夜间,重新打开面板时单选为夜间,重启后首个绘制帧仍为夜间
