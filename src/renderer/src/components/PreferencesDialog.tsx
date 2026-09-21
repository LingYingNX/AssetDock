import { useEffect, useMemo, useState } from 'react'
import { formatBytes } from '../data/query'
import { useUI } from '../store/ui'
import { Icon } from './Icons'
import { applyTheme, parseTheme, type ThemeMode } from '../data/theme'

type CloseAction = 'minimize' | 'quit'
type PreferenceState = {
  openMode: 'recent' | 'specified'
  autoSync: boolean
  theme: ThemeMode
  autoLaunch: boolean
  closeAction: CloseAction
  hoverAudio: boolean
  hoverVideo: boolean
  hoverGif: boolean
  hoverSound: boolean
}

const PREFERENCES_KEY = 'preferences'
const DEFAULT_PREFERENCES: PreferenceState = {
  openMode: 'recent',
  autoSync: true,
  theme: 'light',
  autoLaunch: false,
  closeAction: 'minimize',
  hoverAudio: true,
  hoverVideo: true,
  hoverGif: true,
  hoverSound: false
}

type SectionKey = 'general' | 'library' | 'media' | 'interface' | 'operation' | 'shortcuts' | 'notify'

const SECTIONS: { key: SectionKey; icon: string; label: string }[] = [
  { key: 'general', icon: 'sliders', label: '常用' },
  { key: 'library', icon: 'drive', label: '资源库' },
  { key: 'media', icon: 'film', label: '音视频' },
  { key: 'interface', icon: 'grid', label: '界面' },
  { key: 'operation', icon: 'edit', label: '操作' },
  { key: 'shortcuts', icon: 'more-h', label: '快捷键' },
  { key: 'notify', icon: 'info', label: '通知' }
]

function readPreferences(raw: string | null): PreferenceState {
  if (!raw) return DEFAULT_PREFERENCES
  try {
    const value = JSON.parse(raw) as Partial<PreferenceState>
    return {
      openMode: value.openMode === 'specified' ? 'specified' : 'recent',
      autoSync: value.autoSync !== false,
      theme: parseTheme(raw),
      autoLaunch: value.autoLaunch === true,
      closeAction: value.closeAction === 'quit' ? 'quit' : 'minimize',
      hoverAudio: value.hoverAudio !== false,
      hoverVideo: value.hoverVideo !== false,
      hoverGif: value.hoverGif !== false,
      hoverSound: value.hoverSound === true
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

function Check({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }): React.JSX.Element {
  return (
    <label className="pref-choice">
      <input type="checkbox" checked={checked} onChange={onChange} />
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
  const [section, setSection] = useState<SectionKey>('general')
  const [draft, setDraft] = useState<PreferenceState>(DEFAULT_PREFERENCES)
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [libraryName, setLibraryName] = useState('')
  const [libraryPath, setLibraryPath] = useState('')
  const [autoLaunchSupported, setAutoLaunchSupported] = useState(true)

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
    void window.windowApi.app.getAutoLaunch().then((r) => {
      if (!cancelled) setAutoLaunchSupported(r.supported)
    })
    return () => { cancelled = true }
  }, [open])

  // 主题即时预览:切换单选项立刻生效;取消关闭时回滚为已保存值
  useEffect(() => {
    if (!open) return
    applyTheme(draft.theme)
  }, [open, draft.theme])

  if (!open) return null

  const close = (): void => {
    void window.windowApi.state.get(PREFERENCES_KEY).then((raw) => applyTheme(parseTheme(raw)))
    setOpenMenu(null)
  }
  const closeCreate = (force = false): void => {
    if (creating && !force) return
    setCreateOpen(false)
    setLibraryName('')
    setLibraryPath('')
  }
  const save = (): void => {
    if (saving) return
    setSaving(true)
    void window.windowApi.state
      .set(PREFERENCES_KEY, JSON.stringify(draft))
      .then(() => {
        if (autoLaunchSupported) void window.windowApi.app.setAutoLaunch(draft.autoLaunch)
        // 立即同步到运行中的界面,不必重启即可看到音视频偏好生效
        useUI.getState().setHoverPlayback(draft.hoverVideo, draft.hoverSound)
        close()
      })
      .catch(() => alert('保存偏好设置失败,请重试'))
      .finally(() => setSaving(false))
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

  const generalPane = (
    <>
      <section className="pref-section">
        <h2>主题</h2>
        <div className="pref-row">
          <Choice name="theme" label="白天模式" checked={draft.theme === 'light'} onChange={() => setDraft({ ...draft, theme: 'light' })} />
          <Choice name="theme" label="夜间模式" checked={draft.theme === 'dark'} onChange={() => setDraft({ ...draft, theme: 'dark' })} />
        </div>
      </section>
      <section className="pref-section">
        <h2>启动</h2>
        <div className="pref-options">
          <Check
            checked={draft.autoLaunch}
            label={autoLaunchSupported ? '开机时自动启动' : '开机时自动启动（打包后可用）'}
            onChange={() => setDraft({ ...draft, autoLaunch: !draft.autoLaunch })}
          />
        </div>
      </section>
      <section className="pref-section">
        <h2>关闭按钮</h2>
        <div className="pref-row">
          <Choice name="close-action" label="最小化" checked={draft.closeAction === 'minimize'} onChange={() => setDraft({ ...draft, closeAction: 'minimize' })} />
          <Choice name="close-action" label="退出软件" checked={draft.closeAction === 'quit'} onChange={() => setDraft({ ...draft, closeAction: 'quit' })} />
        </div>
      </section>
    </>
  )

  const libraryPane = (
    <>
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
    </>
  )

  const mediaPane = (
    <>
      <section className="pref-section">
        <h2>列表模式悬浮是否自动播放</h2>
        <div className="pref-row">
          <Check checked={draft.hoverAudio} label="音频自动播放" onChange={() => setDraft({ ...draft, hoverAudio: !draft.hoverAudio })} />
          <Check checked={draft.hoverVideo} label="视频自动播放" onChange={() => setDraft({ ...draft, hoverVideo: !draft.hoverVideo })} />
          <Check checked={draft.hoverGif} label="GIF 自动播放" onChange={() => setDraft({ ...draft, hoverGif: !draft.hoverGif })} />
        </div>
      </section>
      <section className="pref-section">
        <h2>列表模式是否开启音量</h2>
        <div className="pref-row">
          <Choice name="hover-sound" label="静音" checked={!draft.hoverSound} onChange={() => setDraft({ ...draft, hoverSound: false })} />
          <Choice name="hover-sound" label="开启音量" checked={draft.hoverSound} onChange={() => setDraft({ ...draft, hoverSound: true })} />
        </div>
      </section>
    </>
  )

  const emptyPane = (label: string): React.JSX.Element => (
    <section className="pref-section pref-empty-pane">
      <h2>{label}</h2>
      <p>该分类暂无可用设置。</p>
    </section>
  )

  const panes: Record<SectionKey, React.JSX.Element> = {
    general: generalPane,
    library: libraryPane,
    media: mediaPane,
    interface: emptyPane('界面'),
    operation: emptyPane('操作'),
    shortcuts: emptyPane('快捷键'),
    notify: emptyPane('通知')
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
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={`pref-nav-item${section === s.key ? ' on' : ''}`}
                aria-current={section === s.key ? 'page' : undefined}
                onClick={() => setSection(s.key)}
              >
                <Icon name={s.icon} />
                {s.label}
              </button>
            ))}
          </nav>
          <main className="pref-content">
            {panes[section]}
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
