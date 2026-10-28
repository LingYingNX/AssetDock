import { describe, expect, it } from 'vitest'
import {
  FORMAT_GROUPS,
  FORMAT_OPTIONS,
  FORMAT_SPECS,
  detectFormat,
  duplicateExtensions,
  formatSpec,
  isSupportedExtension,
  needsVideoTranscode
} from '../src/shared/formats'

describe('format registry', () => {
  it('has no duplicate extensions', () => {
    expect(duplicateExtensions()).toEqual([])
  })

  it('detects aliases case-insensitively and keeps canonical formats', () => {
    expect(detectFormat('a.JPEG')?.format).toBe('JPG')
    expect(detectFormat('a.gltf')?.format).toBe('GLB')
    expect(detectFormat('a.heif')?.format).toBe('HEIC')
    expect(detectFormat('a.vrm')?.format).toBe('VRM')
    expect(detectFormat('a.pmx')?.type).toBe('model')
    expect(detectFormat('a.mkv')?.type).toBe('video')
    expect(detectFormat('a.ai')?.preview).toBe('pdf')
    expect(detectFormat('a.c4d')?.external).toBe('cinema4d')
    expect(detectFormat('a.MD')?.format).toBe('MARKDOWN')
    expect(detectFormat('a.markdown')?.format).toBe('MARKDOWN')
    expect(detectFormat('a.docx')?.type).toBe('document')
    expect(detectFormat('a.doc')).toMatchObject({
      type: 'document',
      format: 'DOC',
      probe: 'document',
      thumbnail: 'document',
      preview: 'document',
      documentShape: 'doc'
    })
    expect(detectFormat('a.xlsx')?.documentShape).toBe('sheet')
    expect(detectFormat('a.pptx')?.preview).toBe('document')
    expect(detectFormat('a.wps')?.external).toBe('office')
    expect(detectFormat('a.rtf')?.preview).toBe('document')
    expect(detectFormat('a.odt')?.shape).toBeUndefined()
    expect(detectFormat('a.odt')?.documentShape).toBe('doc')
    expect(detectFormat('a.odp')?.documentShape).toBe('slides')
    expect(detectFormat('a.odt')?.external).toBeUndefined()
  })

  it('rejects unknown and extensionless paths', () => {
    expect(detectFormat('a.unknown')).toBeNull()
    expect(detectFormat('noext')).toBeNull()
    expect(detectFormat('.hidden')).toBeNull()
    expect(isSupportedExtension('EXR')).toBe(true)
    expect(isSupportedExtension('docx')).toBe(true)
    expect(isSupportedExtension('TXT')).toBe(true)
  })

  it('exposes one option per canonical format', () => {
    const formats = FORMAT_OPTIONS.map((spec) => spec.format)
    expect(new Set(formats).size).toBe(formats.length)
    expect(formats).toContain('AI')
    expect(formats).toContain('PSD')
    expect(formats).toContain('BLEND')
    expect(formats).toContain('C4D')
    expect(formats).toContain('HDR')
    expect(formats).toContain('EXR')
    expect(formats).toContain('MARKDOWN')
    expect(formats).toContain('DOC')
    expect(formats).toContain('DOCX')
    expect(formats).toContain('XLSX')
    expect(formats).toContain('PPTX')
  })

  it('covers every canonical format in exactly one UI group', () => {
    const grouped = FORMAT_GROUPS.flatMap((group) => group.formats)
    expect(new Set(grouped).size).toBe(grouped.length)
    expect(new Set(grouped)).toEqual(new Set(FORMAT_OPTIONS.map((spec) => spec.format)))
    for (const group of FORMAT_GROUPS) {
      for (const format of group.formats) {
        expect(formatSpec(format)?.type).toBe(group.type)
      }
    }
    expect(FORMAT_GROUPS.find((group) => group.type === 'document')?.formats).toContain('DOCX')
  })

  it('transcodes only video containers that Chromium cannot stream directly', () => {
    expect(needsVideoTranscode('MP4')).toBe(false)
    expect(needsVideoTranscode('WEBM')).toBe(false)
    expect(needsVideoTranscode('MKV')).toBe(true)
    expect(needsVideoTranscode('AVI')).toBe(true)
    expect(needsVideoTranscode('JPG')).toBe(false)
  })

  it('keeps every registry entry attached to a real extension', () => {
    for (const spec of FORMAT_SPECS) {
      expect(detectFormat(`sample.${spec.ext}`)?.format).toBe(spec.format)
    }
  })
})
