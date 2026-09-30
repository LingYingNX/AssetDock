import { describe, expect, it } from 'vitest'
import { toPowerShellArray } from '../src/main/services/clipboardFiles'

/**
 * 只测纯逻辑:真实写剪贴板要调 PowerShell 并占用系统剪贴板,不适合放进套件。
 * 端到端的文件对象写入由人工在资源管理器里粘贴验证。
 */
describe('clipboard file paths', () => {
  it('quotes each path and joins with a comma', () => {
    expect(toPowerShellArray(['C:\\a.png', 'D:\\b.png'])).toBe("'C:\\a.png','D:\\b.png'")
  })

  it('doubles single quotes so apostrophes survive', () => {
    // "it's a test.css" 里的撇号必须双写,否则 PowerShell 字符串提前闭合、整条命令失败
    expect(toPowerShellArray(["C:\\it's a 'test'.css"])).toBe("'C:\\it''s a ''test''.css'")
  })

  it('keeps CJK and spaces intact', () => {
    expect(toPowerShellArray(['E:\\素材\\新建 文本文档.css'])).toBe("'E:\\素材\\新建 文本文档.css'")
  })

  it('produces an empty string for no paths', () => {
    expect(toPowerShellArray([])).toBe('')
  })
})
