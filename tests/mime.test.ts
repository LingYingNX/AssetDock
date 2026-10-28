import { describe, expect, it } from 'vitest'
import { mimeForExtension } from '../src/main/services/media'

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
})
