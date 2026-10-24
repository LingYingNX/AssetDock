import { describe, expect, it } from 'vitest'
import { configuredToolPath, probeExecutable } from '../src/main/services/externalTools'

describe('external tool configuration', () => {
  it('reads flat and nested tool paths', () => {
    expect(configuredToolPath(JSON.stringify({ blenderPath: 'C:\\Apps\\blender.exe' }), 'blender'))
      .toBe('C:\\Apps\\blender.exe')
    expect(configuredToolPath(JSON.stringify({ externalTools: { cinema4d: 'C:\\Apps\\C4D.exe' } }), 'cinema4d'))
      .toBe('C:\\Apps\\C4D.exe')
    expect(configuredToolPath('{bad json', 'blender')).toBeUndefined()
  })

  it('runs an executable without a shell and reports its version line', async () => {
    const status = await probeExecutable(process.execPath, ['--version'])
    expect(status.available).toBe(true)
    expect(status.version).toContain('v')
  })

  it('reports a missing executable as unavailable', async () => {
    const status = await probeExecutable('C:\\definitely-missing\\tool.exe', ['--version'], 1_000)
    expect(status.available).toBe(false)
    expect(status.error).toBeTruthy()
  })

  it('keeps the final stderr line when an executable exits with an error', async () => {
    const status = await probeExecutable(
      process.execPath,
      ['-e', 'console.error("No License Model defined"); process.exit(2)'],
      1_000
    )
    expect(status.available).toBe(false)
    expect(status.error).toBe('No License Model defined')
  })

  it('terminates a hung executable at the timeout', async () => {
    const started = Date.now()
    const status = await probeExecutable(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], 150)
    expect(status.available).toBe(false)
    expect(Date.now() - started).toBeLessThan(3_000)
  })
})
