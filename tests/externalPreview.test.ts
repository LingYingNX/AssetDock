import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  blendPreviewPath,
  blenderExportArgs,
  ensureBlendPreview,
  resetExternalPreviewTasks
} from '../src/main/services/externalPreview'

const roots: string[] = []
const fingerprint = '0123456789abcdef0123'

afterEach(async () => {
  resetExternalPreviewTasks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Blender preview cache', () => {
  it('passes paths as argv values instead of interpolating them into shell code', () => {
    const args = blenderExportArgs('C:\\素材\\场景.blend', 'C:\\缓存\\预览 1.glb')
    expect(args).toContain('C:\\素材\\场景.blend')
    expect(args.at(-1)).toBe('C:\\缓存\\预览 1.glb')
    expect(args).toContain('--python-expr')
    expect(args).toContain('--factory-startup')
    expect(args).toContain('--disable-autoexec')
    expect(args.join(' ')).not.toContain('C:\\素材\\场景.blend)')
  })

  it('keeps the source asset when Blender is missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-blend-preview-'))
    roots.push(root)
    const source = join(root, 'scene.blend')
    await writeFile(source, 'blend')

    await expect(ensureBlendPreview(root, source, fingerprint, join(root, 'missing-blender.exe')))
      .rejects.toMatchObject({ kind: 'missing-tool' })
    await expect(rm(blendPreviewPath(root, fingerprint), { force: true })).resolves.toBeUndefined()
  })
})
