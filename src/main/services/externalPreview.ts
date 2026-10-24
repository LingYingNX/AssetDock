import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { getDb } from './db'
import { getAppState } from './store'
import { runMediaProcess } from './ffmpeg'
import { configuredToolPath, probeTool, toolName } from './externalTools'

export type ExternalPreviewFailure = 'missing-tool' | 'timeout' | 'failed'

export class ExternalPreviewError extends Error {
  constructor(
    message: string,
    readonly kind: ExternalPreviewFailure
  ) {
    super(message)
    this.name = 'ExternalPreviewError'
  }
}

const active = new Map<string, Promise<string>>()

export function blendPreviewDir(libPath: string): string {
  return join(libPath, '.mediahub', 'external', 'blend')
}

export function blendPreviewPath(libPath: string, fingerprint: string): string {
  return join(blendPreviewDir(libPath), `${fingerprint}.glb`)
}

export function blenderExportArgs(blendPath: string, outputPath: string): string[] {
  const script = [
    'import bpy, sys',
    "output = sys.argv[sys.argv.index('--') + 1]",
    "bpy.ops.export_scene.gltf(filepath=output, export_format='GLB')"
  ].join('; ')
  return [
    '--background',
    '--factory-startup',
    '--disable-autoexec',
    blendPath,
    '--python-expr',
    script,
    '--',
    outputPath
  ]
}

function configuredBlenderPath(): string | undefined {
  try {
    return configuredToolPath(getAppState(getDb(), 'preferences'), 'blender')
  } catch {
    return undefined
  }
}

export function ensureBlendPreview(
  libPath: string,
  absPath: string,
  fingerprint: string,
  configuredPath?: string
): Promise<string> {
  if (!/^[0-9a-f]{20}$/i.test(fingerprint)) return Promise.reject(new Error('invalid fingerprint'))
  const target = blendPreviewPath(libPath, fingerprint)
  const key = `${libPath}\0${fingerprint}`
  const running = active.get(key)
  if (running) return running

  const task = (async () => {
    const cached = await stat(target).catch(() => null)
    if (cached?.isFile()) return target
    const tool = await probeTool('blender', configuredPath ?? configuredBlenderPath())
    if (!tool.available || !tool.path) {
      throw new ExternalPreviewError(`${toolName('blender')} 未安装或未配置路径`, 'missing-tool')
    }

    await mkdir(blendPreviewDir(libPath), { recursive: true })
    const temp = `${target}.tmp-${process.pid}-${Date.now()}.glb`
    try {
      const result = await runMediaProcess(tool.path, blenderExportArgs(absPath, temp), {
        timeoutMs: 2 * 60_000,
        maxOutputBytes: 8 * 1024 * 1024
      }).catch((error: unknown) => {
        if (error instanceof Error && 'kind' in error && error.kind === 'timeout') {
          throw new ExternalPreviewError('Blender 导出超时', 'timeout')
        }
        throw new ExternalPreviewError(
          error instanceof Error ? error.message : 'Blender 导出失败',
          'failed'
        )
      })
      const output = await stat(temp).catch(() => null)
      if (!output?.isFile() || output.size === 0) {
        const detail = result.stderr.trim().split(/\r?\n/).pop()
        throw new ExternalPreviewError(
          `Blender 未生成 GLB${detail ? `: ${detail}` : ''}`,
          'failed'
        )
      }
      await rename(temp, target)
      return target
    } finally {
      await rm(temp, { force: true }).catch(() => undefined)
    }
  })()

  active.set(key, task)
  void task.finally(() => {
    if (active.get(key) === task) active.delete(key)
  }).catch(() => undefined)
  return task
}

export function resetExternalPreviewTasks(): void {
  active.clear()
}
