import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  aiPreviewPath,
  countPdfPages,
  ensureAiPagePreview,
  resetAiPreviewTasks
} from '../src/main/services/aiPreview'

const roots: string[] = []
const fingerprint = '0123456789abcdef0123'

function twoPagePdf(): Buffer {
  const stream = 'BT /F1 18 Tf 20 50 Td (page) Tj ET'
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 7 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  for (let i = 0; i < bodies.length; i++) {
    offsets.push(Buffer.byteLength(out))
    out += `${i + 1} 0 obj\n${bodies[i]}\nendobj\n`
  }
  const xref = Buffer.byteLength(out)
  out += `xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${bodies.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out)
}

afterEach(async () => {
  resetAiPreviewTasks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('AI page previews', () => {
  it('counts pages and caches each page under its fingerprint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-ai-preview-'))
    roots.push(root)
    const source = join(root, 'poster.ai')
    await writeFile(source, twoPagePdf())

    expect(await countPdfPages(source)).toBe(2)
    const page2 = await ensureAiPagePreview(root, source, fingerprint, 2)
    expect(page2).toBe(aiPreviewPath(root, fingerprint, 2))
    await expect(access(page2)).resolves.toBeUndefined()
  })

  it('rejects out-of-range page requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-ai-preview-range-'))
    roots.push(root)
    const source = join(root, 'poster.ai')
    await writeFile(source, twoPagePdf())

    await expect(ensureAiPagePreview(root, source, fingerprint, 3)).rejects.toThrow()
  })
})
