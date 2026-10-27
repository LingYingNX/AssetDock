## Context

素材管理器已经具备库内扫描、文件监听和素材卡片拖到侧栏文件夹的能力。系统文件拖入与库内素材拖拽共用 DOM 的 drag 事件，但数据来源不同：系统文件带 `Files` 类型，应用内素材带 `application/x-mediahub-assets`，文件夹带 `application/x-mediahub-folder`。导入必须复制文件而不是移动源文件，并且不能绕过现有库根路径校验。

## Goals / Non-Goals

**Goals:**

- 从系统资源管理器拖入一个或多个支持格式的文件，复制到当前文件夹并立即刷新。
- 拖拽经过内容区时显示明确的边缘框，不误伤应用内拖拽。
- 同名文件自动避让，失败时清理本次已复制文件并显示可理解错误。

**Non-Goals:**

- 不递归导入目录。
- 不支持导入到多个文件夹；一次投放只有一个目标文件夹。
- 不改变现有库内素材移动、文件夹排序或 Eagle 导入语义。

## Decisions

### 事件分流

渲染层只把同时包含 `Files` 类型的拖拽视为系统文件。投放层覆盖整个 `.content`，通过窗口级 `dragover` / `drop` 监听和内容区矩形判定工作；组件自身 `pointer-events:none`，避免遮住网格与检查器交互。应用内素材拖拽仍由现有卡片与侧栏 handler 处理。

### 目标目录

`nav` 为 `folder:<path>` 时复制到该文件夹；其它浏览视图复制到库根。目标路径在主进程通过现有 `assertLibraryFolder` 校验，并在导入服务内再用 `realPathWithinRoot` 防 Junction 逃逸。

### 文件复制

先为整批文件解析唯一目标名，再执行 `copyFile(..., COPYFILE_EXCL)`。中途失败时删除本次已复制文件。复制完成后用 `scanPaths` 采集尺寸、时长、指纹等元数据，再 `upsertScanned` 入库；监听器照常运行，重复 add 事件由 upsert 的 unchanged 语义收敛。

### 跳过规则

仅接受格式注册表白名单内的普通文件；源路径已在库内、隐藏或临时文件、目录、不可读文件均跳过。跳过数量随结果返回，不把部分失败当作整体成功。

## Risks / Trade-offs

- [Windows 上复制大文件期间 watcher 仍可能先入库] → `upsertScanned` 幂等，保留已有标签/评分并只更新扫描字段；本次 IPC 完成后仍全量刷新。
- [系统拖拽在 `dragover` 阶段可能拿不到文件内容] → 只依赖 `dataTransfer.types` 激活视觉，真正读取文件延后到 `drop`。
- [Junction/符号链接把目标目录指向库外] → 目标目录必须同时通过 lexical 校验和 `realPathWithinRoot`。
- [目录拖入暂不支持] → 明确计数为跳过并在界面提示，不静默忽略。

## Migration Plan

无数据迁移。新增 IPC 只由新的投放层调用；旧库和既有导入路径不受影响。

## Open Questions

无。
