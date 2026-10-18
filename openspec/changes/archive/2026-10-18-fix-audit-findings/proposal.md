# Proposal

## Why

本次审计发现 20 个问题，其中包含 `media://` 缩略图参数越界、回退库串写、任意路径建库、可被渲染层直接调用的旧库清空接口，以及批量移动失败后丢失元数据。另有一批规格与实现漂移：筛选条统计被删除、空态缺少出口、Eagle“导入”实际搬空源库、偏好开关无效、扫描和视频探测在大库下不可用。

这次集中修复，是因为这些问题已经不能靠单点补丁安全处理：安全边界、数据一致性、扫描性能和界面规格互相牵连，必须先固定验收场景再动代码。

依赖审计还发现 Electron 33、旧构建链、旧文件监听和 `better-sqlite3` 已落后于当前运行时，`sharp 0.35.4` 另有高危漏洞。依赖升级与原生模块加载方式必须和上述修复一起验证，否则审计无法真正收口。

## What Changes

- **安全边界**：只接受对话框返回的建库路径；校验缩略图 `v` 参数；移除渲染层可直接调用的旧库清空能力；所有回退库编辑都按 `library_id` 隔离。
- **数据完整性**：数据库迁移改为可重放；批量移动成功一项就落库一项；检查器切换素材时重置备注和来源链接；Eagle 导入默认复制并保留源库。
- **扫描与预览**：视频元数据只读头信息并限制并发；扫描按批次入库，扫描中即可浏览；GLTF/FBX 外部资源使用正确基准路径；灯箱按当前筛选集合翻页。
- **界面与规格**：恢复筛选结果和选中统计；标签下拉随素材更新；补齐空态动作；修复 PSD 等无尺寸素材的 `undefined×undefined`；修复视频时长进位；删除无效偏好开关；实现右键菜单标注的 `Ctrl+C`。
- **精简**：删除未使用的演示数据集和 `lucide-static`；Three.js 改为 3D 预览时加载，并清理不再需要的 Draco asm.js 回退。
- **依赖安全**：升级 Electron、electron-vite、Vite、chokidar、better-sqlite3 和 sharp；用 N-API 预编译绑定替代双 ABI 重建，并移除 `@electron/rebuild`。
- **规格收敛**：删除 `asset-store` 中已被新规格否定的“演示数据集回退”，并明确 FBX/OBJ 真实预览及失败回退。

## Capabilities

### New Capabilities

- `preferences`: 定义哪些偏好设置真实生效，以及删除无效开关后的持久化契约。

### Modified Capabilities

- `app-shell`: 建库路径必须来自系统目录选择器，并拒绝磁盘根等不受控目标。
- `asset-browser`: 恢复筛选/选中统计；标签下拉响应素材变化；补齐空态动作；批量移动部分成功时展示真实位置。
- `asset-store`: 移除未绑定库时的演示数据集回退要求。
- `inspector`: 切换素材时备注和来源链接不得残留上一条内容。
- `library-index`: Eagle 导入默认复制，保留源 Eagle 库；旧外部索引迁移语义保持不变。
- `library-portable`: 回退库的所有编辑按 `library_id` 隔离；旧库清空只能由主进程原生确认触发。
- `library-scan`: 视频探测不完整解码；扫描按批次入库。
- `lightbox`: 上一张/下一张使用当前导航、搜索、筛选和颜色筛选结果。
- `menus-shortcuts`: `Ctrl+C` 复制当前选中素材，与右键菜单标注一致。
- `renderer-resilience`: 标签、移动、复制、导出等持久化操作失败必须可见并可恢复。
- `renderer-responsiveness`: Three.js 只在需要查看 3D 素材时加载，不进入首屏主包。
- `thumbnails`: 缩略图指纹参数必须可验证；`media://` Range 支持标准 suffix range。
- `viewer-3d`: GLTF/FBX 外部资源可解析；GLB/GLTF/FBX/OBJ 真实预览失败时统一回退占位。

## Impact

影响主进程的建库、库作用域、数据库迁移、文件移动、Eagle 导入、扫描、视频探测、缩略图协议与旧库清理；影响预加载 API；影响渲染层的筛选条、检查器、灯箱、右键菜单、偏好对话框、Three.js 加载和素材查询。删除 `dataset.ts` 的演示素材、`lucide-static` 和 `@electron/rebuild`。最终以 40 个测试文件、264 个用例、生产构建和真实 Electron 启动共同验收；`npm audit` 必须为 0 漏洞。
