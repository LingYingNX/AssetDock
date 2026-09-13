import Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const packageRoot = dirname(require.resolve('better-sqlite3/package.json'))

function nativeBindingPath(): string | undefined {
  const target = process.versions.electron ? 'electron' : `node-${process.versions.modules}`
  const path = join(packageRoot, 'build', 'Release', `better_sqlite3.${target}.node`)
  return existsSync(path) ? path : undefined
}

export function openSqlite(filename: string): Database.Database {
  const nativeBinding = nativeBindingPath()
  return nativeBinding ? new Database(filename, { nativeBinding }) : new Database(filename)
}
