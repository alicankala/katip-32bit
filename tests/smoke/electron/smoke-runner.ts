import { app, BrowserWindow, ipcMain } from 'electron'
import fsSync from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

const RESULT_PREFIX = 'KATIP_SMOKE_RESULT:'
const TEST_DIR_PREFIX = 'katip-integration-'

function dogrulanmisTestDizini(): string {
  if (process.env.KATIP_TEST_MODE !== 'integration') {
    throw new Error('[KATIP_SMOKE_TEMP_GUARD] Entegrasyon test modu etkin degil.')
  }
  const candidate = process.env.KATIP_SMOKE_SCENARIO_ROOT
  if (!candidate) throw new Error('[KATIP_SMOKE_TEMP_GUARD] Test dizini tanimli degil.')
  const tempBase = realpathSync(tmpdir())
  const resolvedRoot = realpathSync(candidate)
  const relativePath = relative(tempBase, resolvedRoot)
  const firstSegment = relativePath.split(sep)[0]
  if (
    relativePath === '' || isAbsolute(relativePath) || relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) || !firstSegment.startsWith(TEST_DIR_PREFIX)
  ) {
    throw new Error(`[KATIP_SMOKE_TEMP_GUARD] Guvensiz test dizini reddedildi: ${resolvedRoot}`)
  }
  return resolvedRoot
}

async function bekle(
  kontrol: () => Promise<any>,
  aciklama: string,
  timeoutMs = 15_000
): Promise<any> {
  const baslangic = Date.now()
  let sonDeger: any = null
  while (Date.now() - baslangic < timeoutMs) {
    sonDeger = await kontrol()
    if (sonDeger) return sonDeger
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Smoke bekleme zaman asimi: ${aciklama}. Son deger: ${JSON.stringify(sonDeger)}`)
}

async function javascriptCalistir(
  win: BrowserWindow,
  kod: string,
  aciklama: string,
  timeoutMs = 5_000
): Promise<any> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(kod),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(
          `Renderer JavaScript zaman asimi: ${aciklama}; ` +
          `url=${win.webContents.getURL()}; loading=${win.webContents.isLoading()}; ` +
          `crashed=${win.webContents.isCrashed()}`
        )), timeoutMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function calistir(): Promise<void> {
  const scenarioRoot = dogrulanmisTestDizini()
  const controlledTemp = join(scenarioRoot, 'temp')
  fsSync.mkdirSync(controlledTemp, { recursive: true })
  app.setPath('userData', scenarioRoot)
  app.setPath('temp', controlledTemp)
  await app.whenReady()

  const preloadFile = process.arch === 'ia32' ? 'preload.js' : 'preload.mjs'
  const preloadPath = join(process.cwd(), 'dist-electron', preloadFile)
  const rendererPath = join(process.cwd(), 'dist', 'index.html')
  if (!fsSync.existsSync(preloadPath) || !fsSync.existsSync(rendererPath)) {
    throw new Error('Smoke testi için normal build çıktıları bulunamadı.')
  }

  const databaseModule = await import('../../../electron/database.js')
  const masterModule = await import('../../../electron/controllers/masterController.js')
  const customerModule = await import('../../../electron/controllers/customerController.js')
  const vehicleModule = await import('../../../electron/controllers/vehicleController.js')
  const partModule = await import('../../../electron/controllers/partController.js')
  const workOrderModule = await import('../../../electron/controllers/workOrderController.js')
  const accountModule = await import('../../../electron/controllers/accountController.js')
  const settingsModule = await import('../../../electron/controllers/settingsController.js')
  const closingModule = await import('../../../electron/controllers/closingController.js')
  const sessionModule = await import('../../../electron/session.js')
  const permissionsModule = await import('../../../electron/permissions.js')
  const restoreStateModule = await import('../../../electron/restoreState.js')
  const windowOpenPolicyModule = await import('../../../electron/windowOpenPolicy.js')

  if (realpathSync(dirname(databaseModule.dbPath)) !== scenarioRoot) {
    throw new Error(`[KATIP_SMOKE_TEMP_GUARD] Veritabani test dizini disinda: ${databaseModule.dbPath}`)
  }
  databaseModule.initDB()
  const db = databaseModule.getDatabase()
  db.prepare(`INSERT INTO app_settings (key, value) VALUES ('setup_wizard_done', 'true')
    ON CONFLICT(key) DO UPDATE SET value = 'true'`).run()

  const kanalEkle = (kanal: string, fonksiyon: (...args: any[]) => any) => {
    ipcMain.removeHandler(kanal)
    ipcMain.handle(kanal, (event, ...args) => {
      if (restoreStateModule.isRestoreInProgress()) {
        return { success: false, error: 'Restore devam ediyor.' }
      }
      if (permissionsModule.destekModundaYasakMi(kanal, sessionModule.getActiveMasterSession())) {
        return { success: false, error: permissionsModule.DESTEK_ENGEL_MESAJI, yetkiHatasi: true }
      }
      return fonksiyon(event, ...args)
    })
  }

  masterModule.registerMasterHandlers(kanalEkle)
  customerModule.registerCustomerHandlers(kanalEkle)
  vehicleModule.registerVehicleHandlers(kanalEkle)
  partModule.registerPartHandlers(kanalEkle)
  workOrderModule.registerWorkOrderHandlers(kanalEkle)
  accountModule.registerAccountHandlers(kanalEkle)
  settingsModule.registerSettingsHandlers(kanalEkle)
  closingModule.registerClosingHandlers(kanalEkle)

  kanalEkle('pencere-durum-getir', () => ({ success: true, isMaximized: false }))
  kanalEkle('pencere-kucult', () => ({ success: true }))
  kanalEkle('pencere-buyut-kucult', () => ({ success: true, isMaximized: false }))
  kanalEkle('pencere-kapat', () => ({ success: true }))
  kanalEkle('pencere-kapat-zorla', () => ({ success: true }))
  kanalEkle('guncelleme-durum-getir', () => ({
    success: true, durum: 'gelistirme', mevcutSurum: app.getVersion(), paketli: false
  }))
  kanalEkle('doviz-kurlari-getir', () => ({ success: false, offline: true }))
  kanalEkle('hava-durumu-getir', () => ({ success: false, offline: true }))
  kanalEkle('telefon-erisimi-durum-getir', () => ({
    success: true, running: false, port: 0, ip: '127.0.0.1', ips: []
  }))

  const rendererErrors: string[] = []
  let domReady = false
  let rendererGone = ''
  let loadFailure = ''
  let rendererUnresponsive = false
  console.log('[SMOKE] controllers-ready')
  app.on('window-all-closed', () => {
    // Test raporu yazılana kadar ana süreci canlı tut.
  })
  const win = new BrowserWindow({
    width: 1024,
    height: 640,
    show: false,
    webPreferences: {
      preload: preloadPath
    }
  })
  let printWindow: BrowserWindow | null = null
  let createdWindowCount = 0
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.log(`[SMOKE] window-open-request ${url}`)
    return windowOpenPolicyModule.yeniPencereKarari(url)
  })
  win.webContents.on('did-create-window', (createdWindow) => {
    createdWindowCount += 1
    printWindow = createdWindow
    createdWindow.hide()
  })
  win.webContents.on('console-message', (...args: any[]) => {
    const details = args[1]
    const level = typeof details === 'object' ? Number(details.level) : Number(details)
    const message = typeof details === 'object' ? details.message : args[2]
    if (level >= 2) {
      rendererErrors.push(String(message))
      console.error(`[SMOKE] renderer-console ${String(message)}`)
    }
  })
  win.webContents.on('preload-error', (_event, preload, error) => {
    console.error(`[SMOKE] preload-error ${preload}: ${error.message}`)
  })
  win.webContents.once('dom-ready', () => {
    domReady = true
    console.log('[SMOKE] dom-ready')
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    rendererGone = `${details.reason}:${details.exitCode}`
    console.error(`[SMOKE] render-process-gone ${rendererGone}`)
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    loadFailure = `${errorCode}:${errorDescription}`
    console.error(`[SMOKE] did-fail-load ${loadFailure}`)
  })
  win.on('unresponsive', () => {
    rendererUnresponsive = true
    console.error('[SMOKE] renderer-unresponsive')
  })

  let closedCleanly = false
  win.once('closed', () => { closedCleanly = true })
  console.log('[SMOKE] window-created')
  await win.loadFile(rendererPath)
  console.log('[SMOKE] load-file-resolved')
  await bekle(async () => domReady, 'renderer DOM hazirligi', 5_000)
  console.log(`[SMOKE] renderer-state url=${win.webContents.getURL()} crashed=${win.webContents.isCrashed()}`)

  const printOpenReturnedWindow = await javascriptCalistir(win, `(() => {
    const popup = window.open('', '_blank')
    if (!popup) return false
    popup.document.write('<!doctype html><html><head><title>Katip Print Smoke</title></head><body>print-ready</body></html>')
    popup.document.close()
    return true
  })()`, 'yerel yazdirma penceresi')
  await bekle(async () => printWindow && !printWindow.isDestroyed(), 'yazdirma penceresinin olusmasi')
  const printWindowState = JSON.parse(await javascriptCalistir(
    printWindow!,
    `JSON.stringify({
      title: document.title,
      text: document.body?.innerText || '',
      hasNodeRequire: typeof window.require === 'function',
      hasNodeProcess: typeof window.process === 'object'
    })`,
    'yazdirma penceresi guvenligi'
  ))
  const windowCountBeforeDeniedOpen = createdWindowCount
  const deniedOpenReturnedWindow = await javascriptCalistir(
    win,
    `Boolean(window.open('https://example.invalid', '_blank'))`,
    'uzak pencere reddi'
  )
  await new Promise((resolve) => setTimeout(resolve, 250))
  const remoteWindowDenied = createdWindowCount === windowCountBeforeDeniedOpen
  printWindow!.close()
  printWindow = null
  console.log('[SMOKE] print-window-policy')

  const loginScreen = await bekle(
    () => javascriptCalistir(win, `Boolean(
      document.querySelector('.login-page') &&
      document.querySelector('input[type="password"]') &&
      Array.from(document.querySelectorAll('button')).some(function (button) {
        return (button.textContent || '').trim() === 'Giriş Yap'
      })
    )`, 'giris ekrani sorgusu'),
    'giriş ekranı'
  )
  console.log('[SMOKE] login-screen')
  const initialTheme = await javascriptCalistir(
    win,
    `document.documentElement.getAttribute('data-theme') || ''`,
    'varsayilan tema'
  )
  const preloadState = JSON.parse(await javascriptCalistir(win, `JSON.stringify({
    hasApi: Boolean(window.api),
    hasLogin: typeof window.api?.ustaGirisYap === 'function',
    hasCustomer: typeof window.api?.musteriEkle === 'function',
    hasWorkOrder: typeof window.api?.isEmriEkle === 'function'
  })`, 'preload durumu'))
  console.log('[SMOKE] preload-state')
  const mastersResult = JSON.parse(await javascriptCalistir(
    win,
    '(async () => JSON.stringify(await window.api.ustalariGetir()))()',
    'usta IPC'
  ))
  console.log('[SMOKE] preload-ipc')

  await javascriptCalistir(win, `(() => {
    const combo = document.querySelector('[role="combobox"]')
    if (!combo) throw new Error('Usta seçim kutusu bulunamadı.')
    combo.click()
  })()`, 'usta secim kutusu')
  await bekle(
    () => javascriptCalistir(win, `Boolean(document.querySelector('[role="option"]'))`, 'usta secenegi sorgusu'),
    'usta seçeneği'
  )
  await javascriptCalistir(win, `(() => {
    const option = document.querySelector('[role="option"]')
    if (!option) throw new Error('Usta seçeneği bulunamadı.')
    option.click()
    const input = document.querySelector('input[type="password"]')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '1111')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const button = Array.from(document.querySelectorAll('button')).find(function (item) {
      return (item.textContent || '').trim() === 'Giriş Yap'
    })
    if (!button) throw new Error('Giriş butonu bulunamadı.')
    button.click()
  })()`, 'usta girisi')

  const loggedIn = await bekle(
    () => javascriptCalistir(win, `Boolean(document.querySelector('.status-master-box'))`, 'oturum sorgusu'),
    'başarılı usta girişi'
  )
  console.log('[SMOKE] logged-in')

  const chainResult = JSON.parse(await javascriptCalistir(win, `(async () => JSON.stringify(await (async () => {
    const customer = await window.api.musteriEkle({
      name: 'Smoke Customer', phone: '5555000001', note: 'stage5 smoke'
    })
    if (!customer?.success) return { step: 'customer', customer }
    const vehicle = await window.api.aracEkle({
      customer_id: customer.id, plate: 'SMK5001', brand: 'Smoke', model: 'Test', year: 2020
    })
    if (!vehicle?.success) return { step: 'vehicle', customer, vehicle }
    const workOrder = await window.api.isEmriEkle({
      vehicle_id: vehicle.id, description: 'Smoke work order', mileage: 5000, status: 'Açık'
    })
    if (!workOrder?.success) return { step: 'workOrder', customer, vehicle, workOrder }
    const orders = await window.api.isEmirleriGetir()
    window.location.hash = '/work-orders'
    return { success: true, customer, vehicle, workOrder, orders }
  })()))()`, 'kritik IPC zinciri', 15_000))

  const workOrdersScreen = await bekle(
    () => javascriptCalistir(win, `Boolean(
      location.hash.includes('work-orders') &&
      document.body.innerText.includes('İş Emirleri')
    )`, 'is emirleri ekrani sorgusu'),
    'İş Emirleri ekranı'
  )
  console.log('[SMOKE] critical-chain')
  const persisted = {
    customer: db.prepare('SELECT id, name FROM customers WHERE name = ?').get('Smoke Customer'),
    vehicle: db.prepare('SELECT id, plate, customer_id FROM vehicles WHERE plate = ?').get('SMK5001'),
    workOrder: db.prepare('SELECT id, vehicle_id, description, status FROM work_orders WHERE description = ?')
      .get('Smoke work order')
  }
  const quickCheck = String(db.pragma('quick_check', { simple: true }))
  win.close()
  await bekle(async () => closedCleanly, 'pencerenin kapanması')
  console.log('[SMOKE] window-closed')

  console.log(RESULT_PREFIX + JSON.stringify({
    safety: {
      scenarioRoot,
      tempPath: app.getPath('temp'),
      dbPath: databaseModule.dbPath,
      expectedDbPath: join(scenarioRoot, 'otoservis.db')
    },
    runtime: {
      arch: process.arch,
      electron: process.versions.electron,
      preloadFile: basename(preloadPath)
    },
    printing: {
      printOpenReturnedWindow,
      printWindowState,
      deniedOpenReturnedWindow,
      remoteWindowDenied
    },
    loginScreen,
    initialTheme,
    preloadState,
    mastersResult,
    loggedIn,
    chainResult,
    workOrdersScreen,
    persisted,
    quickCheck,
    closedCleanly,
    rendererErrors,
    domReady,
    rendererGone,
    loadFailure,
    rendererUnresponsive
  }))
  sessionModule.clearActiveMasterSession()
  db.close()
}

calistir()
  .then(() => {
    process.exitCode = 0
    app.quit()
  })
  .catch((error) => {
    process.exitCode = 1
    console.error(error)
    app.quit()
  })
