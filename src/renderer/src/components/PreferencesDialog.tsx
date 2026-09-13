import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../data/query'
import { useUI } from '../store/ui'
import { Icon } from './Icons'

type PreferenceState = {
  openMode: 'recent' | 'specified'
  autoSync: boolean
}

const PREFERENCES_KEY = 'preferences'
const DEFAULT_PREFERENCES: PreferenceState = {
  openMode: 'recent',
  autoSync: true
}

function readPreferences(raw: string | null): PreferenceState {
  if (!raw) return DEFAULT_PREFERENCES
  try {
    const value = JSON.parse(raw) as Partial<PreferenceState>
    return {
      openMode: value.openMode === 'specified' ? 'specified' : 'recent',
      autoSync: value.autoSync !== false
    }
  } catch {
    return DEFAULT_PREFERENCES
  }
}

function Choice({ checked, disabled, label, name, onChange }: { checked: boolean; disabled?: boolean; label: string; name: string; onChange?: () => void }): React.JSX.Element {
  return (
    <label className={`pref-choice${disabled ? ' disabled' : ''}`}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

export function PreferencesDialog(): React.JSX.Element | null {
  const open = useUI((s) => s.openMenu === 'preferences')
  const setOpenMenu = useUI((s) => s.setOpenMenu)
  const libraries = useUI((s) => s.libraries)
  const tabs = useUI((s) => s.tabs)
  const activeTabId = useUI((s) => s.activeTabId)
  const assets = useUI((s) => s.assets)
  const createLibraryFlow = useUI((s) => s.createLibraryFlow)
  const [draft, setDraft] = useState<PreferenceState>(DEFAULT_PREFERENCES)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [libraryName, setLibraryName] = useState('')
  const [libraryPath, setLibraryPath] = useState('')

  const activeLibrary = useMemo(() => {
    const libraryId = tabs.find((tab) => tab.id === activeTabId)?.libraryId
    return libraries.find((library) => library.id === libraryId)
  }, [activeTabId, libraries, tabs])
  const libraryAssets = useMemo(
    () => assets.filter((asset) => asset.libraryId === activeLibrary?.id && !asset.deletedAt && !asset.missing),
    [activeLibrary?.id, assets]
  )
  const librarySize = useMemo(() => libraryAssets.reduce((total, asset) => total + asset.sizeBytes, 0), [libraryAssets])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void window.windowApi.state.get(PREFERENCES_KEY).then((raw) => {
      if (!cancelled) setDraft(readPreferences(raw))
    })
    return () => { cancelled = true }
  }, [open])

  if (!open) return null

  const close = (): void => setOpenMenu(null)
  const closeCreate = (force = false): void => {
    if (creating && !force) return
    setCreateOpen(false)
    setLibraryName('')
    setLibraryPath('')
  }
  const save = (): void => {
    if (saving) return
    setSaving(true)
    void window.windowApi.state.set(PREFERENCES_KEY, JSON.stringify(draft)).then(close).catch(() => alert('保存偏好设置失败,请重试')).finally(() => setSaving(false))
  }
  const browseLibraryPath = (): void => {
    void window.windowApi.pickFolder().then((path) => {
      if (path) setLibraryPath(path)
    })
  }
  const createLibrary = (): void => {
    const name = libraryName.trim()
    if (!name) {
      alert('请输入资源库名称')
      return
    }
    if (!libraryPath) {
      alert('请选择存储文件夹路径')
      return
    }
    setCreating(true)
    void createLibraryFlow(name, libraryPath).then((created) => {
      if (created) closeCreate(true)
    }).finally(() => setCreating(false))
  }

  return (
    <div className="pref-backdrop" role="presentation">
      <section className="pref-dialog glass-preferences" role="dialog" aria-modal="true" aria-label="偏好设置">
        <header className="pref-header">
          <span className="pref-title">偏好设置</span>
          <button className="pref-close" title="关闭" aria-label="关闭" onClick={close}><Icon name="x" /></button>
        </header>
        <div className="pref-body">
          <nav className="pref-nav" aria-label="偏好设置分类">
            <div className="pref-nav-item"><Icon name="sliders" />常用</div>
            <div className="pref-nav-item on"><Icon name="drive" />资源库</div>
            <div className="pref-nav-item"><Icon name="film" />音视频</div>
            <div className="pref-nav-item"><Icon name="grid" />界面</div>
            <div className="pref-nav-item"><Icon name="sliders" />操作</div>
            <div className="pref-nav-item"><Icon name="more-h" />快捷键</div>
            <div className="pref-nav-item"><Icon name="info" />通知</div>
          </nav>
          <main className="pref-content">
            <section className="pref-section">
              <h2>默认打开</h2>
              <div className="pref-options">
                <Choice name="open-mode" label="默认打开最近使用资源库" checked={draft.openMode === 'recent'} onChange={() => setDraft({ ...draft, openMode: 'recent' })} />
                <Choice name="open-mode" label="启动时打开指定资源库" checked={draft.openMode === 'specified'} disabled />
              </div>
            </section>
            <section className="pref-section">
              <h2>打开资源库是否自动同步</h2>
              <div className="pref-row">
                <Choice name="auto-sync" label="是" checked={draft.autoSync} onChange={() => setDraft({ ...draft, autoSync: true })} />
                <Choice name="auto-sync" label="否" checked={!draft.autoSync} onChange={() => setDraft({ ...draft, autoSync: false })} />
              </div>
            </section>
            <section className="pref-section">
              <h2>资源库信息</h2>
              <div className="pref-library">
                <div className="pref-library-badge">
                  <span className="pref-library-icon"><Icon name="layers" /></span>
                  <span className="pref-current">(当前)</span>
                  <span>{activeLibrary?.name ?? '未打开资源库'}</span>
                </div>
                <div className="pref-library-details">
                  <span>资源库大小：{formatBytes(librarySize)}</span>
                  <span>素材数量：{libraryAssets.length.toLocaleString('en-US')}</span>
                  <span className="pref-library-path">{activeLibrary?.path ?? '—'}</span>
                  {activeLibrary ? <button className="pref-link" onClick={() => window.windowApi.showInFolder(activeLibrary.path)}>打开</button> : null}
                </div>
              </div>
              <div className="pref-create-bar">
                <button className="pref-create-library" onClick={() => setCreateOpen(true)}><Icon name="plus" />创建资源库</button>
              </div>
            </section>
            <footer className="pref-footer">
              <button className="pref-cancel" onClick={close}>取消</button>
              <button className="pref-save" disabled={saving} onClick={save}>{saving ? '保存中…' : '保存'}</button>
            </footer>
          </main>
        </div>
      </section>
      {createOpen ? (
        <div className="pref-create-backdrop" role="presentation">
          <section className="pref-create-dialog glass-preferences" role="dialog" aria-modal="true" aria-label="创建资源库">
            <header className="pref-create-header">创建资源库</header>
            <label className="pref-field">
              <span>资源库名称</span>
              <input autoFocus value={libraryName} placeholder="例如：设计素材库" onChange={(event) => setLibraryName(event.target.value)} />
            </label>
            <label className="pref-field">
              <span>存储路径</span>
              <span className="pref-path-picker">
                <input value={libraryPath} placeholder="请选择存储文件夹路径..." readOnly onClick={browseLibraryPath} />
                <button type="button" onClick={browseLibraryPath}>浏览...</button>
              </span>
            </label>
            <footer className="pref-create-footer">
              <button type="button" className="pref-cancel" disabled={creating} onClick={() => closeCreate()}>取消</button>
              <button type="button" className="pref-save" disabled={creating} onClick={createLibrary}>{creating ? '创建中…' : '确认创建'}</button>
            </footer>
          </section>
        </div>
      ) : null}
    </div>
  )
}
