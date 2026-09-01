import { readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = 'E:/zcode项目/素材管理器/素材'

function jpegSize(buf) {
  let i = 2
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue }
    const marker = buf[i + 1]
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }
    }
    i += 2 + buf.readUInt16BE(i + 2)
  }
  return null
}
function pngSize(buf) {
  return buf.length > 24 ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null
}

function mp4Info(buf) {
  const idx = buf.indexOf(Buffer.from('mvhd'))
  if (idx < 0) return null
  const ver = buf[idx + 4]
  let timescale, duration
  if (ver === 1) { timescale = buf.readUInt32BE(idx + 24); duration = Number(buf.readBigUInt64BE(idx + 28)) }
  else { timescale = buf.readUInt32BE(idx + 16); duration = buf.readUInt32BE(idx + 20) }
  if (!timescale) return null
  const sec = duration / timescale
  const mm = String(Math.floor(sec / 60)).padStart(2, '0')
  const ss = String(Math.round(sec % 60)).padStart(2, '0')
  return { sec, mmss: `${mm}:${ss}` }
}

for (const name of readdirSync(dir)) {
  const full = join(dir, name)
  const st = statSync(full)
  let dims = ''
  if (/\.jpe?g$/i.test(name)) { const d = jpegSize(readFileSync(full)); if (d) dims = `${d.w}x${d.h}` }
  else if (/\.png$/i.test(name)) { const d = pngSize(readFileSync(full)); if (d) dims = `${d.w}x${d.h}` }
  let dur = ''
  if (/\.mp4$/i.test(name)) { const d = mp4Info(readFileSync(full)); if (d) dur = d.mmss }
  console.log(`${name}|${st.size}|${st.mtime.toISOString().slice(0, 16).replace('T', ' ')}|${dims}|${dur}`)
}
