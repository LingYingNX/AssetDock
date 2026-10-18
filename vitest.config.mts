import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    server: {
      deps: {
        // 原生模块必须走 Node require，不能让 Vite 转译后由 worker 清理。
        external: ['sharp', 'better-sqlite3']
      }
    }
  }
})
