import { useEffect, useMemo, useRef, useState } from 'react'
import { buildPreviewHtml } from '../../../shared/cssPreview'
import { useUI } from '../store/ui'
import { formatBytes } from '../data/query'
import type { Asset } from '../data/types'
import { Icon } from './Icons'

/**
 * CSS 素材编辑器:左侧代码、右侧实时预览。
 *
 * 预览用编辑器当前内容而非磁盘内容,因此改一行颜色立刻能看到效果;
 * 预览页经 sandbox iframe 渲染且骨架脚本已被剥离,样式不会污染主界面。
 */

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; message: string }
type Pane = 'css' | 'html'

const PREVIEW_DEBOUNCE_MS = 250

/**
 * 骨架留空时的默认 HTML:站点给的组件通常是 HTML + CSS 成对,
 * 这段默认值给出一份可直接改的起点,省去从空白页开始。
 */
const HTML_STARTER = `<div class="input">
  <button class="value">菜单项一</button>
  <button class="value">菜单项二</button>
</div>`

export function CssEditor({ a }: { a: Asset }): React.JSX.Element {
  const setCssDirty = useUI((s) => s.setCssDirty)
  const [pane, setPane] = useState<Pane>('css')
  const [css, setCss] = useState<string | null>(null)
  const [savedCss, setSavedCss] = useState('')
  const [html, setHtml] = useState('')
  const [savedHtml, setSavedHtml] = useState('')
  const [htmlExists, setHtmlExists] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<SaveState>({ kind: 'idle' })
  const [previewHtml, setPreviewHtml] = useState('')
  const areaRef = useRef<HTMLTextAreaElement | null>(null)

  const cssDirty = css != null && css !== savedCss
  const htmlDirty = html !== savedHtml
  const dirty = cssDirty || htmlDirty

  /* 打开素材时加载 CSS 与配套 HTML;组件常驻挂载,按素材 id 重载 */
  useEffect(() => {
    let cancelled = false
    setCss(null)
    setHtml('')
    setSavedHtml('')
    setHtmlExists(false)
    setLoadError(null)
    setSaveState({ kind: 'idle' })
    setPane('css')
    if (a.dbId == null || a.libraryId == null) {
      setLoadError('该素材不在素材库中,无法编辑')
      return
    }
    const libId = a.libraryId
    const assetId = a.dbId
    void window.windowApi.assets.readText(libId, assetId).then((r) => {
      if (cancelled) return
      if ('error' in r) {
        setLoadError(r.error)
        return
      }
      setCss(r.text)
      setSavedCss(r.text)
    })
    void window.windowApi.assets.readShell(libId, assetId).then((r) => {
      if (cancelled || 'error' in r) return
      // 没有配套 HTML 时用起点模板占位,但不算「已有骨架」,也不标记为脏
      setHtml(r.exists && r.text != null ? r.text : HTML_STARTER)
      setSavedHtml(r.exists && r.text != null ? r.text : HTML_STARTER)
      setHtmlExists(r.exists)
    })
    return () => {
      cancelled = true
    }
  }, [a.id, a.dbId, a.libraryId])

  /* 未保存标记同步到 store,让关闭/切换素材统一走确认 */
  useEffect(() => {
    setCssDirty(dirty)
    return () => setCssDirty(false)
  }, [dirty, setCssDirty])

  /* 预览防抖刷新:右侧外观由 HTML 承载,编辑器内容即时生效 */
  useEffect(() => {
    if (css == null) return
    const id = window.setTimeout(() => setPreviewHtml(buildPreviewHtml(css, html.trim() || null)), PREVIEW_DEBOUNCE_MS)
    return () => window.clearTimeout(id)
  }, [css, html])

  const save = useMemo(
    () => async (): Promise<void> => {
      if (a.dbId == null || a.libraryId == null || css == null) return
      setSaveState({ kind: 'saving' })
      if (cssDirty) {
        const r = await window.windowApi.assets.writeText(a.libraryId, a.dbId, css).catch(() => ({ error: '保存失败' }))
        if ('error' in r) {
          setSaveState({ kind: 'failed', message: r.error })
          return
        }
        setSavedCss(css)
      }
      // 只有确实写过或改过 HTML 才落盘,避免凭空生成同名 .html
      if (htmlDirty || htmlExists) {
        const r = await window.windowApi.assets.writeShell(a.libraryId, a.dbId, html).catch(() => ({ error: '保存失败' }))
        if ('error' in r) {
          setSaveState({ kind: 'failed', message: r.error })
          return
        }
        setSavedHtml(html)
        setHtmlExists(true)
      }
      setSaveState({ kind: 'saved' })
    },
    [a.dbId, a.libraryId, css, html, cssDirty, htmlDirty, htmlExists]
  )

  /* Ctrl+S 保存:输入区与窗口都监听,焦点在代码区时也能生效 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      e.stopPropagation()
      void save()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [save])

  const codeProps = {
    spellCheck: false,
    autoComplete: 'off',
    onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // 保持「像记事本」的手感:Tab 插入两个空格而不是切走焦点
      if (e.key !== 'Tab') return
      e.preventDefault()
      const el = e.currentTarget
      const start = el.selectionStart
      const end = el.selectionEnd
      const next = `${el.value.slice(0, start)}  ${el.value.slice(end)}`
      if (pane === 'css') setCss(next)
      else setHtml(next)
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2
      })
    }
  }

  return (
    <div className="css-edit">
      <div className="css-pane">
        <div className="css-pane-h">
          <div className="css-tabs">
            <button className={`css-tab${pane === 'css' ? ' on' : ''}`} onClick={() => setPane('css')}>
              <Icon name="code" />CSS{cssDirty && <i className="css-dot" />}
            </button>
            <button className={`css-tab${pane === 'html' ? ' on' : ''}`} onClick={() => setPane('html')}>
              <Icon name="markup" />HTML{htmlDirty && <i className="css-dot" />}
            </button>
          </div>
          <span className={`css-state${dirty ? ' dirty' : ''}`} role="status" aria-live="polite">
            {dirty ? '未保存' : saveState.kind === 'saved' ? '已保存' : ''}
          </span>
          <button
            className="v3-chip"
            title="保存 (Ctrl+S)"
            disabled={!dirty || saveState.kind === 'saving'}
            onClick={() => void save()}
          >
            <Icon name="save" />
            {saveState.kind === 'saving' ? '保存中…' : '保存'}
          </button>
        </div>
        {loadError ? (
          <div className="css-error"><Icon name="info" />{loadError}</div>
        ) : pane === 'css' ? (
          <textarea
            ref={areaRef}
            className="css-code"
            name="asset-css"
            aria-label="CSS 代码"
            value={css ?? ''}
            placeholder={css == null ? '读取中…' : ''}
            onChange={(e) => setCss(e.target.value)}
            {...codeProps}
          />
        ) : (
          <>
            <textarea
              className="css-code"
              name="asset-html"
              aria-label="HTML 骨架"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              {...codeProps}
            />
            {!htmlExists && !htmlDirty && (
              <div className="css-hint"><Icon name="info" />右侧外观由这段 HTML 决定,保存后写入同名 .html</div>
            )}
          </>
        )}
      </div>
      <div className="css-pane">
        <div className="css-pane-h">
          <span className="css-pane-t"><Icon name="image" />外观</span>
          <span className="css-pane-note">{a.format} · {formatBytes(a.sizeBytes)}</span>
        </div>
        <iframe
          className="css-preview"
          title="CSS 预览"
          sandbox="allow-same-origin"
          srcDoc={previewHtml}
        />
      </div>
      {saveState.kind === 'failed' && <div className="css-toast err"><Icon name="info" />{saveState.message}</div>}
    </div>
  )
}
