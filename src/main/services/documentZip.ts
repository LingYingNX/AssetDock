import { readFile, stat } from 'node:fs/promises'
import JSZip from 'jszip'

const MAX_OOXML_BYTES = 128 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 5000

/** 受密码保护的 Office 文件不是 zip,而是 OLE/CFB 容器(加密包)。 */
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])

export async function openZip(absPath: string): Promise<JSZip> {
  const st = await stat(absPath).catch(() => null)
  if (!st?.isFile()) throw new Error('source file is missing')
  if (st.size > MAX_OOXML_BYTES) throw new Error('OOXML file exceeds limit')
  const data = await readFile(absPath)
  if (data.length >= 8 && data.subarray(0, 8).equals(OLE_SIGNATURE)) {
    throw new Error('OOXML file is encrypted (OLE container)')
  }
  const zip = await JSZip.loadAsync(data)
  const entries = Object.values(zip.files)
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('OOXML archive has too many entries')
  let total = 0
  for (const entry of entries) {
    if (entry.dir) continue
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof size === 'number') {
      total += size
      if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('OOXML uncompressed size exceeds limit')
    }
  }
  return zip
}
