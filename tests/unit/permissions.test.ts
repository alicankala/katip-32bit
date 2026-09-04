import { describe, expect, it } from 'vitest'
import {
  DESTEK_ENGEL_MESAJI,
  USTA_ONLY_CHANNELS,
  destekModundaYasakMi
} from '../../electron/permissions'

describe('destek modu izin matrisi', () => {
  it('tanımlı bütün usta işlemlerini admin/destek oturumunda engeller', () => {
    expect(USTA_ONLY_CHANNELS.size).toBeGreaterThan(0)

    for (const channel of USTA_ONLY_CHANNELS) {
      expect(destekModundaYasakMi(channel, 'admin'), channel).toBe(true)
    }
  })

  it('usta ve oturumsuz kullanımda destek modu engeli uygulamaz', () => {
    for (const channel of USTA_ONLY_CHANNELS) {
      expect(destekModundaYasakMi(channel, 1), channel).toBe(false)
      expect(destekModundaYasakMi(channel, null), channel).toBe(false)
    }
  })

  it.each([
    'is-emirleri-getir',
    'istatistikleri-getir',
    'veritabani-yedekle',
    'veritabani-kontrol-et',
    'gun-sonu-kapanis-ac',
    'ayarlari-getir'
  ])('bakım veya görüntüleme kanalını admin için açık bırakır: %s', (channel) => {
    expect(destekModundaYasakMi(channel, 'admin')).toBe(false)
  })

  it('iş emri, müşteri, araç, stok, finans ve gün sonu mutasyonlarını matriste tutar', () => {
    expect(USTA_ONLY_CHANNELS).toBeInstanceOf(Set)

    for (const channel of [
      'is-emri-ekle',
      'musteri-ekle',
      'arac-ekle',
      'parca-ekle',
      'cari-islem-guncelle',
      'cari-odeme-ekle',
      'gider-ekle',
      'gun-sonu-kapat'
    ]) {
      expect(USTA_ONLY_CHANNELS.has(channel), channel).toBe(true)
    }

    expect(DESTEK_ENGEL_MESAJI.trim().length).toBeGreaterThan(0)
  })
})
