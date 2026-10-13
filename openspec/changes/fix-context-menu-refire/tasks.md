# Tasks

## 1. 遮罩不再吞掉第二次右键

- [x] 1.1 `src/renderer/src/components/ContextMenu.tsx` 的遮罩 `onContextMenu`:关闭菜单后把遮罩临时移出命中测试,取 `document.elementFromPoint` 的真实目标并转发同坐标 `contextmenu`;命中仍在遮罩内时不转发(`npm run typecheck` 通过)
- [x] 1.2 `pointerEvents` 还原为改写前的实际值,不硬写 `'auto'`

## 2. 验证

- [x] 2.1 场景:菜单已打开,在另一张卡片上右键一次  该卡成为唯一选中项且菜单切到它(dev 桥:`rightClickA={"sel":["a8192"],"ctx":"a8192"}`  `thenRightClickB={"sel":["a8191"],"ctx":"a8191"}`)
- [x] 2.2 场景:多选后右键其中之一  整组选中保留、菜单切到被右键那张(`{"sel":["a8192","a8191"],"ctx":"a8192"}`  `{"sel":["a8192","a8191"],"ctx":"a8191"}`)
- [x] 2.3 场景:菜单打开时右键空白区  只关菜单,不误选(`{"before":{"ctx":"a8192"},"after":{"ctx":null,"sel":["a8192","a8191"]}}`)
- [x] 2.4 场景:在菜单自身区域右键  无递归、不重开(`ctx:null`、选中不变)
- [x] 2.5 `npm run test` 全绿(28 files / 193 tests)

## 3. 收尾

- [x] 3.1 清理一次性探测脚本与调试输出
