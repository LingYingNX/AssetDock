# Tasks

## 1. 安全边界与建库

- [x] 1.1 先为 `media://` 缩略图参数新增失败测试：`v=../../Windows/file` 必须被拒绝；再实现 20 位十六进制指纹校验并确认 `tests/mediaProtocol.test.ts` 通过
- [x] 1.2 先为 Range 解析新增 `bytes=-200`、`bytes=900-100` 用例；再实现标准 suffix range 和 416 响应，确认 `tests/mediaProtocol.test.ts` 通过
- [x] 1.3 为主进程选择目录建立短期允许集合，并新增“只接受选择器路径、拒绝 `C:\`、拒绝不存在目录”的单元测试；确认测试通过
- [x] 1.4 从 preload 与 IPC 注册中移除 `legacyStats` 和 `purgeLegacy`；用 `rg` 确认 preload 无引用，确认 `npm run typecheck` 通过
- [x] 1.5 让 `updateAsset`、`addTag`、`removeTag` 接收并校验 `libraryId`；新增两个回退库之间的跨库 id 测试，确认错误 id 不修改另一库记录

## 2. 数据完整性

- [x] 2.1 将 schema 步进的 DDL 与 `user_version` 放入同一事务，并给 `codec`/`fps` 增加列存在检查；新增“已加列但版本未推进时重放迁移”测试，确认不再报 duplicate column
- [x] 2.2 抽出批量移动成功子集的数据库更新函数，失败时只提交已成功项并返回真实 `moved`；新增部分成功测试，确认已移动素材保留 id、标签和评分
- [x] 2.3 给检查器备注和来源链接加 `key={a.id}`；启动开发调试桥，切换 A→B 后断言输入框不保留 A 的文本
- [x] 2.4 将 Eagle 导入改为复制，复制失败清理目标且数据库不登记；新增测试，确认导入后源 Eagle 文件仍存在、失败时目标无残留

## 3. 扫描与视频探测

- [x] 3.1 抽出可测试的 ffmpeg 元数据参数，确保不包含 `-f null -`；为视频探测增加并发上限测试，确认同时运行的探测数不超过 4
- [x] 3.2 为 `scanLibrary` 增加批次回调，`scanLibraryContents` 每批 upsert 并推送增量事件；新增一万条模拟批次测试，确认扫描中已有批次进入数据库
- [x] 3.3 确认 `reconcileRoot` 仍使用完整扫描集合做缺失标记，并运行 `tests/scan.test.ts`、`tests/storePerf.test.ts` 通过

## 4. 界面与规格

- [x] 4.1 恢复筛选条结果/选中统计与分隔线，并让标签下拉订阅 `assets`；新增 `tagMenuItems` 纯函数测试和统计测试，确认新标签无需切换视图即可出现
- [x] 4.2 抽出空态状态判断，筛选无结果显示“清空筛选”，空回收站显示“返回全部素材”；新增空态状态测试
- [x] 4.3 让 `stepLightbox` 使用当前 `queryAssets` 结果，当前素材不在集合时回退全部未删除素材；新增收藏筛选翻页测试
- [x] 4.4 删除 `hoverAudio`、`hoverGif` 和 `openMode` 的状态、默认值、保存与界面开关；用开发调试桥确认偏好面板不再出现这些选项
- [x] 4.5 新增共享“复制当前选择”动作并绑定 `Ctrl+C`；新增无选中时不拦截、有选中时调用复制 API 的测试
- [x] 4.6 为标签增删、批量移动、复制、导出补 `.catch` 提示与失败后重载/回滚；新增拒绝 Promise 的 store 测试，确认出现 toast 且不保留过期状态
- [x] 4.7 `formatResolution` 对缺少宽高的素材返回 `—`，并修复 `mmss` 的 59.6 秒进位为 `01:00`；新增对应查询/格式化测试

## 5. 3D 与精简

- [x] 5.1 将 `Viewer3D` 改为动态导入，Card 和 Lightbox 使用 `Suspense`；构建后确认生成独立 3D chunk，主包不再包含 Three.js
- [x] 5.2 为 GLTF/FBX 解析传入原文件目录作为 base URL，并为 `.gltf + .bin`、缺失外部资源两种场景补测试或开发桥验证
- [x] 5.3 保留 WebAssembly Draco 资源，删除未使用的 `draco_decoder.js`；构建后打开一个 Draco GLB，确认模型或占位回退正常
- [x] 5.4 删除 `dataset.ts` 中的 `ASSETS`、`FOLDERS`、`COLOR_STRIP`、硬编码路径和演示辅助函数，只保留 `TAGS`/`SUGGESTED_TAGS`；用 `rg` 确认无残留引用并运行 `tests/query.test.ts`
- [x] 5.5 运行 `npm uninstall lucide-static` 删除未使用依赖，确认 `package-lock.json` 更新且 `npm run build` 通过

## 6. 集成验证

- [x] 6.1 运行 `npm run typecheck`，确认 node 与 web 两侧通过
- [x] 6.2 运行 `npm run test`，确认全部测试文件和用例通过
- [x] 6.3 运行 `npm run build`，确认主包、preload、renderer 均构建成功且无新增错误
- [x] 6.4 运行 `openspec validate "fix-audit-findings" --strict --json`，确认 change 严格校验通过
- [x] 6.5 运行审计复查命令，确认 `purgeLegacy`、`ASSETS`、`FOLDERS`、`COLOR_STRIP`、`lucide-static` 无生产引用，并记录 `git status --short`

## 7. 依赖安全加固

- [x] 7.1 升级 electron-vite 2→6、Vite 5→8、`@vitejs/plugin-react` 4→5，确认类型检查、测试和构建通过
- [x] 7.2 升级 chokidar 3→5，将 ESM-only 模块打进主进程 bundle，确认扫描与文件监听测试通过
- [x] 7.3 升级 Electron 33→44.9、better-sqlite3 11.10→13.0.3，改用 N-API 预编译绑定并删除 `@electron/rebuild` 和双 ABI 脚本
- [x] 7.4 升级 sharp 0.35.4→0.35.5，分别在 Vitest 与 Electron 44 运行时读取真实图片，确认无原生崩溃
- [x] 7.5 运行 `npm audit` 确认 0 漏洞，并启动真实 Electron 验证窗口、SQLite、素材库列表、4,117 条素材与 9223 调试桥

## Workflow follow-up

- Apply the change with the OpenSpec apply workflow after review.
- Run `openspec-verify-change` against the implemented work.
- Do not archive until the user explicitly authorizes it.
