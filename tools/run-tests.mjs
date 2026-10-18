import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const vitest = join(root, 'node_modules', 'vitest', 'vitest.mjs')
const testsDir = join(root, 'tests')
const requested = process.argv.slice(2).map((file) => resolve(root, file))
const files = requested.length > 0
  ? requested
  : readdirSync(testsDir)
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => join(testsDir, name))
      .sort()

if (!existsSync(vitest)) {
  console.error(`Vitest entry not found: ${vitest}`)
  process.exit(1)
}
if (files.length === 0) {
  console.error('No test files found.')
  process.exit(1)
}

const failed = []
for (let index = 0; index < files.length; index++) {
  const file = files[index]
  console.log(`[${index + 1}/${files.length}] ${basename(file)}`)
  const result = spawnSync(process.execPath, [vitest, 'run', file, '--no-file-parallelism', '--reporter=dot'], {
    cwd: root,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error || result.status !== 0) {
    failed.push({ file, status: result.status, signal: result.signal, error: result.error })
  }
}

if (failed.length > 0) {
  console.error(`\n${failed.length}/${files.length} test files failed:`)
  for (const item of failed) {
    console.error(`- ${basename(item.file)} (status=${String(item.status)}, signal=${String(item.signal)})`)
  }
  process.exit(1)
}

console.log(`\nAll ${files.length} test files passed.`)
