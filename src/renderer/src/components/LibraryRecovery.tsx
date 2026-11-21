import { useState } from 'react'
import { Icon, SvgDefs } from './Icons'

type Item = { id: number; name: string; path: string }

/**
 * 启动前置闸门:注册表里的资源库文件夹不存在时先停在这里。
 * 每一项只能通过「重新定位 / 原路径重建 / 移除登记」之一出清,全部处理后回调继续启动。
 */
export function LibraryRecovery({ items, onResolved }: { items: Item[]; onResolved: () => void }): React.JSX.Element {
  const [left, setLeft] = useState(items)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<{ id: number; message: string } | null>(null)

  const finish = (id: number): void => {
    const next = left.filter((x) => x.id !== id)
    setLeft(next)
    setError(null)
    if (next.length === 0) onResolved()
  }

  const run = async (id: number, action: () => Promise<{ error?: string } | null>): Promise<void> => {
    setBusy(id)
    setError(null)
    try {
      const result = await action()
      if (result === null) return
      if (result.error) setError({ id, message: result.error })
      else finish(id)
    } finally {
      setBusy(null)
    }
  }

  const relocate = (item: Item): void => {
    void run(item.id, async () => {
      const picked = await window.windowApi.pickFolder()
      if (!picked) return null
      const result = await window.windowApi.library.relocate(item.id, picked)
      return 'error' in result ? result : {}
    })
  }

  return (
    <div className="recovery">
      <SvgDefs />
      <section className="recovery-card glass-preferences" role="dialog" aria-modal="true" aria-label="资源库路径丢失">
        <header className="recovery-head">
          <span className="recovery-icon"><Icon name="drive" /></span>
          <div>
            <h2>资源库路径丢失</h2>
            <p>以下资源库的文件夹已不存在。请选择新位置、在原路径重建，或移除登记后继续。</p>
          </div>
        </header>
        <ul className="recovery-list">
          {left.map((item) => (
            <li key={item.id} className="recovery-item">
              <div className="recovery-name">{item.name}</div>
              <code className="recovery-path" title={item.path}>{item.path}</code>
              <div className="recovery-actions">
                <button className="recovery-btn primary" disabled={busy === item.id} onClick={() => relocate(item)}>
                  选择文件夹
                </button>
                <button
                  className="recovery-btn"
                  disabled={busy === item.id}
                  onClick={() => void run(item.id, async () => {
                    const result = await window.windowApi.library.ensureFolder(item.id)
                    return 'error' in result ? result : {}
                  })}
                >
                  在原路径新建
                </button>
                <button
                  className="recovery-btn danger"
                  disabled={busy === item.id}
                  onClick={() => void run(item.id, async () => {
                    const result = await window.windowApi.library.remove(item.id)
                    return 'error' in result ? result : {}
                  })}
                >
                  移除
                </button>
              </div>
              {error?.id === item.id ? <p className="recovery-error">{error.message}</p> : null}
            </li>
          ))}
        </ul>
        <p className="recovery-note">移除只取消登记，不会删除磁盘上的素材文件。</p>
      </section>
    </div>
  )
}
