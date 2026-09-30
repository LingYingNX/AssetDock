import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

interface MenuItem {
  icon: string
  label: string
  k?: string
  danger?: boolean
  /** 子菜单项：悬停/聚焦展开右侧面板，点击父项本身不执行动作 */
  children?: { label: string; hint?: string; swatch?: string; fn: () => void }[]
  fn?: () => void
  /** 该项之前插入分隔线(数据驱动，不依赖数组下标) */
  sepBefore?: boolean
}

/** 素材右键菜单:跟随光标,屏边防溢出翻转 */
export function ContextMenu(): React.JSX.Element | null {
  const ctxMenu = useUI((s) => s.ctxMenu)
  const setCtxMenu = useUI((s) => s.setCtxMenu)
  const startRenaming = useUI((s) => s.startRenaming)
  const trashAsset = useUI((s) => s.trashAsset)
  const restoreAsset = useUI((s) => s.restoreAsset)
  const purgeAsset = useUI((s) => s.purgeAsset)
  const moveAssetsToFolder = useUI((s) => s.moveAssetsToFolder)
  const assets = useUI((s) => s.assets)
  const selectedIds = useUI((s) => s.selectedIds)
  const folderPaths = useUI((s) => s.folderPaths)
  const showToast = useUI((s) => s.showToast)
  const [openSub, setOpenSub] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  /** 换素材/关菜单时重置,避免上一个菜单量出的位置残留到下一次打开 */
  const ctxKey = ctxMenu ? `${ctxMenu.x},${ctxMenu.y},${ctxMenu.assetId}` : ''

  /** 右键的素材若不在选中集内,则操作只针对它;否则针对整个选中集 */
  const targetIds = useMemo(() => {
    if (!ctxMenu) return []
    return selectedIds.includes(ctxMenu.assetId) ? selectedIds : [ctxMenu.assetId]
  }, [ctxMenu, selectedIds])

  /**
   * 菜单高度随内容浮动(有无子菜单、多少文件夹),硬编码估算值会让长菜单溢出屏幕底部。
   * 因此先在不可见状态下量出真实尺寸,再钳制到视口内;四项都钳,左上同样会溢出。
   *
   * 必须放在下方 `if (!ctxMenu) return null` 之前:hook 一旦在两次渲染间数量不一致,
   * React 会抛错并丢弃整个子树,表现为「状态已更新但菜单不出现」。
   */
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el || !ctxMenu) return
    const { width, height } = el.getBoundingClientRect()
    const MARGIN = 8
    setPos({
      top: Math.max(MARGIN, Math.min(ctxMenu.y, window.innerHeight - height - MARGIN)),
      left: Math.max(MARGIN, Math.min(ctxMenu.x, window.innerWidth - width - MARGIN))
    })
  }, [ctxKey])

  /**
   * 子菜单高度只受 max-height 约束,top 却固定跟着父项走,于是靠近屏幕底部时整块探出视口。
   * 这里在挂载后量一次:放不下就整体上移贴住视口,仍放不下才交给 max-height 裁剪滚动。
   *
   * style.top 是相对包含块的偏移,但包含块会随 .menu.open 的入场 transform 在
   * 「.menu-row」与「菜单自身」之间切换(none 不建立包含块,动画中的 matrix 会建立)。
   * 因此不能直接写视口坐标——先算目标视口位置,再减去行自身的视口位置,换算成相对偏移,
   * 这样无论包含块是哪一个,渲染结果都停在正确的视口位置。
   */
  /**
   * 子菜单高度只受 max-height 约束,top 却固定跟着父项走,于是靠近屏幕底部时整块探出视口。
   * 这里在挂载后量一次:放不下就整体上移贴住视口,仍放不下才交给 max-height 裁剪滚动。
   *
   * style.top 是相对包含块的偏移,但包含块会随 .menu.open 的入场 transform 在
   * 「.menu-row」与「菜单自身」之间切换(none 不建立包含块,动画中的 matrix 会建立)。
   * 因此不能直接写视口坐标——先算目标视口位置,再减去行自身的视口位置,换算成相对偏移,
   * 这样无论包含块是哪一个,渲染结果都停在正确的视口位置。
   *
   * 水平方向对称处理:默认向右展开,右侧放不下时翻到左侧(用 .flip-x 切 left/right)。
   */
  useLayoutEffect(() => {
    const sub = subRef.current
    if (!sub) return
    const rowRect = sub.parentElement?.getBoundingClientRect()
    if (!rowRect) return
    const MARGIN = 8

    const h = sub.getBoundingClientRect().height
    const desiredViewportTop = rowRect.top - 5
    const clampedViewportTop = Math.max(MARGIN, Math.min(desiredViewportTop, window.innerHeight - h - MARGIN))
    sub.style.top = `${clampedViewportTop - rowRect.top}px`

    // 内容被 max-height 截断时给出「下面还有」的渐隐线索
    sub.classList.toggle('has-more', sub.scrollHeight > sub.clientHeight + 1)

    // 向右展开会越界则翻到左侧;宽度按翻转后的可用空间判断
    const w = sub.getBoundingClientRect().width
    const flip = rowRect.right + 3 + w > window.innerWidth - MARGIN
    sub.classList.toggle('flip-x', flip)
  }, [openSub, pos])

  if (!ctxMenu) return null
  const a = assets.find((x) => x.id === ctxMenu.assetId)
  const dbIds = targetIds
    .map((id) => assets.find((x) => x.id === id))
    .filter((x): x is NonNullable<typeof x> => x != null && x.dbId != null && x.libraryId != null)
  const libraryId = dbIds[0]?.libraryId
  const copyable = dbIds.length > 0

  const close = (): void => setCtxMenu(null)
  const act = (fn: () => void): void => {
    fn()
    close()
  }
  /** 子菜单动作:执行后关闭整个菜单 */
  const subAct = (fn: () => void): (() => void) => () => act(fn)

  const copySelection = (): void => {
    if (!copyable || libraryId == null) return
    const ids = dbIds.map((x) => x.dbId as number)
    void window.windowApi.assets.copy(libraryId, ids).then((r) => {
      if ('error' in r) {
        showToast(r.error, 'warn')
        return
      }
      const skipped = r.skipped.length
      if (r.mode === 'paths') {
        // 拿不到文件对象时明确告知,免得用户去资源管理器粘贴却发现是空的
        showToast(skipped > 0 ? `已复制 ${r.copied} 条路径,${skipped} 个文件已缺失` : `已复制 ${r.copied} 条路径`, skipped > 0 ? 'warn' : 'ok')
        return
      }
      showToast(skipped > 0 ? `已复制 ${r.copied} 个文件,跳过 ${skipped} 个缺失项` : `已复制 ${r.copied} 个文件`, skipped > 0 ? 'warn' : 'ok')
    })
  }

  const exportSelection = (): void => {
    if (!copyable || libraryId == null) return
    void window.windowApi.assets.export(libraryId, dbIds.map((x) => x.dbId as number))
  }

  const moveTargets = folderPaths.filter((path) => path !== '')
  const moveItems = moveTargets.length
    ? moveTargets.map((path) => ({
        label: path.split('/').pop() ?? path,
        hint: path.includes('/') ? path : undefined,
        fn: subAct(() => moveAssetsToFolder(targetIds, path))
      }))
    : [{ label: '库根目录', fn: subAct(() => moveAssetsToFolder(targetIds, '')) }]

  const items: MenuItem[] = [
    {
      icon: 'external',
      label: '在资源管理器中显示',
      fn: a?.absPath ? () => window.windowApi.showInFolder(a.absPath as string) : undefined
    },
    { icon: 'edit', label: '重命名', k: 'F2', fn: () => startRenaming(ctxMenu.assetId) },
    { icon: 'folder', label: '移动到…', sepBefore: true, children: moveItems },
    ...(a?.deletedAt
      ? [{ icon: 'sync', label: '从回收站恢复', fn: () => restoreAsset(ctxMenu.assetId) }]
      : []),
    { icon: 'copy', label: '复制', k: 'Ctrl C', sepBefore: true, fn: copyable ? copySelection : undefined },
    { icon: 'download', label: '导出…', fn: copyable ? exportSelection : undefined },
    { icon: 'trash', label: a?.deletedAt ? '彻底删除' : '删除', k: 'Del', sepBefore: true, danger: true, fn: () => (a?.deletedAt ? purgeAsset(ctxMenu.assetId) : trashAsset(ctxMenu.assetId)) }
  ]

  const row = (it: MenuItem, key: string): React.JSX.Element => {
    const hasSub = it.children != null && it.children.length > 0
    const enabled = it.fn != null || hasSub
    const expanded = openSub === key
    return (
      <div key={key} className="menu-row">
        <div className={it.danger ? 'danger' : undefined}>
          <button
            disabled={!enabled}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? expanded : undefined}
            onMouseEnter={() => setOpenSub(hasSub ? key : null)}
            onFocus={() => setOpenSub(hasSub ? key : null)}
            onClick={() => {
              if (hasSub) {
                setOpenSub(expanded ? null : key)
                return
              }
              it.fn?.()
              close()
            }}
          >
            <Icon name={it.icon} />
            {it.label}
            {hasSub ? <Icon name="chev-r" className="ic sub" /> : null}
            {it.k ? <span className="k">{it.k}</span> : null}
          </button>
        </div>
        {hasSub && expanded ? (
          <div className="menu glass-menu open submenu" role="menu" ref={subRef}>
            {it.children!.length === 0 ? <div className="menu-empty">暂无可选项</div> : null}
            {it.children!.map((child, i) => (
              <button key={`${child.label}-${i}`} onClick={child.fn}>
                {child.swatch ? <span className="dot" style={{ background: child.swatch }} /> : null}
                {child.label}
                {child.hint ? <span className="sub">{child.hint}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 95 }}
      onClick={close}
      onContextMenu={(e) => { e.preventDefault(); close() }}
    >
      <div
        ref={menuRef}
        className="menu glass-menu open ctx-menu"
        style={{
          top: pos?.top ?? ctxMenu.y,
          left: pos?.left ?? ctxMenu.x,
          visibility: pos ? 'visible' : 'hidden'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it) => (
          <div key={it.label}>
            {it.sepBefore ? <div className="sep" /> : null}
            {row(it, it.label)}
          </div>
        ))}
      </div>
    </div>
  )
}
