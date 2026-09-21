import { contextBridge, ipcRenderer } from 'electron'

const api = {
  minimize: (): void => {
    ipcRenderer.send('window:minimize')
  },
  maximize: (): void => {
    ipcRenderer.send('window:maximize')
  },
  close: (): void => {
    ipcRenderer.send('window:close')
  },
  showInFolder: (p: string): void => {
    ipcRenderer.send('shell:show-in-folder', p)
  },

  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFolder'),

  library: {
    create: (folderPath: string, name?: string): Promise<{ id: number; name: string; path: string; warning?: string } | { error: string }> =>
      ipcRenderer.invoke('library:create', folderPath, name),
    open: (libraryId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('library:open', libraryId),
    list: (): Promise<{ id: number; name: string; path: string }[]> => ipcRenderer.invoke('library:list'),
    takeMigrationFailures: (): Promise<{ names: string[] }> => ipcRenderer.invoke('library:takeMigrationFailures'),
    legacyStats: (): Promise<{ assets: number }> => ipcRenderer.invoke('library:legacyStats'),
    purgeLegacy: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('library:purgeLegacy'),
    importEagle: (libraryId: number, folderPath: string): Promise<{ imported: number; multiFolderAssets: number } | { error: string }> =>
      ipcRenderer.invoke('eagle:import', libraryId, folderPath)
  },

  folders: {
    list: (libraryId: number): Promise<{ paths: string[]; eaglePaths: string[] } | { error: string }> =>
      ipcRenderer.invoke('folders:list', libraryId),
    create: (libraryId: number): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:create', libraryId),
    rename: (libraryId: number, path: string, name: string): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:rename', libraryId, path, name),
    move: (libraryId: number, source: string, target: string, placement: 'before' | 'after' | 'inside'): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:move', libraryId, source, target, placement)
  },

  assets: {
    list: (libraryId: number): Promise<unknown> => ipcRenderer.invoke('assets:list', libraryId),
    update: (libraryId: number, id: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('assets:update', libraryId, id, patch),
    move: (libraryId: number, ids: number[], folder: string): Promise<{ moved: number } | { error: string; moved?: number }> =>
      ipcRenderer.invoke('assets:move', libraryId, ids, folder),
    addTag: (libraryId: number, id: number, name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('assets:addTag', libraryId, id, name),
    removeTag: (libraryId: number, id: number, name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('assets:removeTag', libraryId, id, name),
    emptyTrash: (libraryId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('assets:emptyTrash', libraryId),
    purgeMissing: (libraryId: number): Promise<{ purged: number }> => ipcRenderer.invoke('assets:purgeMissing', libraryId),
    copy: (libraryId: number, ids: number[]): Promise<{ copied: number } | { error: string }> =>
      ipcRenderer.invoke('assets:copy', libraryId, ids),
    export: (libraryId: number, ids: number[]): Promise<{ exported: number } | { canceled: true } | { error: string; exported?: number }> =>
      ipcRenderer.invoke('assets:export', libraryId, ids)
  },

  tabs: {
    get: (): Promise<{ libraryId: number; position: number }[]> => ipcRenderer.invoke('tabs:get'),
    save: (ids: number[]): Promise<{ ok: boolean }> => ipcRenderer.invoke('tabs:save', ids)
  },

  state: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('state:get', key),
    set: (key: string, value: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('state:set', key, value)
  },

  app: {
    getAutoLaunch: (): Promise<{ enabled: boolean; supported: boolean }> => ipcRenderer.invoke('app:getAutoLaunch'),
    setAutoLaunch: (enabled: boolean): Promise<{ ok: boolean; supported: boolean; enabled?: boolean }> =>
      ipcRenderer.invoke('app:setAutoLaunch', enabled)
  },

  /** 白名单事件订阅 */
  on: (channel: 'library:scan' | 'assets:changed' | 'window:maximized', cb: (payload: unknown) => void): (() => void) => {
    const h = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, h)
    return () => {
      ipcRenderer.removeListener(channel, h)
    }
  }
}

contextBridge.exposeInMainWorld('windowApi', api)

export type WindowApi = typeof api
