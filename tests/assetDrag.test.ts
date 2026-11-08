import { describe, expect, it } from 'vitest'
import { downloadUrlForPath } from '../src/renderer/src/data/asset-drag'

describe('downloadUrlForPath', () => {
  it('把 Windows 绝对路径编码成 Chromium DownloadURL', () => {
    expect(downloadUrlForPath('E:\\素材 目录\\图片 1.png')).toBe(
      'application/octet-stream:图片 1.png:file:///E:/%E7%B4%A0%E6%9D%90%20%E7%9B%AE%E5%BD%95/%E5%9B%BE%E7%89%87%201.png'
    )
  })

  it('UNC 路径保留主机名并编码共享目录', () => {
    expect(downloadUrlForPath('\\\\server\\共享 目录\\a.png')).toBe(
      'application/octet-stream:a.png:file://server/%E5%85%B1%E4%BA%AB%20%E7%9B%AE%E5%BD%95/a.png'
    )
  })

  it('没有文件名时返回 null', () => {
    expect(downloadUrlForPath('E:\\')).toBeNull()
  })
})
