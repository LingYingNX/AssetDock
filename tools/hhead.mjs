// 无头验证辅助:经 dev HTTP 桥在渲染进程执行 JS 表达式
// 用法: node tools/hhead.mjs "<expression>"
// 桥路径带随机 token(主进程启动时打印),从 userData/debug-bridge-token 读取
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const expr = process.argv[2]
if (!expr) {
  console.error('usage: node tools/hhead.mjs "<expression>"')
  process.exit(1)
}
let token = ''
const appDataDir = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
/* 更名后默认目录是 AssetDock;旧实例仍可能落在 MediaHub/mediahub,按顺序取存在的 token */
for (const name of ['AssetDock', 'MediaHub', 'mediahub']) {
  try {
    token = readFileSync(join(appDataDir, name, 'debug-bridge-token'), 'utf8').trim()
    break
  } catch { /* 继续找下一个目录 */ }
}
const r = await (await fetch(`http://127.0.0.1:9223/${token}/${encodeURIComponent(expr)}`)).json()
if (!r.ok) {
  console.error('ERR: ' + r.error)
  process.exit(1)
}
const v = r.value
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
