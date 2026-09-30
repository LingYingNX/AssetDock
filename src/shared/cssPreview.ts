/**
 * CSS 预览骨架(主进程与渲染进程共用)。
 *
 * 单独的 .css 没有外观:它只是一组规则,必须被 HTML 元素命中才产生视觉。
 * 这里只做纯字符串处理,不依赖 fs / Electron,因此缩略图截图与灯箱实时预览
 * 共用同一份拼接逻辑,不会出现两条路径视觉不一致。
 */

/** 预览页 CSP:禁一切外部请求,只允许内联样式与库内 media: 资源 */
export const PREVIEW_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src media: data: blob:; font-src media: data:; media-src media:"

/**
 * 内置演示骨架:覆盖从素材站收集的片段最常命中的元素(按钮、输入、卡片、列表、
 * 加载器、徽章等)。命中率有上限——用户可用同名 HTML 精确控制。
 */
export const BUILT_IN_SHELL = `<div class="container">
  <h1>标题 Heading</h1>
  <p>正文段落,用于检查字体、行高与颜色。</p>
  <div class="card box">
    <span class="badge">徽章</span>
    <h2 class="title">卡片标题</h2>
    <p class="text">卡片描述文本,承载次级信息。</p>
    <button class="btn button">按钮</button>
    <button class="btn button secondary" disabled>禁用</button>
  </div>
  <div class="row">
    <input class="input" type="text" placeholder="输入框" />
    <label class="toggle switch"><input type="checkbox" checked /><span class="slider"></span></label>
  </div>
  <ul class="list">
    <li class="item">列表项一</li>
    <li class="item">列表项二</li>
  </ul>
  <table class="table">
    <thead><tr><th>表头</th><th>数值</th></tr></thead>
    <tbody><tr><td>单元</td><td>42</td></tr></tbody>
  </table>
  <div class="loader"><span></span></div>
  <a class="link" href="#">链接</a>
</div>`

/** 去掉骨架里的脚本:预览不允许执行任何脚本(sandbox 之外的第二道防线) */
export function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/>/gi, '')
}

/* ---------- 从 CSS 选择器反推演示骨架 ---------- */

/**
 * 固定骨架不可能覆盖从站点收集来的组件类名(实测 .value / .wrapper 这类一律落空,
 * 预览退化成通用演示内容)。这里按选择器反推 DOM:类名、层级、装饰元素都从 CSS 自己读出来,
 * 因此任意组件片段都能拿到命中它的载体。纯字符串处理,不依赖 fs / Electron。
 */

/** 无闭合体的标签,渲染时自闭合 */
const VOID_TAGS = new Set(['input', 'img', 'br', 'hr', 'source', 'track', 'wbr', 'area', 'col'])
/** 只描述文档外壳的标签,不进预览骨架 */
const SKIP_TAGS = new Set(['html', 'head', 'body', 'meta', 'link', 'style', 'script', 'title', 'noscript'])
/** 只作装饰、不承载内容的标签:父节点据此判断「这是可重复的条目」 */
const DECORATIVE_TAGS = new Set(['svg', 'img', 'i', 'path', 'circle', 'rect', 'use', 'line', 'polygon', 'ellipse'])
/** 叶子元素的填充文案,让尺寸/排版类规则有可见载体 */
const LEAF_TEXT: Record<string, string> = {
  h1: '标题', h2: '标题', h3: '标题', h4: '标题', h5: '标题', h6: '标题',
  p: '正文文本', span: '文本', a: '链接', button: '按钮', label: '标签',
  li: '列表项', th: '表头', td: '数值', strong: '强调', em: '强调', small: '小字', div: '内容'
}
/** 默认属性:输入框与链接不加这些就是不可见的空盒子 */
const DEFAULT_ATTRS: Record<string, string> = {
  input: ' type="text" placeholder="输入框"',
  a: ' href="#"'
}

interface ShellNode {
  tag: string
  classes: string[]
  id: string | null
  attrs: string[]
  children: ShellNode[]
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string)
}

/** 取最外层规则的选择器文本;@ 规则(keyframes/media 等)整体跳过 */
function topLevelSelectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const open = text.indexOf('{', i)
    if (open < 0) break
    const selector = text.slice(i, open).trim()
    let depth = 1
    let j = open + 1
    while (j < text.length && depth > 0) {
      const ch = text[j]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '"' || ch === "'") {
        j++
        while (j < text.length && text[j] !== ch) { if (text[j] === '\\') j++; j++ }
      }
      j++
    }
    if (selector && !selector.startsWith('@')) out.push(selector)
    i = j
  }
  return out
}

/** 拆选择器列表,剥掉伪类与伪元素(::before 等由 CSS 自身产生,不需要真实节点) */
function selectorChains(selector: string): string[][] {
  const chains: string[][] = []
  for (const one of selector.split(',')) {
    const cleaned = one.replace(/::?[\w-]+(\([^)]*\))?/g, '').trim()
    if (!cleaned) continue
    const parts = cleaned.split(/\s*[>+~]\s*|\s+/).filter(Boolean)
    if (parts.length === 0 || parts.length > 4) continue
    chains.push(parts)
  }
  return chains
}

/** 解析单个复合选择器(div.card.box#id[type=text]);含无法识别的字符时返回 null */
function parseCompound(raw: string): { tag: string; classes: string[]; id: string | null; attrs: string[] } | null {
  let rest = raw.trim()
  if (!rest) return null
  const tagMatch = /^([a-zA-Z][\w-]*|\*)/.exec(rest)
  let tag = tagMatch ? tagMatch[1] : 'div'
  if (tagMatch) rest = rest.slice(tagMatch[0].length)
  const classes: string[] = []
  const attrs: string[] = []
  let id: string | null = null
  let consumed = 0
  const tokenRe = /([.#][\w-]+|\[[^\]]*\])/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(rest))) {
    if (m.index !== consumed) return null
    consumed += m[0].length
    if (m[0][0] === '.') classes.push(m[0].slice(1))
    else if (m[0][0] === '#') id = m[0].slice(1)
    else attrs.push(m[0].slice(1, -1))
  }
  if (consumed !== rest.length) return null
  if (tag === '*') tag = 'div'
  return { tag, classes, id, attrs }
}

function shapeKey(c: { tag: string; classes: string[]; id: string | null }): string {
  return `${c.tag}|${[...c.classes].sort().join('.')}|${c.id ?? ''}`
}

/** 只有装饰性子节点 = 可重复的同类条目(如列表项),不是结构容器 */
function isRepeatableItem(node: ShellNode): boolean {
  return node.children.length === 0 || node.children.every((c) => DECORATIVE_TAGS.has(c.tag))
}

function labelOf(node: ShellNode): string {
  return LEAF_TEXT[node.tag] ?? node.classes[0] ?? '示例'
}

function renderNode(node: ShellNode, budget: { left: number }, allowRepeat: boolean): string {
  if (budget.left <= 0) return ''
  budget.left--
  const cls = node.classes.length > 0 ? ` class="${node.classes.join(' ')}"` : ''
  const idAttr = node.id ? ` id="${node.id}"` : ''
  const attrs = node.attrs.length > 0 ? ` ${node.attrs.join(' ')}` : ''
  const extra = `${cls}${idAttr}${attrs}${DEFAULT_ATTRS[node.tag] ?? ''}`
  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${extra} />`
  if (node.tag === 'svg') {
    // 描边图标:实心块会被当成色块,看不出这是「图标占位」
    return `<svg${extra} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="8" /></svg>`
  }
  const inner = renderChildren(node, budget, allowRepeat)
  const decorativeOnly = node.children.length > 0 && node.children.every((c) => DECORATIVE_TAGS.has(c.tag))
  const text = inner + (decorativeOnly ? escapeHtml(labelOf(node)) : '')
  return `<${node.tag}${extra}>${text || escapeHtml(labelOf(node))}</${node.tag}>`
}

function renderChildren(node: ShellNode, budget: { left: number }, allowRepeat: boolean): string {
  if (node.children.length === 0) return ''
  const groups = new Map<string, ShellNode>()
  for (const child of node.children) {
    const key = shapeKey(child)
    if (!groups.has(key)) groups.set(key, child)
  }
  const distinct = [...groups.values()]
  // 单一子类 = 一组同类条目,渲染三份;多种子元素 = 结构,各一份
  const repeat = allowRepeat && distinct.length === 1 && isRepeatableItem(distinct[0]) ? 3 : 1
  let out = ''
  for (const child of distinct) {
    for (let i = 0; i < repeat; i++) out += renderNode(child, budget, false)
  }
  return out
}

/**
 * 按 CSS 的选择器反推一段演示骨架。解析不出任何可用类/元素时返回空串,
 * 调用方回退到固定骨架。
 */
export function shellFromCss(cssText: string): string {
  const roots: ShellNode[] = []
  const index = new Map<string, ShellNode>()
  for (const selector of topLevelSelectors(cssText)) {
    for (const chain of selectorChains(selector)) {
      let parent: ShellNode | null = null
      for (const part of chain) {
        const compound = parseCompound(part)
        if (!compound) break
        if (SKIP_TAGS.has(compound.tag)) continue
        const key = `${parent ? shapeKey(parent) : ''}>${shapeKey(compound)}`
        let node = index.get(key)
        if (!node) {
          node = { ...compound, children: [] }
          index.set(key, node)
          if (parent) parent.children.push(node)
          else if (roots.length < 40) roots.push(node)
        }
        parent = node
      }
    }
  }
  const budget = { left: 160 }
  const html = roots.map((node) => renderNode(node, budget, true)).join('\n')
  return html.trim()
}

/** 没有同名 HTML 骨架时的兜底:先按 CSS 反推,再垫一层通用演示骨架 */
function fallbackShell(cssText: string): string {
  const derived = shellFromCss(cssText)
  return derived ? `${derived}\n${BUILT_IN_SHELL}` : BUILT_IN_SHELL
}


/** 内联 <style> 时转义结束标签,避免 CSS 文本提前闭合样式块 */
function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style')
}

function looksLikeDocument(html: string): boolean {
  return /<html[\s>]/i.test(html)
}

function injectIntoHead(document: string, head: string): string {
  const stripped = stripScripts(document)
  if (/<head[\s>]/i.test(stripped)) {
    return stripped.replace(/<head([^>]*)>/i, `<head$1>${head}`)
  }
  if (/<html[\s>]/i.test(stripped)) {
    return stripped.replace(/<html([^>]*)>/i, `<html$1><head>${head}</head>`)
  }
  return `<head>${head}</head>${stripped}`
}

/** 预览页基础样式:只做重置,绝不与素材自身的 CSS 竞争(素材样式后注入) */
const BASE_STYLE =
  'html,body{margin:0;padding:0}body{padding:16px;background:#fff;color:#111;' +
  'font-family:system-ui,"Segoe UI",sans-serif}*,*::before,*::after{box-sizing:border-box}'

/**
 * 把 CSS 文本与骨架合成一个自包含的预览文档。
 *
 * - 骨架缺省时按 CSS 选择器反推演示骨架(推导不出才用固定骨架);
 * - 骨架是完整文档时注入 <head>,是片段时包一层最小文档;
 * - 一律剥离脚本并注入 CSP,预览不产生任何外部请求。
 */
export function buildPreviewHtml(cssText: string, shellHtml?: string | null): string {
  const shell = (shellHtml ?? '').trim() || fallbackShell(cssText)
  const head =
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    `<style>${BASE_STYLE}</style>` +
    `<style>${escapeStyleText(cssText)}</style>`

  if (looksLikeDocument(shell)) {
    return `<!doctype html>${injectIntoHead(shell, head)}`
  }
  return `<!doctype html><html><head>${head}</head><body>${stripScripts(shell)}</body></html>`
}