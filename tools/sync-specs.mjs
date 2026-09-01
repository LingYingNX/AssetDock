// 将 change 的 delta specs 同步进主 specs(ADDED/MODIFIED 替换,REMOVED 删除)
import fs from 'node:fs'

const change = process.argv[2]
const base = `openspec/changes/${change}/specs`

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
  const delta = fs.readFileSync(`${base}/${cap}/spec.md`, 'utf8')
  const mainPath = `openspec/specs/${cap}/spec.md`
  let main = fs.existsSync(mainPath) ? fs.readFileSync(mainPath, 'utf8') : '## Purpose\n\n## Requirements\n'
  const HEAD = '## Requirements'
  let reqs = main.includes(HEAD) ? main.slice(main.indexOf(HEAD) + HEAD.length) : ''
  const mb = blocks(reqs)
  const addedKeys = Object.keys(section(delta, 'ADDED'))
  if (process.env.SYNC_DEBUG) console.log(`${cap} ADDED keys:`, addedKeys)
  Object.assign(mb, section(delta, 'ADDED'), section(delta, 'MODIFIED'))
  for (const n of removedNames(delta)) delete mb[n]
  const body = Object.values(mb).join('\n\n')
  const newMain = main.slice(0, main.includes(HEAD) ? main.indexOf(HEAD) : undefined) + HEAD + '\n\n' + body + '\n'
  fs.mkdirSync(`openspec/specs/${cap}`, { recursive: true })
  fs.writeFileSync(mainPath, newMain)
  console.log(`${cap}: reqs=${Object.keys(mb).length}`)
}
