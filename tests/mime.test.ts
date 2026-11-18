import { describe, expect, it } from 'vitest'
import { mimeForExtension, HTML_PREVIEW_CSP } from '../src/main/services/media'

describe('media mime map', () => {
  it('serves css and html as text', () => {
    expect(mimeForExtension('.css')).toBe('text/css')
    expect(mimeForExtension('.HTML')).toBe('text/html')
    expect(mimeForExtension('.htm')).toBe('text/html')
    expect(mimeForExtension('.txt')).toBe('text/plain')
    expect(mimeForExtension('.md')).toBe('text/markdown')
    expect(mimeForExtension('.csv')).toBe('text/csv')
    expect(mimeForExtension('.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(mimeForExtension('.xlsx')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    expect(mimeForExtension('.pptx')).toBe('application/vnd.openxmlformats-officedocument.presentationml.presentation')
  })

  it('keeps existing media types', () => {
    expect(mimeForExtension('.png')).toBe('image/png')
    expect(mimeForExtension('.mp4')).toBe('video/mp4')
  })

  it('falls back to a binary stream for unknown extensions', () => {
    expect(mimeForExtension('.xyz')).toBe('application/octet-stream')
    expect(mimeForExtension('')).toBe('application/octet-stream')
  })

  it('allows external script, style and font CDN resources in HTML_PREVIEW_CSP for UI components', () => {
    expect(HTML_PREVIEW_CSP).toContain("script-src 'unsafe-inline' 'unsafe-eval' https: http: data: blob:;")
    expect(HTML_PREVIEW_CSP).toContain("style-src 'unsafe-inline' https: http: data:;")
    expect(HTML_PREVIEW_CSP).toContain("img-src media: data: blob: https: http:;")
    expect(HTML_PREVIEW_CSP).toContain("font-src data: https: http: media:;")
  })
})
