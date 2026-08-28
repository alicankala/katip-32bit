import { describe, expect, it } from 'vitest'
import { disAdresMi, yeniPencereKarari, yerelYazdirmaPenceresiMi } from '../../electron/windowOpenPolicy'

describe('yeni pencere güvenlik politikası', () => {
  it('yalnızca yerel boş yazdırma penceresine izin verir', () => {
    expect(yerelYazdirmaPenceresiMi('about:blank')).toBe(true)
    expect(yerelYazdirmaPenceresiMi('about:blank#blocked')).toBe(true)

    for (const url of [
      'https://example.com',
      'http://example.com',
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'data:text/html,hello',
      'about:srcdoc',
      'about:blank#anything-else'
    ]) {
      expect(yerelYazdirmaPenceresiMi(url)).toBe(false)
    }
  })

  it('yalnızca HTTP ve HTTPS adreslerini sistem tarayıcısı adayı sayar', () => {
    expect(disAdresMi('https://example.com')).toBe(true)
    expect(disAdresMi('HTTP://example.com')).toBe(true)
    expect(disAdresMi('about:blank')).toBe(false)
    expect(disAdresMi('file:///C:/test.html')).toBe(false)
  })

  it('yazdırma penceresini Node erişimi kapalı ve sandbox açık oluşturur', () => {
    expect(yeniPencereKarari('about:blank')).toMatchObject({
      action: 'allow',
      overrideBrowserWindowOptions: {
        frame: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true
        }
      }
    })
    expect(yeniPencereKarari('https://example.com')).toEqual({ action: 'deny' })
  })
})
