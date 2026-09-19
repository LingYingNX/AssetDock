## 1. 拖放语义

- [x] 1.1 在现有 `src/renderer/src/data/` 拖放辅助模块旁新增无 DOM 依赖的文件夹投放判定，并为目标行上方/中央/下方分别返回 `before`/`inside`/`after`；先编写并运行对应 Vitest 单元测试。
- [x] 1.2 更新 `src/renderer/src/components/Sidebar.tsx`，让拖过与放下共用同一 ref 投放结果，使用同步 DOM class 反馈，移除右侧 30% 的嵌套判定和根目录投放区，并验证可写根级与子级文件夹的排序、嵌套仍走现有 `moveFolder`。
- [x] 1.3 更新 `src/renderer/src/styles/sidebar.css`，使前后排序显示插入线、中央嵌套显示完整行高亮且不使用反馈过渡，并验证拖拽预览、折叠按钮、计数和长文件夹名称不造成行高或布局跳动。
- [x] 1.4 更新 `src/renderer/src/store/ui.ts`，在文件夹移动 IPC 返回前乐观更新树顺序、子树路径、导航和素材目录链；成功后校准，失败时回读真实目录。
- [x] 1.5 调整文件夹树视觉对齐：移除文件夹激活态左缘竖线、取消无子级空位，并统一悬浮/激活倒角为 2px。

## 2. 完整性保护

- [x] 2.1 扩展拖放单元测试，验证自身、后代、只读 Eagle/索引目录和同父级中央投放均不产生可接受投放结果。
- [x] 2.2 保持并补充 `tests/folders.test.ts` 对目录物理移动、子目录和素材保留、同级顺序重载的覆盖；运行该测试证明渲染层新语义未绕过已有安全移动链路。

## 3. 验证

- [x] 3.1 运行新增拖放测试、`tests/folders.test.ts`、`npm run typecheck`、`npm run build` 和 `openspec validate folder-tree-drag-organization --type change --strict`，记录任何与本变更无关的既有失败。
- [x] 3.2 在无头 Chromium 中用至少两个根文件夹和一个子文件夹复验：原生拖放数据可触发上方排序，三段投放反馈和调用正确；既有服务测试覆盖刷新及重启后的顺序持久化。
