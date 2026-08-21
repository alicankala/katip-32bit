import { beforeEach, describe, expect, it } from 'vitest'
import { isRestoreInProgress, setRestoreInProgress } from '../../electron/restoreState'

describe('restore durumu', () => {
  beforeEach(() => setRestoreInProgress(false))

  it('varsayılan olarak kapalıdır', () => {
    expect(isRestoreInProgress()).toBe(false)
  })

  it('restore başlangıcı ve bitişini izler', () => {
    setRestoreInProgress(true)
    expect(isRestoreInProgress()).toBe(true)

    setRestoreInProgress(false)
    expect(isRestoreInProgress()).toBe(false)
  })
})
