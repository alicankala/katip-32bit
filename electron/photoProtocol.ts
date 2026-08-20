// İş emri fotoğraflarını arayüze taşıyan özel protokol.
//
// Eskiden `is-emri-fotograflari-getir` bir iş emrinin bütün fotoğraflarını
// diskten okuyup base64'e çevirip tek bir IPC yükü olarak gönderiyordu.
// Base64 boyutu %33 şişiriyor ve aynı anda dosya buffer'ı + base64 metni +
// yapılandırılmış kopya bellekte duruyordu (veri boyutunun ~4 katı). Ana
// paneldeki geçmiş araması bunu daha da büyütüyor: bir aracın TÜM iş emirleri
// için fotoğraflar paralel olarak çekiliyor. 32-bit süreçte kullanılabilir
// bellek sert bir tavanla sınırlı olduğu için bu, ana hattakinden daha kritik.
//
// Artık arayüze yalnızca `katip-foto://foto/<id>` adresi gidiyor; baytları
// Chromium'un kendisi, <img> göründükçe çekiyor.
//
// ── Ana hattan (64-bit katip) FARKI ──────────────────────────────────────
// Ana hat `protocol.handle()` kullanıyor. O API Electron 25 ile geldi; bu depo
// Windows 7 desteği için Electron 22'de sabit (Electron 23+ Windows 7/8'i
// desteklemiyor). Electron 22'de `net.fetch` ve global `Response` da yok.
// Bu yüzden burada Electron 22'nin `protocol.registerFileProtocol` API'si
// kullanılıyor: dosya yolunu döndürmek yeterli, içerik türünü Chromium
// dosya uzantısından kendisi belirliyor.

import { app, protocol } from 'electron'
import path from 'node:path'
import db from './database.js'

export const FOTO_SEMASI = 'katip-foto'

// Chromium net hata kodları (registerFileProtocol geri çağrısında kullanılır).
const NET_ERR_FAILED = -2
const NET_ERR_FILE_NOT_FOUND = -6
const NET_ERR_ACCESS_DENIED = -10

// Arayüzün <img src> alanına koyacağı adres.
export function fotografAdresi(photoId: number | string): string {
  return `${FOTO_SEMASI}://foto/${Number(photoId)}`
}

// Fotoğrafların tutulduğu klasör (yükleme yollarıyla aynı yer).
function fotograflarKlasoru(): string {
  return path.join(app.getPath('userData'), 'fotograflar')
}

// Şema ayrıcalıkları app 'ready' olmadan ÖNCE tanıtılmalıdır; bu yüzden ayrı
// bir fonksiyon olarak duruyor ve main.ts'te modül seviyesinde çağrılıyor.
export function fotografSemasiniTanimla(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: FOTO_SEMASI,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true
      }
    }
  ])
}

// Asıl işleyici; app 'ready' olduktan sonra kaydedilir
// (registerFileProtocol ready'den önce tanımlı değil).
export function fotografProtokolunuKaydet(): void {
  protocol.registerFileProtocol(FOTO_SEMASI, (request, callback) => {
    try {
      const id = Number(new URL(request.url).pathname.replace(/^\//, ''))
      if (!Number.isFinite(id) || id <= 0) {
        callback({ error: NET_ERR_FILE_NOT_FOUND })
        return
      }

      const row = db.prepare('SELECT file_path FROM work_order_photos WHERE id = ?').get(id) as any
      const dosyaYolu = String(row?.file_path || '')
      if (!dosyaYolu) {
        callback({ error: NET_ERR_FILE_NOT_FOUND })
        return
      }

      // Yol her zaman fotoğraf klasörünün içinde olmalı. Veritabanındaki
      // file_path'e körü körüne güvenilmez: yedekten gelen bir kayıt başka bir
      // yeri gösteriyorsa protokol onu servis etmemeli.
      const kok = path.resolve(fotograflarKlasoru())
      const tamYol = path.resolve(dosyaYolu)
      if (tamYol !== kok && !tamYol.startsWith(kok + path.sep)) {
        console.warn('[FotoProtokol] Fotograf klasoru disindaki yol reddedildi:', dosyaYolu)
        callback({ error: NET_ERR_ACCESS_DENIED })
        return
      }

      callback({ path: tamYol })
    } catch (error) {
      console.error('[FotoProtokol] Hata:', error)
      callback({ error: NET_ERR_FAILED })
    }
  })
}
