import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react()],
    server: {
      fs: {
        // 允许渲染进程经 /@fs/ 预览 素材/ 目录(仅 dev);相对 renderer root(src/renderer)上溯到项目根
        allow: ['../..']
      }
    }
  }
})
