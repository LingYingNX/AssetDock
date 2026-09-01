import fs from 'node:fs'
import path from 'node:path'

const root = 'E:/Serpent素材导出/我的资源库'
const files = []
const dirs = []
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name)
    if (e.isDirectory()) {
      dirs.push(path.relative(root, p).replace(/\\/g, '/'))
      walk(p)
    } else {
      files.push({ rel: path.relative(root, p).replace(/\\/g, '/'), size: fs.statSync(p).size })
    }
  }
}
walk(root)
const byExt = {}
for (const f of files) {
  const e = (f.rel.split('.').pop() || '').toLowerCase()
  byExt[e] = (byExt[e] || 0) + 1
}
console.log('files:', files.length, 'dirs:', dirs.length)
console.log('dirs:', dirs.slice(0, 25).join(' | '))
console.log('byExt:', JSON.stringify(byExt))
console.log('totalBytes:', files.reduce((s, f) => s + f.size, 0))
console.log('sample:\n' + files.slice(0, 10).map((f) => f.rel).join('\n'))
