import crypto from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { hashPin, setActiveSalt, verifyPin } from '../../electron/security'

const LEGACY_SALT = 'OtoServis2026_Salt_#9982'
const TEST_SALT = 'unit-test-current-salt-2026'

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex')
}

describe('PIN güvenliği', () => {
  beforeEach(() => setActiveSalt(LEGACY_SALT))

  it('PIN değerini kırpıp aktif salt ile deterministik olarak hashler', () => {
    setActiveSalt(TEST_SALT)

    expect(hashPin(' 1234 ')).toBe(sha256(`1234${TEST_SALT}`))
    expect(hashPin('1234')).toHaveLength(64)
  })

  it('doğru PIN değerini kabul edip yanlış PIN değerini reddeder', () => {
    setActiveSalt(TEST_SALT)
    const storedHash = hashPin('2468')

    expect(verifyPin('2468', storedHash)).toBe(true)
    expect(verifyPin('1357', storedHash)).toBe(false)
    expect(verifyPin('2468', '')).toBe(false)
  })

  it('aktif salt değiştikten sonra legacy salt ile saklanmış PIN değerini doğrular', () => {
    const legacyHash = sha256(`4444${LEGACY_SALT}`)
    setActiveSalt(TEST_SALT)

    expect(verifyPin('4444', legacyHash)).toBe(true)
    expect(verifyPin('0000', legacyHash)).toBe(false)
  })

  it('16 karakterden kısa salt değerini yok sayar', () => {
    setActiveSalt(TEST_SALT)
    const oncekiHash = hashPin('1234')

    setActiveSalt('cok-kisa')

    expect(hashPin('1234')).toBe(oncekiHash)
  })
})
