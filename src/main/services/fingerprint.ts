import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'

/**
 * 内容指纹:sha1(前 64KB + size) 截断 20 位。
 * 读 64KB 而非全文件,速度与抗碰折中;用于缩略图缓存键。
 */
export async function fingerprint(absPath: string, size: number): Promise<string> {
  const h = createHash('sha1')
  const fh = await open(absPath, 'r')
  try {
    const buf = Buffer.alloc(Math.min(65536, Math.max(size, 0)))
    if (buf.length > 0) {
      await fh.read(buf, 0, buf.length, 0)
      h.update(buf)
    }
  } finally {
    await fh.close()
  }
  h.update(`:${size}`)
  return h.digest('hex').slice(0, 20)
}
