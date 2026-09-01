// 无头验证辅助:经 CDP(browser 端点)attach 渲染进程并执行 JS 表达式
// 用法: node tools/cdp.mjs "<expression>"
const ver = await (await fetch('http://127.0.0.1:9222/json/version')).json()
const ws = new WebSocket(ver.webSocketDebuggerUrl)

const send = (msg) => ws.send(JSON.stringify(msg))
const waitMsg = (match) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('cdp timeout')), 10000)
    const h = (ev) => {
      const m = JSON.parse(ev.data)
      if (match(m)) {
        clearTimeout(t)
        ws.removeEventListener('message', h)
        res(m)
      }
    }
    ws.addEventListener('message', h)
  })

ws.onopen = async () => {
  try {
    const targets = await waitMsg((m) => m.id === 1)
    const pages = JSON.parse(targets.result?.targetInfos ? '[]' : '[]') // placeholder
    void pages
  } catch {}
}

// 主流程
ws.onopen = async () => {
  try {
    send({ id: 1, method: 'Target.getTargets' })
    const r = await waitMsg((m) => m.id === 1)
    const infos = r.result.targetInfos ?? []
    const page =
      infos.find((t) => t.type === 'page' && (t.url.includes('5173') || t.title.includes('MediaHub'))) ??
      infos.find((t) => t.type === 'page' && t.url && !t.url.startsWith('devtools'))
    if (!page) {
      console.error('NO_PAGE: ' + JSON.stringify(infos.map((t) => ({ type: t.type, url: t.url.slice(0, 50), title: t.title }))))
      process.exit(1)
    }
    send({ id: 2, method: 'Target.attachToTarget', params: { targetId: page.targetId, flatten: true } })
    const att = await waitMsg((m) => m.id === 2)
    if (att.error) {
      console.error('ATTACH_ERROR: ' + JSON.stringify(att.error))
      process.exit(1)
    }
    const sessionId = att.result.sessionId
    const expr = process.argv[2]
    send({ sessionId, id: 3, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true, awaitPromise: true } })
    const ev = await waitMsg((m) => m.sessionId === sessionId && m.id === 3)
    if (ev.result?.exceptionDetails) {
      console.error('EXCEPTION: ' + JSON.stringify(ev.result.exceptionDetails.exception?.description ?? ev.result.exceptionDetails))
    } else {
      const v = ev.result?.result?.value
      console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
    }
    ws.close()
    process.exit(0)
  } catch (e) {
    console.error('ERR: ' + e.message)
    process.exit(1)
  }
}
ws.onerror = () => {
  console.error('ws error')
  process.exit(1)
}
