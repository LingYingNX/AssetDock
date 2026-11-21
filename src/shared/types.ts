/** 主进程与渲染进程共享的轻量类型(S2-10:跨进程 schema 单一来源) */

export interface PaletteColor {
  hex: string
  ratio: number
}

export type AssetKind = 'image' | 'video' | 'model' | 'style' | 'document'

export interface AssetTag {
  name: string
  color: string
}

/** libraries 表行(注册表) */
export interface LibraryRow {
  id: number
  name: string
  path: string
}

/**
 * assets 表行(listAssets 返回的库内素材记录;snake_case 保持与列名一致)。
 * 主进程查询结果与渲染层解析(ui.ts rowToAsset)共用此类型,漂移即编译错误。
 */
export interface AssetRow {
  id: number
  library_id: number
  rel_path: string
  name: string
  type: AssetKind
  format: string
  width: number | null
  height: number | null
  duration: number | null
  face_count: number | null
  vertices: number | null
  material_info: string | null
  codec: string | null
  fps: number | null
  page_count: number | null
  sheet_count: number | null
  slide_count: number | null
  text_encoding: string | null
  size_bytes: number
  mtime_ms: number
  fingerprint: string
  rating: number
  favorite: number
  review_flag: number
  note: string
  source_url: string | null
  deleted_at: string | null
  missing: number
  palette: string
  imported_at: string
  folder_path: string | null
  tags: AssetTag[]
}

export type DocumentShape = 'text' | 'markdown' | 'html' | 'sheet' | 'doc' | 'slides'

export type DocumentFailureKind =
  | 'corrupt'
  | 'encrypted'
  | 'missing-tool'
  | 'too-large'
  | 'timeout'
  | 'unsupported'

export interface DocumentCellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  fontSize?: number
  fontFamily?: string
  color?: string
  fill?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  border?: string
  numberFormat?: string
}

export interface DocumentSheetCell {
  row: number
  col: number
  value: string
  rowSpan?: number
  colSpan?: number
  style?: DocumentCellStyle
}

export interface DocumentSheet {
  name: string
  columns: number[]
  rows: number[]
  cells: DocumentSheetCell[]
  truncated?: boolean
}

export interface DocumentSlideElement {
  kind: 'text' | 'image' | 'shape' | 'table'
  x: number
  y: number
  w: number
  h: number
  text?: string
  src?: string
  fill?: string
  line?: string
  rotation?: number
  fontSize?: number
  bold?: boolean
  italic?: boolean
  color?: string
  align?: 'left' | 'center' | 'right'
  valign?: 'top' | 'middle' | 'bottom'
  table?: { columns: number[]; rows: number[]; cells: DocumentSheetCell[] }
}

export interface DocumentSlide {
  width: number
  height: number
  background?: string
  elements: DocumentSlideElement[]
  notes?: string
}

export interface DocumentPreview {
  rendererVersion: number
  format: string
  shape: DocumentShape
  fingerprint: string
  generatedAt: string
  pageCount?: number
  sheetCount?: number
  slideCount?: number
  textEncoding?: string
  text?: string
  html?: string
  sheets?: DocumentSheet[]
  slides?: DocumentSlide[]
  truncated?: boolean
  unsupported?: string[]
  failure?: DocumentFailureKind
  failureDetail?: string
}

export interface DocumentPreviewResult {
  preview?: DocumentPreview
  error?: string
  failure?: DocumentFailureKind
}

/** assets:list 的完整响应(含 absPath 扩展列与库信息) */
export interface AssetListRow extends AssetRow {
  absPath: string
}

export interface AssetListResponse {
  library: LibraryRow
  assets: AssetListRow[]
  next?: { importedAt: string; id: number }
}

export interface AssetListPage {
  before?: { importedAt: string; id: number }
}

/** folders:list 响应 */
export interface FolderListResponse {
  paths: string[]
}

/**
 * assets:changed payload(S1-7):
 * - assetIds 缺省/空 = 全量重拉(文件夹操作、批量导入等结构性变化)
 * - assetIds 非空 = 增量:渲染层只按 id 取行合并,避免大库全量重拉风暴
 */
export interface AssetsChangedPayload {
  libraryId: number
  assetIds?: number[]
}

/** assets:rows 响应(按 id 的增量取行,S1-7) */
export interface AssetRowsResponse {
  assets: AssetListRow[]
}

export interface AssetImportResponse {
  imported: number
  skipped: number
}

export interface LibraryScanPayload {
  libraryId: number
  done: number
  phase: 'scanning' | 'moving' | 'done'
  added?: number
  /** S3-6:扫描中读取失败(不可读/被占用)的文件计数 */
  errors?: number
}

export interface ThumbsProgressPayload {
  libraryId: number
  done: number
  total: number
  phase: 'running' | 'done'
  /** S3-6:预热失败计数(渲染层可提示"部分缩略图生成失败") */
  failed?: number
  /** 单张懒生成完成时携带，用于让占位 URL 立即换成真实缓存。 */
  fingerprint?: string
}

/**
 * 跨库传输进度(assets:transfer / folders:transfer)。
 * libraryId 是源库:素材是从它那里减出去的,进度条也挂它的页面上。
 */
export interface TransferProgressPayload {
  libraryId: number
  done: number
  total: number
}

export interface TranscodeProgressPayload {
  libraryId: number
  assetId: number
  status: 'running' | 'done' | 'error'
  progress?: number | null
  error?: string
}

/** 去重规则:汉明距离上限(64 位 dHash 内的距离阈值) */
export type DedupRule = 'strict' | 'balanced' | 'loose'

/** 相似图片候选(一条素材记录,phash 列名与库内一致) */
export interface DedupCandidate {
  id: number
  relPath: string
  name: string
  width: number | null
  height: number | null
  sizeBytes: number
  fingerprint: string
}

/** 一组相似素材:candidates[0] 是按分辨率/体积自动选出的推荐保留项 */
export interface DedupGroup {
  candidates: DedupCandidate[]
}

/** dedup:scan 响应 */
export interface DedupScanResponse {
  scanned: number
  groups: DedupGroup[]
}

export type DedupScanResult = DedupScanResponse | { error: string }

export interface DedupProgressPayload {
  done: number
  total: number
}

/** preload on() 白名单事件通道 → payload 映射(与主进程实际发送一致) */
export interface EventChannelMap {
  'library:scan': LibraryScanPayload
  'assets:changed': AssetsChangedPayload
  'window:maximized': boolean
  'thumbs:progress': ThumbsProgressPayload
  'transcode:progress': TranscodeProgressPayload
  'transfer:progress': TransferProgressPayload
  'dedup:progress': DedupProgressPayload
}
