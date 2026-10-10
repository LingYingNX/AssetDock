// 将 change 的 delta specs 同步进主 specs(ADDED/MODIFIED 替换,REMOVED 删除)
import fs from 'node:fs'

const change = process.argv[2]
const changesBase = process.argv[3] ?? 'openspec/changes'
const base = `${changesBase}/${change}/specs`

// 行尾无关:所有匹配都在 \n 文本上做,写回时还原主 spec 原有 EOL。
// 旧版直接在原文上跑正则,而 `.` 不匹配 \r,CRLF 的主 spec 会命中 0 个 Requirement
// 并把文件清成只剩 Purpose(asset-browser 实测 reqs=0,menus-shortcuts 因是 LF 才没暴露)。
const toLF = (t) => t.replace(/\r\n/g, '\n')
const eolOf = (t) => (t.includes('\r\n') ? '\r\n' : '\n')
const restoreEol = (t, eol) => (eol === '\n' ? t : t.replace(/\n/g, eol))

const blocks = (text) => {
  const out = {}
  const re = /### Requirement: (.+?)\n([\s\S]*?)(?=\n### Requirement: |\n## |$)/g
  let m
  while ((m = re.exec(text))) out[m[1].trim()] = ('### Requirement: ' + m[1].trim() + '\n' + m[2]).trim()
  return out
}
const section = (t, name) => {
  const i = t.indexOf(`## ${name} Requirements`)
  return i < 0 ? {} : blocks(t.slice(i))
}
const removedNames = (t) => {
  const i = t.indexOf('## REMOVED Requirements')
  if (i < 0) return []
  const next = t.indexOf('\n## ', i + 4)
  const seg = next < 0 ? t.slice(i) : t.slice(i, next)
  const re = /### Requirement: (.+?)\n/g
  const names = []
  let m
  while ((m = re.exec(seg))) names.push(m[1].trim())
  return names
}

for (const cap of fs.readdirSync(base)) {
  const delta = toLF(fs.readFileSync(`${base}/${cap}/spec.md`, 'utf8'))
  const mainPath = `openspec/specs/${cap}/spec.md`
  const rawMain = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '## Purpose\n\n## Requirements\n'
  const eol = eolOf(rawMain)
  const main = toLF(rawMain)
  const HEAD = '## Requirements'
  const reqs = main.includes(HEAD) ? main.slice(main.indexOf(HEAD) + HEAD.length) : ''
  const mb = blocks(reqs)
  const before = Object.keys(mb).length
  const addedKeys = Object.keys(section(delta, 'ADDED'))
  const modifiedKeys = Object.keys(section(delta, 'MODIFIED'))
  const removed = removedNames(delta)
  if (process.env.SYNC_DEBUG) console.log(`${cap} ADDED keys:`, addedKeys)
  // 守卫:主 spec 明明有 Requirement 却一个都没解析出来时拒绝写入,避免正则失配再次清空文件
  if (before === 0 && main.includes('### Requirement: ')) {
    throw new Error(`${cap}: 主 spec 含 Requirement 但解析到 0 个,拒绝写入(检查 spec.md 行尾与 blocks() 正则)`)
  }
  // 先删后加:REMOVED 与 ADDED 同名(原地重构/改名后复用)时,后删会把刚加的内容一并删掉。
  for (const n of removed) delete mb[n]
  Object.assign(mb, section(delta, 'ADDED'), section(delta, 'MODIFIED'))
  const body = Object.values(mb).join('\n\n')
  const newMain = main.slice(0, main.includes(HEAD) ? main.indexOf(HEAD) : undefined) + HEAD + '\n\n' + body + '\n'
  fs.mkdirSync(`openspec/specs/${cap}`, { recursive: true })
  fs.writeFileSync(mainPath, restoreEol(newMain, eol))
  console.log(`${cap}: reqs ${before} -> ${Object.keys(mb).length} (added=${addedKeys.length} modified=${modifiedKeys.length} removed=${removed.length}) eol=${JSON.stringify(eol)}`)
}