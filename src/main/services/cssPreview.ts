import { join, extname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { realPathWithinRoot } from './libResolve'

/**
 * CSS 素材的预览骨架 —— 主进程侧入口。
 *
 * 纯字符串拼接(骨架 + CSS → 自包含 HTML)放在 ../../shared/cssPreview,
 * 由主进程缩略图截图与渲染层灯箱预览共用,保证两条路径视觉一致。
 * 本文件只保留依赖文件系统的部分:定位同名 HTML 骨架。
 */

export { BUILT_IN_SHELL, PREVIEW_CSP, buildPreviewHtml, shellFromCss, stripScripts } from '../../shared/cssPreview'

/**
 * 取该 CSS 素材的预览骨架:同目录同名 .html / .htm 优先,缺失时返回 null(调用方回退内置骨架)。
 * 路径经 realPathWithinRoot 校验,越界(符号链接/Junction 逃逸)返回 null。
 */
export async function resolvePreviewShell(libPath: string, relPath: string): Promise<string | null> {
  const ext = extname(relPath)
  const stem = ext ? relPath.slice(0, -ext.length) : relPath
  for (const candidateExt of ['.html', '.htm']) {
    const real = await realPathWithinRoot(libPath, join(libPath, `${stem}${candidateExt}`))
    if (!real) continue
    const text = await readFile(real, 'utf8').catch(() => null)
    if (text != null) return text
  }
  return null
}