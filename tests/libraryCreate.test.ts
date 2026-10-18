import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  isDiskRoot,
  rememberPickedPath,
  validateLibraryCreatePath,
  type PickedPathMap
} from '../src/main/services/libraryCreate'

describe('library create path allowlist', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('accepts a real directory previously returned by the picker', async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-picked-'))
    const picked: PickedPathMap = new Map()
    rememberPickedPath(picked, root)

    await expect(validateLibraryCreatePath(picked, root)).resolves.toEqual({ ok: true, path: await realpathForTest(root) })
  })

  it('rejects a path the renderer did not obtain from the picker', async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-unpicked-'))
    await expect(validateLibraryCreatePath(new Map(), root)).resolves.toMatchObject({ ok: false })
  })

  it('rejects a missing directory and a disk root even when picked', async () => {
    const picked: PickedPathMap = new Map()
    const missing = join(tmpdir(), `mediahub-missing-${Date.now()}`)
    rememberPickedPath(picked, missing)
    await expect(validateLibraryCreatePath(picked, missing)).resolves.toMatchObject({ ok: false })

    const diskRoot = process.platform === 'win32' ? 'C:\\' : '/'
    rememberPickedPath(picked, diskRoot)
    await expect(validateLibraryCreatePath(picked, diskRoot)).resolves.toMatchObject({ ok: false })
    expect(isDiskRoot(diskRoot)).toBe(true)
  })

  it('expires picker paths', async () => {
    root = await mkdtemp(join(tmpdir(), 'mediahub-expired-'))
    const picked: PickedPathMap = new Map()
    rememberPickedPath(picked, root, 1)
    await expect(validateLibraryCreatePath(picked, root, 1 + 10 * 60 * 1000 + 1)).resolves.toMatchObject({ ok: false })
  })
})

async function realpathForTest(path: string): Promise<string> {
  const { realpath } = await import('node:fs/promises')
  return realpath(path)
}
