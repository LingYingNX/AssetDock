import { access, mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, relative } from 'node:path'

const writeLocks = new Map<string, Promise<void>>()

export function isWithinRoot(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'))
}

export async function fileExists(path: string): Promise<boolean> {
  return access(path).then(() => true, () => false)
}

export async function writeFileAtomically(path: string, contents: string | Buffer): Promise<void> {
  const previous = writeLocks.get(path) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  writeLocks.set(path, current)
  await previous
  try {
    await mkdir(dirname(path), { recursive: true })
    const temp = `${path}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(temp, contents)
      try {
        await rename(temp, path)
      } catch (error) {
        if (process.platform !== 'win32' || !['EPERM', 'EEXIST'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        await rm(path, { force: true })
        await rename(temp, path)
      }
    } finally {
      await rm(temp, { force: true })
    }
  } finally {
    release()
    if (writeLocks.get(path) === current) writeLocks.delete(path)
  }
}

export async function moveFileIfPresent(source: string, target: string): Promise<boolean> {
  try {
    await access(source)
  } catch {
    return false
  }
  await mkdir(dirname(target), { recursive: true })
  await rm(target, { force: true })
  await rename(source, target)
  return true
}

export async function removeFileAndPrune(path: string, stopRoot: string): Promise<void> {
  if (!isWithinRoot(stopRoot, path)) throw new Error('cache path escapes its source root')
  await rm(path, { force: true })
  let dir = dirname(path)
  while (dir !== stopRoot && isWithinRoot(stopRoot, dir)) {
    try {
      await rmdir(dir)
    } catch {
      break
    }
    dir = dirname(dir)
  }
}
