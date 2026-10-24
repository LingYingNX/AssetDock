import { describe, expect, it } from 'vitest'
import { runMediaProcess } from '../src/main/services/ffmpeg'

describe('bounded media process', () => {
  it('kills a process that exceeds its timeout', async () => {
    await expect(runMediaProcess(process.execPath, [
      '-e', 'setTimeout(() => process.exit(0), 5000)'
    ], { timeoutMs: 80 })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('stops process output before it can exhaust memory', async () => {
    await expect(runMediaProcess(process.execPath, [
      '-e', 'process.stdout.write(Buffer.alloc(4096))'
    ], { maxOutputBytes: 128 })).rejects.toMatchObject({ kind: 'too-large' })
  })
})
