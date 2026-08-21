import { createRequire } from 'node:module'
import db, { dbPath, uygulamaVerileriniYenileBackend, ayarlariGetirBackend } from '../database.js'
import { app, BrowserWindow, dialog, shell } from 'electron'
import fsSync, { promises as fs } from 'node:fs'
import path from 'node:path'
// Arsivleme/cikarma AKIS tabanli yapiliyor (bkz. zipArsiviOlustur notu).
// yazl ve yauzl saf JavaScript; Windows 7 icin sart olan tar.exe bagimsizligini
// korurken adm-zip gibi her seyi bellege almiyorlar.
import { ZipFile } from 'yazl'
import { open as yauzlOpen } from 'yauzl'
import { isRestoreInProgress, setRestoreInProgress } from '../restoreState.js'

// better-sqlite3 doğrudan ESM import ile yüklenirse Vite'in derlediği main
// paketinde native modülün __filename/__dirname'e dayanan yükleme mantığı
// bozuluyor ("__filename is not defined"). database.js'teki gibi Node'un
// gerçek CommonJS require'ı kullanılmalı.
const nodeRequire = createRequire(__filename)
const Database = nodeRequire('better-sqlite3')

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export function yedekKlasoruYoluGetir(): string {
  return path.join(app.getPath('userData'), 'yedekler')
}

export function fotograflarKlasoruYoluGetir(): string {
  return path.join(app.getPath('userData'), 'fotograflar')
}

type YedekTuru = 'manual' | 'automatic' | 'pre-restore' | 'pre-reset'

export interface TamYedekSonucu {
  success: boolean
  path?: string
  filename?: string
  size?: number
  photoCount?: number
  photoBytes?: number
  error?: string
}

function tarihDamgasiOlustur(now = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const date = String(now.getDate()).padStart(2, '0')
  const hours = String(now.getHours()).padStart(2, '0')
  const minutes = String(now.getMinutes()).padStart(2, '0')
  const seconds = String(now.getSeconds()).padStart(2, '0')
  return `${year}${month}_${hours}${minutes}${seconds}`
}

async function yolVarMi(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function klasorOzetiGetir(rootDir: string): Promise<{ count: number; bytes: number }> {
  if (!(await yolVarMi(rootDir))) return { count: 0, bytes: 0 }

  let count = 0
  let bytes = 0
  const entries = await fs.readdir(rootDir, { withFileTypes: true })

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      const child = await klasorOzetiGetir(entryPath)
      count += child.count
      bytes += child.bytes
    } else if (entry.isFile()) {
      const stat = await fs.stat(entryPath)
      count += 1
      bytes += stat.size
    }
  }

  return { count, bytes }
}

function yedekDosyaAdiOlustur(tur: YedekTuru, stamp: string): string {
  if (tur === 'automatic') return `otoservis_auto_backup_${stamp}.zip`
  if (tur === 'pre-restore') return `geri-yukleme-oncesi-tam-yedek-${stamp}.zip`
  if (tur === 'pre-reset') return `sifirlama-oncesi-tam-yedek-${stamp}.zip`
  return `katip-tam-yedek-${stamp}.zip`
}

// Bir klasördeki tüm dosyaları, arşiv içindeki göreli adlarıyla listeler.
async function klasorDosyalariniListele(
  rootDir: string,
  arsivOneki: string
): Promise<Array<{ diskYolu: string; arsivYolu: string }>> {
  const sonuc: Array<{ diskYolu: string; arsivYolu: string }> = []
  if (!(await yolVarMi(rootDir))) return sonuc

  const girdiler = await fs.readdir(rootDir, { withFileTypes: true })
  for (const girdi of girdiler) {
    const diskYolu = path.join(rootDir, girdi.name)
    // Arşiv içi ayraç her zaman '/' olmalı (zip standardı).
    const arsivYolu = arsivOneki + '/' + girdi.name
    if (girdi.isDirectory()) {
      sonuc.push(...(await klasorDosyalariniListele(diskYolu, arsivYolu)))
    } else if (girdi.isFile()) {
      sonuc.push({ diskYolu, arsivYolu })
    }
  }
  return sonuc
}

// Arşivi AKIŞ hâlinde üretir; hiçbir aşamada tüm fotoğraflar belleğe alınmaz.
//
// Eski hâli iki soruna yol açıyordu:
//   1. Bütün fotoğraf klasörü önce geçici bir hazırlık klasörüne kopyalanıp
//      sonra o kopya sıkıştırılıyordu; yani her yedekte fotoğraflar diske iki
//      kez yazılıyor ve o kadar da boş alan gerekiyordu.
//   2. adm-zip her dosyayı readFileSync ile belleğe alıp arşivi tamamen
//      bellekte kuruyordu. 32-bit süreçte kullanılabilir adres alanı sert bir
//      tavanla sınırlı olduğu için, fotoğraf sayısı arttıkça yedekleme
//      yavaşlamıyor, doğrudan BAŞARISIZ oluyordu -- hem de tam yedeğe en çok
//      ihtiyaç duyulan anda.
//
// yazl dosyaları diskten akış hâlinde okuyup doğrudan çıktı akışına yazar;
// bellekte yalnızca küçük bir tampon tutulur. tar.exe hâlâ KULLANILMIYOR:
// Windows 7'de yok (bkz. sürüm 1.4.1). yazl saf JavaScript'tir.
//
// Arşivin yapısı değişmedi: database/otoservis.db + fotograflar/ + manifest.json
async function zipArsiviOlustur(
  zipPath: string,
  databaseSnapshotPath: string,
  photosDir: string,
  manifest: Record<string, unknown>
): Promise<void> {
  await fs.mkdir(path.dirname(zipPath), { recursive: true })
  await fs.rm(zipPath, { force: true })

  const zip = new ZipFile()

  // 1) Veritabanı anlık görüntüsü (geçici dosyadan doğrudan, kopyalanmadan)
  zip.addFile(databaseSnapshotPath, 'database/otoservis.db')

  // 2) Fotoğraflar, durdukları yerden doğrudan
  const fotograflar = await klasorDosyalariniListele(photosDir, 'fotograflar')
  if (fotograflar.length > 0) {
    for (const f of fotograflar) {
      zip.addFile(f.diskYolu, f.arsivYolu)
    }
  } else {
    // Geri yükleme 'fotograflar' klasörünü beklediği için, hiç fotoğraf yoksa
    // açık bir klasör girdisi eklenir (eski paketlerdeki yapıyla aynı).
    zip.addEmptyDirectory('fotograflar')
  }

  // 3) Manifest (küçük olduğu için bellekten)
  zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'), 'manifest.json')

  zip.end()

  // Çıktıyı diske akıt ve tamamlanmasını bekle.
  await new Promise<void>((resolve, reject) => {
    const cikis = fsSync.createWriteStream(zipPath)
    let bitti = false
    const hataVer = (err: unknown) => {
      if (bitti) return
      bitti = true
      reject(err instanceof Error ? err : new Error(String(err)))
    }

    zip.outputStream.on('error', hataVer)
    cikis.on('error', hataVer)
    cikis.on('close', () => {
      if (bitti) return
      bitti = true
      resolve()
    })

    zip.outputStream.pipe(cikis)
  })
}

export async function tamYedekPaketiOlustur(tur: YedekTuru): Promise<TamYedekSonucu> {
  const backupDir = yedekKlasoruYoluGetir()
  const photosDir = fotograflarKlasoruYoluGetir()
  const stamp = tarihDamgasiOlustur()
  const backupFileName = yedekDosyaAdiOlustur(tur, stamp)
  const backupPath = path.join(backupDir, backupFileName)
  const tempRoot = await fs.mkdtemp(path.join(app.getPath('temp'), 'katip-full-backup-'))
  const snapshotPath = path.join(tempRoot, 'otoservis.db')

  try {
    await fs.mkdir(backupDir, { recursive: true })
    await db.backup(snapshotPath)

    const photoSummary = await klasorOzetiGetir(photosDir)
    const manifest = {
      backupVersion: 1,
      product: 'Kâtip',
      appVersion: app.getVersion(),
      createdAt: new Date().toISOString(),
      databaseFile: 'database/otoservis.db',
      photosFolder: 'fotograflar',
      photoCount: photoSummary.count,
      photoBytes: photoSummary.bytes
    }

    await zipArsiviOlustur(backupPath, snapshotPath, photosDir, manifest)
    const stat = await fs.stat(backupPath)

    return {
      success: true,
      path: backupPath,
      filename: backupFileName,
      size: stat.size,
      photoCount: photoSummary.count,
      photoBytes: photoSummary.bytes
    }
  } catch (error) {
    try { await fs.rm(backupPath, { force: true }) } catch {}
    console.error('[FullBackup] Hata:', error)
    return { success: false, error: getErrorMessage(error) }
  } finally {
    try { await fs.rm(tempRoot, { recursive: true, force: true }) } catch {}
  }
}

export async function otomatikYedekleriTemizle(): Promise<void> {
  const backupDir = yedekKlasoruYoluGetir()
  const settingsRes = ayarlariGetirBackend()
  const rawRetentionCount = settingsRes?.settings?.backup_retention_count
  const retentionCount = rawRetentionCount === undefined || rawRetentionCount === null || rawRetentionCount === ''
    ? 0
    : Number(rawRetentionCount)
  if (retentionCount <= 0) return

  const files = await fs.readdir(backupDir)
  const autoBackups: Array<{ name: string; path: string; time: number }> = []

  for (const fileName of files) {
    const isAutoBackup = fileName.startsWith('otoservis_auto_backup_') &&
      (fileName.endsWith('.zip') || fileName.endsWith('.db'))
    if (!isAutoBackup) continue

    const filePath = path.join(backupDir, fileName)
    const stat = await fs.stat(filePath)
    autoBackups.push({ name: fileName, path: filePath, time: stat.mtimeMs })
  }

  autoBackups.sort((a, b) => b.time - a.time)

  for (const item of autoBackups.slice(retentionCount)) {
    try {
      await fs.unlink(item.path)
      console.log('[AutoBackup] Eski yedek silindi:', item.name)
    } catch (error) {
      console.warn('[AutoBackup] Eski yedek silinemedi:', item.name, error)
    }
  }
}

export async function sonOtomatikYedekZamaniGetir(): Promise<number> {
  const backupDir = yedekKlasoruYoluGetir()
  await fs.mkdir(backupDir, { recursive: true })
  const files = await fs.readdir(backupDir)
  let newestTime = 0

  for (const fileName of files) {
    const isAutoBackup = fileName.startsWith('otoservis_auto_backup_') &&
      (fileName.endsWith('.zip') || fileName.endsWith('.db'))
    if (!isAutoBackup) continue

    try {
      const stat = await fs.stat(path.join(backupDir, fileName))
      newestTime = Math.max(newestTime, stat.mtimeMs)
    } catch (error) {
      console.warn('[AutoBackup] Yedek tarihi okunamadı:', fileName, error)
    }
  }

  return newestTime
}

// Bir arşiv girdisinin hedef klasör dışına çıkmadığını doğrular (zip slip).
// Güvenli ise diskte yazılacak tam yolu, değilse hata döndürür.
function arsivGirdisiniDogrula(entryName: string, root: string): string {
  const normalizedEntryPath = String(entryName || '').replace(/\\/g, '/')
  const parts = normalizedEntryPath.split('/').filter(Boolean)

  if (!normalizedEntryPath || normalizedEntryPath.startsWith('/') ||
      /^[a-zA-Z]:/.test(normalizedEntryPath) || parts.includes('..')) {
    throw new Error(`Yedek paketinde güvenli olmayan dosya yolu var: ${normalizedEntryPath}`)
  }

  const outputPath = path.resolve(root, ...parts)
  if (outputPath !== root && !outputPath.startsWith(root + path.sep)) {
    throw new Error(`Yedek paketinde geçersiz dosya yolu var: ${normalizedEntryPath}`)
  }

  return outputPath
}

// Arşivi AKIŞ hâlinde çıkarır; hiçbir aşamada tüm paket belleğe alınmaz.
//
// Eski hâli adm-zip ile arşivin tamamını belleğe okuyordu (bkz. zipArsiviOlustur
// üstündeki not): 32-bit süreçte fotoğraflı büyük bir yedeği GERİ YÜKLEMEK de
// bellek tavanına takılabiliyordu. yauzl girdileri tek tek akıtır.
//
// tar.exe hâlâ KULLANILMIYOR (Windows 7'de yok). Yol doğrulaması (zip slip
// koruması) aynen korunuyor ve çıkarma başlamadan ÖNCE tüm girdiler denetleniyor.
async function zipPaketiniGuvenliCikart(zipPath: string, targetDir: string): Promise<void> {
  const root = path.resolve(targetDir)
  await fs.mkdir(targetDir, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    yauzlOpen(zipPath, { lazyEntries: true }, (err: any, zipfile: any) => {
      if (err || !zipfile) {
        reject(err instanceof Error ? err : new Error('Yedek paketi açılamadı.'))
        return
      }

      let bitti = false
      const hataVer = (e: unknown) => {
        if (bitti) return
        bitti = true
        try { zipfile.close() } catch { /* zaten kapanmış olabilir */ }
        reject(e instanceof Error ? e : new Error(String(e)))
      }

      zipfile.on('error', hataVer)
      zipfile.on('end', () => {
        if (bitti) return
        bitti = true
        resolve()
      })

      zipfile.on('entry', (entry: any) => {
        let hedefYol: string
        try {
          hedefYol = arsivGirdisiniDogrula(entry.fileName, root)
        } catch (e) {
          hataVer(e)
          return
        }

        // Klasör girdisi (adı '/' ile biter): yalnızca oluştur, sonrakine geç.
        if (/\/$/.test(entry.fileName)) {
          fs.mkdir(hedefYol, { recursive: true })
            .then(() => zipfile.readEntry())
            .catch(hataVer)
          return
        }

        fs.mkdir(path.dirname(hedefYol), { recursive: true })
          .then(() => {
            zipfile.openReadStream(entry, (streamErr: any, okuma: any) => {
              if (streamErr || !okuma) {
                hataVer(streamErr || new Error('Arşiv girdisi okunamadı: ' + entry.fileName))
                return
              }
              const yazma = fsSync.createWriteStream(hedefYol)
              okuma.on('error', hataVer)
              yazma.on('error', hataVer)
              yazma.on('close', () => zipfile.readEntry())
              okuma.pipe(yazma)
            })
          })
          .catch(hataVer)
      })

      zipfile.readEntry()
    })
  })
}

export async function otomatikYedekAlBackend(): Promise<TamYedekSonucu> {
  const result = await tamYedekPaketiOlustur('automatic')
  if (result.success) {
    try { await otomatikYedekleriTemizle() }
    catch (error) { console.warn('[AutoBackup] Saklama temizliği yapılamadı:', error) }
  }
  return result
}

let otomatikYedekTimer: ReturnType<typeof setInterval> | null = null
let otomatikYedekCalisiyor = false

export async function otomatikYedekKontrolEt(force = false): Promise<void> {
  if (otomatikYedekCalisiyor) return

  try {
    const settingsRes = ayarlariGetirBackend()
    const settings = settingsRes?.settings || {}
    if (settings.automatic_backup_enabled !== 'true') return

    if (!force) {
      const intervalHours = Math.max(1, Number(settings.backup_interval_hours) || 24)
      const lastBackupTime = await sonOtomatikYedekZamaniGetir()
      const intervalMilliseconds = intervalHours * 60 * 60 * 1000

      if (lastBackupTime > 0 && Date.now() - lastBackupTime < intervalMilliseconds) return
    }

    otomatikYedekCalisiyor = true
    const result = await otomatikYedekAlBackend()

    if (result.success) console.log('[AutoBackupScheduler] Tam yedek paketi alındı:', result.path)
    else console.error('[AutoBackupScheduler] Yedek alınamadı:', result.error)
  } catch (error) {
    console.error('[AutoBackupScheduler] Hata:', error)
  } finally {
    otomatikYedekCalisiyor = false
  }
}

export function otomatikYedekZamanlayicisiniBaslat(): void {
  if (otomatikYedekTimer) {
    clearInterval(otomatikYedekTimer)
  }

  void otomatikYedekKontrolEt(true)

  otomatikYedekTimer = setInterval(() => {
    void otomatikYedekKontrolEt(false)
  }, 15 * 60 * 1000)
}

export function registerBackupHandlers(
  kanalEkle: (kanal: string, fonksiyon: (...args: any[]) => any) => void,
  getWin: () => BrowserWindow | null
) {
  // 1. Veritabanı + fotoğrafları tek ZIP paketinde yedekle
  kanalEkle('veritabani-yedekle', async () => {
    return await tamYedekPaketiOlustur('manual')
  })

  // 2. Yedek klasörünü aç
  kanalEkle('yedek-klasoru-ac', async () => {
    try {
      const backupDir = yedekKlasoruYoluGetir()
      await fs.mkdir(backupDir, { recursive: true })
      const sonuc = await shell.openPath(backupDir)
      if (sonuc) throw new Error(sonuc)
      return { success: true, path: backupDir }
    } catch (error) {
      console.error('Yedek klasörü açma hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 3. Yedekten geri yükle
  kanalEkle('yedekten-geri-yukle', async (_event, secilenDosyaYolu?: string) => {
    if (isRestoreInProgress()) {
      return { success: false, error: 'Zaten devam eden bir geri yükleme işlemi var.' }
    }
    // db.close() çağrıldıktan sonra bir hata çıkarsa uygulama açık ama
    // veritabanı kapalı kalıyordu: her ekran sessizce çalışmaz hâle geliyor,
    // kullanıcıya da bir şey söylenmiyordu. Sıfırlama akışında olduğu gibi
    // böyle bir durumda uygulama yeniden başlatılır.
    let veritabaniKapatildi = false
    try {
      const win = getWin()
      if (!win) {
        throw new Error('Uygulama penceresi bulunamadı.')
      }

      const backupDir = yedekKlasoruYoluGetir()
      await fs.mkdir(backupDir, { recursive: true })

      let secilenYedek = ''
      if (secilenDosyaYolu) {
        secilenYedek = secilenDosyaYolu
      } else {
        const secim = await dialog.showOpenDialog(win, {
          title: 'Yedek Paketi Seç',
          defaultPath: backupDir,
          properties: ['openFile'],
          filters: [
            { name: 'Kâtip Tam Yedek Paketi', extensions: ['zip'] },
            { name: 'Eski SQLite Yedeği', extensions: ['db'] },
            { name: 'Tüm Dosyalar', extensions: ['*'] }
          ]
        })

        if (secim.canceled || secim.filePaths.length === 0) {
          return {
            success: false,
            cancelled: true,
            error: 'İşlem iptal edildi.'
          }
        }

        secilenYedek = secim.filePaths[0]
      }
      const stat = await fs.stat(secilenYedek)

      if (!stat.isFile()) {
        throw new Error('Seçilen yol geçerli bir dosya değil.')
      }

      const lowerPath = secilenYedek.toLowerCase()

      if (!lowerPath.endsWith('.zip') && !lowerPath.endsWith('.db')) {
        throw new Error('Lütfen .zip veya .db uzantılı bir yedek dosyası seçin.')
      }

      const now = new Date()
      const stamp =
        now.getFullYear().toString() +
        String(now.getMonth() + 1).padStart(2, '0') +
        String(now.getDate()).padStart(2, '0') + '_' +
        String(now.getHours()).padStart(2, '0') +
        String(now.getMinutes()).padStart(2, '0') +
        String(now.getSeconds()).padStart(2, '0')

      const userDataDir = app.getPath('userData')
      const activePhotosDir = path.join(userDataDir, 'fotograflar')
      const guvenlikDir = path.join(userDataDir, `geri-yukleme-oncesi-${stamp}`)
      const tempDir = path.join(app.getPath('temp'), `katip-restore-${stamp}`)

      await fs.mkdir(guvenlikDir, { recursive: true })
      await fs.mkdir(tempDir, { recursive: true })

      const yedekDbKontrolEt = (kontrolDbPath: string) => {
        let kontrolDb: any = null

        try {
          kontrolDb = new Database(kontrolDbPath, {
            readonly: true,
            fileMustExist: true
          })

          const quick = kontrolDb.pragma('quick_check', { simple: true })
          if (String(quick).toLowerCase() !== 'ok') {
            throw new Error('SQLite kontrolü başarısız: ' + quick)
          }

          const tablolar = kontrolDb.prepare(`
            SELECT name
            FROM sqlite_master
            WHERE type = 'table'
          `).all().map((row: any) => String(row.name))

          const gerekliTablolar = [
            'customers',
            'vehicles',
            'work_orders',
            'work_order_items',
            'parts',
            'masters'
          ]

          const eksikler = gerekliTablolar.filter(tablo => !tablolar.includes(tablo))
          if (eksikler.length > 0) {
            throw new Error('Yedek eksik tablolar içeriyor: ' + eksikler.join(', '))
          }
        } finally {
          try {
            kontrolDb?.close()
          } catch {}
        }
      }

      const restoreSonrasiOnar = async () => {
        try {
          if (fsSync.existsSync(activePhotosDir)) {
            const fotografDosyalari = await fs.readdir(activePhotosDir)

            const mevcutSatir = db.prepare(`
              SELECT id
              FROM work_order_photos
              WHERE file_name = ? OR file_path = ?
              LIMIT 1
            `)

            const isEmriVar = db.prepare(`
              SELECT id
              FROM work_orders
              WHERE id = ?
              LIMIT 1
            `)

            const ekle = db.prepare(`
              INSERT INTO work_order_photos (
                work_order_id,
                file_name,
                file_path,
                category,
                note
              )
              VALUES (?, ?, ?, ?, ?)
            `)

            const guncelle = db.prepare(`
              UPDATE work_order_photos
              SET file_path = ?
              WHERE id = ?
            `)

            const mevcutFotograflar = db.prepare(`
              SELECT id, file_name, file_path
              FROM work_order_photos
            `).all() as any[]

            const tx = db.transaction(() => {
              for (const row of mevcutFotograflar) {
                const fileName = String(row.file_name || path.basename(String(row.file_path || '')))
                if (!fileName) continue

                const yeniYol = path.join(activePhotosDir, fileName)
                if (fsSync.existsSync(yeniYol)) {
                  guncelle.run(yeniYol, Number(row.id))
                }
              }

              for (const fileName of fotografDosyalari) {
                const eslesme = /^wo_(\d+)_/i.exec(fileName)
                if (!eslesme) continue

                const workOrderId = Number(eslesme[1])
                if (!workOrderId) continue

                if (!isEmriVar.get(workOrderId)) continue

                const filePath = path.join(activePhotosDir, fileName)

                if (!mevcutSatir.get(fileName, filePath)) {
                  ekle.run(workOrderId, fileName, filePath, 'Araç Kabul', '')
                }
              }
            })

            tx()
          }
        } catch (error) {
          console.error('Fotoğraf yollarını onarma hatası:', error)
        }
      }

      let yedekDbPath = ''
      let yedekPhotosDir = ''

      if (lowerPath.endsWith('.zip')) {
        console.log('[Restore] ZIP açılıyor:', secilenYedek)
        await zipPaketiniGuvenliCikart(secilenYedek, tempDir)

        yedekDbPath = path.join(tempDir, 'database', 'otoservis.db')
        yedekPhotosDir = path.join(tempDir, 'fotograflar')

        if (!fsSync.existsSync(yedekDbPath)) {
          throw new Error('Seçilen ZIP içinde database/otoservis.db bulunamadı.')
        }
      } else {
        yedekDbPath = secilenYedek
      }

      yedekDbKontrolEt(yedekDbPath)

      setRestoreInProgress(true)

      console.log('[Restore] Mevcut veriler güvenliğe alınıyor...')

      if (fsSync.existsSync(dbPath)) {
        await fs.copyFile(dbPath, path.join(guvenlikDir, 'otoservis.db'))
      }

      if (fsSync.existsSync(activePhotosDir)) {
        await fs.cp(activePhotosDir, path.join(guvenlikDir, 'fotograflar'), {
          recursive: true,
          force: true
        })
      }

      db.close()
      veritabaniKapatildi = true

      try { await fs.rm(dbPath + '-wal', { force: true }) } catch {}
      try { await fs.rm(dbPath + '-shm', { force: true }) } catch {}

      await fs.copyFile(yedekDbPath, dbPath)

      if (yedekPhotosDir && fsSync.existsSync(yedekPhotosDir)) {
        await fs.rm(activePhotosDir, { recursive: true, force: true })
        await fs.cp(yedekPhotosDir, activePhotosDir, {
          recursive: true,
          force: true
        })
      }

      const yenileSonuc = await uygulamaVerileriniYenileBackend()
      if (!yenileSonuc.success) {
        throw new Error('Veritabanı yenileme hatası: ' + yenileSonuc.message)
      }

      await restoreSonrasiOnar()

      console.log('[Restore] Geri yükleme tamamlandı. Uygulama yeniden başlatılıyor...')

      // Sıfırlama akışıyla aynı davranış: eskiden burada yalnızca app.exit(0)
      // çağrılıyordu; arayüz "başarıyla geri yüklendi" yazıp uygulama hiçbir
      // uyarı olmadan kapanıyor, kullanıcının programı elle açması gerekiyordu.
      // Zaten restartRequired: true dönüyoruz.
      app.relaunch()
      setTimeout(() => {
        app.exit(0)
      }, 1200)

      return {
        success: true,
        restoredFrom: secilenYedek,
        previousBackup: guvenlikDir,
        restartRequired: true
      }
    } catch (error) {
      console.error('Yedekten geri yükleme hatası:', error)

      if (veritabaniKapatildi) {
        // Bağlantı kapandıktan sonra kalınan bir hatada güvenli devam mümkün
        // değil; uygulama yeniden başlatılır ve açılışta kendini toparlar.
        // Güvenlik yedeği zaten alınmış durumda (guvenlikDir).
        console.error('[Restore] Veritabanı kapalı durumda kalındı, uygulama yeniden başlatılıyor.')
        app.relaunch()
        setTimeout(() => {
          app.exit(0)
        }, 1200)

        return {
          success: false,
          error: getErrorMessage(error) + ' (Uygulama yeniden başlatılacak.)',
          restartRequired: true
        }
      }

      return { success: false, error: getErrorMessage(error) }
    } finally {
      setRestoreInProgress(false)
    }
  })

  // 4. Yedekleri listele
  kanalEkle('yedekleri-listele', async () => {
    try {
      const backupDir = yedekKlasoruYoluGetir()
      await fs.mkdir(backupDir, { recursive: true })
      const files = await fs.readdir(backupDir)
      const list: any[] = []

      for (const fileName of files) {
        const lowerName = fileName.toLowerCase()
        if (lowerName.endsWith('.zip') || lowerName.endsWith('.db')) {
          const filePath = path.join(backupDir, fileName)
          const stat = await fs.stat(filePath)
          list.push({
            name: fileName,
            path: filePath,
            size: formatBytes(stat.size),
            sizeBytes: stat.size,
            time: stat.mtimeMs,
            date: new Date(stat.mtimeMs).toLocaleString('tr-TR'),
            isZip: lowerName.endsWith('.zip')
          })
        }
      }

      list.sort((a, b) => b.time - a.time)

      return { success: true, backups: list }
    } catch (error) {
      console.error('[YedekListele] Hata:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 5. Veritabanı bilgileri getir
  kanalEkle('veritabani-bilgileri-getir', async () => {
    try {
      const backupDir = yedekKlasoruYoluGetir()
      await fs.mkdir(backupDir, { recursive: true })
      return {
        success: true,
        dbPath,
        backupDir
      }
    } catch (error) {
      console.error('Veritabanı bilgileri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 6. Otomatik yedek al
  kanalEkle('otomatik-yedek-al', async () => {
    return await otomatikYedekAlBackend()
  })

  // 7. Veritabanını sıfırla (fabrika ayarlarına dön)
  // Önce tam güvenlik yedeği alınır; yedek alınamazsa sıfırlama yapılmaz.
  // Veritabanı ve fotoğraflar silinir, uygulama yeniden başlatılınca
  // migration'lar temiz bir veritabanını varsayılan değerlerle kurar.
  kanalEkle('veritabani-sifirla', async () => {
    if (isRestoreInProgress()) {
      return { success: false, error: 'Devam eden bir geri yükleme/sıfırlama işlemi var.' }
    }

    const guvenlikYedegi = await tamYedekPaketiOlustur('pre-reset')
    if (!guvenlikYedegi.success) {
      return {
        success: false,
        error: 'Sıfırlama iptal edildi: güvenlik yedeği alınamadı. (' + (guvenlikYedegi.error || 'bilinmeyen hata') + ')'
      }
    }

    setRestoreInProgress(true)

    const yenidenBaslat = () => {
      app.relaunch()
      setTimeout(() => {
        app.exit(0)
      }, 1200)
    }

    try {
      console.log('[Reset] Veritabanı sıfırlanıyor. Güvenlik yedeği:', guvenlikYedegi.path)

      db.close()

      try { await fs.rm(dbPath + '-wal', { force: true }) } catch {}
      try { await fs.rm(dbPath + '-shm', { force: true }) } catch {}
      await fs.rm(dbPath, { force: true })
      await fs.rm(fotograflarKlasoruYoluGetir(), { recursive: true, force: true })

      console.log('[Reset] Sıfırlama tamamlandı. Uygulama yeniden başlatılıyor...')
      yenidenBaslat()

      return {
        success: true,
        backupPath: guvenlikYedegi.path,
        restartRequired: true
      }
    } catch (error) {
      console.error('[Reset] Sıfırlama hatası:', error)
      // Veritabanı bağlantısı kapandığı için güvenli devam mümkün değil;
      // uygulama yine de yeniden başlatılır ve açılışta kendini toparlar.
      yenidenBaslat()
      return {
        success: false,
        error: getErrorMessage(error) + ' (Uygulama yeniden başlatılacak.)'
      }
    }
  })
}
