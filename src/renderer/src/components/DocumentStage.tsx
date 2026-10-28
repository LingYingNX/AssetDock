import { useEffect, useMemo, useState } from 'react'
import type { DocumentCellStyle, DocumentPreview, DocumentSheet, DocumentSlideElement } from '../../../shared/types'
import { Icon } from './Icons'

interface DocumentStageProps {
  preview?: DocumentPreview
  name: string
  loading: boolean
  error?: string
  page: number
  zoom: number
  onPage: (page: number) => void
  onZoom: (zoom: number) => void
  onRetry: () => void
  onOpenExternal: () => void
}

/** 文档缩放:1 表示适应窗口。范围与步进同时供灯箱工具栏按钮复用。 */
export const DOC_ZOOM_MIN = 0.5
export const DOC_ZOOM_MAX = 3
const DOC_ZOOM_STEP = 0.25

export function stepDocZoom(zoom: number, direction: -1 | 1): number {
  const next = Math.round((zoom + direction * DOC_ZOOM_STEP) * 100) / 100
  return Math.min(DOC_ZOOM_MAX, Math.max(DOC_ZOOM_MIN, next))
}

function docFrameHtml(body: string, zoom: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><style>
    *{box-sizing:border-box}html,body{margin:0;min-height:100%;background:#fff;color:#1f2937}${zoom === 1 ? '' : `html{zoom:${zoom}}`}
    body{padding:32px;font:15px/1.72 "Source Han Sans CN","Microsoft YaHei",sans-serif}
    h1,h2,h3,h4,h5,h6{line-height:1.3;margin:.8em 0 .45em}
    p,ul,ol,blockquote,pre,table{margin:.7em 0}
    ul,ol{padding-left:1.7em}blockquote{padding-left:14px;border-left:3px solid #d5dce6;color:#5b6678}
    pre{padding:14px;overflow:auto;border:1px solid #dce2ea;background:#f7f9fc;white-space:pre-wrap;word-break:break-word}
    code{font-family:Consolas,monospace;font-size:.92em}
    table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd4df;padding:7px 9px;text-align:left;vertical-align:top}
    img{max-width:100%;height:auto}.docx-wrapper{background:transparent!important;padding:0!important}
    .docx-wrapper>section.docx{box-shadow:0 8px 28px rgba(15,35,70,.14);margin:0 auto 24px!important}
    .doc-link-text{color:#1769c2;text-decoration:underline;text-underline-offset:2px}
  </style></head><body>${body}</body></html>`
}

function failureLabel(preview: DocumentPreview): string {
  switch (preview.failure) {
    case 'corrupt': return '文档损坏或格式不受支持'
    case 'encrypted': return '文档已加密，需要密码'
    case 'missing-tool': return '缺少可用的外部办公软件转换器'
    case 'too-large': return '文档超过预览资源上限'
    case 'timeout': return '文档解析超时'
    case 'unsupported': return '文档包含暂不支持的预览特性'
    default: return '无法预览文档'
  }
}

export function documentNavCount(preview: DocumentPreview): number {
  if (preview.shape === 'slides') return Math.max(1, preview.slideCount ?? preview.slides?.length ?? 1)
  return Math.max(1, preview.pageCount ?? 1)
}

function cellStyle(style?: DocumentCellStyle): React.CSSProperties {
  if (!style) return {}
  return {
    ...(style.bold ? { fontWeight: 700 } : {}),
    ...(style.italic ? { fontStyle: 'italic' } : {}),
    ...(style.underline ? { textDecoration: 'underline' } : {}),
    ...(style.fontSize ? { fontSize: style.fontSize } : {}),
    ...(style.fontFamily ? { fontFamily: style.fontFamily } : {}),
    ...(style.color ? { color: style.color } : {}),
    ...(style.fill ? { background: style.fill } : {}),
    ...(style.align ? { textAlign: style.align } : {}),
    ...(style.valign ? { verticalAlign: style.valign } : {}),
    ...(style.border ? { border: style.border } : {})
  }
}

function SheetView({ sheet, zoom }: { sheet: DocumentSheet; zoom: number }): React.JSX.Element {
  const byKey = useMemo(() => {
    const map = new Map<string, DocumentSheet['cells'][number]>()
    for (const cell of sheet.cells) map.set(`${cell.row}:${cell.col}`, cell)
    return map
  }, [sheet])
  const covered = useMemo(() => {
    const set = new Set<string>()
    for (const cell of sheet.cells) {
      for (let r = 1; r <= (cell.rowSpan ?? 1); r++) {
        for (let c = 1; c <= (cell.colSpan ?? 1); c++) {
          if (r === 1 && c === 1) continue
          set.add(`${cell.row + r - 1}:${cell.col + c - 1}`)
        }
      }
    }
    return set
  }, [sheet])
  return (
    <div className="doc-sheet-wrap" style={{ zoom }}>
      <table className="doc-sheet-table">
        <colgroup>{sheet.columns.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
        <tbody>
          {sheet.rows.map((height, rowIndex) => (
            <tr key={rowIndex} style={{ height }}>
              {sheet.columns.map((_, colIndex) => {
                const key = `${rowIndex + 1}:${colIndex + 1}`
                if (covered.has(key)) return null
                const cell = byKey.get(key)
                return (
                  <td
                    key={colIndex}
                    rowSpan={cell?.rowSpan}
                    colSpan={cell?.colSpan}
                    style={cellStyle(cell?.style)}
                    title={cell?.value}
                  >
                    {cell?.value ?? ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {sheet.truncated ? <p className="doc-truncated">已截断超出上限的工作表内容。</p> : null}
    </div>
  )
}

function SlideElement({ element, scale }: { element: DocumentSlideElement; scale: number }): React.JSX.Element {
  const style: React.CSSProperties = {
    left: element.x * scale,
    top: element.y * scale,
    width: element.w * scale,
    height: element.h * scale,
    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
    background: element.fill,
    borderColor: element.line,
    color: element.color,
    fontSize: (element.fontSize ?? 20) * scale,
    fontWeight: element.bold ? 700 : 400,
    fontStyle: element.italic ? 'italic' : undefined,
    textAlign: element.align,
    justifyContent: element.valign === 'middle' ? 'center' : element.valign === 'bottom' ? 'flex-end' : 'flex-start'
  }
  if (element.kind === 'image' && element.src) {
    return <img className="doc-slide-el" style={style} src={element.src} alt="" draggable={false} />
  }
  if (element.kind === 'table' && element.table) {
    const columns = element.table.columns
    const rows = element.table.rows
    return (
      <div className="doc-slide-el doc-slide-table" style={style}>
        <table>
          <colgroup>{columns.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
          <tbody>
            {rows.map((height, rowIndex) => (
              <tr key={rowIndex} style={{ height }}>
                {columns.map((_, colIndex) => {
                  const cell = element.table?.cells.find((item) => item.row === rowIndex + 1 && item.col === colIndex + 1)
                  return <td key={colIndex} style={cellStyle(cell?.style)}>{cell?.value ?? ''}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
  return <div className="doc-slide-el" style={style}>{element.text}</div>
}

function SlidesView({ preview, page, zoom }: { preview: DocumentPreview; page: number; zoom: number }): React.JSX.Element {
  const slide = preview.slides?.[Math.max(0, page - 1)]
  if (!slide) return <div className="doc-empty">该幻灯片为空。</div>
  const maxWidth = 1120
  const maxHeight = 660
  const scale = Math.max(0.1, Math.min(maxWidth / slide.width, maxHeight / slide.height)) * zoom
  return (
    <div className="doc-slide-wrap">
      <div
        className="doc-slide"
        style={{ width: slide.width * scale, height: slide.height * scale, background: slide.background ?? '#fff' }}
      >
        {slide.elements.map((element, index) => <SlideElement key={index} element={element} scale={scale} />)}
      </div>
    </div>
  )
}

function HtmlView({ html, zoom }: { html: string; zoom: number }): React.JSX.Element {
  return <iframe className="doc-frame" title="文档内容" sandbox="" srcDoc={docFrameHtml(html, zoom)} />
}

export function DocumentStage({
  preview, name, loading, error, page, zoom, onPage, onZoom, onRetry, onOpenExternal
}: DocumentStageProps): React.JSX.Element {
  const [sheetIndex, setSheetIndex] = useState(0)
  useEffect(() => setSheetIndex(0), [preview?.fingerprint])
  /* 舞台内的键盘操作:方向键走结构导航(XLSX 工作表、PPTX 幻灯片),+/-/0 走缩放。
     焦点在 iframe 内时事件不会冒泡到这里,DOCX/Markdown 的滚动由 iframe 自己处理。 */
  useEffect(() => {
    if (!preview || preview.failure) return
    const shape = preview.shape
    const sheetTotal = preview.sheets?.length ?? 0
    const slideTotal = documentNavCount(preview)
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '+' || e.key === '=') {
        e.preventDefault()
        onZoom(stepDocZoom(zoom, 1))
        return
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        onZoom(stepDocZoom(zoom, -1))
        return
      }
      if (e.key === '0') {
        e.preventDefault()
        onZoom(1)
        return
      }
      const direction = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0
      if (direction === 0) return
      if (shape === 'sheet' && sheetTotal > 1) {
        e.preventDefault()
        setSheetIndex((index) => Math.min(sheetTotal - 1, Math.max(0, index + direction)))
      } else if (shape === 'slides' && slideTotal > 1) {
        e.preventDefault()
        onPage(Math.min(slideTotal, Math.max(1, page + direction)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview, page, zoom, onPage, onZoom])
  if (loading) return <div className="doc-state"><div className="doc-spinner" /><strong>正在解析文档…</strong><span>{name}</span></div>
  if (error) return <div className="doc-state"><Icon name="document" /><strong>{error}</strong><div className="v3-bar"><button className="v3-chip" onClick={onRetry}>重试</button><button className="v3-chip" onClick={onOpenExternal}>外部打开</button></div></div>
  if (!preview) return <div className="doc-state"><Icon name="document" /><strong>没有可用的文档预览</strong><div className="v3-bar"><button className="v3-chip" onClick={onRetry}>重试</button><button className="v3-chip" onClick={onOpenExternal}>外部打开</button></div></div>
  if (preview.failure) return <div className="doc-state"><Icon name="document" /><strong>{failureLabel(preview)}</strong><span>{preview.failureDetail}</span><div className="v3-bar"><button className="v3-chip" onClick={onRetry}>重试</button><button className="v3-chip" onClick={onOpenExternal}>外部打开</button></div></div>

  if (preview.shape === 'sheet') {
    const sheets = preview.sheets ?? []
    const sheet = sheets[Math.min(sheetIndex, Math.max(0, sheets.length - 1))]
    return (
      <div className="doc-shell">
        {sheets.length > 1 ? (
          <div className="doc-sheet-tabs" role="tablist" aria-label="工作表">
            {sheets.map((item, index) => (
              <button key={`${item.name}-${index}`} className={index === sheetIndex ? 'on' : ''} role="tab" aria-selected={index === sheetIndex} onClick={() => setSheetIndex(index)}>{item.name}</button>
            ))}
          </div>
        ) : null}
        <div className="doc-scroll" onDoubleClick={() => onZoom(1)}>
          {sheet ? <SheetView sheet={sheet} zoom={zoom} /> : <div className="doc-empty">空工作表</div>}
        </div>
        {preview.truncated ? <div className="doc-note">内容超过预览上限，已截断。</div> : null}
      </div>
    )
  }
  if (preview.shape === 'slides') {
    const slides = preview.slides ?? []
    return (
      <div className="doc-shell">
        <div className="doc-scroll doc-slide-scroll" onDoubleClick={() => onZoom(1)}>
          <SlidesView preview={preview} page={page} zoom={zoom} />
        </div>
        {slides.length > 1 ? (
          <div className="doc-slide-nav">
            <button disabled={page <= 1} onClick={() => onPage(Math.max(1, page - 1))} aria-label="上一张幻灯片"><Icon name="arr-l" /></button>
            <span>{Math.min(page, slides.length)} / {slides.length}</span>
            <button disabled={page >= slides.length} onClick={() => onPage(Math.min(slides.length, page + 1))} aria-label="下一张幻灯片"><Icon name="arr-r" /></button>
          </div>
        ) : null}
        {preview.truncated ? <div className="doc-note">幻灯片超过预览上限，已截断。</div> : null}
      </div>
    )
  }
  if (preview.shape === 'markdown') {
    return <div className="doc-shell"><HtmlView html={preview.html ?? ''} zoom={zoom} /></div>
  }
  if (preview.shape === 'doc') {
    return <div className="doc-shell"><HtmlView html={preview.html ?? ''} zoom={zoom} /></div>
  }
  return (
    <div className="doc-shell">
      <div className="doc-scroll" onDoubleClick={() => onZoom(1)}>
        <pre className="doc-text" style={{ zoom }}>{preview.text ?? ''}</pre>
      </div>
      {preview.truncated ? <div className="doc-note">文本超过预览上限，已截断。</div> : null}
    </div>
  )
}
