import { describe, expect, it } from 'vitest'
import { isAllowedMediaReferrer, mimeForExtension, parseRangeHeader } from '../src/main/services/media'

describe('isAllowedMediaReferrer (S0-1)', () => {
  it('allows the production file:// document', () => {
    expect(isAllowedMediaReferrer('file:///C:/app/index.html')).toBe(true)
  })

  it('allows the dev server document', () => {
    expect(isAllowedMediaReferrer('http://localhost:5173/')).toBe(true)
  })

  it('allows Electron internal origins (app://, about:)', () => {
    expect(isAllowedMediaReferrer('app://bundle/index.html')).toBe(true)
    expect(isAllowedMediaReferrer('about:srcdoc')).toBe(true)
  })

  it('rejects empty referrer', () => {
    expect(isAllowedMediaReferrer('')).toBe(false)
  })

  it('rejects external http/https origins', () => {
    expect(isAllowedMediaReferrer('http://evil.example/payload.html')).toBe(false)
    expect(isAllowedMediaReferrer('https://evil.example/')).toBe(false)
  })

  it('rejects other localhost ports (dev server impersonation)', () => {
    expect(isAllowedMediaReferrer('http://localhost:9999/')).toBe(false)
    expect(isAllowedMediaReferrer('http://127.0.0.1:5173/')).toBe(false)
  })

  it('rejects malformed referrer strings', () => {
    expect(isAllowedMediaReferrer('not a url')).toBe(false)
    expect(isAllowedMediaReferrer('http://')).toBe(false)
  })
})

describe('mimeForExtension', () => {
  it('maps known extensions to their MIME types', () => {
    expect(mimeForExtension('.jpg')).toBe('image/jpeg')
    expect(mimeForExtension('.mp4')).toBe('video/mp4')
    expect(mimeForExtension('.css')).toBe('text/css')
    expect(mimeForExtension('.glb')).toBe('model/gltf-binary')
  })

  it('is case-insensitive', () => {
    expect(mimeForExtension('.JPG')).toBe('image/jpeg')
    expect(mimeForExtension('.WebP')).toBe('image/webp')
  })

  it('falls back to octet-stream for unknown extensions', () => {
    expect(mimeForExtension('.xyz')).toBe('application/octet-stream')
    expect(mimeForExtension('')).toBe('application/octet-stream')
  })
})

describe('parseRangeHeader', () => {
  const total = 1000

  it('parses a full bytes range', () => {
    expect(parseRangeHeader('bytes=100-199', total)).toEqual({ start: 100, end: 199 })
  })

  it('defaults missing start to 0', () => {
    expect(parseRangeHeader('bytes=-199', total)).toEqual({ start: 0, end: 199 })
  })

  it('defaults missing end to total-1', () => {
    expect(parseRangeHeader('bytes=900-', total)).toEqual({ start: 900, end: 999 })
  })

  it('clamps end beyond total to total-1', () => {
    expect(parseRangeHeader('bytes=0-99999', total)).toEqual({ start: 0, end: 999 })
  })

  it('falls back to whole file when start is out of range', () => {
    expect(parseRangeHeader('bytes=5000-', total)).toEqual({ start: 0, end: 999 })
    expect(parseRangeHeader('bytes=1000-2000', total)).toEqual({ start: 0, end: 999 })
  })

  it('falls back to whole file for malformed headers', () => {
    expect(parseRangeHeader('not-a-range', total)).toEqual({ start: 0, end: 999 })
    expect(parseRangeHeader('bytes=abc-def', total)).toEqual({ start: 0, end: 999 })
  })
})
