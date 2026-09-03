import { once } from 'node:events'
import { mkdtemp, mkdir, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { watchLibrary } from '../src/main/services/watch'

describe('library watcher', () => {
  it('allows externally renaming a watched folder and refreshes the view', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mediahub-watch-'))
    let changes = 0
    const watcher = watchLibrary({} as never, 1, root, {
      onAdded: () => undefined,
      onChanged: () => { changes++ },
      onMissing: () => undefined
    })

    try {
      await once(watcher, 'ready')
      const added = once(watcher, 'addDir')
      await mkdir(join(root, 'old'))
      await added
      await rename(join(root, 'old'), join(root, 'new'))
      await vi.waitFor(() => expect(changes).toBeGreaterThan(1), { timeout: 5000 })
    } finally {
      await watcher.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
