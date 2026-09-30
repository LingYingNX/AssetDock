import { describe, it, expect } from 'vitest'
import { isIgnored, detectKind } from '../src/main/services/ignore'

describe('ignore rules', () => {
  it('whitelist extensions pass', () => {
    expect(isIgnored('a.jpg')).toBe(false)
    expect(isIgnored('sub/b.MP4')).toBe(false)
    expect(isIgnored('x/y/c.glb')).toBe(false)
  })
  it('non-whitelist extensions are ignored', () => {
    expect(isIgnored('a.txt')).toBe(true)
    expect(isIgnored('b.docx')).toBe(true)
    expect(isIgnored('noext')).toBe(true)
  })
  it('hidden/temp/cache files are ignored even with valid ext', () => {
    expect(isIgnored('~$a.psd')).toBe(true)
    expect(isIgnored('b.tmp')).toBe(true)
    expect(isIgnored('c.crdownload')).toBe(true)
    expect(isIgnored('.hidden/a.jpg')).toBe(true)
    expect(isIgnored('thumbs/x.jpg')).toBe(true)
    expect(isIgnored('.mediahub/y.png')).toBe(true)
  })
  it('detectKind maps extensions', () => {
    expect(detectKind('a.jpg')?.format).toBe('JPG')
    expect(detectKind('a.jpeg')?.format).toBe('JPG')
    expect(detectKind('a.mov')?.type).toBe('video')
    expect(detectKind('a.obj')).toEqual({ type: 'model', format: 'OBJ' })
    expect(detectKind('a.txt')).toBeNull()
  })
  it('css is a whitelisted style asset', () => {
    expect(isIgnored('a.css')).toBe(false)
    expect(isIgnored('styles/loader.CSS')).toBe(false)
    expect(detectKind('a/b.css')).toEqual({ type: 'style', format: 'CSS' })
    // 白名单只认扩展名,内容不是 CSS 也照样入库(与其它格式一致)
    expect(isIgnored('.hidden/a.css')).toBe(true)
  })
})