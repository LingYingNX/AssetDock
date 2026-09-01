// 原生模块冒烟:在 Electron 运行时验证 better-sqlite3 / sharp / chokidar / ffmpeg-static
const { app } = require('electron')

app.whenReady().then(async () => {
  const out = {}
  try {
    const B = require('better-sqlite3')
    const db = new B(':memory:')
    db.exec('CREATE TABLE t(a INTEGER)')
    db.prepare('INSERT INTO t VALUES (?)').run(1)
    out.sqlite = 'ok ' + db.prepare('SELECT a FROM t').get().a
  } catch (e) { out.sqlite = 'FAIL ' + e.message }
  try {
    const sharp = require('sharp')
    const m = await sharp('E:/zcode项目/素材管理器/素材/010408_2.jpg').metadata()
    out.sharp = `ok ${m.width}x${m.height}`
  } catch (e) { out.sharp = 'FAIL ' + e.message }
  try { require('chokidar'); out.chokidar = 'ok' } catch (e) { out.chokidar = 'FAIL ' + e.message }
  try {
    const { execFileSync } = require('node:child_process')
    const p = require('ffmpeg-static')
    const v = execFileSync(p, ['-version']).toString().split('\n')[0]
    out.ffmpeg = v.slice(0, 30)
  } catch (e) { out.ffmpeg = 'FAIL ' + e.message }
  console.log('SMOKE ' + JSON.stringify(out))
  app.exit(0)
})
