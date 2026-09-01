import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprint } from '../src/main/services/fingerprint'

let dir: string
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mh-fp-'))
  writeFileSync(join(dir, 'a.bin'), Buffer.alloc(100, 1))
  writeFileSync(join(dir, 'b.bin'), Buffer.alloc(100, 2))
})

describe('fingerprint', () => {
  it('same content+size → same fingerprint', async () => {
    const dir2 = mkdtempSync(join(tmpdir(), 'mh-fp2-'))
    copyFileSync(join(dir, 'a.bin'), join(dir2, 'copy.bin'))
    const [f1, f2] = await Promise.all([fingerprint(join(dir, 'a.bin'), 100), fingerprint(join(dir2, 'copy.bin'), 100)])
    expect(f1).toBe(f2)
  })
  it('different content → different fingerprint', async () => {
    const [f1, f2] = await Promise.all([fingerprint(join(dir, 'a.bin'), 100), fingerprint(join(dir, 'b.bin'), 100)])
    expect(f1).not.toBe(f2)
  })
  it('same content different size → different fingerprint', async () => {
    writeFileSync(join(dir, 'big.bin'), Buffer.alloc(101, 1))
    const [f1, f3] = await Promise.all([fingerprint(join(dir, 'a.bin'), 100), fingerprint(join(dir, 'big.bin'), 101)])
    expect(f1).not.toBe(f3)
  })
})
