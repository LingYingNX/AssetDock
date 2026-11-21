import { useEffect, useRef, useState } from 'react'
import { useUI, restoreUiPrefs } from './store/ui'
import { isEditableTarget } from './data/focus-scope'
import { COLW_MAX, COLW_MIN } from './data/colw'
import { createFrameBatcher, mergeAssetDelta, toAssetDelta, type AssetDelta } from './data/frame-batch'
import { SvgDefs } from './components/Icons'

// dev 下暴露 store 供无头验证脚本断言
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__ui = useUI
}
import { Titlebar } from './components/Titlebar'
import { Sidebar } from './components/Sidebar'
import { FilterBar } from './components/FilterBar'
import { ColorStrip } from './components/ColorStrip'
import { Grid } from './components/Grid'
import { DropZone } from './components/DropZone'
import { Inspector } from './components/Inspector'
import { Lightbox } from './components/Lightbox'
import { ContextMenu } from './components/ContextMenu'
import { FolderContextMenu } from './components/FolderContextMenu'
import { PreferencesDialog } from './components/PreferencesDialog'
import { LibraryRecovery } from './components/LibraryRecovery'
import { DedupDialog } from './components/DedupDialog'
import { ThumbProgress } from './components/ThumbProgress'
import { Toast } from './components/Toast'

export default function App(): React.JSX.Element {
  /**
   * 外壳只订阅自己真正用到的两个字段。
   *
   * 这里原本是 `const s = useUI()` —— 无选择器订阅整个 store，于是缩略图进度每推进
   * 一格、选中集每次变化，整棵组件树都要重渲染一次。动作一律用 `useUI.getState()` 现取。
   */
  const colw = useUI((s) => s.colw)
  const sideWidth = useUI((s) => s.sideWidth)
  const inspHidden = useUI((s) => s.inspHidden)
  const mode = useUI((s) => s.mode)
  const lightboxId = useUI((s) => s.lightboxId)
  const [recovery, setRecovery] = useState<{ id: number; name: string; path: string }[] | null>(null)
  const bootRef = useRef<() => void>(() => {})
  const [ready, setReady] = useState(false)

  /* 启动引导:恢复库标签/激活态,加载数据;订阅主进程事件 */
  useEffect(() => {
    const boot = async (): Promise<void> => {
      /* 偏好恢复失败不阻断启动:回退默认偏好继续,素材库照常打开 */
      try {
        await restoreUiPrefs()
      } catch {
        useUI.getState().showToast('界面偏好恢复失败，已改用默认偏好', 'warn')
      }
      try {
        const libs = await window.windowApi.library.list()
        useUI.getState().setLibraries(libs)
        const missing = libs.filter((l) => l.exists === false)
        if (missing.length > 0) {
          setRecovery(missing.map(({ id, name, path }) => ({ id, name, path })))
          return
        }
        setRecovery(null)
        if (libs.length === 0) {
          setReady(true)
          return
        }
        const migration = await window.windowApi.library.takeMigrationFailures()
        if (migration.names.length > 0) {
          useUI.getState().showToast(`以下素材库无法创建本地数据库，当前会话将使用全局回退数据:\n${migration.names.join('\n')}`, 'warn')
        }
        const openIds = await window.windowApi.tabs.get()
        const tabs = openIds
          .map((t) => {
            const lib = libs.find((l) => l.id === t.libraryId)
            return lib ? { id: `dblib-${lib.id}`, name: lib.name, libraryId: lib.id } : null
          })
          .filter((t): t is NonNullable<typeof t> => t != null)
        const restoredTabCount = tabs.length
        const activeLib = Number(await window.windowApi.state.get('activeTabLibrary'))
        const active = tabs.find((t) => t.libraryId === activeLib) ?? tabs[0] ?? null
        useUI.setState({ tabs, activeTabId: active?.id ?? '' })
        if (restoredTabCount !== openIds.length) useUI.getState().persistTabs()
        if (active?.libraryId != null) {
          void window.windowApi.library.open(active.libraryId)
          useUI.getState().reloadActiveLibrary()
        } else {
          useUI.setState({ assets: [], folderPaths: [], physicalFolderPaths: [], folderEditPath: null, mode: 'empty' })
        }
        setReady(true)
      } catch {
        /* 引导失败进明确的空状态并说明原因,不停在半加载的界面上 */
        useUI.setState({
          tabs: [],
          activeTabId: '',
          assets: [],
          folderPaths: [],
          physicalFolderPaths: [],
          folderEditPath: null,
          mode: 'empty'
        })
        useUI.getState().showToast('启动引导失败，未能读取素材库列表', 'warn')
        setReady(true)
      }
    }
    bootRef.current = () => { void boot() }
    void boot()
    // S1-7:assets:changed 优先走增量合并(带 assetIds);不带则退全量 reload。
    // 扫描期间事件是成批来的,所以按帧边界合并:同一帧内的多条并成一次重载。
    const deltaBatch = createFrameBatcher<AssetDelta>(mergeAssetDelta, (d) => {
      useUI.getState().applyAssetDelta(d.libraryId, d.assetIds ?? undefined)
    })
    const un1 = window.windowApi.on('assets:changed', (p) => {
      deltaBatch.push(toAssetDelta(p as { libraryId: number; assetIds?: number[] }))
    })
    const un3 = window.windowApi.on('window:maximized', (p) => {
      document.documentElement.dataset.maximized = p === true ? 'true' : 'false'
    })
    // 缩略图进度同理:同一帧内只保留最后一次进度快照,不逐条重渲染浮层
    const progressBatch = createFrameBatcher<{ libraryId: number; done: number; total: number } | null>(
      (_pending, next) => next,
      (d) => {
        useUI.getState().setThumbProgress(d)
      }
    )
    const un4 = window.windowApi.on('thumbs:progress', (p) => {
      const d = p as { libraryId: number; phase: string; done: number; total: number; fingerprint?: string }
      if (d.fingerprint) useUI.getState().markThumbReady(d.fingerprint)
      /* 启动时会同时预热多个库;中央进度只属于当前页,否则会被后台库互相覆盖。 */
      const st = useUI.getState()
      const activeLibraryId = st.tabs.find((t) => t.id === st.activeTabId)?.libraryId ?? null
      if (d.libraryId !== activeLibraryId) return
      progressBatch.push(d.phase === 'done' || d.total <= 0
        ? null
        : { libraryId: d.libraryId, done: d.done, total: d.total })
    })
    const un2 = window.windowApi.on('library:scan', (p) => {
      const d = p as { libraryId: number; phase: string; done: number }
      const st = useUI.getState()
      const activeLibraryId = st.tabs.find((t) => t.id === st.activeTabId)?.libraryId ?? null
      /* 别的库扫描结束不该重拉当前库:那会让正在看的标签页白卡一秒 */
      if (d.libraryId !== activeLibraryId) return
      useUI.setState({ scanProgress: d.phase === 'done' ? null : `扫描中 ${d.done} 项` })
      if (d.phase === 'done') useUI.getState().reloadActiveLibrary()
    })
    /* 跨库移动是用户主动发起的:不看当前标签页,否则把素材搬去别的库时进度条会消失 */
    const transferBatch = createFrameBatcher<{ libraryId: number; done: number; total: number } | null>(
      (_pending, next) => next,
      (d) => {
        useUI.getState().setTransferProgress(d)
      }
    )
    const un5 = window.windowApi.on('transfer:progress', (p) => {
      const d = p as { libraryId: number; done: number; total: number }
      /* 到 100% 就撤:主进程还要写库/预热,那几百毫秒不该继续顶着进度条 */
      transferBatch.push(d.total > 0 && d.done < d.total ? d : null)
    })
    return () => {
      un1()
      un2()
      un3()
      un4()
      un5()
      deltaBatch.cancel()
      progressBatch.cancel()
      transferBatch.cancel()
    }
  }, [])

  /* 全局键盘快捷键 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const st = useUI.getState()

      /* Esc 与 Ctrl F 在任何上下文都成立:焦点在输入框里也要能关掉菜单/灯箱、跳回搜索 */
      if (e.key === 'Escape') {
        st.setOpenMenu(null)
        st.setCtxMenu(null)
        st.setFolderCtxMenu(null)
        if (st.lightboxId) st.closeLightbox()
        if (st.renaming) st.setRenaming(false)
        ;(document.activeElement as HTMLElement)?.blur()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        document.querySelector<HTMLInputElement>('.searchbox input')?.focus()
        return
      }

      /* 可编辑控件与模态对话框内:方向键、Enter、Space、Del 属于输入语义,
         不拦截也不 preventDefault,否则要么吃掉文本编辑,要么误触预览/删除 */
      if (isEditableTarget(e.target as Element | null)) return
      /* Enter/Space 在按钮/菜单项上属于该控件自己的激活语义,不能升级成打开素材/切换选中 */
      if (e.key === 'Enter' || e.key === ' ') {
        const control = (e.target as Element | null)?.closest?.(
          'button, select, a, summary, [role="button"], [role="menuitem"], [role="option"], [role="tab"], [role="slider"]'
        )
        if (control) return
      }
      /* 浮层打开时,全局素材快捷键(尤其 Del)不能作用到菜单后面看不见的 activeId */
      if (st.openMenu || st.ctxMenu || st.folderCtxMenu || st.renaming) return

      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        st.setOpenMenu('preferences')
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        st.selectAllVisible()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (st.copySelected()) e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (st.cutSelected()) e.preventDefault()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (st.pasteClipboard()) e.preventDefault()
        return
      }
      if (st.lightboxId) {
        const cur = st.assets.find((a) => a.id === st.lightboxId)
        /* 双击打开素材后,左右键在所有类型上都是「上一个/下一个」:
           换成图片才生效的旧行为,让视频/文档里按方向键毫无反馈。 */
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          if (e.altKey) return
          e.preventDefault()
          st.stepLightbox(e.key === 'ArrowLeft' ? -1 : 1)
          return
        }
        if (e.key === '[') {
          e.preventDefault()
          st.stepLightbox(-1)
        }
        if (e.key === ']') {
          e.preventDefault()
          st.stepLightbox(1)
        }
        if (e.key === 'Enter') {
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
          if (st.focusedCardId) st.selectOnly(st.focusedCardId)
          break
        }
        case 'n':
        case 'N': {
          st.toggleInspector()
          break
        }
        case 'F2': {
          const inSidebar = (document.activeElement as HTMLElement | null)?.closest('.sidebar') != null
          if (st.nav.startsWith('folder:') && (inSidebar || !st.activeId)) {
            e.preventDefault()
            st.beginFolderRename(st.nav.slice('folder:'.length))
          } else if (st.activeId) {
            st.setRenaming(true)
          }
          break
        }
        case 'Delete': {
          const ids = st.selectedIds.length > 0 ? st.selectedIds : st.activeId ? [st.activeId] : []
          if (ids.length === 0) break
          if (st.nav === 'trash') st.purgeAssets(ids)
          else st.trashAssets(ids)
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

  /* Ctrl 滚轮缩放素材预览 */
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const st = useUI.getState()
      /* 灯箱内的 Ctrl+滚轮只缩放媒体,不能再改网格列宽 */
      if (st.lightboxId) return
      const next = Math.min(COLW_MAX, Math.max(COLW_MIN, st.colw - Math.sign(e.deltaY) * 12))
      st.setColw(next)
      document.documentElement.style.setProperty('--colw', `${next}px`)
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  /* 列宽令牌同步 */
  useEffect(() => {
    document.documentElement.style.setProperty('--colw', `${colw}px`)
  }, [colw])

  /* 有未保存的 CSS 改动时,关窗口先拦一下 */
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      if (!useUI.getState().cssDirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  if (recovery) {
    return <LibraryRecovery items={recovery} onResolved={() => bootRef.current()} />
  }

  if (!ready) {
    return (
      <div className="recovery">
        <section className="recovery-card recovery-splash" role="status">正在检查资源库…</section>
      </div>
    )
  }

  return (
    <div className="app">
      <SvgDefs />
      <a className="skip-link" href="#main-content">跳到主内容</a>
      <h1 className="sr-only">MediaHub 素材管理器</h1>
      <Titlebar />
      {/* 折叠检查器时不要卸载它:它一旦从 DOM 消失,列宽的过渡就没有对手可动画,
          只会看到内容凭空消失、布局瞬间重排。让它留在 DOM 里,由 .layout 的
          grid-template-columns 过渡把它推到 0 宽,再由 overflow:hidden 裁掉。 */}
      <div
        className={`layout${inspHidden ? ' insp-hidden' : ''}`}
        style={{ '--rail-nav': `${sideWidth}px` } as React.CSSProperties}
      >
        <Sidebar />
        <main id="main-content" className="content" tabIndex={-1}>
          <FilterBar />
          <ColorStrip />
          <Grid />
          {/* 加载进度挂在素材工作区内:绝对定位在中央偏下,不占布局也不拦截指针。
              灯箱(z-index 80)与投放层(70)会自然盖住它,不需要额外的显隐判断。 */}
          <ThumbProgress />
          <DropZone active={mode === 'library' && !lightboxId} />
          {/* 灯箱只覆盖工作区(侧栏与检查器保持可用),全屏时才扩到整窗 */}
          <Lightbox />
        </main>
        <Inspector />
      </div>
      <ContextMenu />
      <FolderContextMenu />
      <PreferencesDialog />
      <DedupDialog />
      {/* 一次性提示固定在右下角;加载进度已经移入工作区,两者不会再互相遮挡。 */}
      <div className="overlay-stack">
        <Toast />
      </div>
    </div>
  )
}
