import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createRequire } from 'node:module'
import db, { dbPath, uygulamaVerileriniYenileBackend, ayarlariGetirBackend } from '../database.js'
import { app, BrowserWindow, dialog, shell } from 'electron'
import fsSync, { promises as fs } from 'node:fs'
import path from 'node:path'
import { isRestoreInProgress, setRestoreInProgress } from '../restoreState.js'

const execFileAsync = promisify(execFile)

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

async function zipArsiviOlustur(
  zipPath: string,
  databaseSnapshotPath: string,
  photosDir: string,
  manifest: Record<string, unknown>
): Promise<void> {
  const packageRoot = await fs.mkdtemp(path.join(app.getPath('temp'), 'katip-zip-stage-'))

  try {
    const databaseDir = path.join(packageRoot, 'database')
    const packagePhotosDir = path.join(packageRoot, 'fotograflar')

    await fs.mkdir(databaseDir, { recursive: true })
    await fs.mkdir(packagePhotosDir, { recursive: true })
    await fs.copyFile(databaseSnapshotPath, path.join(databaseDir, 'otoservis.db'))

    if (await yolVarMi(photosDir)) {
      await fs.cp(photosDir, packagePhotosDir, { recursive: true, force: true })
    }

    await fs.writeFile(
      path.join(packageRoot, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf8'
    )

    await fs.mkdir(path.dirname(zipPath), { recursive: true })
    await fs.rm(zipPath, { force: true })

    // Windows'un yerleşik tar.exe'si (bsdtar), '-f' değerindeki ilk ':' karakterini
    // gördüğünde bunu uzak arşiv sözdizimi ("host:dosya") sanıp sürücü harfini
    // hostname olarak çözmeye çalışıyor ("Cannot connect to C: resolve failed").
    // Bunu önlemek için arşiv klasörüne geçip -f değerini göreli dosya adıyla veriyoruz.
    await execFileAsync(
      'tar.exe',
      ['-a', '-c', '-f', path.basename(zipPath), '-C', packageRoot, 'database', 'fotograflar', 'manifest.json'],
      { windowsHide: true, maxBuffer: 50 * 1024 * 1024, cwd: path.dirname(zipPath) }
    )
  } finally {
    await fs.rm(packageRoot, { recursive: true, force: true })
  }
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

async function zipPaketiniGuvenliCikart(zipPath: string, targetDir: string): Promise<void> {
  // bsdtar '-f' değerindeki ':' karakterini uzak arşiv sözdizimi sanabildiği için
  // (bkz. zipArsiviOlustur), burada da arşiv klasörüne geçip göreli ad kullanıyoruz.
  const { stdout } = await execFileAsync(
    'tar.exe',
    ['-tf', path.basename(zipPath)],
    { windowsHide: true, maxBuffer: 50 * 1024 * 1024, cwd: path.dirname(zipPath) }
  )

  const root = path.resolve(targetDir)
  const entries = String(stdout || '').split(/\r?\n/).filter(Boolean)

  for (const rawEntry of entries) {
    const normalizedEntryPath = String(rawEntry || '').replace(/\\/g, '/')
    const parts = normalizedEntryPath.split('/').filter(Boolean)

    if (!normalizedEntryPath || normalizedEntryPath.startsWith('/') ||
        /^[a-zA-Z]:/.test(normalizedEntryPath) || parts.includes('..')) {
      throw new Error(`Yedek paketinde güvenli olmayan dosya yolu var: ${normalizedEntryPath}`)
    }

    const outputPath = path.resolve(root, ...parts)
    if (outputPath !== root && !outputPath.startsWith(root + path.sep)) {
      throw new Error(`Yedek paketinde geçersiz dosya yolu var: ${normalizedEntryPath}`)
    }
  }

  await fs.mkdir(targetDir, { recursive: true })
  await execFileAsync(
    'tar.exe',
    ['-xf', path.basename(zipPath), '-C', targetDir],
    { windowsHide: true, maxBuffer: 50 * 1024 * 1024, cwd: path.dirname(zipPath) }
  )
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

      console.log('[Restore] Geri yükleme tamamlandı. Uygulama kapatılıyor...')

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
