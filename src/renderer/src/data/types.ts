export type AssetType = 'image' | 'video' | 'model' | 'style'

export type AssetFormat =
  | 'JPG' | 'PNG' | 'WEBP' | 'SVG' | 'GIF' | 'PSD'
  | 'MP4' | 'MOV'
  | 'GLB' | 'FBX' | 'OBJ'
  | 'CSS'

export interface AssetTag {
  name: string
  color: string
}

export interface PaletteColor {
  hex: string
  ratio: number
}

export interface FolderSort {
  orderBy: 'IMPORT' | 'MTIME' | 'MANUAL'
  sortIncrease: boolean
}

export interface Asset {
  id: string
  /** 库内真实素材的数据库 id;演示模式为空 */
  dbId?: number
  libraryId?: number
  relPath?: string
  fingerprint?: string
  /** 缺失文件的库内素材 */
  missing?: boolean
  type: AssetType
  format: AssetFormat
  /** 不含扩展名,界面不显示后缀 */
  name: string
  width?: number
  height?: number
  faceCount?: number
  vertices?: number
  materialInfo?: string
  duration?: string
  codec?: string
  fps?: number
  sizeBytes: number
  importedAt: string
  rating: 0 | 1 | 2 | 3 | 4 | 5
  favorite: boolean
  reviewFlag?: boolean
  tags: AssetTag[]
  folders: string[]
  note: string
  sourceUrl?: string
  palette: PaletteColor[]
  /** dev 演示模式:经 vite /@fs/ 预览;库模式:media:// 原始素材 */
  previewUrl?: string
  /** 库模式:media:// 原始文件(灯箱大图/播放) */
  originalUrl?: string
  /** 渐变占位类(g-ocean 等) */
  thumbClass?: string
  /** 真实文件绝对路径(「在资源管理器中显示」用) */
  absPath?: string
  /** 回收站:非空表示已删除 */
  deletedAt?: string
}

export interface LibraryTab {
  id: string
  name: string
  /** 库模式:对应数据库 library id;演示标签为空 */
  libraryId?: number
}

export interface FolderNode {
  name: string
  children?: string[]
}

/** 侧栏导航键 */
export type NavKey =
  | 'all' | 'recent' | 'untagged' | 'fav' | 'trash'
  | `folder:${string}`
  | `tag:${string}`
