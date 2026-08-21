import { existsSync, realpathSync } from 'node:fs'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

const RUNTIME_GUARD = '[KATIP_UNIT_RUNTIME_GUARD]'

describe('unit test ortamı güvenliği', () => {
  it('yalnız işletim sistemi geçici dizini altında çalışır', () => {
    const testRoot = process.env.KATIP_TEST_ROOT
    expect(testRoot).toBeTruthy()

    const tempBase = realpathSync(tmpdir())
    const resolvedRoot = realpathSync(testRoot!)
    const relativePath = relative(tempBase, resolvedRoot)

    expect(relativePath).not.toBe('')
    expect(isAbsolute(relativePath)).toBe(false)
    expect(relativePath).not.toBe('..')
    expect(relativePath.startsWith(`..${sep}`)).toBe(false)
    expect(basename(resolvedRoot).startsWith('katip-unit-')).toBe(true)
  })

  it('Electron ve native SQLite çalışma zamanını yüklemeyi reddeder', async () => {
    await expect(import('electron')).rejects.toThrow(RUNTIME_GUARD)
    await expect(import('better-sqlite3')).rejects.toThrow(RUNTIME_GUARD)
  })

  it('database modülünü gerçek userData açılmadan durdurur', async () => {
    await expect(import('../../electron/database.js')).rejects.toThrow(RUNTIME_GUARD)

    const testRoot = process.env.KATIP_TEST_ROOT!
    expect(existsSync(join(testRoot, 'otoservis.db'))).toBe(false)
  })
})
