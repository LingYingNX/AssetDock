// 无头验证辅助:经 dev HTTP 桥在渲染进程执行 JS 表达式
// 用法: node tools/hhead.mjs "<expression>"
const expr = process.argv[2]
if (!expr) {
  console.error('usage: node tools/hhead.mjs "<expression>"')
  process.exit(1)
}
const r = await (await fetch(`http://127.0.0.1:9223/${encodeURIComponent(expr)}`)).json()
if (!r.ok) {
  console.error('ERR: ' + r.error)
  process.exit(1)
}
const v = r.value
console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
