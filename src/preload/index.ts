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
  }
}

contextBridge.exposeInMainWorld('windowApi', api)

export type WindowApi = typeof api
