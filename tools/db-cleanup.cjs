// 临时清理:删除测试残留的 missing 记录(WAL 多进程,busy_timeout 防锁等待挂起)
const { app } = require('electron')
app.whenReady().then(() => {
  try {
    const D = require('better-sqlite3')
    const path = require('node:path')
    const db = new D(path.join(app.getPath('userData'), 'mediahub.db'))
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
