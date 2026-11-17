import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import { fingerprint } from '../src/main/services/fingerprint'
import {
  ensureDocumentPreview,
  DOCUMENT_RENDERER_VERSION,
  parseCsvTable,
  documentPreviewPath,
  documentThumbnailHtml,
  trimLeadingBlankDocHtml
} from '../src/main/services/documentPreview'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mediahub-document-preview-'))
  roots.push(root)
  return root
}

async function writeAndFingerprint(path: string): Promise<string> {
  const data = await readFile(path)
  return fingerprint(path, data.length, 1)
}

describe('document preview', () => {
  it('parses quoted CSV cells and embedded newlines as a real table', () => {
    const rows = parseCsvTable('name,note\n张三,"第一行\n第二行"\n李四,"a,b"')
    expect(rows).toEqual([
      ['name', 'note'],
      ['张三', '第一行\n第二行'],
      ['李四', 'a,b']
    ])
  })

  it('detects tab-separated text without splitting on commas inside quotes', () => {
    const rows = parseCsvTable('name\tnote\n张三\t"a,b"')
    expect(rows).toEqual([
      ['name', 'note'],
      ['张三', 'a,b']
    ])
  })

  it('trims only leading blank DOC paragraphs and keeps later spacing', () => {
    const html = '<style>.msdoc{}</style><p class="msdoc-paragraph"><br /></p><p></p><p>标题</p><p><br /></p><p>正文</p>'
    expect(trimLeadingBlankDocHtml(html)).toBe('<style>.msdoc{}</style><p>标题</p><p><br /></p><p>正文</p>')
  })

  it('renders a markdown table into HTML and caches by fingerprint', async () => {
    const root = await tempRoot()
    const file = join(root, 'notes.md')
    await writeFile(file, '# 标题\n\n| 名称 | 数值 |\n| --- | --- |\n| 一 | 2 |\n\n<script>alert(1)</script>')
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'MARKDOWN', { relPath: 'notes.md', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.shape).toBe('markdown')
    expect(preview.html).toContain('<table>')
    expect(preview.html).not.toContain('<script')
    expect(JSON.parse(await readFile(documentPreviewPath(root, fp), 'utf8'))).toMatchObject({ format: 'MARKDOWN' })
    expect(await ensureDocumentPreview(root, file, fp, 'MARKDOWN', { relPath: 'notes.md', mtimeMs: 1, sizeBytes: 1 })).toEqual(preview)
  })

  it('renders standalone HTML as sanitized read-only content', async () => {
    const root = await tempRoot()
    const file = join(root, 'page.html')
    await writeFile(file, [
      '<!doctype html><html><head><style>.card{color:rgb(255,0,0);background:url(https://example.com/bg.png)}</style></head>',
      '<body><div class="card">安全内容</div><script>alert(1)</script><img src="https://example.com/a.png"></body></html>'
    ].join(''))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'HTML', { relPath: 'page.html', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.shape).toBe('html')
    expect(preview.pageCount).toBe(1)
    expect(preview.html).toContain('class="card"')
    expect(preview.html).toContain('安全内容')
    expect(preview.html).not.toContain('<script')
    expect(preview.html).not.toContain('alert(1)')
    expect(preview.html).not.toContain('https://example.com')
    expect(documentThumbnailHtml(preview)).toContain('安全内容')
  })

  it('keeps the HTML <title> out of the preview body', async () => {
    const root = await tempRoot()
    const file = join(root, 'titled.html')
    await writeFile(file, [
      '<!doctype html><html><head><title>素材加载中</title><style>.mini-loader{width:240px}</style></head>',
      '<body><div class="mini-loader"><span>准备加载...</span></div></body></html>'
    ].join(''))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'HTML', { relPath: 'titled.html', mtimeMs: 1, sizeBytes: 1 })
    // <title> 是被清洗成裸文本后落进正文的,标题不该出现在预览内容里
    expect(preview.html).not.toContain('素材加载中')
    expect(preview.html).toContain('准备加载...')
    expect(preview.html).toContain('.mini-loader')
  })

  it('renders the HTML thumbnail full-bleed instead of inside a padded paper sheet', () => {
    const thumb = documentThumbnailHtml({
      rendererVersion: DOCUMENT_RENDERER_VERSION,
      format: 'HTML',
      shape: 'html',
      fingerprint: 'abc123def456abc123de',
      generatedAt: new Date().toISOString(),
      pageCount: 1,
      html: '<div class="mini-loader">x</div>'
    })
    // 白纸容器带 30px 内边距:HTML 用它会让作品缩成一小块、四周留白边
    expect(thumb).not.toContain('class="doc-thumb"')
    expect(thumb).toContain('width:900px;height:675px')
    expect(thumb).toContain('class="mini-loader"')
  })

  it('inlines library-local markdown images and drops paths outside the library', async () => {
    const root = await tempRoot()
    const outside = await tempRoot()
    const folder = join(root, 'notes')
    const assets = join(root, 'assets')
    const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
    await mkdir(folder, { recursive: true })
    await mkdir(assets, { recursive: true })
    await writeFile(join(folder, 'pixel.png'), pixel)
    await writeFile(join(assets, 'pixel.png'), pixel)
    await writeFile(join(outside, 'secret.png'), pixel)
    const outsideRef = relative(folder, join(outside, 'secret.png')).replace(/\\/g, '/')
    const file = join(folder, 'readme.md')
    await writeFile(file, [
      '![sibling](pixel.png)',
      '',
      '![cross-folder](../assets/pixel.png)',
      '',
      `![outside](${outsideRef})`,
      '',
      '![absolute](/etc/pixel.png)',
      '',
      '![remote](https://example.com/a.png)'
    ].join('\n'))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'MARKDOWN', { relPath: 'notes/readme.md', mtimeMs: 1, sizeBytes: 1 })
    expect((preview.html?.match(/data:image\/png;base64,/g) ?? []).length).toBe(2)
    expect(preview.html).not.toContain('secret.png')
    expect(preview.html).not.toContain('/etc/pixel.png')
    expect(preview.html).not.toContain('https://example.com/a.png')
  })

  it('reads UTF-16 text without mojibake', async () => {
    const root = await tempRoot()
    const file = join(root, 'utf16.txt')
    const body = Buffer.from('\ufeff中文内容', 'utf16le')
    await writeFile(file, body)
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'TXT', { relPath: 'utf16.txt', mtimeMs: 1, sizeBytes: body.length })
    expect(preview.text).toBe('中文内容')
    expect(preview.textEncoding).toBe('UTF-16 LE')
  })

  it('does not decode uninitialized bytes from an odd-length UTF-16 BE file', async () => {
    const root = await tempRoot()
    const file = join(root, 'broken-utf16be.txt')
    // "中" 的大端字节 + 一个孤立尾字节；解码器不能把未初始化缓冲区带进文本。
    await writeFile(file, Buffer.from([0xfe, 0xff, 0x4e, 0x2d, 0x00]))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'TXT', { relPath: 'broken-utf16be.txt', mtimeMs: 1, sizeBytes: 5 })
    expect(preview.text).toBe('中')
  })

  it('puts a resource-blocking CSP on document thumbnail HTML', () => {
    const html = documentThumbnailHtml({
      rendererVersion: DOCUMENT_RENDERER_VERSION,
      format: 'TXT',
      shape: 'text',
      fingerprint: 'a'.repeat(20),
      generatedAt: new Date().toISOString(),
      text: '正文'
    })
    expect(html).toContain('<meta charset="utf-8">')
    expect(html).toContain('Content-Security-Policy')
    expect(html).toContain("default-src 'none'")
    expect(html).toContain('connect-src \'none\'')
  })

  it('parses a real minimal DOCX through docx-preview', async () => {
    const root = await tempRoot()
    const file = join(root, 'plan.docx')
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p></w:body></w:document>')
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'DOCX', { relPath: 'plan.docx', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBeUndefined()
    expect(preview.html).toContain('Hello DOCX')
  })

  it('sanitizes active CSS in DOCX output', async () => {
    const root = await tempRoot()
    const file = join(root, 'styled.docx')
    const zip = new JSZip()
    zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:shd w:fill="FF0000"/></w:pPr><w:r><w:t>Safe</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>')
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'DOCX', { relPath: 'styled.docx', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBeUndefined()
    expect(preview.html).toContain('<style>')
    expect(preview.html).not.toMatch(/url\s*\(/i)
    expect(preview.html).not.toMatch(/@import/i)
    expect(preview.html).not.toContain('<script')
  })

  it('reads a real XLSX workbook with sheets, merged cells and styles', async () => {
    const root = await tempRoot()
    const file = join(root, 'book.xlsx')
    const workbook = new ExcelJS.Workbook()
    const first = workbook.addWorksheet('汇总')
    first.getCell('A1').value = '标题'
    first.getCell('A1').font = { bold: true, color: { argb: 'FF336699' } }
    first.mergeCells('A1:B1')
    first.getCell('A2').value = 42
    first.getCell('A2').numFmt = '0.00'
    first.getColumn(1).width = 24
    workbook.addWorksheet('明细').getCell('A1').value = '第二表'
    await workbook.xlsx.writeFile(file)
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'XLSX', { relPath: 'book.xlsx', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBeUndefined()
    expect(preview.sheetCount).toBe(2)
    expect(preview.sheets?.[0].name).toBe('汇总')
    expect(preview.sheets?.[0].cells.find((cell) => cell.row === 1 && cell.col === 1)).toMatchObject({
      value: '标题',
      colSpan: 2,
      style: { bold: true, color: '#336699' }
    })
  })

  it('reads a BIFF8 XLS through SheetJS with merges, widths and number formats', async () => {
    const root = await tempRoot()
    const file = join(root, 'legacy.xls')
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet([['标题', ''], [42, '中文内容']])
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]
    sheet['!cols'] = [{ wch: 24 }, { wch: 12 }]
    sheet.A2.z = '0.00'
    XLSX.utils.book_append_sheet(workbook, sheet, '汇总')
    await writeFile(file, XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer)
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'XLS', { relPath: 'legacy.xls', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBeUndefined()
    expect(preview.sheetCount).toBe(1)
    expect(preview.sheets?.[0].name).toBe('汇总')
    // BIFF 只存字符宽度,SheetJS 换算成像素;只断言宽列比窄列宽,不做像素级绑定
    expect(preview.sheets?.[0].columns[0]).toBeGreaterThan(preview.sheets?.[0].columns[1] ?? 0)
    expect(preview.sheets?.[0].columns[0]).toBeLessThanOrEqual(480)
    expect(preview.sheets?.[0].cells.find((cell) => cell.row === 1 && cell.col === 1)).toMatchObject({
      value: '标题',
      colSpan: 2
    })
    expect(preview.sheets?.[0].cells.find((cell) => cell.row === 2 && cell.col === 1)).toMatchObject({
      value: '42.00',
      style: { numberFormat: '0.00' }
    })
  })

  it('reads ODS, FODS and XLSB workbooks through the same SheetJS path', async () => {
    for (const [bookType, format] of [['ods', 'ODS'], ['fods', 'FODS'], ['xlsb', 'XLSB']] as const) {
      const root = await tempRoot()
      const file = join(root, `table.${format.toLowerCase()}`)
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['名称', '数量'], ['苹果', 3]]), '库存')
      await writeFile(file, XLSX.write(workbook, { type: 'buffer', bookType }) as Buffer)
      const fp = await writeAndFingerprint(file)
      const preview = await ensureDocumentPreview(root, file, fp, format, { relPath: file, mtimeMs: 1, sizeBytes: 1 })
      expect(preview.failure).toBeUndefined()
      expect(preview.sheets?.[0].name).toBe('库存')
      expect(preview.sheets?.[0].cells.map((cell) => cell.value)).toEqual(['名称', '数量', '苹果', '3'])
    }
  })

  it('degrades an oversized binary spreadsheet before parsing it', async () => {
    const root = await tempRoot()
    const file = join(root, 'huge.xls')
    const handle = await open(file, 'w')
    await handle.truncate(33 * 1024 * 1024)
    await handle.close()
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'XLS', { relPath: 'huge.xls', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBe('too-large')
  })

  it('degrades an XLS with too many merged ranges', async () => {
    const root = await tempRoot()
    const file = join(root, 'merges.xls')
    const workbook = XLSX.utils.book_new()
    const sheet = XLSX.utils.aoa_to_sheet(Array.from({ length: 2001 }, (_, index) => [`r${index}`, '']))
    sheet['!merges'] = Array.from({ length: 2001 }, (_, index) => ({ s: { r: index, c: 0 }, e: { r: index, c: 1 } }))
    XLSX.utils.book_append_sheet(workbook, sheet, 'M')
    await writeFile(file, XLSX.write(workbook, { type: 'buffer', bookType: 'biff8' }) as Buffer)
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'XLS', { relPath: 'merges.xls', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBe('too-large')
    expect(preview.failureDetail).toContain('merged ranges')
  })

  it('parses the real PPTX fixture into positioned slides', async () => {
    const root = await tempRoot()
    const file = join(root, 'deck.pptx')
    await writeFile(file, await readFile(join(process.cwd(), 'node_modules', 'pptx2json', 'fixtures', 'test.pptx')))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'PPTX', { relPath: 'deck.pptx', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBeUndefined()
    expect(preview.slideCount).toBeGreaterThan(0)
    expect(preview.slides?.[0].elements.length).toBeGreaterThan(0)
    expect(preview.slides?.[0].elements.some((element) => element.w > 0 && element.h > 0)).toBe(true)
  })

  it('records corrupt OOXML as a failure instead of throwing', async () => {
    const root = await tempRoot()
    const file = join(root, 'broken.xlsx')
    await writeFile(file, 'not a zip')
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'XLSX', { relPath: 'broken.xlsx', mtimeMs: 1, sizeBytes: 9 })
    expect(preview.failure).toBe('corrupt')
    expect(await readFile(documentPreviewPath(root, fp), 'utf8')).toContain('"failure":"corrupt"')
  })

  it('classifies a malformed legacy DOC as corrupt', async () => {
    const root = await tempRoot()
    const file = join(root, 'broken.doc')
    await writeFile(file, 'not an OLE document')
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'DOC', { relPath: 'broken.doc', mtimeMs: 1, sizeBytes: 19 })
    expect(preview.shape).toBe('doc')
    expect(preview.failure).toBe('corrupt')
    expect(await readFile(documentPreviewPath(root, fp), 'utf8')).toContain('"failure":"corrupt"')
  })

  /* ExcelJS 遇到几万个合并区域会把主线程卡几分钟,必须在进入它之前拦下。 */
  it('degrades an XLSX with too many merged ranges before handing it to ExcelJS', async () => {
    const root = await tempRoot()
    const file = join(root, 'merges.xlsx')
    const zip = new JSZip()
    const merges = Array.from({ length: 2001 }, () => '<mergeCell ref="A1:B1"/>').join('')
    zip.file('xl/worksheets/sheet1.xml', `<worksheet><mergeCells>${merges}</mergeCells></worksheet>`)
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'XLSX', { relPath: 'merges.xlsx', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBe('too-large')
    expect(preview.failureDetail).toContain('merged ranges')
  })

  it('classifies an oversized OOXML package as too-large instead of corrupt', async () => {
    const root = await tempRoot()
    const file = join(root, 'huge.docx')
    const handle = await open(file, 'w')
    await handle.truncate(129 * 1024 * 1024)
    await handle.close()
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'DOCX', { relPath: 'huge.docx', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.failure).toBe('too-large')
  })

  it('force retry bypasses a cached failure after the source is repaired', async () => {
    const root = await tempRoot()
    const file = join(root, 'repair.txt')
    await writeFile(file, '')
    const fp = await writeAndFingerprint(file)
    const first = await ensureDocumentPreview(root, file, fp, 'TXT', { relPath: 'repair.txt', mtimeMs: 1, sizeBytes: 0 })
    expect(first.failure).toBeUndefined()
    await writeFile(documentPreviewPath(root, fp), JSON.stringify({ ...first, failure: 'corrupt' }))
    expect((await ensureDocumentPreview(root, file, fp, 'TXT', { relPath: 'repair.txt', mtimeMs: 1, sizeBytes: 0 })).failure).toBe('corrupt')
    const retried = await ensureDocumentPreview(root, file, fp, 'TXT', { relPath: 'repair.txt', mtimeMs: 1, sizeBytes: 0 }, { force: true })
    expect(retried.failure).toBeUndefined()
    expect(retried.text).toBe('')
  })

  it('invalidates a cached failure written by an older renderer version', async () => {
    const root = await tempRoot()
    const file = join(root, 'versioned.txt')
    await writeFile(file, 'fresh')
    const fp = await writeAndFingerprint(file)
    const cachePath = documentPreviewPath(root, fp)
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify({
      rendererVersion: DOCUMENT_RENDERER_VERSION - 1,
      format: 'TXT',
      shape: 'text',
      fingerprint: fp,
      generatedAt: new Date().toISOString(),
      failure: 'corrupt'
    }))
    const preview = await ensureDocumentPreview(root, file, fp, 'TXT', { relPath: 'versioned.txt', mtimeMs: 1, sizeBytes: 5 })
    expect(preview.failure).toBeUndefined()
    expect(preview.text).toBe('fresh')
  })

  it('renders ODT headings, styled runs, tables and embedded images into sanitized HTML', async () => {
    const root = await tempRoot()
    const file = join(root, 'notes.odt')
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.text')
    zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0">
  <office:automatic-styles>
    <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold" fo:color="#c00000"/></style:style>
    <style:style style:name="P1" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>
  </office:automatic-styles>
  <office:body><office:text>
    <text:h text:outline-level="1">章节标题</text:h>
    <text:p text:style-name="P1">正文 <text:span text:style-name="T1">重点</text:span></text:p>
    <table:table>
      <table:table-column table:number-columns-repeated="2"/>
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p>A1</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>B1</text:p></table:table-cell>
      </table:table-row>
      <table:table-row>
        <table:table-cell table:number-columns-spanned="2" office:value-type="string"><text:p>合并格</text:p></table:table-cell>
      </table:table-row>
    </table:table>
    <text:p><draw:frame><draw:image xlink:href="Pictures/pixel.png"/></draw:frame></text:p>
    <text:p>安全<script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script></text:p>
  </office:text></office:body>
</office:document-content>`)
    zip.file('Pictures/pixel.png', Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ))
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'ODT', { relPath: 'notes.odt', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.shape).toBe('doc')
    expect(preview.html).toContain('<h1')
    expect(preview.html).toContain('text-align:center')
    expect(preview.html).toContain('font-weight:700')
    expect(preview.html).toContain('<table>')
    expect(preview.html).toContain('A1')
    expect(preview.html).toContain('colspan="2"')
    expect(preview.html).toContain('data:image/png;base64,')
    expect(preview.html).not.toContain('<script')
  })

  it('maps ODP pages onto positioned slide elements', async () => {
    const root = await tempRoot()
    const file = join(root, 'deck.odp')
    const zip = new JSZip()
    zip.file('mimetype', 'application/vnd.oasis.opendocument.presentation')
    zip.file('styles.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">
  <office:automatic-styles>
    <style:page-layout style:name="PM1"><style:page-layout-properties fo:page-width="28cm" fo:page-height="15.75cm"/></style:page-layout>
  </office:automatic-styles>
  <office:master-styles><style:master-page style:name="Default" style:page-layout-name="PM1"/></office:master-styles>
</office:document-styles>`)
    zip.file('content.xml', `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
  xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
  xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
  xmlns:xlink="http://www.w3.org/1999/xlink">
  <office:body><office:presentation>
    <draw:page draw:name="p1" draw:master-page-name="Default">
      <draw:frame svg:x="1cm" svg:y="1cm" svg:width="10cm" svg:height="3cm" draw:z-index="1">
        <draw:text-box><text:p>第一页</text:p></draw:text-box>
      </draw:frame>
      <draw:frame svg:x="1cm" svg:y="5cm" svg:width="6cm" svg:height="4cm" draw:z-index="2">
        <draw:image xlink:href="Pictures/pixel.png"/>
      </draw:frame>
    </draw:page>
    <draw:page draw:name="p2" draw:master-page-name="Default">
      <draw:frame svg:x="2cm" svg:y="2cm" svg:width="8cm" svg:height="2cm" draw:z-index="1">
        <draw:text-box><text:p>第二页</text:p></draw:text-box>
      </draw:frame>
    </draw:page>
  </office:presentation></office:body>
</office:document-content>`)
    zip.file('Pictures/pixel.png', Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    ))
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'ODP', { relPath: 'deck.odp', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.shape).toBe('slides')
    expect(preview.slideCount).toBe(2)
    expect(preview.slides?.[0].width).toBe(1058)
    expect(preview.slides?.[0].height).toBe(595)
    expect(preview.slides?.[0].elements.some((el) => el.kind === 'text' && el.text?.includes('第一页'))).toBe(true)
    expect(preview.slides?.[0].elements.some((el) => el.kind === 'image' && el.src?.startsWith('data:image/png'))).toBe(true)
    expect(preview.slides?.[1].elements.some((el) => el.text?.includes('第二页'))).toBe(true)
  })

  it('renders RTF tables, GBK text and unicode escapes without leaking control words', async () => {
    const root = await tempRoot()
    const file = join(root, 'note.rtf')
    const body = String.raw`{\rtf1\ansi\ansicpg936\uc1{\fonttbl{\f0 SimSun;}}{\colortbl ;\red255\green0\blue0;}
\pard\qc\f0\fs28 \b \u31895?\u20307?\b0 \u25991?\'d7\'d6\par
\trowd\cellx2000\cellx4000\intbl \u30002?\cell \u20057?\cell\row\pard \u23614?\u37096?\u22995?\par
{\*\generator Test;}{\*\shppict{\pict\pngblip\picwgoal300 89504e470d0a1a0a}}`
    await writeFile(file, Buffer.from(body, 'latin1'))
    const fp = await writeAndFingerprint(file)
    const preview = await ensureDocumentPreview(root, file, fp, 'RTF', { relPath: 'note.rtf', mtimeMs: 1, sizeBytes: 1 })
    expect(preview.shape).toBe('doc')
    expect(preview.html).toContain('font-weight:700')
    expect(preview.html).toContain('text-align:center')
    expect(preview.html).toContain('字')
    expect(preview.html).toContain('姓')
    expect(preview.html).toContain('粗')
    expect(preview.html).toContain('体')
    expect(preview.html).toContain('<table>')
    expect(preview.html).toContain('甲')
    expect(preview.html).toContain('data:image/png;base64,')
    expect(preview.html).not.toContain('fonttbl')
    expect(preview.html).not.toContain('generator')
  })
})
