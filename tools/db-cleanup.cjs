// 临时清理:删除测试残留的 missing 记录(WAL 多进程,busy_timeout 防锁等待挂起)
// 必须显式传库路径,避免误跑时删掉真实注册表的素材行。
const { app } = require('electron')
const { isAbsolute } = require('node:path')
const dbPath = process.argv[2]
if (!dbPath || !isAbsolute(dbPath)) {
  console.log('usage: npx electron tools/db-cleanup.cjs <absolute path to mediahub.db>')
  process.exit(1)
}
app.whenReady().then(() => {
  try {
    const D = require('better-sqlite3')
    const db = new D(dbPath)
    db.pragma('busy_timeout = 5000')
    const r = db
      .prepare("DELETE FROM assets WHERE (rel_path LIKE 'watch_test%' OR name LIKE 'fake_%') AND missing = 1")
      .run()
    console.log('CLEANED ' + r.changes)
    db.close()
  } catch (e) {
    console.log('CLEAN_FAIL ' + e.message)
  }
  app.exit(0)
})
setTimeout(() => process.exit(1), 15000)
