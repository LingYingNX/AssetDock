import { readFile, stat, mkdir, rm } from 'node:fs/promises'
import { dirname, extname, join, normalize } from 'node:path'
import type Database from 'better-sqlite3'
import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import ExcelJS from 'exceljs'
import { DOMParser } from '@xmldom/xmldom'
import { parseHTML } from 'linkedom'
import PPTX2Json from 'pptx2json'
import * as XLSX from 'xlsx'
import { parseMsDoc, renderMsDoc } from '@file-viewer/doc'
import {
  formatSpec,
  type AssetFormat,
  type DocumentShape
} from '../../shared/formats'
import type {
  DocumentCellStyle,
  DocumentFailureKind,
  DocumentPreview,
  DocumentSheet,
  DocumentSheetCell,
  DocumentSlide,
  DocumentSlideElement
} from '../../shared/types'
import { fileExists, isWithinRoot, writeFileAtomically } from './cacheFiles'
import { openZip } from './documentZip'
import { DOCUMENT_RENDERER_VERSION } from '../../shared/thumbnailConfig'

export { DOCUMENT_RENDERER_VERSION } from '../../shared/thumbnailConfig'

const MAX_TEXT_BYTES = 16 * 1024 * 1024
const MAX_TEXT_CHARS = 4 * 1024 * 1024
const MAX_SHEETS = 64
const MAX_ROWS = 2000
const MAX_COLS = 200
const MAX_CELLS = 100_000
const MAX_SLIDES = 300
const MAX_SLIDE_ELEMENTS = 3000
const MAX_DOCUMENT_HTML = 12 * 1024 * 1024
const MAX_DOC_BYTES = 64 * 1024 * 1024
const MAX_DOC_PICTURE_BYTES = 16 * 1024 * 1024
const PARSE_TIMEOUT_MS = 30_000
/* ExcelJS 会对每个合并区域做二次布局,几万个合并单元格能把主进程卡住几分钟;
   预览只要前 2000 行,所以超限文件在进入 ExcelJS 前直接降级。 */
const MAX_XLSX_MERGES = 2000
const MAX_XLSX_ROWS = 100_000
const MAX_XLSX_COLUMNS = 2000
const MAX_XLSX_SHEET_XML = 32 * 1024 * 1024
/* SheetJS 把整本工作簿读进内存,32MB 以上的二进制表格在解析前直接降级 */
const MAX_SPREADSHEET_BYTES = 32 * 1024 * 1024

export class DocumentPreviewError extends Error {
  constructor(message: string, readonly kind: DocumentFailureKind) {
    super(message)
    this.name = 'DocumentPreviewError'
  }
}

interface PreviewMeta {
  relPath: string
  mtimeMs: number
  sizeBytes: number
  libraryId?: number
}

interface DocumentPreviewOptions {
  force?: boolean
}

const inflight = new Map<string, Promise<DocumentPreview>>()

export function documentPreviewDir(libPath: string, fingerprint: string): string {
  return join(libPath, '.mediahub', 'previews', 'documents', fingerprint)
}

export function documentPreviewPath(libPath: string, fingerprint: string): string {
  return join(documentPreviewDir(libPath, fingerprint), 'preview.json')
}

function shapeFor(format: string): DocumentShape {
  return (formatSpec(format) as { documentShape?: DocumentShape } | undefined)?.documentShape ?? 'text'
}

function failureMessage(kind: DocumentFailureKind): string {
  switch (kind) {
    case 'corrupt': return '文档损坏或格式不受支持'
    case 'encrypted': return '文档已加密，需要密码'
    case 'missing-tool': return '缺少可用的外部办公软件转换器'
    case 'too-large': return '文档超过预览资源上限'
    case 'timeout': return '文档解析超时'
    case 'unsupported': return '文档包含暂不支持的预览特性'
  }
}

function asPreviewError(error: unknown): DocumentPreviewError {
  if (error instanceof DocumentPreviewError) return error
  const message = error instanceof Error ? error.message : String(error)
  // ExcelJS 碰到它不认识的 OOXML 节点时抛这句:文件本身没坏,只是特性不支持。
  if (/Unexpected xml node in parseOpen/i.test(message)) return new DocumentPreviewError(message, 'unsupported')
  if (/exceeds limit|too many entries/i.test(message)) return new DocumentPreviewError(message, 'too-large')
  if (/password|encrypted|encryption|密码|加密/i.test(message)) return new DocumentPreviewError(message, 'encrypted')
  if (/timeout|timed out/i.test(message)) return new DocumentPreviewError(message, 'timeout')
  return new DocumentPreviewError(message || failureMessage('corrupt'), 'corrupt')
}

function assertFingerprint(value: string): string {
  if (!/^[0-9a-f]{20}$/i.test(value)) throw new DocumentPreviewError('invalid document fingerprint', 'corrupt')
  return value
}

function safeDecode(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .slice(0, MAX_TEXT_CHARS)
}

function decodeText(buffer: Buffer): { text: string; encoding: string } {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: safeDecode(buffer.subarray(3).toString('utf8')), encoding: 'UTF-8 BOM' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: safeDecode(buffer.subarray(2).toString('utf16le')), encoding: 'UTF-16 LE' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    // 奇数长度是损坏输入；零初始化避免把未初始化内存解码进预览。
    const swapped = Buffer.alloc(buffer.length - 2)
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    return { text: safeDecode(swapped.toString('utf16le')), encoding: 'UTF-16 BE' }
  }
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return { text: safeDecode(utf8), encoding: 'UTF-8' }
  const gb = new TextDecoder('gb18030').decode(buffer)
  if (!gb.includes('\uFFFD')) return { text: safeDecode(gb), encoding: 'GB18030' }
  return { text: safeDecode(buffer.toString('latin1')), encoding: 'Latin-1' }
}

function detectCsvDelimiter(text: string): string {
  const sample = text.slice(0, 32 * 1024).split(/\r?\n/).slice(0, 30)
  const candidates = [',', '\t', ';', '|']
  let best = ','
  let bestScore = -1
  for (const delimiter of candidates) {
    let score = 0
    let rows = 0
    for (const line of sample) {
      if (!line.trim()) continue
      let quoted = false
      let count = 0
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted
        else if (!quoted && line[i] === delimiter) count++
      }
      if (count > 0) {
        score += count
        rows++
      }
    }
    const value = rows > 0 ? score / rows : 0
    if (value > bestScore) {
      bestScore = value
      best = delimiter
    }
  }
  return best
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function csvSheet(text: string): DocumentSheet {
  const parsed = parseDelimitedRows(text, detectCsvDelimiter(text))
  const rowLimit = Math.min(parsed.length, MAX_ROWS)
  const colLimit = Math.min(Math.max(1, ...parsed.slice(0, rowLimit).map((row) => row.length)), MAX_COLS)
  const cells: DocumentSheetCell[] = []
  for (let r = 0; r < rowLimit; r++) {
    const row = parsed[r] ?? []
    for (let c = 0; c < Math.min(row.length, colLimit); c++) {
      if (row[c] === '') continue
      cells.push({ row: r + 1, col: c + 1, value: row[c] })
    }
  }
  return {
    name: 'CSV',
    columns: Array.from({ length: colLimit }, (_, i) => 88 + (i % 4) * 24),
    rows: Array.from({ length: rowLimit }, () => 28),
    cells,
    ...(parsed.length > MAX_ROWS ? { truncated: true } : {})
  }
}

async function markdownHtml(text: string, libPath: string, absPath: string): Promise<string> {
  const md = new MarkdownIt({ html: false, linkify: false, typographer: false })
  let raw = md.render(text)
  raw = await inlineMarkdownImages(raw, libPath, absPath)
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'img', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'table', 'thead', 'tbody',
      'tr', 'th', 'td', 'blockquote', 'hr', 'del', 'ins'
    ]),
    allowedAttributes: {
      a: ['href'],
      img: ['src', 'alt', 'title'],
      '*': ['class']
    },
    allowedSchemes: ['data'],
    allowedSchemesByTag: { img: ['data'] },
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (_tag, attribs) => ({
        tagName: 'span',
        attribs: { class: 'doc-link-text', ...(attribs.title ? { title: attribs.title } : {}) }
      })
    }
  })
}

async function inlineMarkdownImages(html: string, libPath: string, absPath: string): Promise<string> {
  const doc = parseHTML(`<html><body>${html}</body></html>`).document
  const sourceDir = dirname(absPath)
  type MarkdownImage = {
    getAttribute(name: string): string | null
    setAttribute(name: string, value: string): void
    remove(): void
  }
  for (const image of Array.from(doc.querySelectorAll('img')) as unknown as MarkdownImage[]) {
    const src = image.getAttribute('src')
    if (!src || /^(?:data:|https?:|mailto:|#)/i.test(src)) continue
    if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('/') || src.startsWith('\\')) {
      image.remove()
      continue
    }
    let decoded = src
    try {
      decoded = decodeURIComponent(src.split(/[?#]/, 1)[0])
    } catch {
      // 非法 URL 编码按字面路径处理；后续越界校验仍会拒绝。
    }
    const target = normalize(join(sourceDir, decoded))
    // 库内相对图片都放行(含 ../assets 这类跨目录写法),但不得越出库根。
    if (!isWithinRoot(libPath, target)) {
      image.remove()
      continue
    }
    const st = await stat(target).catch(() => null)
    if (!st?.isFile() || st.size > 16 * 1024 * 1024) {
      image.remove()
      continue
    }
    const mime = markdownImageMime(target)
    if (!mime) {
      image.remove()
      continue
    }
    const data = await readFile(target).catch(() => null)
    if (!data) {
      image.remove()
      continue
    }
    image.setAttribute('src', `data:${mime};base64,${data.toString('base64')}`)
  }
  return doc.body.innerHTML
}

function markdownImageMime(path: string): string | undefined {
  switch (extname(path).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.svg': return 'image/svg+xml'
    default: return undefined
  }
}

function xmlText(node: unknown): string {
  if (node == null) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(xmlText).join('')
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>
    if ('#text' in obj) return String(obj['#text'])
    if ('_' in obj) return String(obj['_'])
    return Object.entries(obj).filter(([key]) => key !== '$').map(([, value]) => xmlText(value)).join('')
  }
  return ''
}

function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const hex = value.replace(/^#/, '').trim()
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex}`
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`
  return undefined
}

function styleForExcel(cell: ExcelJS.Cell): DocumentCellStyle | undefined {
  const style: DocumentCellStyle = {}
  if (cell.font?.bold) style.bold = true
  if (cell.font?.italic) style.italic = true
  if (cell.font?.underline) style.underline = true
  if (typeof cell.font?.size === 'number') style.fontSize = cell.font.size
  if (typeof cell.font?.name === 'string') style.fontFamily = cell.font.name
  const color = normalizeColor(cell.font?.color?.argb)
  if (color) style.color = color
  const fill = cell.fill as { fgColor?: { argb?: string } } | undefined
  const background = normalizeColor(fill?.fgColor?.argb)
  if (background) style.fill = background
  if (cell.alignment?.horizontal === 'left' || cell.alignment?.horizontal === 'center' || cell.alignment?.horizontal === 'right') {
    style.align = cell.alignment.horizontal
  }
  if (cell.alignment?.vertical === 'top' || cell.alignment?.vertical === 'middle' || cell.alignment?.vertical === 'bottom') {
    style.valign = cell.alignment.vertical
  }
  if (cell.numFmt) style.numberFormat = cell.numFmt
  const borders = cell.border
  if (borders?.top?.style || borders?.left?.style || borders?.bottom?.style || borders?.right?.style) {
    style.border = '1px solid rgba(30,40,55,.35)'
  }
  return Object.keys(style).length > 0 ? style : undefined
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    if ('richText' in value) return value.richText.map((part) => part.text).join('')
    if ('text' in value) return String(value.text)
    if ('result' in value) return String(value.result ?? '')
    if ('error' in value) return String(value.error)
  }
  return cell.text ?? ''
}

function cellRefBound(ref: string): { rows: number; cols: number } | null {
  const match = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i.exec(ref.trim())
  if (!match) return null
  const colNumber = (letters: string): number =>
    letters.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
  return {
    rows: Number(match[4] ?? match[2]) || 0,
    cols: colNumber(match[3] ?? match[1])
  }
}

async function assertXlsxWithinLimits(zip: Awaited<ReturnType<typeof openZip>>): Promise<void> {
  for (const name of Object.keys(zip.files)) {
    if (!/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) continue
    const file = zip.file(name)
    if (!file) continue
    const xml = await file.async('string')
    if (xml.length > MAX_XLSX_SHEET_XML) {
      throw new DocumentPreviewError('worksheet XML exceeds preview limit', 'too-large')
    }
    const merges = (xml.match(/<mergeCell\b/g) ?? []).length
    if (merges > MAX_XLSX_MERGES) {
      throw new DocumentPreviewError(`worksheet has ${merges} merged ranges (limit ${MAX_XLSX_MERGES})`, 'too-large')
    }
    const bound = cellRefBound(/<dimension[^>]*ref="([^"]+)"/.exec(xml)?.[1] ?? '')
    if (bound && (bound.rows > MAX_XLSX_ROWS || bound.cols > MAX_XLSX_COLUMNS)) {
      throw new DocumentPreviewError(`worksheet is ${bound.rows}x${bound.cols} cells`, 'too-large')
    }
  }
}

/**
 * CE 版 SheetJS 只能读出填充色(BIFF/XLSX 都把 fill 直接挂在 cell.s 上)与数字格式,
 * 字体、边框、对齐不暴露,因此这里是保真上限而不是遗漏。
 */
type SheetJsCell = XLSX.CellObject & {
  s?: { patternType?: string; fgColor?: { rgb?: string }; bgColor?: { rgb?: string } }
}

function sheetJsStyle(cell: SheetJsCell): DocumentCellStyle | undefined {
  const style: DocumentCellStyle = {}
  const fill = cell.s
  if (fill?.patternType && fill.patternType !== 'none') {
    const color = normalizeColor(fill.fgColor?.rgb ?? '')
    if (color) style.fill = color
  }
  if (typeof cell.z === 'string' && cell.z.trim() && cell.z !== 'General') style.numberFormat = cell.z
  return Object.keys(style).length > 0 ? style : undefined
}

/** 带数字格式的单元格取 SheetJS 预生成的显示文本,只有裸值时才自己格式化 */
function sheetJsText(cell: SheetJsCell): string {
  if (typeof cell.w === 'string' && cell.w.trim()) return cell.w
  const value = cell.v
  if (value == null) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') return ''
  return String(value)
}

function sheetJsColumnWidths(sheet: XLSX.WorkSheet, count: number): number[] {
  const cols = (sheet as { '!cols'?: Array<{ wpx?: number; wch?: number; width?: number } | undefined> })['!cols'] ?? []
  return Array.from({ length: count }, (_, index) => {
    const col = cols[index]
    const chars = col?.wch ?? col?.width
    const px = col?.wpx ?? (typeof chars === 'number' ? chars * 7.5 : undefined)
    return Math.max(48, Math.min(480, Math.round(px ?? 75)))
  })
}

function sheetJsRowHeights(sheet: XLSX.WorkSheet, count: number): number[] {
  const rows = (sheet as { '!rows'?: Array<{ hpt?: number } | undefined> })['!rows'] ?? []
  return Array.from({ length: count }, (_, index) => {
    const points = rows[index]?.hpt
    return Math.max(22, Math.min(220, Math.round((typeof points === 'number' ? points : 15) * 1.7)))
  })
}

function sheetFromSheetJs(sheet: XLSX.WorkSheet, name: string): { sheet: DocumentSheet; truncated: boolean } {
  const range = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']) : null
  const totalRows = range ? range.e.r - range.s.r + 1 : 0
  const totalCols = range ? range.e.c - range.s.c + 1 : 0
  const rowCount = Math.min(totalRows, MAX_ROWS)
  const colCount = Math.min(totalCols, MAX_COLS)
  const cells: DocumentSheetCell[] = []
  let cellCount = 0
  if (range) {
    for (let r = 0; r < rowCount && cellCount < MAX_CELLS; r++) {
      for (let c = 0; c < colCount && cellCount < MAX_CELLS; c++) {
        const address = XLSX.utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })
        const cell = sheet[address] as SheetJsCell | undefined
        if (!cell) continue
        const value = sheetJsText(cell)
        if (!value) continue
        const style = sheetJsStyle(cell)
        cells.push({ row: r + 1, col: c + 1, value, ...(style ? { style } : {}) })
        cellCount++
      }
    }
    const merges = (sheet as { '!merges'?: XLSX.Range[] })['!merges'] ?? []
    if (merges.length > MAX_XLSX_MERGES) {
      throw new DocumentPreviewError(`worksheet has ${merges.length} merged ranges (limit ${MAX_XLSX_MERGES})`, 'too-large')
    }
    const byKey = new Map(cells.map((cell) => [`${cell.row}:${cell.col}`, cell]))
    for (const merge of merges) {
      const row = merge.s.r - range.s.r + 1
      const col = merge.s.c - range.s.c + 1
      const master = byKey.get(`${row}:${col}`)
      if (!master) continue
      const rowSpan = Math.min(merge.e.r, range.s.r + rowCount - 1) - merge.s.r + 1
      const colSpan = Math.min(merge.e.c, range.s.c + colCount - 1) - merge.s.c + 1
      if (rowSpan <= 1 && colSpan <= 1) continue
      master.rowSpan = Math.max(1, rowSpan)
      master.colSpan = Math.max(1, colSpan)
    }
  }
  const truncated = totalRows > rowCount || totalCols > colCount || cellCount >= MAX_CELLS
  return {
    sheet: {
      name,
      columns: sheetJsColumnWidths(sheet, colCount),
      rows: sheetJsRowHeights(sheet, rowCount),
      cells,
      ...(truncated ? { truncated: true } : {})
    },
    truncated
  }
}

/** XLS/BIFF、XLSB、ODS、FODS 共用 SheetJS 读取路径;结果映射到既有 DocumentSheet */
async function previewSpreadsheet(absPath: string, fingerprint: string, format: string): Promise<DocumentPreview> {
  const st = await stat(absPath)
  if (st.size > MAX_SPREADSHEET_BYTES) {
    throw new DocumentPreviewError(`spreadsheet is ${st.size} bytes (limit ${MAX_SPREADSHEET_BYTES})`, 'too-large')
  }
  const workbook = XLSX.read(await readFile(absPath), {
    type: 'buffer',
    cellStyles: true,
    cellNF: true,
    cellDates: true
  })
  const sheets: DocumentSheet[] = []
  let truncated = false
  for (const name of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const built = sheetFromSheetJs(workbook.Sheets[name] ?? {}, name)
    if (built.truncated) truncated = true
    sheets.push(built.sheet)
  }
  if (workbook.SheetNames.length > MAX_SHEETS) truncated = true
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format,
    shape: 'sheet',
    fingerprint,
    generatedAt: new Date().toISOString(),
    sheetCount: workbook.SheetNames.length,
    sheets,
    ...(truncated ? { truncated: true } : {})
  }
}

async function previewXlsx(absPath: string, fingerprint: string): Promise<DocumentPreview> {
  const zip = await openZip(absPath)
  await assertXlsxWithinLimits(zip)
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(absPath)
  const sheets: DocumentSheet[] = []
  let truncated = false
  for (const sheet of workbook.worksheets.slice(0, MAX_SHEETS)) {
    const rowCount = Math.min(sheet.rowCount, MAX_ROWS)
    const colCount = Math.min(sheet.columnCount, MAX_COLS)
    const cells: DocumentSheetCell[] = []
    let cellCount = 0
    for (let r = 1; r <= rowCount && cellCount < MAX_CELLS; r++) {
      const row = sheet.getRow(r)
      for (let c = 1; c <= colCount && cellCount < MAX_CELLS; c++) {
        const cell = row.getCell(c)
        const text = cellText(cell)
        if (!text) continue
        const style = styleForExcel(cell)
        cells.push({ row: r, col: c, value: text, ...(style ? { style } : {}) })
        cellCount++
      }
    }
    const merges = sheet.model.merges ?? []
    for (const merge of merges) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(merge)
      if (!m) continue
      const col = (letters: string): number => letters.toUpperCase().split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0)
      const c1 = col(m[1])
      const r1 = Number(m[2])
      const c2 = col(m[3])
      const r2 = Number(m[4])
      const master = cells.find((cell) => cell.row === r1 && cell.col === c1)
      if (!master) continue
      master.colSpan = Math.max(1, c2 - c1 + 1)
      master.rowSpan = Math.max(1, r2 - r1 + 1)
    }
    const columns = Array.from({ length: colCount }, (_, i) => {
      const width = sheet.getColumn(i + 1).width
      return Math.max(48, Math.min(480, Math.round((width ?? 10) * 7.5)))
    })
    const rows = Array.from({ length: rowCount }, (_, i) => {
      const height = sheet.getRow(i + 1).height
      return Math.max(22, Math.min(220, Math.round((height ?? 15) * 1.7)))
    })
    if (sheet.rowCount > rowCount || sheet.columnCount > colCount || cellCount >= MAX_CELLS) truncated = true
    sheets.push({ name: sheet.name, columns, rows, cells, ...(truncated ? { truncated: true } : {}) })
  }
  if (workbook.worksheets.length > MAX_SHEETS) truncated = true
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'XLSX',
    shape: 'sheet',
    fingerprint,
    generatedAt: new Date().toISOString(),
    sheetCount: workbook.worksheets.length,
    sheets,
    ...(truncated ? { truncated: true } : {})
  }
}

function parseRels(xml: string): Map<string, string> {
  const out = new Map<string, string>()
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  const rels = doc.getElementsByTagName('Relationship')
  for (let i = 0; i < rels.length; i++) {
    const el = rels.item(i)
    const id = el?.getAttribute('Id')
    const target = el?.getAttribute('Target')
    if (id && target) out.set(id, target)
  }
  return out
}

function relTarget(basePart: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = basePart.split('/')
  parts.pop()
  for (const part of target.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return parts.join('/')
}

function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[ch] ?? ch))
}

function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function pptxSlideSvg(
  width: number,
  height: number,
  elements: DocumentSlideElement[],
  background?: string
): string {
  const body = elements.map((el) => {
    const common = `transform="translate(${el.x} ${el.y})${el.rotation ? ` rotate(${el.rotation} ${el.w / 2} ${el.h / 2})` : ''}"`
    if (el.kind === 'image' && el.src) {
      return `<image ${common} width="${el.w}" height="${el.h}" href="${escapeXmlText(el.src)}" preserveAspectRatio="xMidYMid meet"/>`
    }
    if (el.kind === 'table' && el.table) {
      const cols = el.table.columns
      const rows = el.table.rows
      const totalW = cols.reduce((a, b) => a + b, 0) || el.w
      const totalH = rows.reduce((a, b) => a + b, 0) || el.h
      let lines = ''
      let y = 0
      for (let r = 0; r < rows.length; r++) {
        let x = 0
        for (let c = 0; c < cols.length; c++) {
          const cell = el.table.cells.find((item) => item.row === r + 1 && item.col === c + 1)
          lines += `<rect x="${x}" y="${y}" width="${cols[c]}" height="${rows[r]}" fill="${cell?.style?.fill ?? '#ffffff'}" stroke="rgba(30,40,55,.35)" stroke-width="1"/>`
          if (cell?.value) {
            lines += `<text x="${x + 6}" y="${y + Math.min(rows[r] - 5, 18)}" font-family="Source Han Sans CN, Microsoft YaHei, sans-serif" font-size="14" fill="${cell.style?.color ?? '#1f2937'}">${escapeXmlText(cell.value.slice(0, 500))}</text>`
          }
          x += cols[c]
        }
        y += rows[r]
      }
      return `<g ${common}><svg width="${el.w}" height="${el.h}" viewBox="0 0 ${totalW} ${totalH}">${lines}</svg></g>`
    }
    const fill = el.fill ?? (el.kind === 'shape' ? 'rgba(200,210,225,.3)' : 'none')
    const shape = `<rect ${common} width="${el.w}" height="${el.h}" fill="${escapeXmlText(fill)}" ${el.line ? `stroke="${escapeXmlText(el.line)}"` : ''}/>`
    if (!el.text) return shape
    const lines = el.text.split(/\r?\n/).slice(0, 80)
    const fontSize = Math.max(8, Math.min(96, el.fontSize ?? 20))
    const lineHeight = fontSize * 1.28
    const anchor = el.align === 'center' ? 'middle' : el.align === 'right' ? 'end' : 'start'
    const tx = el.align === 'center' ? el.w / 2 : el.align === 'right' ? el.w - 8 : 8
    const startY = el.valign === 'middle'
      ? Math.max(fontSize, (el.h - (lines.length - 1) * lineHeight) / 2)
      : el.valign === 'bottom'
        ? Math.max(fontSize, el.h - (lines.length - 1) * lineHeight - 8)
        : fontSize + 6
    const text = lines.map((line, i) =>
      `<text x="${tx}" y="${startY + i * lineHeight}" text-anchor="${anchor}" font-family="Source Han Sans CN, Microsoft YaHei, sans-serif" font-size="${fontSize}" font-weight="${el.bold ? 700 : 400}" font-style="${el.italic ? 'italic' : 'normal'}" fill="${escapeXmlText(el.color ?? '#1f2937')}">${escapeXmlText(line.slice(0, 1000))}</text>`
    ).join('')
    return `${shape}<g ${common}>${text}</g>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="${escapeXmlText(background ?? '#ffffff')}"/>${body}</svg>`
}

interface PptxElementLike {
  name?: string
  attrs?: Record<string, string>
  children?: PptxElementLike[]
  text?: string
}

function pNode(node: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const value = node[key]
  return Array.isArray(value) ? value[0] as Record<string, unknown> | undefined : value as Record<string, unknown> | undefined
}

function pNodes(node: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const value = node[key]
  return Array.isArray(value) ? value as Record<string, unknown>[] : value ? [value as Record<string, unknown>] : []
}

function pText(node: Record<string, unknown>): string {
  const runs = pNodes(node, 'a:r').map((run) => {
    const t = pNode(run, 'a:t')
    return t ? xmlText(t) : ''
  })
  return runs.join('').replace(/\r/g, '')
}

function parseXfrm(node: Record<string, unknown>): { x: number; y: number; w: number; h: number; rotation?: number } {
  const spPr = pNode(node, 'p:spPr')
  const xfrm = pNode(node, 'a:xfrm') ?? pNode(node, 'p:xfrm') ?? (spPr ? pNode(spPr, 'a:xfrm') : undefined)
  const off = xfrm ? pNode(xfrm, 'a:off') : undefined
  const ext = xfrm ? pNode(xfrm, 'a:ext') : undefined
  const x = Number((off?.$ as Record<string, string> | undefined)?.x ?? 0)
  const y = Number((off?.$ as Record<string, string> | undefined)?.y ?? 0)
  const w = Number((ext?.$ as Record<string, string> | undefined)?.cx ?? 0)
  const h = Number((ext?.$ as Record<string, string> | undefined)?.cy ?? 0)
  const rot = Number((xfrm?.$ as Record<string, string> | undefined)?.rot ?? 0)
  return {
    x: Number.isFinite(x) ? x / 9525 : 0,
    y: Number.isFinite(y) ? y / 9525 : 0,
    w: Number.isFinite(w) ? w / 9525 : 0,
    h: Number.isFinite(h) ? h / 9525 : 0,
    ...(Number.isFinite(rot) && rot !== 0 ? { rotation: rot / 60000 } : {})
  }
}

export function pptxSlideGeometry(
  node: Record<string, unknown>,
  slideWidth: number,
  slideHeight: number
): { x: number; y: number; w: number; h: number; rotation?: number } {
  const geom = parseXfrm(node)
  // 没有显式 xfrm 的占位符继承版式；预览至少给一个可读区域，避免叠在左上角。
  if (geom.w <= 0 || geom.h <= 0) {
    return {
      x: Math.round(slideWidth * 0.08),
      y: Math.round(slideHeight * 0.08),
      w: Math.round(slideWidth * 0.84),
      h: Math.round(slideHeight * 0.28)
    }
  }
  return geom
}

export function parseCsvTable(text: string): string[][] {
  return parseDelimitedRows(text, detectCsvDelimiter(text))
}

function pShapeColor(node: Record<string, unknown>, fillKey: string): string | undefined {
  const props = pNode(node, 'p:spPr')
  const fill = props ? pNode(props, fillKey) : undefined
  const solid = fill ? pNode(fill, 'a:srgbClr') : undefined
  return solid?.$ && typeof (solid.$ as Record<string, string>).val === 'string'
    ? normalizeColor((solid.$ as Record<string, string>).val)
    : undefined
}

function pTextStyle(node: Record<string, unknown>): Pick<DocumentSlideElement, 'fontSize' | 'bold' | 'italic' | 'color' | 'align' | 'valign'> {
  const body = pNode(node, 'p:txBody')
  const bodyProps = body ? pNode(body, 'a:bodyPr') : undefined
  const firstP = body ? pNodes(body, 'a:p')[0] : undefined
  const pPr = firstP ? pNode(firstP, 'a:pPr') : undefined
  const r = firstP ? pNodes(firstP, 'a:r')[0] : undefined
  const rPr = r ? pNode(r, 'a:rPr') : undefined
  const size = Number((rPr?.$ as Record<string, string> | undefined)?.sz ?? NaN)
  const colorNode = rPr ? pNode(rPr, 'a:solidFill') : undefined
  const color = colorNode ? pNode(colorNode, 'a:srgbClr') : undefined
  const align = (pPr?.$ as Record<string, string> | undefined)?.algn
  const anchor = (bodyProps?.$ as Record<string, string> | undefined)?.anchor
  return {
    ...(Number.isFinite(size) && size > 0 ? { fontSize: size / 100 } : {}),
    ...((rPr?.$ as Record<string, string> | undefined)?.b === '1' ? { bold: true } : {}),
    ...((rPr?.$ as Record<string, string> | undefined)?.i === '1' ? { italic: true } : {}),
    ...(color?.$ && typeof (color.$ as Record<string, string>).val === 'string'
      ? { color: normalizeColor((color.$ as Record<string, string>).val) }
      : {}),
    ...(align === 'ctr' ? { align: 'center' as const } : align === 'r' ? { align: 'right' as const } : { align: 'left' as const }),
    ...(anchor === 'ctr' ? { valign: 'middle' as const } : anchor === 'b' ? { valign: 'bottom' as const } : { valign: 'top' as const })
  }
}

async function previewPptx(absPath: string, fingerprint: string): Promise<DocumentPreview> {
  const zip = await openZip(absPath)
  const parser = new PPTX2Json()
  let json: Record<string, unknown>
  try {
    json = await parser.toJson(absPath) as Record<string, unknown>
  } catch (error) {
    throw asPreviewError(error)
  }
  const presentation = (json['ppt/presentation.xml'] as Record<string, unknown> | undefined)?.['p:presentation'] as Record<string, unknown> | undefined
  const slideList = presentation ? pNode(presentation, 'p:sldIdLst') : undefined
  const ids = slideList ? pNodes(slideList, 'p:sldId') : []
  const presentationRels = json['ppt/_rels/presentation.xml.rels'] as Record<string, unknown> | undefined
  const relMap = new Map<string, string>()
  if (presentationRels) {
    const relRoot = pNode(presentationRels, 'Relationships')
    for (const rel of relRoot ? pNodes(relRoot, 'Relationship') : []) {
      const attrs = rel.$ as Record<string, string> | undefined
      if (attrs?.Id && attrs?.Target) relMap.set(attrs.Id, relTarget('ppt/presentation.xml', attrs.Target))
    }
  }
  const slidePaths = ids.map((id) => {
    const attrs = id.$ as Record<string, string> | undefined
    return attrs?.['r:id'] ? relMap.get(attrs['r:id']) ?? '' : ''
  }).filter(Boolean).slice(0, MAX_SLIDES)
  const sldSz = presentation ? pNode(presentation, 'p:sldSz') : undefined
  const widthPx = sldSz?.$ ? Math.round(Number((sldSz.$ as Record<string, string>).cx) / 9525) : 1280
  const heightPx = sldSz?.$ ? Math.round(Number((sldSz.$ as Record<string, string>).cy) / 9525) : 720
  const slides: DocumentSlide[] = []
  for (const slidePath of slidePaths) {
    const slideRoot = (json[slidePath] as Record<string, unknown> | undefined)?.['p:sld'] as Record<string, unknown> | undefined
    if (!slideRoot) continue
    const relPath = `ppt/slides/_rels/${slidePath.split('/').pop()}.rels`
    const relRoot = json[relPath] as Record<string, unknown> | undefined
    const rels = new Map<string, string>()
    if (relRoot) {
      const root = pNode(relRoot, 'Relationships')
      for (const rel of root ? pNodes(root, 'Relationship') : []) {
        const attrs = rel.$ as Record<string, string> | undefined
        if (attrs?.Id && attrs?.Target) rels.set(attrs.Id, relTarget(slidePath, attrs.Target))
      }
    }
    const tree = pNode(slideRoot, 'p:cSld') ? pNode(pNode(slideRoot, 'p:cSld')!, 'p:spTree') : undefined
    const elements: DocumentSlideElement[] = []
    if (tree) {
      const visit = async (parent: Record<string, unknown>): Promise<void> => {
        for (const [key, value] of Object.entries(parent)) {
          if (!['p:sp', 'p:pic', 'p:graphicFrame', 'p:grpSp'].includes(key)) continue
          const nodes = Array.isArray(value) ? value as Record<string, unknown>[] : [value as Record<string, unknown>]
          for (const node of nodes) {
            if (elements.length >= MAX_SLIDE_ELEMENTS) return
            const geom = pptxSlideGeometry(node, widthPx, heightPx)
            if (key === 'p:grpSp') {
              await visit(node)
              continue
            }
            if (key === 'p:pic') {
              const blip = pNode(node, 'p:blipFill') ? pNode(pNode(node, 'p:blipFill')!, 'a:blip') : undefined
              const embed = (blip?.$ as Record<string, string> | undefined)?.['r:embed']
              const target = embed ? rels.get(embed) : undefined
              const ext = target ? extname(target).toLowerCase() : ''
              if (target && /^\.(png|jpe?g|gif|webp|bmp)$/i.test(ext)) {
                const data = zip.file(target) ? await zip.file(target)!.async('base64') : ''
                if (data) {
                  elements.push({
                    kind: 'image',
                    ...geom,
                    src: `data:image/${ext === '.jpg' || ext === '.jpeg' ? 'jpeg' : ext.slice(1)};base64,${data}`
                  })
                }
              }
              continue
            }
            if (key === 'p:graphicFrame') {
              const tbl = pNode(node, 'a:graphic') ? pNode(pNode(node, 'a:graphic')!, 'a:graphicData') : undefined
              const table = tbl ? pNode(tbl, 'a:tbl') : undefined
              if (table) {
                const cols = pNodes(table, 'a:tblGrid').flatMap((grid) => pNodes(grid, 'a:gridCol').map((col) => Math.round(Number((col.$ as Record<string, string>)?.w ?? 0) / 9525)))
                const rowNodes = pNodes(table, 'a:tr')
                const rows = rowNodes.map((row) => Math.round(Number((row.$ as Record<string, string>)?.h ?? 0) / 9525))
                const cells: DocumentSheetCell[] = []
                rowNodes.forEach((row, ri) => {
                  pNodes(row, 'a:tc').forEach((cell, ci) => {
                    const text = pNodes(cell, 'a:txBody').flatMap((body) => pNodes(body, 'a:p').map(pText)).join('\n')
                    if (text) cells.push({ row: ri + 1, col: ci + 1, value: text })
                  })
                })
                elements.push({ kind: 'table', ...geom, table: { columns: cols.length ? cols : [Math.round(geom.w / 3), Math.round(geom.w / 3), Math.round(geom.w / 3)], rows: rows.length ? rows : [32], cells } })
              }
              continue
            }
            const text = pNodes(node, 'p:txBody').flatMap((body) => pNodes(body, 'a:p').map(pText)).join('\n')
            const style = pTextStyle(node)
            const fill = pShapeColor(node, 'a:solidFill')
            const line = pShapeColor(node, 'a:ln')
            elements.push({
              kind: text ? 'text' : 'shape',
              ...geom,
              ...(text ? { text } : {}),
              ...(fill ? { fill } : {}),
              ...(line ? { line } : {}),
              ...style
            })
          }
        }
      }
      await visit(tree)
    }
    slides.push({ width: widthPx, height: heightPx, elements })
  }
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'PPTX',
    shape: 'slides',
    fingerprint,
    generatedAt: new Date().toISOString(),
    slideCount: slidePaths.length,
    slides,
    ...(ids.length > MAX_SLIDES ? { truncated: true } : {})
  }
}

function localName(value: unknown): string {
  return String(value ?? '').split(':').pop() ?? ''
}

function docxXmlNode<T extends object>(node: T): T {
  return new Proxy(node, {
    get(target, key, receiver) {
      if (key === 'localName' || key === 'nodeName') return localName(Reflect.get(target, key, receiver))
      if (key === 'firstElementChild' || key === 'firstChild') {
        const child = Reflect.get(target, key, receiver)
        return child ? docxXmlNode(child) : child
      }
      if (key === 'childNodes' || key === 'attributes') {
        const list = Reflect.get(target, key, receiver) as {
          length: number
          item(index: number): object | null
        }
        return new Proxy(list, {
          get(listTarget, listKey) {
            if (listKey === 'item') {
              return (index: number) => {
                const item = listTarget.item(index)
                return item ? docxXmlNode(item) : item
              }
            }
            const value = Reflect.get(listTarget, listKey)
            return typeof value === 'function' ? value.bind(listTarget) : value
          }
        })
      }
      const value = Reflect.get(target, key, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

/**
 * docx-preview 依赖挂在 globalThis 上的 window/document,而全局只有一份:
 * 并发解析两份 DOCX 会互相顶掉注入的 DOM。这里串行化,同一时刻只允许一个在跑。
 */
let docxRenderQueue: Promise<unknown> = Promise.resolve()

function docxHtml(absPath: string): Promise<{ html: string; pageCount: number }> {
  const run = docxRenderQueue.then(() => renderDocxHtml(absPath), () => renderDocxHtml(absPath))
  docxRenderQueue = run.catch(() => undefined)
  return run
}

async function renderDocxHtml(absPath: string): Promise<{ html: string; pageCount: number }> {
const { parseAsync, renderDocument } = await import('docx-preview')
const data = await readFile(absPath)
const dom = parseHTML('<!doctype html><html><body></body></html>')
const globalObject = globalThis as unknown as Record<string, unknown> & {
  window?: unknown
  document?: unknown
  Node?: unknown
  DOMParser?: unknown
  XMLSerializer?: unknown
  Range?: unknown
  requestAnimationFrame?: unknown
      FileReader?: unknown
}
const previous = {
  window: globalObject.window,
  document: globalObject.document,
  Node: globalObject.Node,
  DOMParser: globalObject.DOMParser,
  XMLSerializer: globalObject.XMLSerializer,
  Range: globalObject.Range,
      requestAnimationFrame: globalObject.requestAnimationFrame,
      FileReader: globalObject.FileReader
}
globalObject.window = dom.window
globalObject.document = dom.document
globalObject.Node = dom.Node
globalObject.DOMParser = class extends dom.window.DOMParser {
  parseFromString(text: string, type: string) {
    return docxXmlNode(super.parseFromString(text, type))
  }
}
globalObject.XMLSerializer = class {
  serializeToString(node: unknown): string {
    return String(node)
  }
}
globalObject.Range = dom.window.Range
globalObject.requestAnimationFrame = (callback: (time: number) => void) => setTimeout(() => callback(Date.now()), 0)
    // docx-preview 的 useBase64URL 走 FileReader.readAsDataURL,Node 里没有这个 API;
    // 缺了它文档内图片会静默变成没有 src 的 <img>。
    globalObject.FileReader = class {
      result: string | null = null
      onload: ((event: { target: unknown }) => void) | null = null
      onloadend: ((event: { target: unknown }) => void) | null = null
      onerror: ((event: { target: unknown }) => void) | null = null
      readAsDataURL(blob: Blob): void {
        blob.arrayBuffer().then(
          (buffer) => {
            this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`
            this.onload?.({ target: this })
            this.onloadend?.({ target: this })
          },
          () => {
            this.onerror?.({ target: this })
            this.onloadend?.({ target: this })
          }
        )
      }
    }
try {
  const options = {
    renderHeaders: true,
    renderFooters: true,
    renderFootnotes: true,
    renderEndnotes: true,
    renderComments: false,
    renderAltChunks: false,
    renderChanges: false,
    useBase64URL: true,
    ignoreLastRenderedPageBreak: false,
    breakPages: true,
    ignoreWidth: false,
    ignoreHeight: false,
    ignoreFonts: false,
    inWrapper: true,
    className: 'docx'
  }
  const parsed = await parseAsync(data, options)
  const nodes = await renderDocument(parsed, options)
  const html = nodes
    .filter((node) => node.nodeType !== 8)
    .map((node) => String(node))
    .join('')
  if (html.length > MAX_DOCUMENT_HTML) {
    throw new DocumentPreviewError('rendered DOCX HTML exceeds limit', 'too-large')
  }
  // docx-preview 每页一个 <section class="docx">,外层还有 class="docx-wrapper" 包裹,
  // 只数 section,否则页数会永远多 1。
  const pageCount = Math.max(1, (html.match(/<section[^>]+class="[^"]*\bdocx\b[^"]*"/g) ?? []).length)
  return { html, pageCount }
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete globalObject[key]
    else globalObject[key] = value
  }
}
}

function sanitizeDocumentHtml(html: string): string {
  const sanitized = sanitizeHtml(html, {
    allowedTags: [
      'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'thead',
      'tbody', 'tfoot', 'tr', 'th', 'td', 'img', 'br', 'hr', 'pre', 'code', 'blockquote', 'em', 'strong',
      'b', 'i', 'u', 's', 'sup', 'sub', 'section', 'header', 'footer', 'style'
    ],
    allowedAttributes: {
      '*': ['class', 'style', 'data-page-number'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan']
    },
    allowedSchemes: ['data'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    allowVulnerableTags: true,
    disallowedTagsMode: 'discard'
  })
  // CSS 中的 url()/expression() 能绕过标签级白名单去取远程资源。
  // 文档内容只保留颜色、字体、边框等声明；图片由 data: URL 保留。
  return sanitized
    .replace(/@import[\s\S]*?;/gi, '')
    .replace(/(?<!-)url\s*\([^)]*\)/gi, 'none')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
}

/** 旧版 Word 常用大量空段落做页首留白；缩略图与首屏应跳过它们。 */
export function trimLeadingBlankDocHtml(html: string): string {
  const styles = /^(?:\s*<style\b[^>]*>[\s\S]*?<\/style>)+/i.exec(html)?.[0] ?? ''
  const body = html.slice(styles.length).replace(
    /^(?:\s*<p\b[^>]*>(?:\s|&nbsp;|<br\s*\/?>)*<\/p>)+/i,
    ''
  )
  return styles + body
}

async function previewDoc(absPath: string, fingerprint: string): Promise<DocumentPreview> {
  const file = await stat(absPath)
  if (!file.isFile()) throw new DocumentPreviewError('DOC source is missing', 'corrupt')
  if (file.size > MAX_DOC_BYTES) throw new DocumentPreviewError('DOC exceeds size limit', 'too-large')
  const parsed = parseMsDoc(new Uint8Array(await readFile(absPath)), {
    maxPictureBytes: MAX_DOC_PICTURE_BYTES
  })
  if (parsed.meta.fib.fEncrypted) throw new DocumentPreviewError('DOC is encrypted', 'encrypted')
  if (parsed.assets.some((asset) => asset.bytes.byteLength > MAX_DOC_PICTURE_BYTES)) {
    throw new DocumentPreviewError('DOC embedded asset exceeds limit', 'too-large')
  }
  const rendered = renderMsDoc(parsed, {
    externalLinkPolicy: 'block',
    externalResourcePolicy: 'block'
  })
  const html = `<style>${rendered.css}</style>${rendered.html}`
  if (html.length > MAX_DOCUMENT_HTML) throw new DocumentPreviewError('rendered DOC HTML exceeds limit', 'too-large')
  const safe = trimLeadingBlankDocHtml(sanitizeDocumentHtml(html))
  const pageCount = Math.max(1, (rendered.html.match(/msdoc-page-break/g) ?? []).length + 1)
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'DOC',
    shape: 'doc',
    fingerprint,
    generatedAt: new Date().toISOString(),
    pageCount,
    html: safe,
    ...(rendered.warnings.length
      ? { unsupported: rendered.warnings.slice(0, 20).map((warning) => warning.message) }
      : {})
  }
}

async function previewDocx(absPath: string, fingerprint: string): Promise<DocumentPreview> {
  await openZip(absPath)
  const { html, pageCount } = await docxHtml(absPath)
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'DOCX',
    shape: 'doc',
    fingerprint,
    generatedAt: new Date().toISOString(),
    pageCount,
    html: sanitizeDocumentHtml(html)
  }
}

// ---------- ODF(ODT/ODP)：直接解析 content.xml，避免 34 MB 的第三方转换器 ----------

type Zip = Awaited<ReturnType<typeof openZip>>

const MAX_ODF_XML_BYTES = 64 * 1024 * 1024
const MAX_ODF_NODES = 80_000
const MAX_ODF_TABLE_CELLS = 20_000
const MAX_RTF_BYTES = 32 * 1024 * 1024
const MAX_RTF_IMAGE_BYTES = 8 * 1024 * 1024
const ODF_PX_PER_UNIT: Record<string, number> = {
  cm: 37.79527559055118,
  mm: 3.779527559055118,
  in: 96,
  pt: 96 / 72,
  pc: 16,
  px: 1
}

/** xmldom 的 Document/Element 类型依赖 DOM lib，主进程 tsconfig 只有 ES2022，这里用结构类型。 */
interface XmlElementLike {
  nodeType: number
  nodeName: string
  localName?: string | null
  textContent?: string | null
  childNodes: ArrayLike<XmlElementLike | undefined>
  attributes?: ArrayLike<{ name: string; value: string }>
  getAttribute(name: string): string | null
}

function xmlLocal(node: XmlElementLike): string {
  return String(node.localName ?? node.nodeName.split(':').pop() ?? '').toLowerCase()
}

function xmlChildren(node: XmlElementLike, name?: string): XmlElementLike[] {
  const out: XmlElementLike[] = []
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (!child || child.nodeType !== 1) continue
    if (!name || xmlLocal(child) === name) out.push(child)
  }
  return out
}

function xmlAttr(node: XmlElementLike, ...names: string[]): string | null {
  for (const name of names) {
    const value = node.getAttribute(name)
    if (value) return value
  }
  const attrs = node.attributes
  if (!attrs) return null
  const wanted = new Set(names.map((name) => name.split(':').pop()?.toLowerCase()))
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i]
    const local = (attr.name.split(':').pop() ?? '').toLowerCase()
    if (wanted.has(local)) return attr.value
  }
  return null
}

function xmlDescendants(root: XmlElementLike, name: string, limit = MAX_ODF_NODES): XmlElementLike[] {
  const out: XmlElementLike[] = []
  const top = xmlChildren(root)
  const stack: XmlElementLike[] = []
  for (let i = top.length - 1; i >= 0; i--) stack.push(top[i])
  for (let node = stack.pop(); node && out.length < limit; node = stack.pop()) {
    if (xmlLocal(node) === name) out.push(node)
    const children = xmlChildren(node)
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i])
  }
  return out
}

function parseXmlRoot(xml: string): XmlElementLike {
  const errors: string[] = []
  const parser = new DOMParser({
    onError: (level, message) => {
      if (level === 'fatalError' && errors.length < 4) errors.push(message)
    }
  })
  const doc = parser.parseFromString(xml, 'application/xml')
  if (errors.length) throw new DocumentPreviewError(`ODF XML is malformed: ${errors[0]}`, 'corrupt')
  const root = doc.documentElement as unknown as XmlElementLike | undefined
  if (!root) throw new DocumentPreviewError('ODF XML has no root element', 'corrupt')
  return root
}

interface OdfStyle {
  parent?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  fontSize?: string
  align?: 'left' | 'center' | 'right' | 'justify'
  marginLeft?: string
  textIndent?: string
  spacingBefore?: string
  spacingAfter?: string
  background?: string
}

function odfCssLength(value: string | null): string | undefined {
  const trimmed = value?.trim() ?? ''
  return /^-?[0-9.]+(?:pt|px|cm|mm|in|em|%)$/.test(trimmed) ? trimmed : undefined
}

function odfLengthPx(value: string | null | undefined, fallback: number): number {
  if (!value) return fallback
  const match = /^(-?[0-9.]+)\s*(cm|mm|in|pt|pc|px)?$/i.exec(value.trim())
  if (!match) return fallback
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return fallback
  return amount * (ODF_PX_PER_UNIT[(match[2] ?? 'cm').toLowerCase()] ?? ODF_PX_PER_UNIT.cm)
}

function readOdfStyles(root: XmlElementLike, into: Map<string, OdfStyle>): void {
  for (const styleNode of xmlDescendants(root, 'style')) {
    const name = xmlAttr(styleNode, 'style:name')
    if (!name || into.has(name)) continue
    const style: OdfStyle = {}
    const parent = xmlAttr(styleNode, 'style:parent-style-name')
    if (parent) style.parent = parent
    for (const props of xmlChildren(styleNode)) {
      switch (xmlLocal(props)) {
        case 'text-properties': {
          const weight = xmlAttr(props, 'fo:font-weight')
          if (weight && /^(bold|[6-9]00)$/i.test(weight)) style.bold = true
          const decor = xmlAttr(props, 'fo:text-decoration')
          const fontStyle = xmlAttr(props, 'fo:font-style')
          if (fontStyle && /^(italic|oblique)$/i.test(fontStyle)) style.italic = true
          if (decor?.includes('underline')) style.underline = true
          const underline = xmlAttr(props, 'style:text-underline-style')
          if (underline && underline !== 'none') style.underline = true
          const color = normalizeColor(xmlAttr(props, 'fo:color') ?? '')
          if (color) style.color = color
          const size = odfCssLength(xmlAttr(props, 'fo:font-size'))
          if (size) style.fontSize = size
          break
        }
        case 'paragraph-properties': {
          const align = (xmlAttr(props, 'fo:text-align') ?? '').toLowerCase()
          if (align === 'center') style.align = 'center'
          else if (align === 'end' || align === 'right') style.align = 'right'
          else if (align === 'justify') style.align = 'justify'
          else if (align === 'start' || align === 'left') style.align = 'left'
          const marginLeft = odfCssLength(xmlAttr(props, 'fo:margin-left'))
          if (marginLeft) style.marginLeft = marginLeft
          const textIndent = odfCssLength(xmlAttr(props, 'fo:text-indent'))
          if (textIndent) style.textIndent = textIndent
          const before = odfCssLength(xmlAttr(props, 'fo:margin-top'))
          if (before) style.spacingBefore = before
          const after = odfCssLength(xmlAttr(props, 'fo:margin-bottom'))
          if (after) style.spacingAfter = after
          break
        }
        case 'table-cell-properties':
        case 'drawing-page-properties': {
          const background = normalizeColor(
            xmlAttr(props, 'fo:background-color') ?? xmlAttr(props, 'draw:fill-color') ?? ''
          )
          if (background) style.background = background
          break
        }
        default:
          break
      }
    }
    into.set(name, style)
  }
}

function resolveOdfStyle(styles: Map<string, OdfStyle>, name: string | null, depth = 0): OdfStyle {
  if (!name || depth > 8) return {}
  const own = styles.get(name)
  if (!own) return {}
  const inherited = own.parent ? resolveOdfStyle(styles, own.parent, depth + 1) : {}
  return { ...inherited, ...own }
}

function odfTextCss(style: OdfStyle): string {
  const parts: string[] = []
  if (style.bold) parts.push('font-weight:700')
  if (style.italic) parts.push('font-style:italic')
  if (style.underline) parts.push('text-decoration:underline')
  if (style.color) parts.push(`color:${style.color}`)
  if (style.fontSize) parts.push(`font-size:${style.fontSize}`)
  return parts.join(';')
}

function odfParaCss(style: OdfStyle): string {
  const parts: string[] = []
  if (style.align) parts.push(`text-align:${style.align}`)
  if (style.marginLeft) parts.push(`margin-left:${style.marginLeft}`)
  if (style.textIndent) parts.push(`text-indent:${style.textIndent}`)
  if (style.spacingBefore) parts.push(`margin-top:${style.spacingBefore}`)
  if (style.spacingAfter) parts.push(`margin-bottom:${style.spacingAfter}`)
  return parts.join(';')
}

interface OdfContext {
  zip: Zip
  styles: Map<string, OdfStyle>
  nodes: number
  cells: number
  images: number
  truncated: boolean
}

function odfCount(ctx: OdfContext): void {
  ctx.nodes += 1
  if (ctx.nodes > MAX_ODF_NODES) throw new DocumentPreviewError('ODF document is too complex', 'too-large')
}

async function openOdfXml(zip: Zip, part: string): Promise<XmlElementLike> {
  const file = zip.file(part)
  if (!file) throw new DocumentPreviewError(`ODF part ${part} is missing`, 'corrupt')
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (typeof size === 'number' && size > MAX_ODF_XML_BYTES) {
    throw new DocumentPreviewError('ODF XML exceeds limit', 'too-large')
  }
  const xml = await file.async('string')
  if (xml.length > MAX_ODF_XML_BYTES) throw new DocumentPreviewError('ODF XML exceeds limit', 'too-large')
  return parseXmlRoot(xml)
}

async function odfStylesFor(zip: Zip, content: XmlElementLike): Promise<Map<string, OdfStyle>> {
  const styles = new Map<string, OdfStyle>()
  if (zip.file('styles.xml')) readOdfStyles(await openOdfXml(zip, 'styles.xml'), styles)
  // content.xml 的自动样式优先级高于命名样式，后写覆盖。
  readOdfStyles(content, styles)
  return styles
}

async function odfImageSrc(ctx: OdfContext, href: string | null): Promise<string | null> {
  if (!href || ctx.images >= 200) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.includes('..')) return null
  const target = href.replace(/^\.\//, '')
  const file = ctx.zip.file(target) ?? ctx.zip.file(decodeURIComponent(target))
  if (!file) return null
  const ext = extname(target).toLowerCase()
  const mime = ext === '.png' ? 'image/png'
    : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
          : ext === '.svg' ? 'image/svg+xml'
            : ''
  if (!mime) return null
  const size = (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
  if (typeof size === 'number' && size > 16 * 1024 * 1024) return null
  ctx.images += 1
  return `data:${mime};base64,${await file.async('base64')}`
}

async function odfFrameImage(node: XmlElementLike, ctx: OdfContext): Promise<string | null> {
  const image = xmlChildren(node, 'image')[0] ?? node
  return odfImageSrc(ctx, xmlAttr(image, 'xlink:href', 'href'))
}

async function odtInline(node: XmlElementLike, ctx: OdfContext): Promise<string> {
  let html = ''
  for (let i = 0; i < node.childNodes.length; i++) {
    const child = node.childNodes[i]
    if (!child) continue
    if (child.nodeType === 3 || child.nodeType === 4) {
      html += escapeXmlText(child.textContent ?? '')
      continue
    }
    if (child.nodeType !== 1) continue
    odfCount(ctx)
    switch (xmlLocal(child)) {
      case 'span': {
        const inner = await odtInline(child, ctx)
        const css = odfTextCss(resolveOdfStyle(ctx.styles, xmlAttr(child, 'text:style-name')))
        html += css ? `<span style="${css}">${inner}</span>` : inner
        break
      }
      case 's': {
        const count = Number(xmlAttr(child, 'text:c') ?? 1)
        html += '&nbsp;'.repeat(Math.min(80, Math.max(1, Number.isFinite(count) ? Math.trunc(count) : 1)))
        break
      }
      case 'tab':
        html += '&emsp;'
        break
      case 'line-break':
      case 'br':
        html += '<br>'
        break
      case 'frame':
      case 'image': {
        const src = await odfFrameImage(child, ctx)
        if (src) html += `<img src="${src}" alt="">`
        break
      }
      case 'bookmark':
      case 'soft-page-break':
        break
      default:
        html += await odtInline(child, ctx)
        break
    }
  }
  return html
}

async function odtList(node: XmlElementLike, ctx: OdfContext): Promise<string> {
  const ordered = /number/i.test(xmlAttr(node, 'text:style-name') ?? '')
  const tag = ordered ? 'ol' : 'ul'
  let items = ''
  for (const item of xmlChildren(node, 'list-item')) {
    odfCount(ctx)
    items += `<li>${await odtBlocks(item, ctx)}</li>`
  }
  return `<${tag}>${items}</${tag}>`
}

async function odtTable(node: XmlElementLike, ctx: OdfContext): Promise<string> {
  const rowNodes: XmlElementLike[] = []
  const collect = (parent: XmlElementLike): void => {
    for (const child of xmlChildren(parent)) {
      const local = xmlLocal(child)
      if (local === 'table-row') rowNodes.push(child)
      else if (local === 'table-header-rows' || local === 'table-row-group' || local === 'table-rows') collect(child)
    }
  }
  collect(node)
  let rowsHtml = ''
  for (const rowNode of rowNodes.slice(0, MAX_ROWS)) {
    let cellsHtml = ''
    let column = 0
    for (const cell of xmlChildren(rowNode)) {
      const local = xmlLocal(cell)
      if (local !== 'table-cell' && local !== 'covered-table-cell') continue
      const repeatRaw = Number(xmlAttr(cell, 'table:number-columns-repeated') ?? 1)
      const repeat = Math.min(50, MAX_COLS, Number.isFinite(repeatRaw) ? Math.max(1, Math.trunc(repeatRaw)) : 1)
      const spanRaw = Number(xmlAttr(cell, 'table:number-columns-spanned') ?? 1)
      const rowSpanRaw = Number(xmlAttr(cell, 'table:number-rows-spanned') ?? 1)
      const span = Number.isFinite(spanRaw) ? Math.min(MAX_COLS, Math.max(1, Math.trunc(spanRaw))) : 1
      const rowSpan = Number.isFinite(rowSpanRaw) ? Math.min(MAX_ROWS, Math.max(1, Math.trunc(rowSpanRaw))) : 1
      const style = resolveOdfStyle(ctx.styles, xmlAttr(cell, 'table:style-name'))
      const attrs = `${span > 1 ? ` colspan="${span}"` : ''}${rowSpan > 1 ? ` rowspan="${rowSpan}"` : ''}${style.background ? ` style="background-color:${style.background}"` : ''}`
      const content = local === 'covered-table-cell' ? '' : await odtBlocks(cell, ctx)
      ctx.cells += repeat
      if (ctx.cells > MAX_ODF_TABLE_CELLS) {
        ctx.truncated = true
        break
      }
      for (let i = 0; i < repeat && column < MAX_COLS; i++) {
        cellsHtml += `<td${attrs}>${content}</td>`
        column += 1
      }
    }
    rowsHtml += `<tr>${cellsHtml}</tr>`
  }
  return `<table>${rowsHtml}</table>`
}

async function odtBlocks(node: XmlElementLike, ctx: OdfContext): Promise<string> {
  let html = ''
  for (const child of xmlChildren(node)) {
    odfCount(ctx)
    const local = xmlLocal(child)
    switch (local) {
      case 'p': {
        const css = odfParaCss(resolveOdfStyle(ctx.styles, xmlAttr(child, 'text:style-name')))
        html += `<p${css ? ` style="${css}"` : ''}>${await odtInline(child, ctx)}</p>`
        break
      }
      case 'h': {
        const levelRaw = Number(xmlAttr(child, 'text:outline-level') ?? 1)
        const level = Number.isFinite(levelRaw) ? Math.min(6, Math.max(1, Math.trunc(levelRaw))) : 1
        const css = odfParaCss(resolveOdfStyle(ctx.styles, xmlAttr(child, 'text:style-name')))
        html += `<h${level}${css ? ` style="${css}"` : ''}>${await odtInline(child, ctx)}</h${level}>`
        break
      }
      case 'list':
        html += await odtList(child, ctx)
        break
      case 'table':
        html += await odtTable(child, ctx)
        break
      case 'section':
      case 'list-item':
      case 'index-body':
        html += await odtBlocks(child, ctx)
        break
      case 'frame': {
        const src = await odfFrameImage(child, ctx)
        if (src) html += `<p><img src="${src}" alt=""></p>`
        break
      }
      case 'soft-page-break':
        html += '<hr>'
        break
      default:
        break
    }
  }
  return html
}

function assertDocumentHtmlBudget(html: string): void {
  if (html.length > MAX_DOCUMENT_HTML) throw new DocumentPreviewError('rendered document HTML exceeds limit', 'too-large')
}

async function previewOdt(zip: Zip, fingerprint: string): Promise<DocumentPreview> {
  const content = await openOdfXml(zip, 'content.xml')
  const styles = await odfStylesFor(zip, content)
  const body = xmlDescendants(content, 'body')[0]
  const textNode = body ? xmlChildren(body, 'text')[0] : undefined
  if (!textNode) throw new DocumentPreviewError('ODF text body is missing', 'corrupt')
  const ctx: OdfContext = { zip, styles, nodes: 0, cells: 0, images: 0, truncated: false }
  const html = sanitizeDocumentHtml(await odtBlocks(textNode, ctx))
  assertDocumentHtmlBudget(html)
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'ODT',
    shape: 'doc',
    fingerprint,
    generatedAt: new Date().toISOString(),
    pageCount: Math.max(1, xmlDescendants(content, 'soft-page-break').length + 1),
    html,
    ...(ctx.truncated ? { truncated: true } : {})
  }
}

function odpGeometry(node: XmlElementLike): { x: number; y: number; w: number; h: number } | null {
  const x = odfLengthPx(xmlAttr(node, 'svg:x'), NaN)
  const y = odfLengthPx(xmlAttr(node, 'svg:y'), NaN)
  const w = odfLengthPx(xmlAttr(node, 'svg:width'), NaN)
  const h = odfLengthPx(xmlAttr(node, 'svg:height'), NaN)
  if (![x, y, w, h].every((value) => Number.isFinite(value)) || w <= 0 || h <= 0) return null
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }
}

function odpTable(node: XmlElementLike, geom: { w: number; h: number }): DocumentSlideElement['table'] {
  const rowNodes = xmlDescendants(node, 'table-row', MAX_ROWS)
  const columnNodes = xmlDescendants(node, 'table-column', MAX_COLS)
  const columnCount = Math.max(
    1,
    Math.min(MAX_COLS, columnNodes.reduce((sum, col) => {
      const repeat = Number(xmlAttr(col, 'table:number-columns-repeated') ?? 1)
      return sum + (Number.isFinite(repeat) ? Math.max(1, Math.trunc(repeat)) : 1)
    }, 0)),
    ...rowNodes.map((row) => xmlChildren(row).filter((cell) => ['table-cell', 'covered-table-cell'].includes(xmlLocal(cell))).length)
  )
  const columns = columnNodes
    .map((col) => Math.round(odfLengthPx(xmlAttr(col, 'style:column-width'), 0)))
    .filter((width) => width > 0)
  while (columns.length < columnCount) columns.push(Math.max(24, Math.round(geom.w / columnCount)))
  const rows = rowNodes.map((row) => Math.round(odfLengthPx(xmlAttr(row, 'style:row-height'), 0)))
  const rowHeight = Math.max(18, Math.round(geom.h / Math.max(1, rows.length)))
  for (let i = 0; i < rows.length; i++) if (rows[i] <= 0) rows[i] = rowHeight
  const cells: DocumentSheetCell[] = []
  rowNodes.forEach((row, rowIndex) => {
    let column = 0
    for (const cell of xmlChildren(row)) {
      if (xmlLocal(cell) !== 'table-cell') continue
      const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text && column < columnCount) cells.push({ row: rowIndex + 1, col: column + 1, value: text })
      column += 1
    }
  })
  return { columns: columns.slice(0, columnCount), rows, cells }
}

async function odpElement(
  node: XmlElementLike,
  ctx: OdfContext,
  geom: { x: number; y: number; w: number; h: number }
): Promise<DocumentSlideElement | null> {
  const style = resolveOdfStyle(ctx.styles, xmlAttr(node, 'draw:style-name'))
  const fill = normalizeColor(xmlAttr(node, 'draw:fill-color') ?? '') ?? style.background
  const line = normalizeColor(xmlAttr(node, 'svg:stroke-color') ?? '')
  const image = xmlChildren(node, 'image')[0]
  if (image) {
    const src = await odfImageSrc(ctx, xmlAttr(image, 'xlink:href', 'href'))
    if (src) return { kind: 'image', ...geom, src }
  }
  const table = xmlChildren(node, 'table')[0]
  if (table) return { kind: 'table', ...geom, table: odpTable(table, geom) }
  const textBox = xmlChildren(node, 'text-box')[0]
  const paragraphs = textBox ? xmlDescendants(textBox, 'p', 200) : []
  const listParagraphs = new Set<XmlElementLike>()
  if (textBox) {
    for (const list of xmlDescendants(textBox, 'list', 200)) {
      for (const item of xmlDescendants(list, 'p', 200)) listParagraphs.add(item)
    }
  }
  const text = paragraphs
    .map((p) => `${listParagraphs.has(p) ? '\u2022 ' : ''}${p.textContent ?? ''}`)
    .join('\n')
    .replace(/\u00a0/g, ' ')
    .trim()
  const paragraphStyle = resolveOdfStyle(ctx.styles, xmlAttr(paragraphs[0] ?? node, 'text:style-name'))
  const runStyle = paragraphs[0]
    ? resolveOdfStyle(ctx.styles, xmlAttr(xmlChildren(paragraphs[0], 'span')[0] ?? paragraphs[0], 'text:style-name'))
    : {}
  const fontSize = paragraphStyle.fontSize ?? runStyle.fontSize
  return {
    kind: text ? 'text' : 'shape',
    ...geom,
    ...(text ? { text } : {}),
    ...(fill ? { fill } : {}),
    ...(line ? { line } : {}),
    ...(runStyle.color ? { color: runStyle.color } : {}),
    ...(runStyle.bold || paragraphStyle.bold ? { bold: true } : {}),
    ...(runStyle.italic || paragraphStyle.italic ? { italic: true } : {}),
    ...(fontSize ? { fontSize: Math.min(96, Math.max(8, Math.round(odfLengthPx(fontSize, 20)))) } : {}),
    ...(paragraphStyle.align === 'center' || paragraphStyle.align === 'right'
      ? { align: paragraphStyle.align }
      : { align: 'left' as const })
  }
}

async function odpElements(
  parent: XmlElementLike,
  ctx: OdfContext
): Promise<{ z: number; element: DocumentSlideElement }[]> {
  const out: { z: number; element: DocumentSlideElement }[] = []
  for (const child of xmlChildren(parent)) {
    odfCount(ctx)
    const local = xmlLocal(child)
    if (local === 'g' || local === 'section') {
      out.push(...await odpElements(child, ctx))
      continue
    }
    if (!['frame', 'custom-shape', 'rect', 'ellipse', 'caption', 'connector', 'line', 'polygon', 'path'].includes(local)) continue
    const geom = odpGeometry(child)
    if (!geom) continue
    const element = await odpElement(child, ctx, geom)
    if (!element) continue
    const zRaw = Number(xmlAttr(child, 'draw:z-index') ?? 0)
    out.push({ z: Number.isFinite(zRaw) ? zRaw : 0, element })
    if (out.length >= MAX_SLIDE_ELEMENTS) break
  }
  return out
}

async function odpPageSize(zip: Zip, content: XmlElementLike): Promise<{ width: number; height: number }> {
  const roots = [content]
  if (zip.file('styles.xml')) roots.push(await openOdfXml(zip, 'styles.xml'))
  const layouts = new Map<string, { width: number; height: number }>()
  const masters = new Map<string, string>()
  for (const root of roots) {
    for (const layout of xmlDescendants(root, 'page-layout', 256)) {
      const name = xmlAttr(layout, 'style:name')
      const props = xmlChildren(layout, 'page-layout-properties')[0]
      if (!name || !props) continue
      const width = odfLengthPx(xmlAttr(props, 'fo:page-width'), 0)
      const height = odfLengthPx(xmlAttr(props, 'fo:page-height'), 0)
      if (width > 0 && height > 0) layouts.set(name, { width, height })
    }
    for (const master of xmlDescendants(root, 'master-page', 256)) {
      const name = xmlAttr(master, 'style:name')
      const layout = xmlAttr(master, 'style:page-layout-name')
      if (name && layout) masters.set(name, layout)
    }
  }
  const firstPage = xmlDescendants(content, 'page', 1)[0]
  const masterName = firstPage ? xmlAttr(firstPage, 'draw:master-page-name') : null
  const layoutName = masterName ? masters.get(masterName) : undefined
  const matched = layoutName ? layouts.get(layoutName) : undefined
  if (matched) return { width: Math.round(matched.width), height: Math.round(matched.height) }
  // 兜底取面积最大的横向版式：ODP 演示文稿几乎都是横向。
  let best: { width: number; height: number } | null = null
  for (const layout of layouts.values()) {
    if (layout.width <= layout.height) continue
    if (!best || layout.width * layout.height > best.width * best.height) best = layout
  }
  if (best) return { width: Math.round(best.width), height: Math.round(best.height) }
  return { width: 1280, height: 720 }
}

async function previewOdp(zip: Zip, fingerprint: string): Promise<DocumentPreview> {
  const content = await openOdfXml(zip, 'content.xml')
  const styles = await odfStylesFor(zip, content)
  const { width, height } = await odpPageSize(zip, content)
  const presentation = xmlDescendants(content, 'presentation')[0] ?? content
  const pageNodes = xmlChildren(presentation, 'page').slice(0, MAX_SLIDES)
  const slides: DocumentSlide[] = []
  for (const page of pageNodes) {
    const ctx: OdfContext = { zip, styles, nodes: 0, cells: 0, images: 0, truncated: false }
    const pageStyle = resolveOdfStyle(styles, xmlAttr(page, 'draw:style-name'))
    const items = await odpElements(page, ctx)
    items.sort((a, b) => a.z - b.z)
    slides.push({
      width,
      height,
      elements: items.map((item) => item.element),
      ...(pageStyle.background ? { background: pageStyle.background } : {})
    })
  }
  if (!slides.length) throw new DocumentPreviewError('ODF presentation has no slides', 'corrupt')
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'ODP',
    shape: 'slides',
    fingerprint,
    generatedAt: new Date().toISOString(),
    slideCount: pageNodes.length,
    slides,
    ...(xmlChildren(presentation, 'page').length > MAX_SLIDES ? { truncated: true } : {})
  }
}

async function previewOdf(absPath: string, fingerprint: string, format: string): Promise<DocumentPreview> {
  const zip = await openZip(absPath)
  return format === 'ODP' ? previewOdp(zip, fingerprint) : previewOdt(zip, fingerprint)
}

// ---------- RTF：自写子集解析，第三方包都不支持表格 ----------

const RTF_SKIP_DESTINATIONS = new Set([
  'info', 'stylesheet', 'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'themedata',
  'colorschememapping', 'datastore', 'latentstyles', 'xmlnstbl', 'filetbl', 'revtbl', 'fldinst',
  'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'footnote', 'annotation', 'atnid', 'atnauthor', 'object', 'shpinst', 'shprslt', 'nonshppict'
])

const RTF_FONT_CHARSET_CODEPAGE: Record<number, number> = {
  0: 1252, 1: 1252, 128: 932, 129: 949, 130: 1361, 134: 936, 136: 950, 161: 1253,
  162: 1254, 163: 1258, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250
}

interface RtfRunStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  sup: boolean
  sub: boolean
  font: number
  fontSize: number
  color: number
  highlight: number
}

interface RtfParaStyle {
  align: 'left' | 'center' | 'right' | 'justify'
  indent: number
  firstLine: number
  before: number
  after: number
}

interface RtfFontEntry {
  name: string
  charset?: number
}

function rtfDecode(bytes: number[], codePage: number): string {
  if (!bytes.length) return ''
  const label = codePage === 936 ? 'gb18030'
    : codePage === 950 ? 'big5'
      : codePage === 932 ? 'shift_jis'
        : codePage === 949 ? 'euc-kr'
          : codePage === 874 ? 'windows-874'
            : codePage >= 1250 && codePage <= 1258 ? `windows-${codePage}`
              : ''
  try {
    return label
      ? new TextDecoder(label).decode(Uint8Array.from(bytes))
      : Buffer.from(bytes).toString('latin1')
  } catch {
    return Buffer.from(bytes).toString('latin1')
  }
}

function rtfEscape(text: string): string {
  return escapeXmlText(text)
}

function rtfColor(colors: { r: number; g: number; b: number }[], index: number): string | undefined {
  const entry = colors[index]
  if (!entry) return undefined
  const hex = (value: number): string => Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0')
  return `#${hex(entry.r)}${hex(entry.g)}${hex(entry.b)}`
}

function rtfRunCss(style: RtfRunStyle, fonts: Map<number, RtfFontEntry>, colors: { r: number; g: number; b: number }[]): string {
  const parts: string[] = []
  if (style.bold) parts.push('font-weight:700')
  if (style.italic) parts.push('font-style:italic')
  if (style.underline) parts.push('text-decoration:underline')
  if (style.strike) parts.push('text-decoration:line-through')
  if (style.sup) parts.push('vertical-align:super;font-size:.75em')
  if (style.sub) parts.push('vertical-align:sub;font-size:.75em')
  if (style.fontSize > 0) parts.push(`font-size:${Math.min(96, style.fontSize / 2)}pt`)
  const color = rtfColor(colors, style.color)
  if (color) parts.push(`color:${color}`)
  const highlight = style.highlight > 0 ? rtfColor(colors, style.highlight) : undefined
  if (highlight) parts.push(`background-color:${highlight}`)
  const font = fonts.get(style.font)
  const family = font?.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim()
  if (family) parts.push(`font-family:"${family}"`)
  return parts.join(';')
}

function rtfParaCss(style: RtfParaStyle): string {
  const parts: string[] = []
  if (style.align !== 'left') parts.push(`text-align:${style.align}`)
  if (style.indent > 0) parts.push(`margin-left:${Math.round(style.indent / 15)}px`)
  if (style.firstLine !== 0) parts.push(`text-indent:${Math.round(style.firstLine / 15)}px`)
  if (style.before > 0) parts.push(`margin-top:${Math.round(style.before / 15)}px`)
  if (style.after > 0) parts.push(`margin-bottom:${Math.round(style.after / 15)}px`)
  return parts.join(';')
}

function rtfToHtml(source: string): string {
  const fonts = new Map<number, RtfFontEntry>()
  const colors: { r: number; g: number; b: number }[] = []
  const body: string[] = []
  const tableRows: string[] = []
  let rowCells: string[] = []
  let cellHtml = ''
  let inTable = false
  let justEndedRow = false
  let cellDefinitions: number[] = []
  let cellMergeFlags: ('first' | 'merge' | null)[] = []
  let pendingMerge: 'first' | 'merge' | null = null
  let paraHtml = ''
  let truncated = false
  let plainChars = 0
  let codePage = 1252
  let ucSkip = 1
  let skipChars = 0
  const bytes: number[] = []
  let run: RtfRunStyle = { bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, font: 0, fontSize: 24, color: 0, highlight: 0 }
  let para: RtfParaStyle = { align: 'left', indent: 0, firstLine: 0, before: 0, after: 0 }
  const stack: { run: RtfRunStyle; para: RtfParaStyle; depth: number; skip: number }[] = []
  let depth = 0
  let skipFromDepth = -1
  let mode: 'fonttbl' | 'colortbl' | 'pict' | null = null
  let modeDepth = -1
  let fontIndex = 0
  let fontName = ''
  let fontCharset: number | undefined
  let colorR = 0
  let colorG = 0
  let colorB = 0
  let pictType = ''
  let pictGoal = 0
  let pictHex = ''
  let pendingFirstToken = true
  let starDepth = -1

  const currentCodepage = (): number => {
    const font = fonts.get(run.font)
    return (font?.charset != null ? RTF_FONT_CHARSET_CODEPAGE[font.charset] : undefined) ?? codePage
  }

  const flushBytes = (): void => {
    if (!bytes.length) return
    const text = rtfDecode(bytes.splice(0, bytes.length), currentCodepage())
    if (mode) return
    appendText(text)
  }

  const appendText = (text: string): void => {
    if (!text) return
    if (skipChars > 0) {
      const dropped = Math.min(skipChars, text.length)
      skipChars -= dropped
      text = text.slice(dropped)
      if (!text) return
    }
    plainChars += text.length
    if (plainChars > 4_000_000) {
      truncated = true
      return
    }
    const css = rtfRunCss(run, fonts, colors)
    paraHtml += css ? `<span style="${css}">${rtfEscape(text)}</span>` : rtfEscape(text)
  }

  const flushParagraph = (): void => {
    flushBytes()
    if (!paraHtml.trim()) {
      paraHtml = ''
      return
    }
    const css = rtfParaCss(para)
    const html = `<p${css ? ` style="${css}"` : ''}>${paraHtml}</p>`
    if (inTable) cellHtml += html
    else body.push(html)
    paraHtml = ''
  }

  const flushTable = (): void => {
    if (!tableRows.length) return
    body.push(`<table>${tableRows.join('')}</table>`)
    tableRows.length = 0
  }

  const endCell = (): void => {
    flushParagraph()
    rowCells.push(cellHtml)
    cellHtml = ''
  }

  const endRow = (): void => {
    flushParagraph()
    if (cellHtml.trim()) {
      rowCells.push(cellHtml)
      cellHtml = ''
    }
    let cells = ''
    let column = 0
    let openCell: { content: string; width: number; colspan: number } | null = null
    const flushCell = (): void => {
      if (!openCell) return
      const style = openCell.width > 0 ? ` style="width:${Math.max(8, Math.round(openCell.width / 15))}px"` : ''
      const span = openCell.colspan > 1 ? ` colspan="${openCell.colspan}"` : ''
      cells += `<td${span}${style}>${openCell.content}</td>`
      openCell = null
    }
    for (let index = 0; index < rowCells.length; index++) {
      const previousBoundary = index > 0 ? cellDefinitions[index - 1] ?? 0 : 0
      const width = Math.max(0, (cellDefinitions[index] ?? 0) - previousBoundary)
      if (cellMergeFlags[index] === 'merge' && openCell) {
        openCell.colspan += 1
        openCell.width += width
        openCell.content += rowCells[index]
      } else {
        flushCell()
        openCell = { content: rowCells[index], width, colspan: 1 }
      }
      column += 1
      if (column >= MAX_COLS) {
        truncated = true
        break
      }
    }
    flushCell()
    tableRows.push(`<tr>${cells}</tr>`)
    if (tableRows.length > MAX_ROWS) {
      truncated = true
      tableRows.pop()
    }
    rowCells = []
    cellDefinitions = []
    cellMergeFlags = []
    justEndedRow = true
  }

  const pushGroup = (): void => {
    flushBytes()
    stack.push({ run: { ...run }, para: { ...para }, depth, skip: skipFromDepth })
    depth += 1
    pendingFirstToken = true
  }

  const popGroup = (): void => {
    flushBytes()
    const closingDepth = depth
    if (mode === 'fonttbl' && fontName.trim()) {
      fonts.set(fontIndex, {
        name: fontName.replace(/;[\s\S]*$/, '').trim(),
        ...(fontCharset != null ? { charset: fontCharset } : {})
      })
      fontName = ''
      fontCharset = undefined
    } else if (mode === 'pict' && modeDepth === closingDepth) {
      const data = pictHex.replace(/[^0-9a-f]/gi, '')
      if ((pictType === 'png' || pictType === 'jpeg') && data.length >= 8 && data.length <= MAX_RTF_IMAGE_BYTES * 2) {
        const width = pictGoal > 0 ? ` style="width:${Math.max(8, Math.round(pictGoal / 15))}px"` : ''
        paraHtml += `<img src="data:image/${pictType === 'jpeg' ? 'jpeg' : 'png'};base64,${Buffer.from(data, 'hex').toString('base64')}"${width} alt="">`
      }
      pictHex = ''
    }
    if (mode && modeDepth === closingDepth) {
      mode = null
      modeDepth = -1
    }
    if (starDepth >= closingDepth) starDepth = -1
    depth -= 1
    if (justEndedRow && depth === 0) {
      flushTable()
      inTable = false
      justEndedRow = false
    }
    const saved = stack.pop()
    if (saved) {
      run = saved.run
      para = saved.para
      skipFromDepth = saved.skip
    } else {
      skipFromDepth = -1
    }
  }

  const skipped = (): boolean => skipFromDepth >= 0

  const controlWord = (word: string, param: number | null): void => {
    if (skipFromDepth >= 0) return
    if (starDepth === depth) {
      starDepth = -1
      // Word 把真正的图片包在 {\*\shppict ... {\pict...}} 里：跳过外壳，只放行 \pict 子组。
      if (word === 'shppict') {
        skipFromDepth = depth
        return
      }
      if (word !== 'pict') {
        skipFromDepth = depth
        return
      }
    }
    if (mode === 'fonttbl') {
      if (word === 'f' && param != null) {
        if (fontName) fonts.set(fontIndex, { name: fontName.trim(), ...(fontCharset != null ? { charset: fontCharset } : {}) })
        fontIndex = param
        fontName = ''
        fontCharset = undefined
      } else if (word === 'fcharset' && param != null) {
        fontCharset = param
      }
      return
    }
    if (mode === 'colortbl') {
      if (word === 'red' && param != null) colorR = param
      else if (word === 'green' && param != null) colorG = param
      else if (word === 'blue' && param != null) colorB = param
      return
    }
    if (mode === 'pict') {
      if (word === 'pngblip') pictType = 'png'
      else if (word === 'jpegblip') pictType = 'jpeg'
      else if (word === 'emfblip' || word === 'wmetafile') pictType = 'skip'
      else if (word === 'picwgoal' && param != null) pictGoal = param
      return
    }
    if (pendingFirstToken) {
      if (word === 'fonttbl' || word === 'colortbl' || word === 'pict') {
        mode = word === 'pict' ? 'pict' : word
        modeDepth = depth
        return
      }
      if (RTF_SKIP_DESTINATIONS.has(word)) {
        skipFromDepth = depth
        return
      }
    }
    pendingFirstToken = false
    switch (word) {
      case 'ansicpg':
        if (param != null) codePage = param
        break
      case 'uc':
        if (param != null) ucSkip = Math.max(0, Math.min(4, param))
        break
      case 'deff':
        if (param != null) run.font = param
        break
      case 'b': run.bold = param !== 0; break
      case 'i': run.italic = param !== 0; break
      case 'ul': run.underline = param !== 0; break
      case 'strike': run.strike = param !== 0; break
      case 'super': run.sup = param !== 0; if (param !== 0) run.sub = false; break
      case 'sub': run.sub = param !== 0; if (param !== 0) run.sup = false; break
      case 'fs': if (param != null && param > 0) run.fontSize = param; break
      case 'f': if (param != null) run.font = param; break
      case 'cf': if (param != null) run.color = param; break
      case 'highlight': if (param != null) run.highlight = param; break
      case 'plain':
        run = { ...run, bold: false, italic: false, underline: false, strike: false, sup: false, sub: false, color: 0, highlight: 0 }
        break
      case 'pard':
        flushParagraph()
        skipChars = 0
        para = { align: 'left', indent: 0, firstLine: 0, before: 0, after: 0 }
        if (justEndedRow) {
          flushTable()
          inTable = false
          justEndedRow = false
        }
        break
      case 'ql': para.align = 'left'; break
      case 'qc': para.align = 'center'; break
      case 'qr': para.align = 'right'; break
      case 'qj': para.align = 'justify'; break
      case 'li': if (param != null) para.indent = param; break
      case 'fi': if (param != null) para.firstLine = param; break
      case 'sb': if (param != null) para.before = param; break
      case 'sa': if (param != null) para.after = param; break
      case 'par': skipChars = 0; flushParagraph(); break
      case 'intbl': inTable = true; break
      case 'shppict': skipFromDepth = depth; break
      case 'trowd':
        inTable = true
        justEndedRow = false
        cellDefinitions = []
        pendingMerge = null
        break
      case 'clmgf': pendingMerge = 'first'; break
      case 'clmrg': pendingMerge = 'merge'; break
      case 'cellx':
        if (param != null) cellDefinitions.push(param)
        cellMergeFlags.push(pendingMerge)
        pendingMerge = null
        break
      case 'cell': skipChars = 0; endCell(); break
      case 'row': skipChars = 0; endRow(); break
      case 'line': appendText('\n'); break
      case 'tab': appendText('\t'); break
      default:
        break
    }
  }

  let index = 0
  const length = source.length
  while (index < length) {
    const ch = source[index]
    if (ch === '{') {
      const pictAhead = skipped() && /^\{\\(?:\*\\)?pict\b/i.test(source.slice(index, index + 24))
      pushGroup()
      if (pictAhead) skipFromDepth = -1
      if (mode === 'pict') skipFromDepth = depth
      index += 1
      continue
    }
    if (ch === '}') {
      popGroup()
      index += 1
      continue
    }
    if (ch !== '\\') {
      flushBytes()
      pendingFirstToken = false
      let stop = index
      while (stop < length && source[stop] !== '\\' && source[stop] !== '{' && source[stop] !== '}') stop += 1
      const text = source.slice(index, stop)
      if (skipped()) {
        // 跳过目标（页眉页脚、批注、图片属性等）里的文本。
      } else if (mode === 'fonttbl') fontName += text
      else if (mode === 'pict') pictHex += text
      else if (mode === 'colortbl') {
        const entries = text.split(';')
        for (let i = 0; i < entries.length; i++) {
          if (i > 0) {
            colors.push({ r: colorR, g: colorG, b: colorB })
            colorR = colorG = colorB = 0
          }
          if (entries[i].trim()) {
            // 颜色表里只有空白和数字，忽略即可。
          }
        }
      } else appendText(text.replace(/[\r\n]/g, ''))
      index = stop
      continue
    }
    const nextChar = source[index + 1]
    if (nextChar === undefined) break
    if (nextChar === "'") {
      const hex = source.slice(index + 2, index + 4)
      if (/^[0-9a-f]{2}$/i.test(hex)) {
        pendingFirstToken = false
        if (skipChars > 0) skipChars -= 1
        else if (!skipped() && !mode) bytes.push(Number.parseInt(hex, 16))
        index += 4
        continue
      }
      index += 1
      continue
    }
    if (nextChar === '*') {
      if (!skipped() && !mode) starDepth = depth
      index += 2
      continue
    }
    if (nextChar === '\\' || nextChar === '{' || nextChar === '}') {
      flushBytes()
      if (!skipped() && !mode) appendText(nextChar)
      index += 2
      continue
    }
    if (nextChar === '~') {
      flushBytes()
      if (!skipped() && !mode) appendText('\u00a0')
      index += 2
      continue
    }
    if (nextChar === '_' || nextChar === '-') {
      index += 2
      continue
    }
    if (nextChar === '\n' || nextChar === '\r') {
      flushBytes()
      if (!skipped() && !mode) paraHtml += '<br>'
      index += 2
      continue
    }
    if (/[a-zA-Z]/.test(nextChar)) {
      let cursor = index + 1
      while (cursor < length && /[a-zA-Z]/.test(source[cursor])) cursor += 1
      const word = source.slice(index + 1, cursor)
      let param: number | null = null
      let negative = false
      if (source[cursor] === '-') {
        negative = true
        cursor += 1
      }
      const digitsStart = cursor
      while (cursor < length && source[cursor] >= '0' && source[cursor] <= '9') cursor += 1
      if (cursor > digitsStart) param = Number(source.slice(digitsStart, cursor)) * (negative ? -1 : 1)
      if (source[cursor] === ' ') cursor += 1
      if (word === 'u' && param != null && !skipped() && !mode) {
        flushBytes()
        const code = param < 0 ? param + 65536 : param
        appendText(String.fromCharCode(code))
        skipChars = ucSkip
      } else if (word === 'bin' && param != null && param > 0) {
        flushBytes()
        index = Math.min(length, cursor + param)
        continue
      } else {
        flushBytes()
        controlWord(word, param)
      }
      index = cursor
      continue
    }
    // 未识别的控制符号：跳过反斜杠和一个字符。
    index += 2
  }
  flushParagraph()
  if (inTable) {
    flushTable()
    inTable = false
  }
  if (!body.length) body.push('<p></p>')
  if (truncated) {
    const note = '<p><em>内容超过预览上限，已截断。</em></p>'
    if (!body.includes(note)) body.push(note)
  }
  return body.join('\n')
}

async function previewRtf(absPath: string, fingerprint: string): Promise<DocumentPreview> {
  const st = await stat(absPath).catch(() => null)
  if (!st?.isFile()) throw new DocumentPreviewError('source file is missing', 'corrupt')
  if (st.size > MAX_RTF_BYTES) throw new DocumentPreviewError('RTF file exceeds limit', 'too-large')
  const buffer = await readFile(absPath)
  const source = buffer.toString('latin1')
  if (!/^\s*{\\rtf/i.test(source.slice(0, 512))) {
    throw new DocumentPreviewError('RTF header is missing', 'corrupt')
  }
  const html = sanitizeDocumentHtml(rtfToHtml(source))
  assertDocumentHtmlBudget(html)
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format: 'RTF',
    shape: 'doc',
    fingerprint,
    generatedAt: new Date().toISOString(),
    pageCount: Math.max(1, (source.match(/\\page\b/g) ?? []).length + 1),
    html
  }
}

async function previewTextLike(
  libPath: string,
  absPath: string,
  fingerprint: string,
  format: AssetFormat,
  shape: DocumentShape
): Promise<DocumentPreview> {
  const st = await stat(absPath).catch(() => null)
  if (!st?.isFile()) throw new DocumentPreviewError('source file is missing', 'corrupt')
  if (st.size > MAX_TEXT_BYTES) throw new DocumentPreviewError('text file exceeds limit', 'too-large')
  const buffer = await readFile(absPath)
  if (buffer.length === 0) {
    return {
      rendererVersion: DOCUMENT_RENDERER_VERSION,
      format,
      shape,
      fingerprint,
      generatedAt: new Date().toISOString(),
      text: '',
      textEncoding: 'UTF-8',
      pageCount: 1
    }
  }
  const decoded = decodeText(buffer)
  if (format === 'CSV') {
    return {
      rendererVersion: DOCUMENT_RENDERER_VERSION,
      format,
      shape: 'sheet',
      fingerprint,
      generatedAt: new Date().toISOString(),
      textEncoding: decoded.encoding,
      sheetCount: 1,
      sheets: [csvSheet(decoded.text)],
      ...(decoded.text.length >= MAX_TEXT_CHARS ? { truncated: true } : {})
    }
  }
  if (format === 'MARKDOWN') {
    const html = await markdownHtml(decoded.text, libPath, absPath)
    assertDocumentHtmlBudget(html)
    return {
      rendererVersion: DOCUMENT_RENDERER_VERSION,
      format,
      shape: 'markdown',
      fingerprint,
      generatedAt: new Date().toISOString(),
      textEncoding: decoded.encoding,
      html,
      pageCount: Math.max(1, Math.ceil(decoded.text.length / 4000)),
      ...(decoded.text.length >= MAX_TEXT_CHARS ? { truncated: true } : {})
    }
  }
  return {
    rendererVersion: DOCUMENT_RENDERER_VERSION,
    format,
    shape: 'text',
    fingerprint,
    generatedAt: new Date().toISOString(),
    textEncoding: decoded.encoding,
    text: decoded.text,
    pageCount: Math.max(1, Math.ceil(decoded.text.length / 4000)),
    ...(decoded.text.length >= MAX_TEXT_CHARS ? { truncated: true } : {})
  }
}

async function withTimeout<T>(fn: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new DocumentPreviewError('document parse timed out', 'timeout')), PARSE_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function parseDocument(
  libPath: string,
  absPath: string,
  format: AssetFormat,
  fingerprint: string
): Promise<DocumentPreview> {
  if (format === 'TXT' || format === 'MARKDOWN' || format === 'CSV') {
    return previewTextLike(libPath, absPath, fingerprint, format, shapeFor(format))
  }
  if (format === 'DOC') return previewDoc(absPath, fingerprint)
  if (format === 'DOCX') return previewDocx(absPath, fingerprint)
  if (format === 'XLSX') return previewXlsx(absPath, fingerprint)
  if (format === 'XLS' || format === 'XLSB' || format === 'ODS' || format === 'FODS') {
    return previewSpreadsheet(absPath, fingerprint, format)
  }
  if (format === 'PPTX') return previewPptx(absPath, fingerprint)
  if (format === 'RTF') return previewRtf(absPath, fingerprint)
  if (format === 'ODT' || format === 'ODP') return previewOdf(absPath, fingerprint, format)
  throw new DocumentPreviewError(`document format ${format} is not supported by the built-in renderer`, 'unsupported')
}

async function readCached(
  libPath: string,
  fingerprint: string,
  format: string
): Promise<DocumentPreview | null> {
  const path = documentPreviewPath(libPath, fingerprint)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as DocumentPreview
    if (
      parsed.rendererVersion === DOCUMENT_RENDERER_VERSION &&
      parsed.fingerprint === fingerprint &&
      parsed.format === format
    ) return parsed
  } catch {
    // 缺失或损坏的派生缓存直接重建。
  }
  return null
}

export async function ensureDocumentPreview(
  libPath: string,
  absPath: string,
  fingerprint: string,
  format: string,
  meta: PreviewMeta,
  options: DocumentPreviewOptions = {}
): Promise<DocumentPreview> {
  assertFingerprint(fingerprint)
  const spec = formatSpec(format)
  if (!spec || spec.type !== 'document') throw new DocumentPreviewError(`not a document format: ${format}`, 'unsupported')
  if (options.force) await removeDocumentPreview(libPath, fingerprint)
  if (spec.preview !== 'document') {
    const failed: DocumentPreview = {
      rendererVersion: DOCUMENT_RENDERER_VERSION,
      format: spec.format,
      shape: spec.documentShape ?? 'text',
      fingerprint,
      generatedAt: new Date().toISOString(),
      failure: 'missing-tool',
      failureDetail: `${format} 需要外部办公软件转换为 PDF`
    }
    await mkdir(documentPreviewDir(libPath, fingerprint), { recursive: true }).catch(() => undefined)
    await writeFileAtomically(documentPreviewPath(libPath, fingerprint), JSON.stringify(failed)).catch(() => undefined)
    return failed
  }
  const cached = options.force ? null : await readCached(libPath, fingerprint, format)
  if (cached) return cached
  const key = `${libPath}|${fingerprint}|${format}`
  const existing = inflight.get(key)
  if (existing) return existing
  const task = withTimeout(() => parseDocument(libPath, absPath, spec.format as AssetFormat, fingerprint))
    .then(async (preview) => {
      await mkdir(documentPreviewDir(libPath, fingerprint), { recursive: true })
      await writeFileAtomically(documentPreviewPath(libPath, fingerprint), JSON.stringify(preview))
      return preview
    })
    .catch(async (error) => {
      const failure = asPreviewError(error)
      const failed: DocumentPreview = {
        rendererVersion: DOCUMENT_RENDERER_VERSION,
        format: spec.format,
        shape: spec.documentShape ?? 'text',
        fingerprint,
        generatedAt: new Date().toISOString(),
        failure: failure.kind,
        failureDetail: failure.message
      }
      await mkdir(documentPreviewDir(libPath, fingerprint), { recursive: true }).catch(() => undefined)
      await writeFileAtomically(documentPreviewPath(libPath, fingerprint), JSON.stringify(failed)).catch(() => undefined)
      return failed
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, task)
  void meta
  return task
}

export async function removeDocumentPreview(libPath: string, fingerprint: string): Promise<void> {
  if (!/^[0-9a-f]{20}$/i.test(fingerprint)) return
  await rm(documentPreviewDir(libPath, fingerprint), { recursive: true, force: true }).catch(() => undefined)
}

export function documentFingerprintInUse(
  db: Database.Database,
  libraryId: number,
  fingerprint: string
): boolean {
  return !!db
    .prepare('SELECT 1 FROM assets WHERE library_id = ? AND fingerprint = ? AND deleted_at IS NULL LIMIT 1')
    .get(libraryId, fingerprint)
}

export async function removeDocumentPreviewIfUnused(
  libPath: string,
  db: Database.Database,
  libraryId: number,
  fingerprint: string
): Promise<void> {
  if (documentFingerprintInUse(db, libraryId, fingerprint)) return
  await removeDocumentPreview(libPath, fingerprint)
}

export async function collectOrphanDocumentPreviews(
  libPath: string,
  liveFingerprints: ReadonlySet<string>
): Promise<number> {
  const root = join(libPath, '.mediahub', 'previews', 'documents')
  let removed = 0
  const { readdir } = await import('node:fs/promises')
  for (const name of await readdir(root).catch(() => [] as string[])) {
    if (liveFingerprints.has(name)) continue
    await rm(join(root, name), { recursive: true, force: true }).catch(() => undefined)
    removed++
  }
  return removed
}

export async function documentPreviewExists(libPath: string, fingerprint: string): Promise<boolean> {
  return fileExists(documentPreviewPath(libPath, fingerprint))
}

export function documentThumbnailHtml(preview: DocumentPreview): string {
  const styles = `
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="${previewCsp()}">
    <style>
      *{box-sizing:border-box}html,body{margin:0;width:900px;height:675px;overflow:hidden;background:#e8edf3;color:#1f2937;font-family:"Source Han Sans CN","Microsoft YaHei",sans-serif}
      .doc-thumb{width:100%;height:100%;padding:30px;background:#fff}
      .doc-text{white-space:pre-wrap;font:16px/1.7 "Source Han Sans CN","Microsoft YaHei",sans-serif;max-height:100%;overflow:hidden}
      table{border-collapse:collapse;width:100%;font-size:13px}td,th{border:1px solid #c7d0dc;padding:5px 7px;vertical-align:top}
      h1,h2,h3,h4{line-height:1.3;margin:.6em 0}h1{font-size:30px}h2{font-size:24px}h3{font-size:20px}
      img{max-width:100%;max-height:500px;object-fit:contain}.slide{position:relative;width:100%;height:100%;overflow:hidden;background:#fff}
      .slide-el{position:absolute;overflow:hidden;white-space:pre-wrap;padding:4px;font-size:16px;line-height:1.3}
    </style>`
  if (preview.shape === 'sheet') {
    const sheet = preview.sheets?.[0]
    if (!sheet) return `<html><head>${styles}</head><body><div class="doc-thumb"><div class="doc-text">${escapeXmlText(preview.failureDetail ?? '空工作表')}</div></div></body></html>`
    const rows = Array.from({ length: Math.min(20, sheet.rows.length) }, (_, r) => {
      const cells = Array.from({ length: Math.min(12, sheet.columns.length) }, (_, c) => {
        const cell = sheet.cells.find((item) => item.row === r + 1 && item.col === c + 1)
        return `<td>${escapeXmlText(cell?.value ?? '')}</td>`
      }).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    return `<html><head>${styles}</head><body><div class="doc-thumb"><table>${rows}</table></div></body></html>`
  }
  if (preview.shape === 'slides') {
    const slide = preview.slides?.[0]
    if (!slide) return `<html><head>${styles}</head><body><div class="doc-thumb"><div class="doc-text">${escapeXmlText(preview.failureDetail ?? '空幻灯片')}</div></div></body></html>`
    const elements = slide.elements.slice(0, 80).map((el) => {
      const style = `left:${el.x / slide.width * 100}%;top:${el.y / slide.height * 100}%;width:${el.w / slide.width * 100}%;height:${el.h / slide.height * 100}%;background:${el.fill ?? 'transparent'};color:${el.color ?? '#1f2937'};font-size:${Math.max(8, (el.fontSize ?? 20) * 900 / slide.width)}px;text-align:${el.align ?? 'left'}`
      if (el.kind === 'image' && el.src) return `<img class="slide-el" style="${style};object-fit:contain" src="${escapeXmlText(el.src)}">`
      if (el.kind === 'table') return `<div class="slide-el" style="${style}"><table>${(el.table?.cells ?? []).slice(0, 30).map((cell) => `<tr><td>${escapeXmlText(cell.value)}</td></tr>`).join('')}</table></div>`
      return `<div class="slide-el" style="${style}">${escapeXmlText(el.text ?? '')}</div>`
    }).join('')
    return `<html><head>${styles}</head><body><div class="doc-thumb"><div class="slide">${elements}</div></div></body></html>`
  }
  if (preview.shape === 'markdown' || preview.shape === 'doc') {
    return `<html><head>${styles}</head><body><div class="doc-thumb">${preview.html ?? ''}</div></body></html>`
  }
  return `<html><head>${styles}</head><body><div class="doc-thumb"><div class="doc-text">${escapeXmlText(preview.text ?? preview.failureDetail ?? '')}</div></div></body></html>`
}

export function previewCsp(): string {
  return "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
}
