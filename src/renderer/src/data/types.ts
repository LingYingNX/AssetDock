export type AssetType = 'image' | 'video' | 'model'

export type AssetFormat =
  | 'JPG' | 'PNG' | 'WEBP' | 'SVG' | 'GIF' | 'PSD'
  | 'MP4' | 'MOV'
  | 'GLB' | 'FBX' | 'OBJ'

export interface AssetTag {
  name: string
  color: string
}

export interface PaletteColor {
  hex: string
  ratio: number
}

export interface Asset {
  id: string
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
  /** dev 预览地址(真实文件经 vite /@fs/ 提供);合成条目为空,用渐变占位 */
  previewUrl?: string
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
