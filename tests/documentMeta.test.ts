import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { documentMetaFromParts, detectTextEncoding, probeDocumentMeta } from '../src/main/services/documentMeta'

describe('document metadata', () => {
  it('detects UTF-8, UTF-8 BOM and UTF-16 encodings', () => {
    expect(detectTextEncoding(Buffer.from('中文'))).toBe('UTF-8')
    expect(detectTextEncoding(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toBe('UTF-8 BOM')
    expect(detectTextEncoding(Buffer.from([0xff, 0xfe, 0x41, 0x00]))).toBe('UTF-16 LE')
    expect(detectTextEncoding(Buffer.from([0xfe, 0xff, 0x00, 0x41]))).toBe('UTF-16 BE')
  })

  it('counts DOCX page breaks without treating a single section as zero pages', () => {
    expect(documentMetaFromParts({ format: 'DOCX', documentXml: '<w:document/>' })).toEqual({ pageCount: 1 })
    expect(documentMetaFromParts({
      format: 'DOCX',
      documentXml: '<w:br w:type="page"/><w:lastRenderedPageBreak/>'
    })).toEqual({ pageCount: 3 })
  })

  it('counts workbook sheets and presentation slides', () => {
    expect(documentMetaFromParts({
      format: 'XLSX',
      workbookXml: '<sheets><sheet name="A"/><sheet name="B"/><sheet name="C"/></sheets>'
    })).toEqual({ sheetCount: 3 })
    expect(documentMetaFromParts({
      format: 'PPTX',
      slideNames: ['ppt/slides/slide1.xml', 'ppt/slides/slide2.xml', 'ppt/slides/_rels/slide1.xml.rels']
    })).toEqual({ slideCount: 2 })
  })

  it('leaves unknown metadata empty rather than guessing', () => {
    expect(documentMetaFromParts({ format: 'DOCX', documentXml: null })).toEqual({})
    expect(documentMetaFromParts({ format: 'XLSX', workbookXml: null })).toEqual({})
    expect(documentMetaFromParts({ format: 'PPTX', slideNames: [] })).toEqual({ slideCount: 0 })
  })

  it('counts ODP pages but not page thumbnails inside speaker notes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-odp-meta-'))
    try {
      const file = join(root, 'deck.odp')
      const zip = new JSZip()
      zip.file('content.xml', [
        '<office:presentation>',
        '<draw:page draw:name="p1"/>',
        '<draw:page draw:name="p2"/>',
        '<presentation:notes><draw:page-thumbnail draw:page-number="1"/></presentation:notes>',
        '</office:presentation>'
      ].join(''))
      await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
      expect(await probeDocumentMeta(file, 'ODP')).toEqual({ slideCount: 2 })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
