let timer: number | null = null

/** 颜色面板悬停进出共用:留一小段宽限,指针穿过按钮与浮层之间的间隙时不闪关 */
export function scheduleColorMenuClose(close: () => void): void {
  cancelColorMenuClose()
  timer = window.setTimeout(() => {
    timer = null
    close()
  }, 160)
}

export function cancelColorMenuClose(): void {
  if (timer != null) {
    window.clearTimeout(timer)
    timer = null
  }
}
