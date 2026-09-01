import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const roots = readdirSync('node_modules').filter((n) => !n.startsWith('.'))
const rows = []

function countLines(dir) {
  let total = 0
  let files
  try {
    files = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const f of files) {
    const p = join(dir, f.name)
    if (f.isDirectory()) {
      if (f.name === 'dist' && /\.exe$|node_modules\/electron\/dist/.test(p)) continue
      total += countLines(p)
    } else if (/\.(js|mjs|cjs|ts|jsx|tsx|json)$/.test(f.name)) {
      try {
        const s = statSync(p)
        if (s.size > 20 * 1024 * 1024) continue
        total += readFileSync(p, 'utf8').split('\n').length
      } catch { /* 跳过不可读文件 */ }
    }
  }
  return total
}

for (const name of roots) {
  if (name.startsWith('@')) {
    for (const sub of readdirSync(join('node_modules', name))) {
      const p = join('node_modules', name, sub)
      const n = countLines(p)
      rows.push([n, `${name}/${sub}`])
    }
  } else {
    const n = countLines(join('node_modules', name))
    rows.push([n, name])
  }
}

rows.sort((a, b) => b[0] - a[0])
let sum = 0
for (const [n, name] of rows.slice(0, 14)) console.log(`${String(n).padStart(8)}  ${name}`)
for (const [n] of rows) sum += n
console.log('--------')
console.log(`${String(sum).padStart(8)}  总计(${rows.length} 个顶层包)`)
