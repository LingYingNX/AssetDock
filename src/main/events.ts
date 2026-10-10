import { BrowserWindow } from 'electron'

/**
 * 主进程 → 渲染层事件发送。
 * 广播到全部窗口:托盘化(hide)的窗口 webContents 仍存活会照常收到;
 * 单发 getAllWindows()[0] 在多窗口/时序不确定的场景会静默丢事件(S1-3)。
 * 面向具体窗口的事件(如 window:maximized)仍按窗口直发,不走这里。
 */
export function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}
