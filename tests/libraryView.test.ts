import { describe, expect, it, vi } from 'vitest'

function stubWindow(pathsByLibrary: Record<number, string[]>): {
  setPaths: (next: Record<number, string[]>) => void
} {
  let paths = pathsByLibrary
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    windowApi: {
      assets: {
        list: vi.fn().mockResolvedValue({ assets: [], library: {} })
      },
      folders: {
        list: vi.fn(async (libraryId: number) => ({ paths: paths[libraryId] ?? [] })),
        styles: vi.fn().mockResolvedValue({ styles: [] })
      },
      library: { open: vi.fn().mockResolvedValue({ ok: true }) },
      tabs: { save: vi.fn().mockResolvedValue(undefined) },
      state: { set: vi.fn().mockResolvedValue({ ok: true }) }
    }
  })
  return {
    setPaths: (next) => {
      paths = next
    }
  }
}

const FOLDER = '图/壁纸/横屏壁纸'

describe('library view state', () => {
  it('restores the folder nav and selection after switching away and back', async () => {
    stubWindow({ 1: ['图', '图/壁纸', FOLDER], 2: ['其他'] })
    vi.resetModules()
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [
        { id: 'a1', name: 'A', libraryId: 1 },
        { id: 'b2', name: 'B', libraryId: 2 }
      ],
      activeTabId: 'a1',
      mode: 'empty',
      assets: []
    })

    useUI.getState().reloadActiveLibrary()
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toHaveLength(3))
    useUI.getState().setNav(`folder:${FOLDER}` as never)
    useUI.getState().clickFolder(1, FOLDER, {})

    useUI.getState().openTab('b2')
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toEqual(['其他']))
    expect(useUI.getState().nav).toBe('all')

    useUI.getState().openTab('a1')
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toHaveLength(3))
    expect(useUI.getState().nav).toBe(`folder:${FOLDER}`)
    expect(useUI.getState().folderSelection?.paths).toEqual([FOLDER])
  })

  it('collapses subfolders on first open and keeps collapse state per library', async () => {
    stubWindow({ 1: ['图', '图/壁纸', FOLDER], 2: ['其他', '其他/子'] })
    vi.resetModules()
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [
        { id: 'a1', name: 'A', libraryId: 1 },
        { id: 'b2', name: 'B', libraryId: 2 }
      ],
      activeTabId: 'a1',
      mode: 'empty',
      assets: []
    })

    useUI.getState().reloadActiveLibrary()
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toHaveLength(3))
    expect(useUI.getState().collapsedFolders).toEqual(['图', '图/壁纸'])

    useUI.getState().toggleFolderCollapsed('图')
    expect(useUI.getState().collapsedFolders).toEqual(['图/壁纸'])

    useUI.getState().openTab('b2')
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toEqual(['其他', '其他/子']))
    expect(useUI.getState().collapsedFolders).toEqual(['其他'])

    useUI.getState().openTab('a1')
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toHaveLength(3))
    expect(useUI.getState().collapsedFolders).toEqual(['图/壁纸'])
  })

  it('drops a stale folder selection when the folder no longer exists', async () => {
    const stub = stubWindow({ 1: ['图', FOLDER] })
    vi.resetModules()
    const { useUI } = await import('../src/renderer/src/store/ui')
    useUI.setState({
      tabs: [{ id: 'a1', name: 'A', libraryId: 1 }],
      activeTabId: 'a1',
      mode: 'empty',
      assets: []
    })

    useUI.getState().reloadActiveLibrary()
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toEqual(['图', FOLDER]))
    useUI.getState().setNav(`folder:${FOLDER}` as never)
    useUI.getState().clickFolder(1, FOLDER, {})

    stub.setPaths({ 1: ['图'] })
    useUI.getState().reloadActiveLibrary()
    await vi.waitFor(() => expect(useUI.getState().folderPaths).toEqual(['图']))

    expect(useUI.getState().nav).toBe('all')
    expect(useUI.getState().folderSelection).toBeNull()
  })
})
