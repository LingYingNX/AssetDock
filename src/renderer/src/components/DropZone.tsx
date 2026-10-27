import { useEffect, useRef, useState } from 'react'
import { useUI } from '../store/ui'
import { isExternalFileDrag, leftDropZone } from '../data/drop-files'
import { Icon } from './Icons'

function currentFolder(nav: string): string {
  return nav.startsWith('folder:') ? nav.slice('folder:'.length) : ''
}

export function DropZone({ active }: { active: boolean }): React.JSX.Element | null {
  const hostRef = useRef<HTMLDivElement>(null)
  const busyRef = useRef(false)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const nav = useUI((s) => s.nav)
  const targetFolder = currentFolder(nav)

  useEffect(() => {
    const host = hostRef.current
    // active=false 时组件虽然不渲染,但这层守卫让 effect 语义与挂载条件一致。
    if (!host || !active) return
    const inside = (event: DragEvent): boolean => {
      const rect = host.getBoundingClientRect()
      return event.clientX >= rect.left && event.clientX <= rect.right &&
        event.clientY >= rect.top && event.clientY <= rect.bottom
    }
    const clear = (): void => {
      host.classList.remove('is-active')
      setDragging(false)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!isExternalFileDrag(event.dataTransfer) || !inside(event)) {
        clear()
        return
      }
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
      if (!host.classList.contains('is-active')) {
        host.classList.add('is-active')
        setDragging(true)
      }
    }
    const onDrop = (event: DragEvent): void => {
      if (!isExternalFileDrag(event.dataTransfer)) return
      event.preventDefault()
      clear()
      if (!inside(event)) return
      if (busyRef.current) return
      const files = Array.from(event.dataTransfer?.files ?? [])
      let paths: string[]
      try {
        paths = files.map((file) => window.windowApi.getFilePath(file)).filter((path): path is string => !!path)
      } catch {
        useUI.getState().showToast('无法读取拖入文件的路径', 'warn')
        return
      }
      if (paths.length === 0) {
        useUI.getState().showToast('无法读取拖入文件的路径', 'warn')
        return
      }
      const state = useUI.getState()
      const tab = state.tabs.find((item) => item.id === state.activeTabId)
      if (tab?.libraryId == null) {
        state.showToast('请先打开一个素材库', 'warn')
        return
      }
      busyRef.current = true
      setBusy(true)
      void window.windowApi.assets.importPaths(tab.libraryId, paths, currentFolder(state.nav)).then((result) => {
        if ('error' in result) {
          state.showToast(result.error, 'warn')
          return
        }
        const skipped = result.skipped > 0 ? `，跳过 ${result.skipped} 个不支持或库内文件` : ''
        state.showToast(`已导入 ${result.imported} 个素材${skipped}`, result.skipped > 0 ? 'warn' : 'ok')
        state.reloadActiveLibrary()
      }).catch(() => {
        state.showToast('导入素材失败，请重试', 'warn')
      }).finally(() => {
        busyRef.current = false
        setBusy(false)
      })
    }
    const onDragEnd = (): void => clear()
    const onWindowLeave = (event: DragEvent): void => {
      if (leftDropZone(host, event.relatedTarget)) clear()
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('dragleave', onWindowLeave)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('dragleave', onWindowLeave)
    }
  }, [active])

  if (!active) return null
  return (
    <div ref={hostRef} className={`drop-zone${busy ? ' is-busy' : ''}`} aria-hidden={!dragging && !busy}>
      <div className="drop-zone-frame" />
      <div className="drop-zone-card">
        <span className="drop-zone-icon"><Icon name={busy ? 'clock' : 'plus'} /></span>
        <span className="drop-zone-copy">
          <strong>{busy ? '正在导入素材' : '拖入素材到工作区'}</strong>
          <span>{busy ? '正在复制并生成缩略图' : `复制到「${targetFolder || '素材库根目录'}」`}</span>
        </span>
      </div>
    </div>
  )
}
