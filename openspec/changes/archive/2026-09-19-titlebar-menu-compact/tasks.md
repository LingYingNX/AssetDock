## 1. 标题栏菜单

- [x] 1.1 「+」菜单只保留「新建素材库」,启用紧凑玻璃样式且宽度按内容收缩
- [x] 1.2 已打开库标签页不再提供任何右键索引入口(原右键索引实现随 2026-09-10 索引概念整体移除而撤销)

## 2. 关闭与拖拽

- [x] 2.1 下拉打开时点击标题栏其它区域关闭菜单;关闭后恢复标题栏拖拽

## 3. 验证

- [x] 3.1 typecheck/test/build 通过;运行实测加号精简、标题栏外点关闭与拖拽恢复
      - Verified 2026-09-19 via the dev debug bridge: `+` menu is compact and contains only 「新建素材库」; clicking the titlebar spacer or a library tab closes any open menu (plus/settings) and `WebkitAppRegion` returns to `drag`; settings menu re-opened and 「偏好设置」 mounts `.pref-backdrop` (the merge regression stays fixed). typecheck, 12 test files / 44 tests, and build all pass.
