import { describe, expect, it } from 'vitest'
import { compareVersion, parseUpdateManifest } from '../src/shared/appUpdate'
import { resolveUpdateFromTexts } from '../src/main/services/appUpdate'

describe('compareVersion', () => {
  it('orders by major, minor and patch', () => {
    expect(compareVersion('1.2.3', '1.2.3')).toBe(0)
    expect(compareVersion('1.2.4', '1.2.3')).toBe(1)
    expect(compareVersion('1.2.3', '1.2.4')).toBe(-1)
    expect(compareVersion('2.0.0', '1.9.9')).toBe(1)
    expect(compareVersion('1.10.0', '1.9.0')).toBe(1)
  })

  it('tolerates v-prefix and prerelease suffixes', () => {
    expect(compareVersion('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersion('1.1.0-beta.1', '1.0.0')).toBe(1)
  })

  it('falls back to 0.0.0 for unparseable input', () => {
    expect(compareVersion('dev', '0.0.0')).toBe(0)
    expect(compareVersion('', '1.0.0')).toBe(-1)
  })
})

describe('parseUpdateManifest', () => {
  it('parses the native manifest shape', () => {
    const manifest = parseUpdateManifest(JSON.stringify({
      version: '1.1.0',
      publishedAt: '2026-11-19',
      downloadUrl: 'https://example.com/AssetDock-1.1.0.exe',
      sizeBytes: 1024,
      notes: ['新增关于页', '修复缩略图']
    }))
    expect(manifest).toEqual({
      version: '1.1.0',
      publishedAt: '2026-11-19',
      downloadUrl: 'https://example.com/AssetDock-1.1.0.exe',
      sizeBytes: 1024,
      notes: ['新增关于页', '修复缩略图']
    })
  })

  it('normalizes a GitHub release and prefers the installer asset', () => {
    const manifest = parseUpdateManifest(JSON.stringify({
      tag_name: 'v1.2.0',
      published_at: '2026-11-19T08:00:00Z',
      body: '# 新功能\n- 更新检测\n* 进度条',
      assets: [
        { name: 'source.zip', browser_download_url: 'https://example.com/source.zip', size: 10 },
        { name: 'AssetDock-Setup-1.2.0.exe', browser_download_url: 'https://example.com/setup.exe', size: 2048 }
      ]
    }))
    expect(manifest?.version).toBe('v1.2.0')
    expect(manifest?.publishedAt).toBe('2026-11-19')
    expect(manifest?.downloadUrl).toBe('https://example.com/setup.exe')
    expect(manifest?.sizeBytes).toBe(2048)
    expect(manifest?.notes).toEqual(['新功能', '更新检测', '进度条'])
  })

  it('returns null for bad JSON or a manifest without a version', () => {
    expect(parseUpdateManifest('not json')).toBeNull()
    expect(parseUpdateManifest('[]')).toBeNull()
    expect(parseUpdateManifest(JSON.stringify({ notes: ['x'] }))).toBeNull()
  })

  it('leaves download fields empty when the release has no assets', () => {
    const manifest = parseUpdateManifest(JSON.stringify({ tag_name: 'v1.0.1', body: '' }))
    expect(manifest?.downloadUrl).toBe('')
    expect(manifest?.sizeBytes).toBeNull()
    expect(manifest?.notes).toEqual([])
  })
})

describe('resolveUpdateFromTexts', () => {
  const manifest = JSON.stringify({ version: '1.1.0', notes: ['一条更新'] })

  it('takes the first parseable source and skips null entries', () => {
    const result = resolveUpdateFromTexts('1.0.0', [null, manifest])
    expect(result.hasUpdate).toBe(true)
    expect(result.manifest?.version).toBe('1.1.0')
    expect(result.error).toBe('')
  })

  it('stops at the first usable manifest without consulting later ones', () => {
    const result = resolveUpdateFromTexts('1.1.0', [manifest, JSON.stringify({ version: '9.9.9' })])
    expect(result.hasUpdate).toBe(false)
    expect(result.manifest?.version).toBe('1.1.0')
  })

  it('reports failure when every source is empty or malformed', () => {
    expect(resolveUpdateFromTexts('1.0.0', [null, '', 'not json']).error).toBe('暂无可用更新来源')
    expect(resolveUpdateFromTexts('1.0.0', [null]).manifest).toBeNull()
  })
})
