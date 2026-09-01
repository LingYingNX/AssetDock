import type { WindowApi } from './index'

declare global {
  interface Window {
    windowApi: WindowApi
  }
}

export {}
