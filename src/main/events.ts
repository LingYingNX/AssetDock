import { BrowserWindow } from 'electron'

export function send(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows()[0]?.webContents.send(channel, payload)
}
