import { open, stat } from 'node:fs/promises'
import { openZip } from './documentZip'

export interface DocumentMeta {
  pageCount?: number
  sheetCount?: number
  slideCount?: number
  textEncoding?: string
}

export const MAX_TEXT_META_BYTES = 16 * 1024 * 1024

export function countMatches(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length
}

export async function readUtf8Part(zipPath: string, part: string): Promise<string | null> {
  const zip = await openZip(zipPath)
  const file = zip.file(part)
  if (!file) return null
  return file.async('string')
}

export function detectTextEncoding(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'UTF-8 BOM'
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return 'UTF-16 LE'
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) return 'UTF-16 BE'
  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return 'UTF-8'
  return 'GB18030'
}

export function documentMetaFromParts(parts: {
  format: string
  text?: Buffer
  documentXml?: string | null
  workbookXml?: string | null
  slideNames?: string[]
}): DocumentMeta {
  if (parts.format === 'TXT' || parts.format === 'MARKDOWN' || parts.format === 'CSV') {
    return parts.text ? { textEncoding: detectTextEncoding(parts.text) } : {}
  }
  if (parts.format === 'DOCX') {
    if (parts.documentXml == null) return {}
    const explicit = countMatches(parts.documentXml, /<w:br[^>]+w:type="page"/g)
    const rendered = countMatches(parts.documentXml, /<w:lastRenderedPageBreak\s*\/>/g)
    return { pageCount: Math.max(1, explicit + rendered + 1) }
  }
  if (parts.format === 'XLSX') {
    return parts.workbookXml == null ? {} : { sheetCount: countMatches(parts.workbookXml, /<(?:\w+:)?sheet\b/g) }
  }
  if (parts.format === 'PPTX') {
    return { slideCount: (parts.slideNames ?? []).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length }
  }
  return {}
}

async function probeText(absPath: string): Promise<DocumentMeta> {
  const st = await stat(absPath).catch(() => null)
  if (!st?.isFile()) return {}
  const length = Math.min(st.size, 64 * 1024)
  const handle = await open(absPath, 'r')
  try {
    const buffer = Buffer.alloc(length)
    if (length > 0) await handle.read(buffer, 0, length, 0)
    const encoding = detectTextEncoding(buffer)
    return { textEncoding: encoding }
  } finally {
    await handle.close()
  }
}

export async function probeDocumentMeta(absPath: string, format: string): Promise<DocumentMeta> {
  try {
    if (format === 'TXT' || format === 'MARKDOWN' || format === 'CSV') {
      const st = await stat(absPath)
      if (st.size > MAX_TEXT_META_BYTES) return {}
      return await probeText(absPath)
    }
    if (format === 'DOCX') {
      const doc = await readUtf8Part(absPath, 'word/document.xml')
      return documentMetaFromParts({ format, documentXml: doc })
    }
    if (format === 'XLSX') {
      const workbook = await readUtf8Part(absPath, 'xl/workbook.xml')
      return documentMetaFromParts({ format, workbookXml: workbook })
    }
    if (format === 'PPTX') {
      const zip = await openZip(absPath)
      return documentMetaFromParts({ format, slideNames: Object.keys(zip.files) })
    }
    if (format === 'ODP') {
      const content = await readUtf8Part(absPath, 'content.xml')
      if (content == null) return {}
      // `<draw:page-thumbnail` 也会命中 `\b`，必须要求空白或 `>` 紧跟。
      return { slideCount: countMatches(content, /<draw:page[\s>]/g) }
    }
    return {}
  } catch {
    return {}
  }
}
