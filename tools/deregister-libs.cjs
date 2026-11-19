// 一次性维护脚本:从指定库注册表删除四个库条目(目录与 .mediahub 数据保留,可重新绑定恢复)
// 必须显式传库路径,避免误跑时删掉真实注册表。
const { app } = require('electron')
const { isAbsolute } = require('node:path')
const dbPath = process.argv[2]
if (!dbPath || !isAbsolute(dbPath)) {
  console.log('usage: npx electron tools/deregister-libs.cjs <absolute path to mediahub.db>')
  process.exit(1)
}
app.whenReady().then(() => {
  try {
    const D = require('better-sqlite3')
    const db = new D(dbPath)
    db.pragma('busy_timeout = 5000')
    const before = db.prepare('SELECT id, name, path FROM libraries').all()
    const names = ['素材', '测试', '我的资源库', 'mh_portable_copy']
    const ids = before.filter((l) => names.includes(l.name)).map((l) => l.id)
    let delTabs = 0
    let delLibs = 0
    if (ids.length > 0) {
      delTabs = db.prepare(`DELETE FROM open_tabs WHERE library_id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes
      delLibs = db.prepare(`DELETE FROM libraries WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids).changes
    }
    console.log('DEREGISTERED ' + delLibs + ' libs, ' + delTabs + ' tabs; remaining: ' +
      db.prepare('SELECT name FROM libraries').all().map((r) => r.name).join(','))
    db.close()
  } catch (e) {
    console.log('FAIL ' + e.message)
  }
  app.exit(0)
})
setTimeout(() => process.exit(1), 15000)
