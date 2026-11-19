import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

export type ExternalToolKey = 'blender' | 'cinema4d'

export interface ExternalToolStatus {
  key: ExternalToolKey
  available: boolean
  path?: string
  version?: string
  error?: string
}

type ExecutableProbe = Omit<ExternalToolStatus, 'key'>

interface ToolSpec {
  name: string
  versionArgs: string[]
  candidates: string[]
}

const TOOLS: Record<ExternalToolKey, ToolSpec> = {
  blender: {
    name: 'Blender',
    versionArgs: ['--version'],
    candidates: [
      'C:\\Program Files\\Blender Foundation',
      'C:\\Program Files\\Blender Foundation\\Blender'
    ]
  },
  cinema4d: {
    name: 'Cinema 4D',
    versionArgs: ['--version'],
    candidates: [
      'C:\\Program Files\\Maxon Cinema 4D',
      'C:\\Program Files\\Maxon'
    ]
  }
}

export function configuredToolPath(preferencesRaw: string | null, key: ExternalToolKey): string | undefined {
  if (!preferencesRaw) return undefined
  try {
    const prefs = JSON.parse(preferencesRaw) as Record<string, unknown>
    const tools = prefs.externalTools
    const value = tools && typeof tools === 'object' && !Array.isArray(tools)
      ? (tools as Record<string, unknown>)[key]
      : prefs[`${key}Path`]
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

/** 在常见安装目录中查找可执行文件；找不到时返回 null，不抛错。 */
export async function findInstalledTool(key: ExternalToolKey): Promise<string | null> {
  const spec = TOOLS[key]
  for (const root of spec.candidates) {
    if (!existsSync(root)) continue
    try {
      const entries = await readdir(root, { withFileTypes: true })
      const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
      for (const dir of dirs) {
        const exe = key === 'blender'
          ? join(root, dir, 'blender.exe')
          : join(root, dir, 'Cinema 4D.exe')
        if (existsSync(exe)) return exe
        /* Cinema 4D 的嵌套路径与上面的直接路径相同,只有 Blender 需要多看一层 */
        if (key === 'blender') {
          const nested = join(root, dir, 'Blender', 'blender.exe')
          if (existsSync(nested)) return nested
        }
      }
      const direct = key === 'blender' ? join(root, 'blender.exe') : join(root, 'Cinema 4D.exe')
      if (existsSync(direct)) return direct
    } catch {
      // 无权限或目录消失时继续尝试下一个候选。
    }
  }
  return null
}

export function probeExecutable(path: string, args: string[], timeout = 8_000): Promise<ExecutableProbe> {
  return new Promise((resolve) => {
    execFile(path, args, { timeout, windowsHide: true, maxBuffer: 1024 * 256 }, (error, stdout, stderr) => {
      if (error) {
        const detail = `${stdout}\n${stderr}`.split(/\r?\n/).map((item) => item.trim()).reverse().find(Boolean)
        resolve({ available: false, path, error: detail ?? error.message })
        return
      }
      const line = `${stdout}\n${stderr}`.split(/\r?\n/).map((item) => item.trim()).find(Boolean)
      resolve({ available: true, path, version: line })
    })
  })
}

export async function probeTool(
  key: ExternalToolKey,
  configuredPath?: string
): Promise<ExternalToolStatus> {
  const path = configuredPath ?? await findInstalledTool(key)
  if (!path) {
    return { key, available: false, error: `${TOOLS[key].name} 未安装或未配置路径` }
  }
  const status = await probeExecutable(path, TOOLS[key].versionArgs)
  return {
    key,
    ...status,
    ...(status.available ? {} : { error: status.error ?? `${TOOLS[key].name} 无法启动` })
  }
}

export function toolName(key: ExternalToolKey): string {
  return TOOLS[key].name
}
