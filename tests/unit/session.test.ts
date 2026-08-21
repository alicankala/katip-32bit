import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearActiveMasterSession,
  getActiveMasterSession,
  resolveActiveMasterId,
  setActiveMasterSession
} from '../../electron/session'

describe('ana süreç oturumu', () => {
  beforeEach(() => clearActiveMasterSession())

  it('başlangıçta ve temizlendikten sonra oturumu boş tutar', () => {
    expect(getActiveMasterSession()).toBeNull()
    expect(resolveActiveMasterId()).toBeNull()

    setActiveMasterSession(2)
    clearActiveMasterSession()

    expect(getActiveMasterSession()).toBeNull()
    expect(resolveActiveMasterId()).toBeNull()
  })

  it('geçerli usta kimliğini kayıt yapan kimlik olarak çözer', () => {
    setActiveMasterSession(3)

    expect(getActiveMasterSession()).toBe(3)
    expect(resolveActiveMasterId()).toBe(3)
  })

  it('admin oturumunu usta kimliği olarak kullanmaz', () => {
    setActiveMasterSession('admin')

    expect(getActiveMasterSession()).toBe('admin')
    expect(resolveActiveMasterId()).toBeNull()
  })

  it('geçersiz sayısal kimlikleri kayıt yapan usta olarak çözmez', () => {
    for (const invalidId of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      setActiveMasterSession(invalidId)
      expect(resolveActiveMasterId()).toBeNull()
    }
  })
})
