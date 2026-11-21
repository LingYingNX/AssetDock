import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AssetImportResponse, AssetListResponse, AssetListPage, AssetRowsResponse, DedupRule, DedupScanResult, EventChannelMap, FolderListResponse } from '../shared/types'
import type { DocumentPreview } from '../shared/types'

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
  pickFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickFile'),
  pickAssetFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:pickAssetFiles'),
  getFilePath: (file: File): string => webUtils.getPathForFile(file),

  tools: {
    status: (): Promise<{ blender: { available: boolean; path?: string; version?: string; error?: string }; cinema4d: { available: boolean; path?: string; version?: string; error?: string } }> =>
      ipcRenderer.invoke('tools:status')
  },

  library: {
    create: (folderPath: string, name?: string): Promise<{ id: number; name: string; path: string; warning?: string } | { error: string }> =>
      ipcRenderer.invoke('library:create', folderPath, name),
    open: (libraryId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('library:open', libraryId),
    list: (): Promise<{ id: number; name: string; path: string }[]> => ipcRenderer.invoke('library:list'),
    takeMigrationFailures: (): Promise<{ names: string[] }> => ipcRenderer.invoke('library:takeMigrationFailures'),
    importEagle: (libraryId: number, folderPath: string): Promise<{ imported: number; multiFolderAssets: number } | { error: string }> =>
      ipcRenderer.invoke('eagle:import', libraryId, folderPath)
  },

  folders: {
    list: (libraryId: number): Promise<FolderListResponse | { error: string }> =>
      ipcRenderer.invoke('folders:list', libraryId),
    styles: (libraryId: number): Promise<{ styles: { path: string; icon: string; color: string }[] } | { error: string }> =>
      ipcRenderer.invoke('folders:styles', libraryId),
    setStyles: (
      libraryId: number,
      paths: string[],
      patch: { icon?: string | null; color?: string | null }
    ): Promise<{ ok: true } | { error: string }> => ipcRenderer.invoke('folders:setStyles', libraryId, paths, patch),    create: (libraryId: number, parentPath?: string): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:create', libraryId, parentPath),
    open: (libraryId: number, path: string): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('folders:open', libraryId, path),
    trash: (libraryId: number, path: string): Promise<{ ok: true; removedAssets: number } | { error: string }> =>
      ipcRenderer.invoke('folders:trash', libraryId, path),
    rename: (libraryId: number, path: string, name: string): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:rename', libraryId, path, name),
    move: (libraryId: number, source: string, target: string, placement: 'before' | 'after' | 'inside'): Promise<{ path: string } | { error: string }> =>
      ipcRenderer.invoke('folders:move', libraryId, source, target, placement),
    transfer: (
      sourceLibraryId: number,
      targetLibraryId: number,
      path: string,
      destFolder: string
    ): Promise<{ transferred: number; skipped: number; keptSource: number; removedFolders: number } | { error: string }> =>
      ipcRenderer.invoke('folders:transfer', sourceLibraryId, targetLibraryId, path, destFolder)
  },

  assets: {
    list: (libraryId: number, page?: AssetListPage): Promise<AssetListResponse | { error: string }> =>
      ipcRenderer.invoke('assets:list', libraryId, page),
    rows: (libraryId: number, ids: number[]): Promise<AssetRowsResponse> =>
      ipcRenderer.invoke('assets:rows', libraryId, ids),
    update: (libraryId: number, id: number, patch: Record<string, unknown>): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('assets:update', libraryId, id, patch),
    preparePreview: (libraryId: number, id: number, options?: { force?: boolean }): Promise<
      | { kind: 'native' }
      | { kind: 'video'; url: string }
      | { kind: 'three'; url: string }
      | { kind: 'image'; url: string }
      | { kind: 'pdf'; url: string; pages: number }
      | { kind: 'html'; url: string }
      | { kind: 'document'; preview: DocumentPreview }
      | { kind: 'external'; tool: 'cinema4d'; message: string }
      | { error: string }
    > => ipcRenderer.invoke('assets:preparePreview', libraryId, id, options),
    openExternal: (libraryId: number, id: number): Promise<{ ok: true } | { error: string }> =>
      ipcRenderer.invoke('assets:openExternal', libraryId, id),
    move: (libraryId: number, ids: number[], folder: string): Promise<{ moved: number } | { error: string; moved?: number }> =>
      ipcRenderer.invoke('assets:move', libraryId, ids, folder),
    transfer: (
      sourceLibraryId: number,
      targetLibraryId: number,
      ids: number[],
      folder: string,
      mode: 'copy' | 'cut'
    ): Promise<{ transferred: number; skipped: number; keptSource: number; targetIds: number[] } | { error: string }> =>
      ipcRenderer.invoke('assets:transfer', sourceLibraryId, targetLibraryId, ids, folder, mode),
    addTag: (libraryId: number, id: number, name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('assets:addTag', libraryId, id, name),
    removeTag: (libraryId: number, id: number, name: string): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('assets:removeTag', libraryId, id, name),
    emptyTrash: (libraryId: number): Promise<{ ok: boolean }> => ipcRenderer.invoke('assets:emptyTrash', libraryId),
    purge: (libraryId: number, ids: number[]): Promise<{ ok: boolean; purged: number }> => ipcRenderer.invoke('assets:purge', libraryId, ids),
    readText: (libraryId: number, id: number): Promise<{ text: string; sizeBytes: number } | { error: string }> => ipcRenderer.invoke('assets:readText', libraryId, id),
    writeText: (libraryId: number, id: number, text: string): Promise<{ ok: true; fingerprint: string; sizeBytes: number } | { error: string }> => ipcRenderer.invoke('assets:writeText', libraryId, id, text),
    readShell: (libraryId: number, id: number): Promise<{ text: string | null; exists: boolean; sizeBytes?: number } | { error: string }> => ipcRenderer.invoke('assets:readShell', libraryId, id),
    writeShell: (libraryId: number, id: number, html: string): Promise<{ ok: true } | { error: string }> => ipcRenderer.invoke('assets:writeShell', libraryId, id, html),
    rename: (libraryId: number, id: number, newName: string): Promise<{ ok: true; relPath: string } | { error: string }> => ipcRenderer.invoke('assets:rename', libraryId, id, newName),
    importPaths: (libraryId: number, paths: string[], folder: string): Promise<AssetImportResponse | { error: string }> =>
      ipcRenderer.invoke('assets:importPaths', libraryId, paths, folder),
    copy: (libraryId: number, ids: number[]): Promise<{ copied: number; mode: 'files' | 'paths'; skipped: string[]; paths: string[] } | { error: string }> =>
      ipcRenderer.invoke('assets:copy', libraryId, ids),
    export: (libraryId: number, ids: number[]): Promise<{ exported: number } | { canceled: true } | { error: string; exported?: number }> =>
      ipcRenderer.invoke('assets:export', libraryId, ids)
  },

  dedup: {
    scan: (libraryId: number, rule: DedupRule, folder?: string | null): Promise<DedupScanResult> => ipcRenderer.invoke('dedup:scan', libraryId, rule, folder)
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

  /** 白名单事件订阅(payload 类型来自 shared EventChannelMap,S2-10) */
  on: <K extends keyof EventChannelMap>(channel: K, cb: (payload: EventChannelMap[K]) => void): (() => void) => {
    const h = (_e: unknown, payload: EventChannelMap[K]): void => cb(payload)
    ipcRenderer.on(channel, h)
    return () => {
      ipcRenderer.removeListener(channel, h)
    }
  }
}

contextBridge.exposeInMainWorld('windowApi', api)

export type WindowApi = typeof api
