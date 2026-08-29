import { initDB, ayarlariGetirBackend } from './database.js'
import { app, BrowserWindow, ipcMain, Menu, shell, type IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import log from 'electron-log/main'
import { autoUpdater } from 'electron-updater'
import { NodeHttpExecutor } from './nodeHttpExecutor.js'
import { disAdresMi, yeniPencereKarari } from './windowOpenPolicy.js'
import { runPhoneServerMigrations } from './phoneServer.js'
import { isRestoreInProgress } from './restoreState.js'
import { fotografSemasiniTanimla, fotografProtokolunuKaydet } from './photoProtocol.js'
import { getActiveMasterSession } from './session.js'
import { destekModundaYasakMi, DESTEK_ENGEL_MESAJI } from './permissions.js'

// Tüm console.log/warn/error çağrılarını kalıcı log dosyasına da yazar
// (app.getPath('logs') altında dönen dosya; Ayarlar > Log Klasörünü Aç ile açılan klasörle aynı)
log.initialize()
log.transports.file.level = 'info'

// Yalnız yerel log: telemetry/crash upload yoktur. Monitor olayı Node'un normal
// çökme davranışını değiştirmeden, kapanmadan önce tanı izi bırakır.
process.on('uncaughtExceptionMonitor', (error, origin) => {
  log.error('[CrashDiagnostic] Yakalanmamış ana süreç hatası.', { origin, error })
})

app.on('render-process-gone', (_event, webContents, details) => {
  log.error('[CrashDiagnostic] Renderer süreci kapandı.', {
    webContentsId: webContents.id,
    reason: details.reason,
    exitCode: details.exitCode
  })
})

app.on('child-process-gone', (_event, details) => {
  log.error('[CrashDiagnostic] Electron alt süreci kapandı.', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    serviceName: details.serviceName || ''
  })
})

// Fotoğraf protokolünün ayrıcalıkları app 'ready' olmadan önce tanıtılmalıdır.
fotografSemasiniTanimla()

import { registerCustomerHandlers } from './controllers/customerController.js'
import { registerPartHandlers } from './controllers/partController.js'
import { registerVehicleHandlers } from './controllers/vehicleController.js'
import { registerMasterHandlers } from './controllers/masterController.js'
import { registerAccountHandlers } from './controllers/accountController.js'
import { registerWorkOrderHandlers } from './controllers/workOrderController.js'
import { registerPhoneHandlers } from './controllers/phoneController.js'
import { registerSettingsHandlers } from './controllers/settingsController.js'
import { registerClosingHandlers, gunSonuHatirlatmaGerekliMi } from './controllers/closingController.js'
import { registerMarketHandlers } from './controllers/marketController.js'
import {
  registerBackupHandlers,
  otomatikYedekZamanlayicisiniBaslat,
  otomatikYedekAlBackend,
  guncellemeOncesiYedekAlBackend
} from './controllers/backupController.js'

// Paket CommonJS olarak üretiliyor (bkz. package.json'da "type" alanının olmaması):
// Electron 22 ana süreçte ESModule çalıştıramadığı için __dirname/__filename
// Node tarafından hazır veriliyor; ayrıca import.meta.url'den türetmeye gerek yok.
process.env.APP_ROOT = path.join(__dirname, '..')

export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST

let win: BrowserWindow | null = null

// Kısayola iki kez tıklandığında ikinci bir kopya açılıyor; iki pencere aynı
// veritabanına yazıyor ve Chromium'un önbellek kilidi çakışıyordu. İkinci kopya
// artık kendini kapatıp var olan pencereyi öne getiriyor.
//
// Kilit yalnızca kurulu uygulamada uygulanır: geliştirme sırasında dosya
// değişince Electron yeniden başlatıldığı için, eski süreç kilidi henüz
// bırakmamışken yeni süreç açılamaz ve uygulama geri gelmezdi.
if (app.isPackaged) {
  if (!app.requestSingleInstanceLock()) {
    // exit(), quit()'ten farklı olarak 'before-quit' çalıştırmaz; yoksa bu ikinci
    // kopya kapanırken gereksiz yere çıkış yedeği almaya kalkardı.
    app.exit(0)
  } else {
    app.on('second-instance', () => {
      if (!win) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    })
  }
}

// Kullanıcı hatırlatmaya rağmen "Kapatmadan Çık" derse bir daha sorulmaz
let gunSonuHatirlatmasiAtlandi = false

function createWindow() {
  win = new BrowserWindow({
    title: 'Kâtip',
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    resizable: true,
    maximizable: true,
    minimizable: true,
    center: true,
    show: false,
    frame: false,
    backgroundColor: '#0f172a',
    icon: path.join(process.env.VITE_PUBLIC, 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // Uygulama yalnızca kendi yerel arayüzünü ve HTML'i renderer tarafından
  // doldurulan boş yazdırma pencerelerini açar. Uzak adresler uygulamaya
  // yüklenmez; sistem tarayıcısına yönlendirilir.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const karar = yeniPencereKarari(url)
    if (karar.action === 'allow') return karar
    if (disAdresMi(url)) {
      void shell.openExternal(url)
    }
    return karar
  })

  // Yazdırma penceresinin kendisinden yeni bir pencere zinciri açılamaz.
  // Bir HTTP(S) bağlantısı eklenirse yalnızca varsayılan tarayıcıya gider.
  win.webContents.on('did-create-window', (yeniPencere) => {
    yeniPencere.webContents.setWindowOpenHandler(({ url }) => {
      if (disAdresMi(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })

    yeniPencere.webContents.on('will-navigate', (event, url) => {
      event.preventDefault()
      if (disAdresMi(url)) void shell.openExternal(url)
    })
  })

  win.webContents.on('will-navigate', (event, url) => {
    const izinliKok = VITE_DEV_SERVER_URL || 'file://'
    if (url.startsWith(izinliKok)) return

    event.preventDefault()
    if (disAdresMi(url)) {
      void shell.openExternal(url)
    }
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  win.webContents.on('unresponsive', () => {
    log.warn('[CrashDiagnostic] Renderer yanıt vermiyor.', { webContentsId: win?.webContents.id })
  })

  win.webContents.on('responsive', () => {
    log.info('[CrashDiagnostic] Renderer yeniden yanıt veriyor.', { webContentsId: win?.webContents.id })
  })

  win.on('maximize', () => {
    win?.webContents.send('window-maximized-state', true)
  })

  win.on('unmaximize', () => {
    win?.webContents.send('window-maximized-state', false)
  })

  win.once('ready-to-show', () => {
    win?.show()
    win?.maximize()
  })

  // Pencere kapatılırken gün sonu yapılmamışsa (ve gün boş değilse) önce hatırlat;
  // renderer diyalogdan "Kapatmadan Çık" derse pencere-kapat-zorla ile devam edilir.
  win.on('close', (event) => {
    if (gunSonuHatirlatmasiAtlandi || isQuitting) return
    try {
      if (gunSonuHatirlatmaGerekliMi()) {
        event.preventDefault()
        win?.webContents.send('gun-sonu-hatirlatma')
      }
    } catch (error) {
      console.error('[GünSonu] Çıkış hatırlatması kontrolü hatası:', error)
    }
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// ── Güncelleme durumu ────────────────────────────────────────────────
// electron-updater'ın kendi bildirimi Windows'un İngilizce sistem bildirimi
// olduğu için dükkanda fark edilmiyordu. Durum artık arayüze aktarılıp
// uygulamanın içinde Türkçe bir şeritle gösteriliyor.
type GuncellemeDurumu = {
  durum: 'bilinmiyor' | 'denetleniyor' | 'guncel' | 'indiriliyor' | 'hazir' | 'hata'
  surum?: string
  yuzde?: number
  hata?: string
  internetYok?: boolean
}

// İnternet yokken electron-updater ham İngilizce ağ hatası veriyor
// ("net::ERR_INTERNET_DISCONNECTED", "getaddrinfo ENOTFOUND github.com" gibi) ve bu
// metin dükkanda kırmızı bir hata kutusu olarak görünüp tedirgin ediyordu.
// Ham hata yalnızca log dosyasına yazılır; kullanıcıya sade Türkçe karşılığı gösterilir.
const AG_HATA_IMZALARI = [
  'err_internet_disconnected',
  'err_name_not_resolved',
  'err_name_resolution_failed',
  'err_connection',
  'err_network_changed',
  'err_internet',
  'err_address_unreachable',
  'err_proxy_connection_failed',
  'err_timed_out',
  'enotfound',
  'eai_again',
  'econnrefused',
  'econnreset',
  'etimedout',
  'enetunreach',
  'ehostunreach',
  'getaddrinfo',
  'socket hang up',
  'network is unreachable'
]

// Windows 7'nin kök sertifika deposu 2020'den beri güncellenmiyor. GitHub'ın
// sertifikaları güncel köklere (ISRG Root X1, Sectigo/USERTrust) dayandığı için
// eksik kök sertifikalı makinelerde bağlantı sertifika hatasıyla reddedilebiliyor.
// Bu ayrı bir kategori: kullanıcıya "internet yok" demek yanıltıcı olur.
const SERTIFIKA_HATA_IMZALARI = [
  'err_cert',
  'cert_authority_invalid',
  'cert_date_invalid',
  'cert_common_name_invalid',
  'unable_to_verify_leaf_signature',
  'unable_to_get_issuer_cert',
  'self_signed_cert',
  'depth_zero_self_signed',
  'cert_has_expired',
  'certificate verify failed'
]

// Ham hatadan teknik kodu ayıklar (ERR_CERT_AUTHORITY_INVALID, ENOTFOUND gibi).
// Destek sırasında sebebin log dosyası açmadan görülebilmesi için mesaja ekleniyor.
function hataKoduCikar(error: unknown): string {
  const parcalar: string[] = []
  if (error instanceof Error) {
    parcalar.push(error.message)
    const kod = (error as { code?: unknown }).code
    if (kod) parcalar.push(String(kod))
  } else {
    parcalar.push(String(error))
  }

  const eslesme = parcalar.join(' ').match(/\b(ERR_[A-Z0-9_]+|E[A-Z]{3,})\b/)
  return eslesme ? eslesme[1] : ''
}

function guncellemeHatasiniCevir(error: unknown): { mesaj: string; internetYok: boolean } {
  const ham = error instanceof Error ? `${error.message} ${error.stack || ''}` : String(error)
  const kucuk = ham.toLowerCase()
  const kod = hataKoduCikar(error)
  const kodEki = kod ? ` (kod: ${kod})` : ''

  if (SERTIFIKA_HATA_IMZALARI.some((imza) => kucuk.includes(imza))) {
    return {
      mesaj: 'Güvenlik sertifikası doğrulanamadı. Bilgisayarın tarih/saati yanlış olabilir ' +
        'veya Windows kök sertifikaları eksik olabilir.' + kodEki,
      internetYok: false
    }
  }

  if (AG_HATA_IMZALARI.some((imza) => kucuk.includes(imza))) {
    return {
      mesaj: 'İnternet bağlantısı yok. Güncelleme denetlenemedi; bağlanınca kendiliğinden denenecek.' + kodEki,
      internetYok: true
    }
  }

  return {
    mesaj: 'Güncelleme sunucusuna şu an ulaşılamıyor. Daha sonra tekrar denenecek.' + kodEki,
    internetYok: false
  }
}

let guncellemeDurumu: GuncellemeDurumu = { durum: 'bilinmiyor' }
let guncellemeDinleyicileriKuruldu = false
let guncellemeKuruluyor = false

function guncellemeDurumunuYayinla(yeni: GuncellemeDurumu): void {
  guncellemeDurumu = yeni
  if (win && !win.isDestroyed()) {
    win.webContents.send('guncelleme-durumu', yeni)
  }
}

function guncellemeDinleyicileriniKur(): void {
  if (guncellemeDinleyicileriKuruldu) return
  guncellemeDinleyicileriKuruldu = true

  // Ağ katmanı Electron'un net modülünden Node'a alınıyor. Gerekçesi
  // nodeHttpExecutor.ts başındaki notta: Windows 7'nin kök sertifika deposu
  // güncel olmadığı için Chromium GitHub'a ERR_CERT_AUTHORITY_INVALID veriyor.
  // httpExecutor electron-updater'ın tip tanımlarında yer almadığı için cast
  // gerekiyor; çalışma zamanında sıradan bir özellik (bkz. AppUpdater.js).
  ;(autoUpdater as unknown as { httpExecutor: unknown }).httpExecutor = new NodeHttpExecutor()

  autoUpdater.logger = log
  autoUpdater.autoDownload = true
  // İndirilen paket normal uygulama çıkışında kendiliğinden kurulmaz. Kurulum
  // yalnız guncellemeyi-kur IPC akışından, güncelleme öncesi tam yedek başarıyla
  // tamamlandıktan sonra quitAndInstall ile başlatılır.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    guncellemeDurumunuYayinla({ durum: 'denetleniyor' })
  })

  autoUpdater.on('update-not-available', () => {
    guncellemeDurumunuYayinla({ durum: 'guncel', surum: app.getVersion() })
  })

  autoUpdater.on('update-available', (info) => {
    guncellemeDurumunuYayinla({ durum: 'indiriliyor', surum: info?.version, yuzde: 0 })
  })

  autoUpdater.on('download-progress', (ilerleme) => {
    guncellemeDurumunuYayinla({
      durum: 'indiriliyor',
      surum: guncellemeDurumu.surum,
      yuzde: Math.round(ilerleme?.percent || 0)
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    guncellemeDurumunuYayinla({ durum: 'hazir', surum: info?.version })
  })

  autoUpdater.on('error', (err) => {
    // Ham hata log dosyasına gider (Ayarlar → Log Klasörünü Aç), arayüze sadeleştirilmiş hâli.
    console.error('Güncelleme hatası:', err)
    const { mesaj, internetYok } = guncellemeHatasiniCevir(err)
    if (guncellemeKuruluyor) {
      guncellemeKuruluyor = false
      isQuitting = false
    }
    guncellemeDurumunuYayinla({ durum: 'hata', hata: mesaj, internetYok })
  })
}

function kanalEkle(kanal: string, fonksiyon: (event: IpcMainInvokeEvent, ...args: any[]) => any): void {
  ipcMain.removeHandler(kanal)
  ipcMain.handle(kanal, (event, ...args) => {
    if (isRestoreInProgress() && kanal !== 'yedekten-geri-yukle') {
      return { success: false, error: 'Veritabanı yedekten geri yükleniyor, lütfen bekleyin.' }
    }
    // Destek (Admin) oturumu usta işlerini yapamaz; arayüz atlatılsa bile burada durur.
    if (destekModundaYasakMi(kanal, getActiveMasterSession())) {
      console.warn(`[Yetki] Destek modunda reddedildi: ${kanal}`)
      return { success: false, error: DESTEK_ENGEL_MESAJI, yetkiHatasi: true }
    }
    return fonksiyon(event, ...args)
  })
}

function ipcKopruleriniKur() {
  // Pencere kontrolleri
  kanalEkle('pencere-kucult', () => {
    win?.minimize()
    return { success: true }
  })

  kanalEkle('pencere-buyut-kucult', () => {
    if (!win) return { success: false }

    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }

    return { success: true, isMaximized: win.isMaximized() }
  })

  kanalEkle('pencere-kapat', () => {
    win?.close()
    return { success: true }
  })

  kanalEkle('pencere-durum-getir', () => {
    return { success: true, isMaximized: win?.isMaximized() ?? false }
  })

  kanalEkle('pencere-kapat-zorla', () => {
    gunSonuHatirlatmasiAtlandi = true
    win?.close()
    return { success: true }
  })

  // Güncelleme
  kanalEkle('guncelleme-durum-getir', () => {
    return { success: true, ...guncellemeDurumu, mevcutSurum: app.getVersion(), paketli: app.isPackaged }
  })

  kanalEkle('guncelleme-denetle', async () => {
    // Geliştirme sırasında electron-updater çalışmaz; arayüzün bunu kullanıcıya
    // "hata" diye göstermemesi için ayrı bir yanıt dönülür.
    if (!app.isPackaged) {
      return { success: false, gelistirmeModu: true, error: 'Güncelleme denetimi yalnızca kurulu uygulamada çalışır.' }
    }

    try {
      guncellemeDinleyicileriniKur()
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (error) {
      // checkForUpdates hem 'error' olayını yayar hem de hatayı yeniden fırlatır;
      // ikisi de aynı sadeleştirilmiş metni kullansın diye burada da çevriliyor.
      console.error('Güncelleme denetimi hatası:', error)
      const { mesaj, internetYok } = guncellemeHatasiniCevir(error)
      guncellemeDurumunuYayinla({ durum: 'hata', hata: mesaj, internetYok })
      return { success: false, error: mesaj, internetYok }
    }
  })

  kanalEkle('guncellemeyi-kur', async () => {
    if (guncellemeDurumu.durum !== 'hazir') {
      return { success: false, error: 'Kurulmaya hazır bir güncelleme yok.' }
    }

    if (guncellemeKuruluyor) {
      return { success: false, error: 'Güncelleme kurulumu zaten hazırlanıyor.' }
    }

    guncellemeKuruluyor = true

    // Müşteri kayıtları yerinde değiştirilmez. Kurulumdan önce SQLite'ın tutarlı
    // anlık görüntüsü ve fotoğraflar ayrı bir ZIP'e kopyalanır. Yedek alınamazsa
    // kurulum hiç başlatılmaz ve mevcut sürüm çalışmaya devam eder.
    let yedekSonucu
    try {
      yedekSonucu = await guncellemeOncesiYedekAlBackend()
    } catch (error) {
      console.error('[UpdateInstall] Güncelleme öncesi yedek hatası:', error)
      guncellemeKuruluyor = false
      return {
        success: false,
        error: 'Güncelleme kurulmadı: güvenlik yedeği alınamadı. Diskte boş alan olduğunu kontrol edin.'
      }
    }

    if (!yedekSonucu.success) {
      console.error('[UpdateInstall] Güncelleme öncesi yedek alınamadı:', yedekSonucu.error)
      guncellemeKuruluyor = false
      return {
        success: false,
        error: `Güncelleme kurulmadı: güvenlik yedeği alınamadı. (${yedekSonucu.error || 'bilinmeyen hata'})`
      }
    }

    console.log('[UpdateInstall] Güncelleme öncesi tam yedek hazır:', yedekSonucu.path)

    // Yedek zaten tamamlandı. before-quit içindeki isteğe bağlı çıkış yedeğini
    // ikinci kez çalıştırmadan kurucuyu başlat; böylece NSIS ile asenkron yedek
    // birbirinin uygulamanın kapanmasını beklediği bir yarış oluşmaz.
    setImmediate(() => {
      try {
        isQuitting = true
        autoUpdater.quitAndInstall()
      } catch (error) {
        isQuitting = false
        guncellemeKuruluyor = false
        console.error('Güncelleme kurulum hatası:', error)
        guncellemeDurumunuYayinla({
          durum: 'hata',
          hata: 'Güncelleme kurulumu başlatılamadı. Programı kapatıp yeniden açmayı deneyin.'
        })
      }
    })
    return { success: true, backupCreated: true }
  })

  // Tüm IPC controller kaydı
  registerMasterHandlers(kanalEkle)
  registerCustomerHandlers(kanalEkle)
  registerPartHandlers(kanalEkle)
  registerVehicleHandlers(kanalEkle)
  registerWorkOrderHandlers(kanalEkle)
  registerAccountHandlers(kanalEkle)
  registerPhoneHandlers(kanalEkle)
  registerSettingsHandlers(kanalEkle)
  registerClosingHandlers(kanalEkle)
  registerMarketHandlers(kanalEkle)
  registerBackupHandlers(kanalEkle, () => win)
}

let isQuitting = false

app.on('before-quit', (event) => {
  if (isQuitting) return

  try {
    const settingsRes = ayarlariGetirBackend()
    const settings = settingsRes?.settings || {}
    if (settings.backup_on_exit === 'true') {
      event.preventDefault()

      void (async () => {
        try {
          const result = await otomatikYedekAlBackend()
          if (!result.success) console.error('[BackupOnExit] Yedek alınamadı:', result.error)
        } catch (error) {
          console.error('[BackupOnExit] Hata:', error)
        } finally {
          isQuitting = true
          app.quit()
        }
      })()
    }
  } catch (error) {
    console.error('[BackupOnExit] Hata:', error)
    isQuitting = true
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  initDB()
  runPhoneServerMigrations()
  // Veritabanı hazır olduktan sonra kaydedilir: işleyici fotoğraf yolunu
  // work_order_photos tablosundan okuyor.
  fotografProtokolunuKaydet()
  ipcKopruleriniKur()
  Menu.setApplicationMenu(null)

  otomatikYedekZamanlayicisiniBaslat()

  createWindow()

  // Dinleyiciler her zaman kurulur: autoUpdater 'error' olayını dinleyicisiz yayarsa
  // EventEmitter hatayı fırlatır ve Electron'un İngilizce hata kutusu açılır.
  guncellemeDinleyicileriniKur()

  if (app.isPackaged) {
    // checkForUpdatesAndNotify yerine sade denetim: bildirimi Windows'un
    // İngilizce sistem bildirimi değil, uygulama içindeki şerit üstleniyor.
    // İnternet yokken buradaki hata sessizce loglanır; arayüz Türkçe durum metnini gösterir.
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('Otomatik güncelleme kontrolü hatası:', err)
    })
  }
})
