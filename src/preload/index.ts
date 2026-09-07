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
    create: (folderPath: string): Promise<{ id: number; name: string; path: string; warning?: string } | { error: string }> =>
      ipcRenderer.invoke('library:create', folderPath),
    list: (): Promise<{ id: number; name: string; path: string }[]> => ipcRenderer.invoke('library:list'),
    takeMigrationFailures: (): Promise<{ names: string[] }> => ipcRenderer.invoke('library:takeMigrationFailures'),
    legacyStats: (): Promise<{ assets: number }> => ipcRenderer.invoke('library:legacyStats'),
    purgeLegacy: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('library:purgeLegacy')
  },

  folders: {
    list: (libraryId: number): Promise<{ paths: string[] } | { error: string }> =>
      ipcRenderer.invoke('folders:list', libraryId),
    create: (libraryId: number): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:create', libraryId),
    rename: (libraryId: number, path: string, name: string): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:rename', libraryId, path, name)
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
    purgeMissing: (libraryId: number): Promise<{ purged: number }> => ipcRenderer.invoke('assets:purgeMissing', libraryId)
  },

  index: {
    add: (libraryId: number, folder: string): Promise<{ id: number; name: string; path: string } | { error: string }> =>
      ipcRenderer.invoke('index:add', libraryId, folder),
    remove: (libraryId: number, indexId: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('index:remove', libraryId, indexId),
    list: (libraryId: number): Promise<{ id: number; path: string; name: string }[]> =>
      ipcRenderer.invoke('index:list', libraryId)
  },

  tabs: {
    get: (): Promise<{ libraryId: number; position: number }[]> => ipcRenderer.invoke('tabs:get'),
    save: (ids: number[]): Promise<{ ok: boolean }> => ipcRenderer.invoke('tabs:save', ids)
  },

  state: {
    get: (key: string): Promise<string | null> => ipcRenderer.invoke('state:get', key),
    set: (key: string, value: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('state:set', key, value)
  },

  /** 白名单事件订阅 */
  on: (channel: 'library:scan' | 'assets:changed' | 'thumbs:ready', cb: (payload: unknown) => void): (() => void) => {
    const h = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, h)
    return () => {
      ipcRenderer.removeListener(channel, h)
    }
  }
}

contextBridge.exposeInMainWorld('windowApi', api)

export type WindowApi = typeof api
