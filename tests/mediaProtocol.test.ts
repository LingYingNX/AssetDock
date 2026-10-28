import { describe, expect, it } from 'vitest'
import { hostToLibId, isAllowedMediaReferrer, isValidThumbFingerprint, mimeForExtension, parseRangeHeader } from '../src/main/services/media'

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

  it('allows empty referrer only for the production file document', () => {
    expect(isAllowedMediaReferrer('')).toBe(false)
    expect(isAllowedMediaReferrer('', true)).toBe(true)
  })

  it('rejects external http/https origins', () => {
    expect(isAllowedMediaReferrer('http://evil.example/payload.html')).toBe(false)
    expect(isAllowedMediaReferrer('https://evil.example/')).toBe(false)
  })

  it('rejects other localhost ports (dev server impersonation)', () => {
    expect(isAllowedMediaReferrer('http://localhost:9999/')).toBe(false)
    expect(isAllowedMediaReferrer('http://127.0.0.1:5173/')).toBe(false)
  })

  it('follows the dev server origin chosen by electron-vite', () => {
    const previous = process.env.ELECTRON_RENDERER_URL
    process.env.ELECTRON_RENDERER_URL = 'http://localhost:5174/'
    try {
      expect(isAllowedMediaReferrer('http://localhost:5174/')).toBe(true)
      expect(isAllowedMediaReferrer('http://localhost:9999/')).toBe(false)
    } finally {
      if (previous == null) delete process.env.ELECTRON_RENDERER_URL
      else process.env.ELECTRON_RENDERER_URL = previous
    }
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

describe('isValidThumbFingerprint', () => {
  it('accepts the 20-character content fingerprint format', () => {
    expect(isValidThumbFingerprint('0123456789abcdefABCD')).toBe(true)
  })

  it('rejects path fragments and arbitrary cache keys', () => {
    expect(isValidThumbFingerprint('../../Windows/file')).toBe(false)
    expect(isValidThumbFingerprint('fp')).toBe(false)
    expect(isValidThumbFingerprint('')).toBe(false)
  })
})

describe('hostToLibId', () => {
  it('accepts both raw and WHATWG-normalized numeric hosts', () => {
    expect(hostToLibId('1')).toBe(1)
    expect(hostToLibId('0.0.0.1')).toBe(1)
    expect(hostToLibId('0.0.1.0')).toBe(256)
  })

  it('rejects non-IPv4 and out-of-range hosts', () => {
    expect(Number.isNaN(hostToLibId('library'))).toBe(true)
    expect(Number.isNaN(hostToLibId('0.0.0.256'))).toBe(true)
  })
})

describe('parseRangeHeader', () => {
  const total = 1000

  it('parses a full bytes range', () => {
    expect(parseRangeHeader('bytes=100-199', total)).toEqual({ start: 100, end: 199 })
  })

  it('returns the final bytes for a suffix range', () => {
    expect(parseRangeHeader('bytes=-199', total)).toEqual({ start: 801, end: 999 })
    expect(parseRangeHeader('bytes=-200', total)).toEqual({ start: 800, end: 999 })
  })

  it('defaults missing end to total-1', () => {
    expect(parseRangeHeader('bytes=900-', total)).toEqual({ start: 900, end: 999 })
  })

  it('clamps end beyond total to total-1', () => {
    expect(parseRangeHeader('bytes=0-99999', total)).toEqual({ start: 0, end: 999 })
  })

  it('rejects a range whose start is out of bounds', () => {
    expect(parseRangeHeader('bytes=5000-', total)).toBeNull()
    expect(parseRangeHeader('bytes=1000-2000', total)).toBeNull()
  })

  it('rejects malformed and inverted ranges', () => {
    expect(parseRangeHeader('not-a-range', total)).toBeNull()
    expect(parseRangeHeader('bytes=abc-def', total)).toBeNull()
    expect(parseRangeHeader('bytes=900-100', total)).toBeNull()
    expect(parseRangeHeader('bytes=-0', total)).toBeNull()
  })
})
