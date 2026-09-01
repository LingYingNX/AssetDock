// 探测可携带副本的行数(Electron ABI 下运行)
const { app } = require('electron')
app.whenReady().then(() => {
  try {
    const D = require('better-sqlite3')
    const db = new D('E:/mh_portable_copy/.mediahub/library.db')
    db.pragma('busy_timeout = 5000')
    console.log('PORTABLE_ROWS ' + db.prepare('SELECT COUNT(*) c FROM assets').get().c)
    db.close()
  } catch (e) {
    console.log('PORTABLE_ERR ' + e.message)
  }
  app.exit(0)
})
