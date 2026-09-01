import { useEffect } from 'react'
import { useUI } from './store/ui'
import { SvgDefs } from './components/Icons'
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
          if (st.activeId) st.setRenaming(true)
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
