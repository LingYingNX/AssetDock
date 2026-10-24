import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { writePsd } from 'ag-psd'
import { afterEach, describe, expect, it } from 'vitest'
import { probeImageMeta } from '../src/main/services/formatProbe'

const roots: string[] = []

async function tempFile(name: string, data: string | Buffer | Uint8Array): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'mediahub-probe-'))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, data)
  return path
}

function minimalPdf(width: number, height: number): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Contents 4 0 R >>`,
    '<< /Length 0 >>\nstream\n\nendstream'
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((content, index) => {
    offsets.push(Buffer.byteLength(body, 'utf8'))
    body += `${index + 1} 0 obj\n${content}\nendobj\n`
  })
  const xref = Buffer.byteLength(body, 'utf8')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(body, 'utf8')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('image metadata probes', () => {
  it('reads sharp image dimensions', async () => {
    const path = await tempFile('sample.png', await sharp({
      create: { width: 13, height: 7, channels: 4, background: '#ffffff' }
    }).png().toBuffer())
    await expect(probeImageMeta(path, 'sample.png')).resolves.toEqual({ width: 13, height: 7 })
  })

  it('reads PSD canvas dimensions without decoding layers', async () => {
    const psd = writePsd({ width: 21, height: 9 })
    const path = await tempFile('sample.psd', Buffer.from(psd))
    await expect(probeImageMeta(path, 'sample.psd')).resolves.toEqual({ width: 21, height: 9 })
  })

  it('reads PDF-compatible AI page dimensions', async () => {
    const path = await tempFile('sample.ai', minimalPdf(200, 100))
    await expect(probeImageMeta(path, 'sample.ai')).resolves.toEqual({ width: 200, height: 100 })
  })

  it('returns empty metadata for corrupt files', async () => {
    const path = await tempFile('broken.exr', 'not an exr')
    await expect(probeImageMeta(path, 'broken.exr')).resolves.toEqual({})
  })
})
