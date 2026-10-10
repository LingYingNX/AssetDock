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
try {
  token = readFileSync(join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'MediaHub', 'debug-bridge-token'), 'utf8').trim()
} catch { /* token 文件不存在时按无 token 请求,桥会回 403 */ }
const r = await (await fetch(`http://127.0.0.1:9223/${token}/${encodeURIComponent(expr)}`)).json()
if (!r.ok) {
  console.error('ERR: ' + r.error)
  process.exit(1)
}
const v = r.value
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
