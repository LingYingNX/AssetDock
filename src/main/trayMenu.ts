import { BrowserWindow, app, screen, type Tray } from 'electron'

/** 自绘托盘菜单:原生菜单改不了行高/圆角/高亮填充,这里用一个透明小窗代替 */
const MENU_W = 148
const MENU_H = 72

let menuWin: BrowserWindow | null = null

function menuHtml(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{background:transparent;overflow:hidden}
  body{font:13px/1 "Segoe UI","Microsoft YaHei UI",sans-serif;user-select:none}
  .menu{height:100vh;padding:4px;display:flex;flex-direction:column;border-radius:6px;border:1px solid rgba(255,255,255,.16);background:rgba(34,42,53,.97);box-shadow:0 10px 26px rgba(0,0,0,.38)}
  button{height:28px;padding:0 10px;border:0;border-radius:4px;background:transparent;color:#E9EEF6;font:inherit;text-align:left;cursor:pointer}
  button:hover{background:rgba(59,155,255,.22);color:#fff}
  .sep{height:1px;margin:3px 6px;background:rgba(255,255,255,.14)}
  @media (prefers-color-scheme: light){
    .menu{background:rgba(250,252,255,.98);border-color:rgba(30,50,80,.18);box-shadow:0 10px 26px rgba(20,40,80,.22)}
    button{color:#1B2634}
    button:hover{background:rgba(10,132,255,.14)}
    .sep{background:rgba(30,50,80,.14)}
  }
  </style></head><body><div class="menu">
  <button data-act="open">打开面板</button><div class="sep"></div><button data-act="quit">退出</button>
  </div><script>
  document.addEventListener('click',(e)=>{const b=e.target.closest('button');if(!b)return;window.open('tray-menu://'+b.dataset.act,'_blank')})
  document.addEventListener('keydown',(e)=>{if(e.key==='Escape')window.close()})
  document.body.addEventListener('mouseleave',()=>window.open('tray-menu://close','_blank'))
  </script></body></html>`
}

export function showTrayMenu(tray: Tray, onOpen: () => void): void {
  if (!menuWin) {
    menuWin = new BrowserWindow({
      width: MENU_W,
      height: MENU_H,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      hasShadow: true,
      backgroundColor: '#00000000',
      focusable: false,
      webPreferences: { sandbox: true }
    })
    void menuWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(menuHtml()))
    /* 非激活窗口不抢焦点:失焦事件不可靠,关闭改由鼠标离开或托盘点击触发 */
    menuWin.on('close', (event) => { event.preventDefault(); menuWin?.hide() })
    menuWin.webContents.setWindowOpenHandler(({ url }) => {
      if (url.endsWith('close')) {
        menuWin?.hide()
      } else if (url.endsWith('open')) {
        menuWin?.hide()
        onOpen()
      } else if (url.endsWith('quit')) {
        app.quit()
      }
      return { action: 'deny' }
    })
    menuWin.once('ready-to-show', () => { if (menuWin) placeAndShow(menuWin, tray) })
    return
  }
  placeAndShow(menuWin, tray)
}

function placeAndShow(win: BrowserWindow, tray: Tray): void {
  const b = tray.getBounds()
  const area = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea
  const below = b.y < area.y + area.height / 2
  const x = Math.min(Math.max(area.x + 4, Math.round(b.x + b.width / 2 - MENU_W / 2)), area.x + area.width - MENU_W - 4)
  const y = below
    ? Math.min(b.y + b.height + 6, area.y + area.height - MENU_H - 4)
    : Math.max(area.y + 4, b.y - MENU_H - 6)
  win.setBounds({ x, y, width: MENU_W, height: MENU_H })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.showInactive()
}
export function destroyTrayMenu(): void {
  menuWin?.destroy()
  menuWin = null
}

export function hideTrayMenu(): void {
  menuWin?.hide()
}

export function isTrayMenuVisible(): boolean {
  return !!menuWin?.isVisible()
}
