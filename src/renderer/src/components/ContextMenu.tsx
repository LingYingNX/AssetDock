import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { useMenuFocus } from './useMenuFocus'

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
  const trashAssets = useUI((s) => s.trashAssets)
  const restoreAsset = useUI((s) => s.restoreAsset)
  const purgeAssets = useUI((s) => s.purgeAssets)
  const moveAssetsToFolder = useUI((s) => s.moveAssetsToFolder)
  const assets = useUI((s) => s.assets)
  const selectedIds = useUI((s) => s.selectedIds)
  const folderPaths = useUI((s) => s.folderPaths)
  const copySelected = useUI((s) => s.copySelected)
  const cutSelected = useUI((s) => s.cutSelected)
  const pasteClipboard = useUI((s) => s.pasteClipboard)
  const assetClipboard = useUI((s) => s.assetClipboard)
  const showToast = useUI((s) => s.showToast)
  const [openSub, setOpenSub] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const subRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  /* 右键菜单的入场本来靠 `.menu.open` 的 @starting-style(挂载首帧带 .open 即可播),
     但退场完全缺失:关闭时 ctxMenu 置空,组件立刻 return null,菜单 0ms 消失。
     这里把「在不在」和「画什么」分开:退场期间用 last 继续渲染同一份菜单,
     并挂上 .closing 播淡出,160ms 后再卸载。
     不能只等 transitionend——reduced-motion 下过渡被全局移除,事件永不触发。 */
  const [mounted, setMounted] = useState(ctxMenu != null)
  const [last, setLast] = useState(ctxMenu)

  useEffect(() => {
    if (ctxMenu) {
      setLast(ctxMenu)
      setMounted(true)
      return
    }
    if (!mounted) return
    const t = window.setTimeout(() => setMounted(false), 160)
    return () => window.clearTimeout(t)
  }, [ctxMenu, mounted])

  /** 渲染用的菜单数据:退场期间回落到最后一次打开的快照 */
  const m = ctxMenu ?? last
  useMenuFocus(
    ctxMenu != null && mounted,
    menuRef,
    () => setCtxMenu(null),
    'menu',
    () => document.querySelector<HTMLElement>(`.card[data-asset-id="${CSS.escape(m?.assetId ?? '')}"]`)
  )

  /** 换素材/关菜单时重置,避免上一个菜单量出的位置残留到下一次打开 */
  const ctxKey = ctxMenu ? `${ctxMenu.x},${ctxMenu.y},${ctxMenu.assetId}` : ''

  /** 右键的素材若不在选中集内,则操作只针对它;否则针对整个选中集 */
  const targetIds = useMemo(() => {
    if (!ctxMenu) return []
    return selectedIds.includes(ctxMenu.assetId) ? selectedIds : [ctxMenu.assetId]
  }, [ctxMenu, selectedIds])

  const groupSelection = (): void => {
    showToast(`已选中 ${targetIds.length} 个素材，移动到同一文件夹即成组`)
  }

  /**
   * 菜单高度随内容浮动(有无子菜单、多少文件夹),硬编码估算值会让长菜单溢出屏幕底部。
   * 因此先在不可见状态下量出真实尺寸,再钳制到视口内;四项都钳,左上同样会溢出。
   *
   * 必须放在下方 `if (!ctxMenu) return null` 之前:hook 一旦在两次渲染间数量不一致,
   * React 会抛错并丢弃整个子树,表现为「状态已更新但菜单不出现」。
   */
  /* 三态让 mounted 比 ctxMenu 晚一帧:置 ctxMenu 的那次渲染 mounted 仍为 false,
     组件 return null,menuRef.current 是 null —— 而本 effect 的依赖 [ctxKey] 此时
     已经落定,等菜单真正挂上后不会再跑,pos 永远停在 null,菜单以 visibility:hidden
     渲染,右键看起来完全没反应。把 mounted 同时放进守卫与依赖表。 */
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!mounted || !el || !ctxMenu) return
    const { width, height } = el.getBoundingClientRect()
    const MARGIN = 8
    setPos({
      top: Math.max(MARGIN, Math.min(ctxMenu.y, window.innerHeight - height - MARGIN)),
      left: Math.max(MARGIN, Math.min(ctxMenu.x, window.innerWidth - width - MARGIN))
    })
  }, [ctxKey, mounted])

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

  /* 退场期间 ctxMenu 已为 null,靠 mounted + last 再撑 180ms 播完淡出 */
  if (!mounted || !m) return null
  const assetById = new Map(assets.map((asset) => [asset.id, asset]))
  const a = assetById.get(m.assetId)
  const dbIds = targetIds
    .map((id) => assetById.get(id))
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

  const exportSelection = (): void => {
    if (!copyable || libraryId == null) return
    void window.windowApi.assets.export(libraryId, dbIds.map((x) => x.dbId as number)).then((result) => {
      if ('canceled' in result) return
      if ('error' in result) {
        showToast(result.error, 'warn')
        return
      }
      showToast(`已导出 ${result.exported} 个文件`)
    }).catch(() => showToast('导出失败,请重试', 'warn'))
  }

  const moveTargets = folderPaths.filter((path) => path !== '')
  const moveItems = [
    { label: '库根目录', fn: subAct(() => moveAssetsToFolder(targetIds, '')) },
    ...moveTargets.map((path) => ({
        label: path.split('/').pop() ?? path,
        hint: path.includes('/') ? path : undefined,
        fn: subAct(() => moveAssetsToFolder(targetIds, path))
      }))
  ]

  const items: MenuItem[] = [
    {
      icon: 'folder',
      label: '移动',
      children: moveItems
    },
    { icon: 'layers', label: '打组', k: 'Ctrl+G', fn: targetIds.length > 1 ? groupSelection : undefined },
    { icon: 'spark', label: '加入预设', fn: copyable ? () => { copySelected() } : undefined },
    { icon: 'edit', label: '重命名', k: 'F2', fn: () => startRenaming(m.assetId) },
    {
      icon: 'external',
      label: '源文件',
      fn: a?.absPath ? () => window.windowApi.showInFolder(a.absPath as string) : undefined
    },
    {
      icon: 'trash',
      label: a?.deletedAt ? '彻底删除' : '删除',
      k: 'Del',
      sepBefore: true,
      danger: true,
      fn: () => (a?.deletedAt ? purgeAssets(targetIds) : trashAssets(targetIds))
    }
  ]

  const row = (it: MenuItem, key: string): React.JSX.Element => {
    const hasSub = it.children != null && it.children.length > 0
    const enabled = it.fn != null || hasSub
    const expanded = openSub === key
    return (
      <div key={key} className="menu-row">
        <div className={it.danger ? 'danger' : undefined}>
          <button
            role="menuitem"
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
              <button key={`${child.label}-${i}`} role="menuitem" onClick={child.fn}>
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
      style={{ position: 'fixed', inset: 0, zIndex: 95, pointerEvents: ctxMenu ? 'auto' : 'none' }}
      onClick={close}
      onContextMenu={(e) => {
        e.preventDefault()
        close()
        /* 遮罩铺满视口,第二张卡片上的右键先落到这里。原样吃掉只关菜单,
           用户得再右键一次才轮到卡片,表现为「右键两次才生效」。
           这里把遮罩临时移出命中测试拿到真实目标,再把同一位置的右键原样转发,
           于是这一次右键就直接选中并弹出新菜单。
           命中仍在遮罩内(点在菜单自己身上)时不转发:事件会再次冒泡回本处理器。 */
        const el = e.currentTarget as HTMLElement
        const prev = el.style.pointerEvents
        el.style.pointerEvents = 'none'
        const hit = document.elementFromPoint(e.clientX, e.clientY)
        el.style.pointerEvents = prev
        if (!hit || el.contains(hit)) return
        hit.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          buttons: 2,
          clientX: e.clientX,
          clientY: e.clientY
        }))
      }}
    >
      <div
        ref={menuRef}
        /* 关闭时摘掉 .open 换上 .closing:.open 把 opacity 定在 1,只有摘掉它才能从 1 过渡到 0。
           .closing 写在 menu.css 里 .open 之后,同特异性靠顺序取胜。 */
        className={`menu glass-menu ctx-menu${ctxMenu ? ' open' : ' closing'}`}
        role="menu"
        aria-label="素材操作"
        style={{
          top: pos?.top ?? m.y,
          left: pos?.left ?? m.x,
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
