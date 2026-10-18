import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Three.js 的 DRACOLoader 即使调用 setDecoderPath 也会静态带上一份
 * draco_decoder.js 兜底资源。Viewer3D 始终使用 setDecoderPath 的 wasm 资源，
 * 因此从产物中移除这个未使用的 JS，保留 wasm 与 wrapper。
 */
function dropUnusedDracoAsm(): Plugin {
  return {
    name: 'drop-unused-draco-asm',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const name of Object.keys(bundle)) {
        if (/(^|\/)draco_decoder-[^/]+\.js$/.test(name)) delete bundle[name]
      }
    }
  }
}

export default defineConfig({
  main: {
    build: {
      // chokidar 5 是 ESM-only；打进主进程 bundle，避免 CJS require 失败。
      externalizeDeps: { exclude: ['chokidar'] }
    }
  },
  preload: {},
  renderer: {
    plugins: [react(), dropUnusedDracoAsm()],
    server: {
      fs: {
        // 允许渲染进程经 /@fs/ 预览 素材/ 目录(仅 dev);相对 renderer root(src/renderer)上溯到项目根
        allow: ['../..']
      }
    }
  }
})
