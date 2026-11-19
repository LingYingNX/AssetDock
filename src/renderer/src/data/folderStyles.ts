/** 文件夹自定义样式:图标键必须在 Icons.tsx 的 symbol 里存在,颜色用十六进制存库。 */
export interface FolderStyle {
  icon: string
  color: string
}

export const DEFAULT_FOLDER_ICON = 'folder'

export const FOLDER_ICONS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'folder', label: '文件夹' },
  { key: 'image', label: '图片' },
  { key: 'film', label: '视频' },
  { key: 'document', label: '文档' },
  { key: 'cube', label: '三维' },
  { key: 'book', label: '书籍' },
  { key: 'star', label: '收藏' },
  { key: 'heart', label: '喜欢' },
  { key: 'tag', label: '标签' },
  { key: 'archive', label: '归档' }
]

/** 与标签色板同源,保持侧栏/检查器同一套色感 */
export const FOLDER_COLORS: readonly string[] = [
  '#22D3EE',
  '#3B82F6',
  '#A855F7',
  '#EE509E',
  '#FF7A93',
  '#F97316',
  '#E8A33D',
  '#3ECF8E'
]