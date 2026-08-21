import { describe, expect, it } from 'vitest'
import { checkVinChecksum, decodeVin } from '../../src/utils/vinDecoder'

describe('VIN doğrulama ve çözümleme', () => {
  it('geçerli Modulus 11 kontrol hanesini doğrular', () => {
    expect(checkVinChecksum('1M8GDM9AXKP042788')).toBe(true)
    expect(checkVinChecksum('1M8GDM9AXKP042789')).toBe(false)
    expect(checkVinChecksum('KISA')).toBe(false)
  })

  it('Kuzey Amerika VIN bilgisini marka, ülke ve yıl ile çözer', () => {
    expect(decodeVin('1FTFW1ET3EFA00001')).toEqual({
      brand: 'Ford',
      country: 'ABD',
      year: 2014,
      isValidChecksum: true,
      checksumApplies: true
    })
  })

  it('küçük harf ve ayraçları temizleyerek Avrupa VIN bilgisini çözer', () => {
    expect(decodeVin('wvw-zzz-1jz-3w386752')).toEqual({
      brand: 'Volkswagen',
      country: 'Almanya',
      year: 2003,
      isValidChecksum: false,
      checksumApplies: false
    })
  })

  it('çok kısa VIN değerini reddeder', () => {
    expect(decodeVin('A-1')).toBeNull()
  })

  it('bilinmeyen WMI kodunda güvenli boş marka ve ülke döndürür', () => {
    const result = decodeVin('ZZZ000000T0000000')

    expect(result?.brand).toBe('')
    expect(result?.country).toBe('')
    expect(result?.year).toBe(2026)
  })
})
