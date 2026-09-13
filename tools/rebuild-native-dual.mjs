import { access, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const releaseDir = join(root, 'node_modules', 'better-sqlite3', 'build', 'Release')
const defaultBinary = join(releaseDir, 'better_sqlite3.node')
const electronBinary = join(releaseDir, 'better_sqlite3.electron.node')
const nodeBinary = join(releaseDir, `better_sqlite3.node-${process.versions.modules}.node`)

const exists = (path) => access(path).then(() => true, () => false)

async function npm(command) {
  if (process.platform === 'win32') {
    await execFileAsync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `npm.cmd ${command}`], { cwd: root, windowsHide: true })
    return
  }
  await execFileAsync('npm', command.split(' '), { cwd: root })
}

if (process.argv.includes('--ensure') && (await exists(electronBinary)) && (await exists(nodeBinary))) process.exit(0)

await npm('run rebuild:native')
await copyFile(defaultBinary, electronBinary)
await npm('rebuild better-sqlite3')
await copyFile(defaultBinary, nodeBinary)
await npm('run rebuild:native')
await copyFile(defaultBinary, electronBinary)

console.log(`better-sqlite3 dual ABI ready (Node ${process.versions.modules}, Electron)`) 
