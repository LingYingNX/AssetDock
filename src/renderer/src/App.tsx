import { useEffect } from 'react'
import { useUI } from './store/ui'
import { SvgDefs } from './components/Icons'

// dev 下暴露 store 供无头验证脚本断言
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__ui = useUI
}
import { Titlebar } from './components/Titlebar'
import { Toolbar } from './components/Toolbar'
import { Sidebar } from './components/Sidebar'
import { FilterBar } from './components/FilterBar'
import { ColorStrip } from './components/ColorStrip'
import { Grid } from './components/Grid'
import { Inspector } from './components/Inspector'
import { Lightbox } from './components/Lightbox'
import { ContextMenu } from './components/ContextMenu'

export default function App(): React.JSX.Element {
  const s = useUI()

  /* 启动引导:恢复库标签/激活态,加载数据;订阅主进程事件 */
  useEffect(() => {
    const boot = async (): Promise<void> => {
      try {
        const libs = await window.windowApi.library.list()
        useUI.getState().setLibraries(libs)
        if (libs.length === 0) return
        const openIds = await window.windowApi.tabs.get()
        const tabs = openIds
          .map((t) => {
            const lib = libs.find((l) => l.id === t.libraryId)
            return lib ? { id: `dblib-${lib.id}`, name: lib.name, libraryId: lib.id } : null
          })
          .filter((t): t is NonNullable<typeof t> => t != null)
        const restoredTabCount = tabs.length
        if (tabs.length === 0) {
          const first = libs[0]
          tabs.push({ id: `dblib-${first.id}`, name: first.name, libraryId: first.id })
        }
        const activeLib = Number(await window.windowApi.state.get('activeTabLibrary'))
        const active = tabs.find((t) => t.libraryId === activeLib) ?? tabs[0]
        useUI.setState({ tabs, activeTabId: active.id })
        if (openIds.length === 0 || restoredTabCount !== openIds.length) useUI.getState().persistTabs()
        useUI.getState().reloadActiveLibrary()
      } catch {
        /* 引导失败保持空状态 */
      }
    }
    void boot()
    const un1 = window.windowApi.on('assets:changed', () => useUI.getState().reloadActiveLibrary())
    const un2 = window.windowApi.on('thumbs:ready', () => useUI.getState().bumpThumb())
    const un3 = window.windowApi.on('library:scan', (p) => {
      const d = p as { phase: string; done: number }
      useUI.setState({ scanProgress: d.phase === 'done' ? null : `扫描中 ${d.done} 项` })
      if (d.phase === 'done') useUI.getState().reloadActiveLibrary()
    })
    return () => {
      un1()
      un2()
      un3()
    }
  }, [])

  /* 全局键盘快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      const inField = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'
      const st = useUI.getState()

      if (e.key === 'Escape') {
        st.setOpenMenu(null)
        st.setCtxMenu(null)
        if (st.lightboxId) st.closeLightbox()
        if (st.renaming) st.setRenaming(false)
        ;(document.activeElement as HTMLElement)?.blur()
        return
      }
      if (inField) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.searchbox input')?.focus()
        return
      }
      if (st.lightboxId) {
        if (e.key === 'ArrowLeft') st.stepLightbox(-1)
        if (e.key === 'ArrowRight') st.stepLightbox(1)
        if (e.key === 'Enter') {
          const cur = st.assets.find((a) => a.id === st.lightboxId)
          if (cur) st.toggleFavorite(cur.id)
        }
        return
      }
      switch (e.key) {
        case 'Enter':
          if (st.focusedCardId) st.openLightbox(st.focusedCardId)
          break
        case ' ': {
          e.preventDefault()
          if (st.focusedCardId) st.clickCard(st.focusedCardId)
          break
        }
        case 'F2': {
          if (st.nav.startsWith('folder:')) {
            e.preventDefault()
            useUI.setState({ folderEditPath: st.nav.slice('folder:'.length) })
          } else if (st.activeId) {
            st.setRenaming(true)
          }
          break
        }
        case 'Delete': {
          if (st.activeId) st.trashAsset(st.activeId)
          break
        }
        case 'i':
        case 'I': {
          if ((e.ctrlKey || e.metaKey) && st.focusedCardId) st.openLightbox(st.focusedCardId)
          break
        }
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Ctrl 滚轮缩放缩略图 */
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const st = useUI.getState()
      const next = Math.min(320, Math.max(170, st.colw - Math.sign(e.deltaY) * 12))
      st.setColw(next)
      document.documentElement.style.setProperty('--colw', `${next}px`)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  /* 列宽令牌同步 */
  useEffect(() => {
    document.documentElement.style.setProperty('--colw', `${s.colw}px`)
  }, [s.colw])

  return (
    <div className="app">
      <SvgDefs />
      <Titlebar />
      <Toolbar />
      <div className={`layout${s.inspHidden ? ' insp-hidden' : ''}`}>
        <Sidebar />
        <main className="content">
          <FilterBar />
          <ColorStrip />
          <Grid />
        </main>
        <Inspector />
      </div>
      <Lightbox />
      <ContextMenu />
    </div>
  )
}
