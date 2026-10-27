## 1. 拖放判定与视觉

- [x] 1.1 新增无 DOM 依赖的系统文件拖入判定，区分 `Files` 与应用内素材/文件夹拖拽。
- [x] 1.2 在工作区挂载投放层，显示内容区 2px 强调色边缘和当前目标提示；内部拖拽不激活。
- [x] 1.3 使用既有动效令牌完成短促入退场，支持 `prefers-reduced-motion`。

## 2. 导入链路

- [x] 2.1 新增主进程文件导入服务：唯一目标名、复制不覆盖、源文件保留、失败清理、跳过计数。
- [x] 2.2 新增 `assets:importPaths` IPC 与 preload 桥接，校验目标文件夹、库根范围与 Junction 逃逸。
- [x] 2.3 复用 `scanPaths` / `upsertScanned` / watcher 暂停与缩略图预热，完成后刷新素材与目录。

## 3. 验证

- [x] 3.1 新增文件导入服务测试与拖入判定测试，覆盖同名避让、库内来源、跳过、Junction 越界。
- [x] 3.2 运行 `npm run typecheck`、`npm run test` 与 `npm run build`。
- [x] 3.3 经 9223 桥验证投放层矩形覆盖内容区、2px 蓝色边缘、内部素材拖拽不激活。
- [x] 3.4 在隔离 userData 与临时库中，用 CDP `Input.dispatchDragEvent` 注入真实系统文件完成拖放；确认投放态 `active=true`、边框 `2px`、网格出现 1 张卡、toast 为「已导入 1 个素材」、目标文件存在且源文件保留。未使用 Explorer 的真实指针手势，该差异已披露。
