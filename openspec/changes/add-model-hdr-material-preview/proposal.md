# Proposal

## Why

渲染模式直接恢复 FBX 源材质后，当前测试模型的 14 个材质中有 10 个带 `transparent=true`，即使 `opacity=1` 也会呈半透明，用户无法可靠检查真实材质。三维预览还缺少 Blender 式的环境检查入口，旧 `lightbox` 主规格仍保留转台、线框和曝光的已废弃控制概念。

## What Changes

- 渲染模式默认将材质归一为不透明，避免源文件把 `opacity=1` 的材质错误显示成幽灵模型。
- 在模型预览右上角增加 HDR 环境选择器，内置 Blender 官方 8 个 CC0 1K EXR 世界，默认使用 `forest.exr`。
- 渲染模式保留模型源材质与贴图，不提供材质槽编辑面板，也不写回 GLB/FBX/OBJ 源文件。
- 模型舞台保持全幅，顶栏只保留左上返回；HDR 和实体/渲染模式按钮均覆盖在画面内部。
- 保留实体模式的 clay 检查、渲染模式的真实材质、滚轮中键平移和现有加载/释放约束。
- HDR 切换和换片时释放旧环境贴图、PMREM 目标与材质引用。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `viewer-3d`: 增加 HDR 环境、渲染模式材质归一化与不透明默认值，并保留实体/渲染双模式与多格式加载。
- `lightbox`: 更新三维舞台为全幅沉浸式布局，顶栏仅保留返回，HDR 与模式按钮位于舞台内部。

## Impact

- 渲染层：`Viewer3D.tsx`、`Lightbox.tsx`、`LazyViewer3D.tsx`、`Card.tsx` 及相关样式。
- 静态资源：新增 `src/renderer/public/hdri/` 下的 8 个 Blender CC0 1K EXR 和许可证说明。
- 依赖：继续使用现有 `three`，新增 `EXRLoader` 的本地模块引用，不新增 npm 依赖。
- 测试：新增材质归一化纯函数、HDR 目录/默认值校验；无头验证覆盖 FBX/GLB/OBJ。
- 不涉及主进程 IPC、媒体协议、数据库结构或用户素材写回。
