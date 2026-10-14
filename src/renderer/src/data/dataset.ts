import type { Asset, AssetTag, FolderNode } from './types'

export const TAGS: Record<string, string> = {
  产品图: '#22D3EE',
  品牌主视觉: '#F97316',
  '春季 Campaign': '#3ECF8E',
  客户案例: '#E8A33D',
  幕后: '#FF7A93',
  '4K 素材': '#3B82F6',
  待调色: '#A855F7'
}

export const SUGGESTED_TAGS = ['客户案例', '幕后', '4K 素材', '待调色']

export const FOLDERS: FolderNode[] = [
  { name: '01 品牌VI' },
  { name: '02 产品摄影' },
  { name: '03 视频素材', children: ['产品演示', '广告投放', '幕后花絮'] },
  { name: '04 电商详情' },
  { name: '05 社媒素材' },
  { name: '归档' }
]

/** 色带(当前文件夹颜色构造,8 块) */
export const COLOR_STRIP: { hex: string; ratio: number }[] = [
  { hex: '#2FD6A3', ratio: 24 },
  { hex: '#5EE7F9', ratio: 16 },
  { hex: '#F2B33D', ratio: 12 },
  { hex: '#F1616D', ratio: 9 },
  { hex: '#F97316', ratio: 7 },
  { hex: '#3ECF8E', ratio: 6 },
  { hex: '#8A9490', ratio: 5 },
  { hex: '#15171B', ratio: 21 }
]

const ASSETS_DIR = 'E:/zcode项目/素材管理器/素材'

function t(name: string): AssetTag[] {
  return [{ name, color: TAGS[name] ?? '#64748B' }]
}
function ts(...names: string[]): AssetTag[] {
  return names.map((name) => ({ name, color: TAGS[name] ?? '#64748B' }))
}

/**
 * 数据集:真实素材快照(素材/ 目录,元数据经 tools/probe-assets.mjs 探测)
 * + 自拟合成条目覆盖全部格式与视图状态。
 * palette 为人工标定(真实提取在 Change 2 k-means 实现)。
 */
export const ASSETS: Asset[] = [
  {
    id: 'real-1',
    type: 'image',
    format: 'JPG',
    name: '010408_2',
    width: 1920,
    height: 1046,
    sizeBytes: 343288,
    importedAt: '2026-06-28T11:11',
    rating: 4,
    favorite: false,
    tags: ts('品牌主视觉'),
    folders: ['归档'],
    note: '',
    palette: [
      { hex: '#2E2447', ratio: 26 },
      { hex: '#7C6BD9', ratio: 24 },
      { hex: '#AFC0EE', ratio: 22 },
      { hex: '#4A3E85', ratio: 16 },
      { hex: '#E6D08C', ratio: 12 }
    ],
    previewUrl: `${ASSETS_DIR}/010408_2.jpg`,
    absPath: 'E:\\zcode项目\\素材管理器\\素材\\010408_2.jpg'
  },
  {
    id: 'real-2',
    type: 'image',
    format: 'JPG',
    name: '010715_2',
    width: 2720,
    height: 1856,
    sizeBytes: 1912639,
    importedAt: '2026-06-28T11:11',
    rating: 5,
    favorite: true,
    tags: ts('产品图'),
    folders: ['02 产品摄影'],
    note: '白底沙发场景,构图干净,可直接用于详情页首图。',
    palette: [
      { hex: '#F2F4F6', ratio: 34 },
      { hex: '#17181C', ratio: 24 },
      { hex: '#8E939E', ratio: 18 },
      { hex: '#5AD9E8', ratio: 14 },
      { hex: '#F2A8C4', ratio: 10 }
    ],
    previewUrl: `${ASSETS_DIR}/010715_2.jpg`,
    absPath: 'E:\\zcode项目\\素材管理器\\素材\\010715_2.jpg'
  },
  {
    id: 'real-3',
    type: 'video',
    format: 'MP4',
    name: '总渲染',
    width: 1920,
    height: 1080,
    duration: '00:20',
    sizeBytes: 17117453,
    importedAt: '2026-08-31T08:28',
    rating: 0,
    favorite: false,
    tags: ts('幕后'),
    folders: ['03 视频素材', '产品演示'],
    note: '',
    palette: [
      { hex: '#0E1626', ratio: 30 },
      { hex: '#1B2A4A', ratio: 24 },
      { hex: '#3E6FD9', ratio: 20 },
      { hex: '#7FD9E8', ratio: 14 },
      { hex: '#E8F2FF', ratio: 12 }
    ],
    previewUrl: `${ASSETS_DIR}/总渲染.mp4`,
    absPath: 'E:\\zcode项目\\素材管理器\\素材\\总渲染.mp4'
  },

  {
    id: 'syn-1',
    type: 'image',
    format: 'JPG',
    name: '产品白底图_主推_01',
    width: 3000,
    height: 3000,
    sizeBytes: 5_033_164,
    importedAt: '2026-08-31T09:12',
    rating: 5,
    favorite: true,
    tags: ts('产品图'),
    folders: ['04 电商详情'],
    note: '主推 SKU,白底 1:1,详情页与主图通用。',
    palette: [
      { hex: '#F4F4F2', ratio: 52 },
      { hex: '#D8D2C8', ratio: 20 },
      { hex: '#8A6F4D', ratio: 14 },
      { hex: '#3C342A', ratio: 9 },
      { hex: '#B49B72', ratio: 5 }
    ],
    thumbClass: 'g-mono'
  },
  {
    id: 'syn-2',
    type: 'image',
    format: 'JPG',
    name: '春季主视觉_海报_02',
    width: 2480,
    height: 3508,
    sizeBytes: 13_225_139,
    importedAt: '2026-08-31T08:47',
    rating: 4,
    favorite: false,
    tags: ts('春季 Campaign', '品牌主视觉'),
    folders: ['01 品牌VI'],
    note: '',
    palette: [
      { hex: '#F8A8B8', ratio: 30 },
      { hex: '#E23A5F', ratio: 24 },
      { hex: '#7C1D3C', ratio: 20 },
      { hex: '#FFE1E6', ratio: 16 },
      { hex: '#F2B33D', ratio: 10 }
    ],
    thumbClass: 'g-blossom'
  },
  {
    id: 'syn-3',
    type: 'video',
    format: 'MP4',
    name: '产品演示_主镜头_03',
    width: 3840,
    height: 2160,
    duration: '00:32',
    sizeBytes: 134_846_669,
    importedAt: '2026-08-31T10:24',
    rating: 4,
    favorite: false,
    tags: ts('产品图', '4K 素材'),
    folders: ['03 视频素材', '产品演示'],
    note: '备用主镜头,17s 处颜色需二次调校;客户已确认使用。',
    palette: [
      { hex: '#16266B', ratio: 28 },
      { hex: '#2E7CF6', ratio: 26 },
      { hex: '#5EE7F9', ratio: 20 },
      { hex: '#0E1424', ratio: 16 },
      { hex: '#E8F2FF', ratio: 10 }
    ],
    thumbClass: 'g-ocean',
    reviewFlag: true
  },
  {
    id: 'syn-4',
    type: 'model',
    format: 'GLB',
    name: '机甲头盔_高模_v04',
    faceCount: 46312,
    vertices: 23954,
    materialInfo: 'PBR · 3 套 <贴图 2K ×4>',
    sizeBytes: 26_001_935,
    importedAt: '2026-08-31T11:05',
    rating: 4,
    favorite: false,
    tags: ts('产品图'),
    folders: ['02 产品摄影'],
    note: '',
    palette: [
      { hex: '#22D3EE', ratio: 26 },
      { hex: '#6366F1', ratio: 24 },
      { hex: '#241B5E', ratio: 22 },
      { hex: '#0E1424', ratio: 16 },
      { hex: '#A8D8FF', ratio: 12 }
    ],
    thumbClass: 'g-cyber'
  },
  {
    id: 'syn-5',
    type: 'video',
    format: 'MOV',
    name: '品牌TVC_竖版_终版',
    width: 2160,
    height: 3840,
    duration: '01:24',
    sizeBytes: 509_607_936,
    importedAt: '2026-08-31T09:47',
    rating: 5,
    favorite: true,
    tags: ts('品牌主视觉', '春季 Campaign'),
    folders: ['03 视频素材', '广告投放'],
    note: '终版过审,投放渠道:抖音 / 视频号。',
    palette: [
      { hex: '#0E1424', ratio: 34 },
      { hex: '#232C46', ratio: 26 },
      { hex: '#94BBFF', ratio: 18 },
      { hex: '#FACC21', ratio: 12 },
      { hex: '#E8F2FF', ratio: 10 }
    ],
    thumbClass: 'g-night'
  },
  {
    id: 'syn-6',
    type: 'image',
    format: 'JPG',
    name: '咖啡产品图_暖光_01',
    width: 6000,
    height: 4000,
    sizeBytes: 8_598_220,
    importedAt: '2026-08-30T09:12',
    rating: 4,
    favorite: false,
    tags: ts('产品图'),
    folders: ['02 产品摄影'],
    note: '',
    palette: [
      { hex: '#FFB25C', ratio: 28 },
      { hex: '#F0527C', ratio: 24 },
      { hex: '#5B2A86', ratio: 22 },
      { hex: '#FFE3B3', ratio: 16 },
      { hex: '#2A1230', ratio: 10 }
    ],
    thumbClass: 'g-sunset'
  },
  {
    id: 'syn-7',
    type: 'image',
    format: 'PNG',
    name: 'Logo_主标志_透明底',
    width: 2400,
    height: 2400,
    sizeBytes: 655_360,
    importedAt: '2026-08-30T21:36',
    rating: 5,
    favorite: true,
    tags: ts('品牌主视觉'),
    folders: ['01 品牌VI'],
    note: 'VI 标准源文件,透明底,最小使用尺寸 48px。',
    palette: [
      { hex: '#C7D0DC', ratio: 36 },
      { hex: '#7C8BA1', ratio: 26 },
      { hex: '#39445A', ratio: 20 },
      { hex: '#E8EDF5', ratio: 12 },
      { hex: '#101820', ratio: 6 }
    ],
    thumbClass: 'g-mono'
  },
  {
    id: 'syn-8',
    type: 'model',
    format: 'FBX',
    name: '场景道具_木箱组合',
    faceCount: 12438,
    vertices: 6219,
    materialInfo: 'PBR · 2 套 <贴图 1K ×3>',
    sizeBytes: 8_598_220,
    importedAt: '2026-08-30T20:14',
    rating: 2,
    favorite: false,
    tags: [],
    folders: ['归档'],
    note: '',
    palette: [
      { hex: '#FBD36B', ratio: 30 },
      { hex: '#E8930C', ratio: 26 },
      { hex: '#8A4B12', ratio: 22 },
      { hex: '#FFF3C4', ratio: 14 },
      { hex: '#3C2408', ratio: 8 }
    ],
    thumbClass: 'g-sand'
  },
  {
    id: 'syn-9',
    type: 'video',
    format: 'MP4',
    name: '幕后花絮_访谈片段',
    width: 3840,
    height: 2160,
    duration: '03:05',
    sizeBytes: 1_258_291_200,
    importedAt: '2026-08-30T18:20',
    rating: 3,
    favorite: false,
    tags: ts('幕后'),
    folders: ['03 视频素材', '幕后花絮'],
    note: '',
    palette: [
      { hex: '#0B4A38', ratio: 30 },
      { hex: '#0E9F6E', ratio: 26 },
      { hex: '#7FE6B4', ratio: 22 },
      { hex: '#D1FAE5', ratio: 14 },
      { hex: '#06281E', ratio: 8 }
    ],
    thumbClass: 'g-forest'
  },
  {
    id: 'syn-10',
    type: 'image',
    format: 'JPG',
    name: '春季Campaign_人像_02',
    width: 4800,
    height: 6000,
    sizeBytes: 13_006_467,
    importedAt: '2026-08-30T16:05',
    rating: 4,
    favorite: false,
    reviewFlag: true,
    tags: ts('春季 Campaign', '客户案例'),
    folders: ['05 社媒素材'],
    note: '模特授权至 2027 年 3 月。',
    palette: [
      { hex: '#F8A8B8', ratio: 28 },
      { hex: '#E23A5F', ratio: 24 },
      { hex: '#7C1D3C', ratio: 20 },
      { hex: '#FFE1E6', ratio: 18 },
      { hex: '#F2B33D', ratio: 10 }
    ],
    thumbClass: 'g-blossom'
  },
  {
    id: 'syn-11',
    type: 'image',
    format: 'GIF',
    name: '动态海报_循环_v3',
    width: 1080,
    height: 1080,
    sizeBytes: 19_713_228,
    importedAt: '2026-08-29T14:52',
    rating: 3,
    favorite: false,
    tags: ts('春季 Campaign'),
    folders: ['05 社媒素材'],
    note: '',
    palette: [
      { hex: '#22D3EE', ratio: 30 },
      { hex: '#6366F1', ratio: 26 },
      { hex: '#241B5E', ratio: 22 },
      { hex: '#67E8F9', ratio: 14 },
      { hex: '#0E1424', ratio: 8 }
    ],
    thumbClass: 'g-cyber'
  },
  {
    id: 'syn-12',
    type: 'image',
    format: 'PSD',
    name: '包装设计_源文件',
    width: 5400,
    height: 3600,
    sizeBytes: 509_607_936,
    importedAt: '2026-08-27T11:30',
    rating: 2,
    favorite: false,
    tags: ts('产品图', '待调色'),
    folders: ['01 品牌VI'],
    note: '分层源文件,印刷出图前需转 CMYK 校色。',
    palette: [
      { hex: '#FBD36B', ratio: 30 },
      { hex: '#E8930C', ratio: 24 },
      { hex: '#8A4B12', ratio: 22 },
      { hex: '#FFF3C4', ratio: 16 },
      { hex: '#3C2408', ratio: 8 }
    ],
    thumbClass: 'g-sand'
  },
  {
    id: 'syn-13',
    type: 'image',
    format: 'WEBP',
    name: '电商详情_头图_促销',
    width: 1920,
    height: 1440,
    sizeBytes: 327_680,
    importedAt: '2026-08-28T09:47',
    rating: 4,
    favorite: false,
    tags: ts('产品图'),
    folders: ['04 电商详情'],
    note: '',
    palette: [
      { hex: '#A7F3D0', ratio: 30 },
      { hex: '#2FBE8F', ratio: 26 },
      { hex: '#0E5F46', ratio: 22 },
      { hex: '#F0FDF4', ratio: 14 },
      { hex: '#064E3B', ratio: 8 }
    ],
    thumbClass: 'g-mint'
  },
  {
    id: 'syn-14',
    type: 'video',
    format: 'MP4',
    name: '年度发布会_全场录像',
    width: 3840,
    height: 2160,
    duration: '15:42',
    sizeBytes: 9_232_386_048,
    importedAt: '2026-08-28T20:14',
    rating: 3,
    favorite: false,
    tags: ts('幕后', '4K 素材'),
    folders: ['归档'],
    note: '全场原片,切片素材另见「发布会切片」文件夹。',
    palette: [
      { hex: '#2A1160', ratio: 30 },
      { hex: '#7C3AED', ratio: 26 },
      { hex: '#C4B5FD', ratio: 22 },
      { hex: '#E9D5FF', ratio: 14 },
      { hex: '#160838', ratio: 8 }
    ],
    thumbClass: 'g-royal'
  },
  {
    id: 'syn-15',
    type: 'image',
    format: 'SVG',
    name: '图标集_线性_24px',
    width: 24,
    height: 24,
    sizeBytes: 98_304,
    importedAt: '2026-08-28T11:28',
    rating: 3,
    favorite: false,
    tags: ts('品牌主视觉'),
    folders: ['01 品牌VI'],
    note: '24px 网格,1.7px 描边,与界面图标同源。',
    palette: [
      { hex: '#B7C0CE', ratio: 32 },
      { hex: '#6E7B90', ratio: 26 },
      { hex: '#2C3444', ratio: 22 },
      { hex: '#E8EDF5', ratio: 14 },
      { hex: '#101820', ratio: 6 }
    ],
    thumbClass: 'g-slate'
  },
  {
    id: 'syn-16',
    type: 'image',
    format: 'JPG',
    name: '团队合影_年会_04',
    width: 7680,
    height: 4320,
    sizeBytes: 14_790_656,
    importedAt: '2026-08-30T18:22',
    rating: 3,
    favorite: false,
    tags: ts('幕后'),
    folders: ['归档'],
    note: '',
    palette: [
      { hex: '#FDB4A0', ratio: 28 },
      { hex: '#F0654A', ratio: 26 },
      { hex: '#8C2E1B', ratio: 22 },
      { hex: '#FFE0CC', ratio: 16 },
      { hex: '#40140A', ratio: 8 }
    ],
    thumbClass: 'g-coral'
  },
  {
    id: 'syn-17',
    type: 'video',
    format: 'MOV',
    name: '产品特写_慢镜头',
    width: 3840,
    height: 2160,
    duration: '00:18',
    sizeBytes: 754_974_720,
    importedAt: '2026-08-27T15:40',
    rating: 4,
    favorite: false,
    tags: ts('产品图', '4K 素材'),
    folders: ['03 视频素材', '产品演示'],
    note: '120fps 升格,用于详情页头图动效。',
    palette: [
      { hex: '#1F2B45', ratio: 30 },
      { hex: '#51658C', ratio: 26 },
      { hex: '#9FB4D4', ratio: 22 },
      { hex: '#D6E5FF', ratio: 14 },
      { hex: '#0E1626', ratio: 8 }
    ],
    thumbClass: 'g-steel'
  },
  {
    id: 'syn-18',
    type: 'image',
    format: 'PNG',
    name: 'Banner_首页_双十一_宽版',
    width: 2560,
    height: 960,
    sizeBytes: 1_887_437,
    importedAt: '2026-08-29T15:04',
    rating: 3,
    favorite: false,
    tags: ts('产品图'),
    folders: ['04 电商详情'],
    note: '',
    palette: [
      { hex: '#232C46', ratio: 30 },
      { hex: '#0E1424', ratio: 26 },
      { hex: '#94BBFF', ratio: 20 },
      { hex: '#FACC21', ratio: 14 },
      { hex: '#E8F2FF', ratio: 10 }
    ],
    thumbClass: 'g-night'
  },
  {
    id: 'syn-19',
    type: 'image',
    format: 'JPG',
    name: '奖杯特写_金属质感',
    width: 4000,
    height: 5000,
    sizeBytes: 10_066_329,
    importedAt: '2026-08-30T16:08',
    rating: 4,
    favorite: false,
    tags: ts('客户案例'),
    folders: ['02 产品摄影'],
    note: '',
    palette: [
      { hex: '#F7D774', ratio: 30 },
      { hex: '#D9930D', ratio: 26 },
      { hex: '#6E3B0A', ratio: 22 },
      { hex: '#FFF7D6', ratio: 14 },
      { hex: '#3C2408', ratio: 8 }
    ],
    thumbClass: 'g-gold'
  },
  {
    id: 'syn-20',
    type: 'video',
    format: 'MP4',
    name: '社媒_开箱短视频',
    width: 1080,
    height: 1920,
    duration: '00:45',
    sizeBytes: 220_200_960,
    importedAt: '2026-08-26T18:40',
    rating: 4,
    favorite: false,
    tags: ts('产品图'),
    folders: ['05 社媒素材'],
    note: '',
    palette: [
      { hex: '#C7D0DC', ratio: 30 },
      { hex: '#7C8BA1', ratio: 26 },
      { hex: '#39445A', ratio: 22 },
      { hex: '#E8EDF5', ratio: 14 },
      { hex: '#101820', ratio: 8 }
    ],
    thumbClass: 'g-mono'
  },
  {
    id: 'syn-21',
    type: 'model',
    format: 'GLB',
    name: '场景道具_灯光套组',
    faceCount: 18240,
    vertices: 9806,
    materialInfo: 'PBR · 2 套 <贴图 2K ×3>',
    sizeBytes: 14_883_840,
    importedAt: '2026-08-27T16:44',
    rating: 0,
    favorite: false,
    tags: [],
    folders: ['归档'],
    note: '',
    palette: [
      { hex: '#2A1160', ratio: 30 },
      { hex: '#7C3AED', ratio: 26 },
      { hex: '#C4B5FD', ratio: 22 },
      { hex: '#E9D5FF', ratio: 14 },
      { hex: '#160838', ratio: 8 }
    ],
    thumbClass: 'g-royal'
  },
  {
    id: 'syn-22',
    type: 'model',
    format: 'OBJ',
    name: '角色_基础人形',
    faceCount: 5872,
    vertices: 3120,
    materialInfo: '基础材质 · 无贴图',
    sizeBytes: 1_992_294,
    importedAt: '2026-08-25T10:02',
    rating: 1,
    favorite: false,
    tags: [],
    folders: ['归档'],
    note: '',
    palette: [
      { hex: '#9FB4D4', ratio: 30 },
      { hex: '#51658C', ratio: 26 },
      { hex: '#1F2B45', ratio: 24 },
      { hex: '#D6E5FF', ratio: 12 },
      { hex: '#0E1626', ratio: 8 }
    ],
    thumbClass: 'g-steel'
  },
  {
    id: 'syn-23',
    type: 'image',
    format: 'PNG',
    name: '图标集_填充_24px',
    width: 1024,
    height: 1024,
    sizeBytes: 215_040,
    importedAt: '2026-08-28T11:30',
    rating: 0,
    favorite: false,
    tags: [],
    folders: [],
    note: '',
    palette: [
      { hex: '#B7C0CE', ratio: 32 },
      { hex: '#6E7B90', ratio: 26 },
      { hex: '#2C3444', ratio: 22 },
      { hex: '#E8EDF5', ratio: 12 },
      { hex: '#101820', ratio: 8 }
    ],
    thumbClass: 'g-slate'
  },
  {
    id: 'syn-24',
    type: 'image',
    format: 'JPG',
    name: '幕后花絮_合影快门',
    width: 4032,
    height: 3024,
    sizeBytes: 6_710_886,
    importedAt: '2026-08-29T21:36',
    rating: 2,
    favorite: false,
    tags: ts('幕后'),
    folders: ['03 视频素材', '幕后花絮'],
    note: '',
    palette: [
      { hex: '#7FE6B4', ratio: 28 },
      { hex: '#0E9F6E', ratio: 26 },
      { hex: '#0B4A38', ratio: 22 },
      { hex: '#D1FAE5', ratio: 16 },
      { hex: '#06281E', ratio: 8 }
    ],
    thumbClass: 'g-forest'
  }
]
