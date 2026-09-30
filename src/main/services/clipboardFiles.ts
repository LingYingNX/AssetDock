import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'

/**
 * 把文件写进系统剪贴板,让资源管理器可以直接 Ctrl+V 粘贴出文件。
 *
 * 为什么绕开 Electron 的 clipboard:实测 Electron 33 在 Windows 上写不出 CF_HDROP ——
 * writeBuffer('FileNameW'/'text/uri-list') 与 write({bookmark}) 都只落到文本格式,
 * ContainsFileDropList() 始终为 false。资源管理器只认 CF_HDROP,所以走系统自带的
 * PowerShell 5.1 Set-Clipboard -Path(它内部调 .NET Clipboard.SetFileDropList)。
 *
 * 路径经 -EncodedCommand(UTF-16LE base64)传递,彻底避开引号转义与代码页问题;
 * 中文、空格、括号、单引号路径均已实测通过。
 */

/** execFile 的 timeout 只约束进程,不约束剪贴板写入本身;给足但别拖住界面 */
const CLIP_TIMEOUT_MS = 5000

export interface ClipResult {
  /** 成功放入剪贴板并确认存在的文件数 */
  copied: number
  /** 因文件不存在被跳过的路径 */
  skipped: string[]
}

/**
 * 路径 → PowerShell 数组字面量文本。
 *
 * 单引号字符串里靠「双写」转义;抽成纯函数以便测试(真实路径里带单引号并不罕见,
 * 比如 "it's a test.css",转义写错就是整条命令失败)。
 */
export function toPowerShellArray(paths: string[]): string {
  return paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')
}

function setClipboardViaPowerShell(paths: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const script = `Set-Clipboard -Path ${toPowerShellArray(paths)}`
    const args = [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64')
    ]
    const child = spawn('powershell.exe', args, { windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => {
      child.kill()
      resolve(false)
    }, CLIP_TIMEOUT_MS)
    child.on('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0)
    })
  })
}

/**
 * 只保留磁盘上确实存在的路径。
 *
 * Set-Clipboard -Path 遇到不存在的路径会整条命令失败(已实测),所以必须先过滤,
 * 否则一个缺失素材会把其它正常文件的复制一起拖垮。
 */
async function existingPaths(paths: string[]): Promise<{ ok: string[]; missing: string[] }> {
  const checks = await Promise.all(
    paths.map(async (p) => ({ p, exists: await access(p).then(() => true, () => false) }))
  )
  return {
    ok: checks.filter((c) => c.exists).map((c) => c.p),
    missing: checks.filter((c) => !c.exists).map((c) => c.p)
  }
}

/**
 * 复制文件到系统剪贴板。
 *
 * 非 Windows 直接返回失败:这里只实现了 Windows 的 CF_HDROP 路径,
 * 不假装成功,让调用方有机会退回「复制路径文本」。
 */
export async function copyFilesToClipboard(paths: string[]): Promise<ClipResult | null> {
  if (process.platform !== 'win32') return null
  if (paths.length === 0) return { copied: 0, skipped: [] }

  const { ok, missing } = await existingPaths(paths)
  if (ok.length === 0) return { copied: 0, skipped: missing }

  const done = await setClipboardViaPowerShell(ok)
  if (!done) return null
  return { copied: ok.length, skipped: missing }
}
