import { app } from 'electron'
import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fsSync, { promises as fs } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import { promisify } from 'node:util'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'

const execFileAsync = promisify(execFile)
const RESULT_PREFIX = 'KATIP_STAGE4_RESULT:'
const TEST_DIR_PREFIX = 'katip-integration-'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

type Handler = (...args: any[]) => any
type DbRow = Record<string, any>

function dogrulanmisTestDizini(): string {
  if (process.env.KATIP_TEST_MODE !== 'integration') {
    throw new Error('[KATIP_STAGE4_TEMP_GUARD] Entegrasyon test modu etkin degil.')
  }
  const candidate = process.env.KATIP_STAGE4_SCENARIO_ROOT
  if (!candidate) throw new Error('[KATIP_STAGE4_TEMP_GUARD] Test dizini tanimli degil.')

  const tempBase = realpathSync(tmpdir())
  const resolvedRoot = realpathSync(candidate)
  const relativePath = relative(tempBase, resolvedRoot)
  const firstSegment = relativePath.split(sep)[0]
  if (
    relativePath === '' || isAbsolute(relativePath) || relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) || !firstSegment.startsWith(TEST_DIR_PREFIX)
  ) {
    throw new Error(`[KATIP_STAGE4_TEMP_GUARD] Guvensiz test dizini reddedildi: ${resolvedRoot}`)
  }
  return resolvedRoot
}

function testKokuIcindeMi(target: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(target))
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function sha256(data: Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function tekGirdiliZipOlustur(entryName: string, content: Buffer): Buffer {
  const name = Buffer.from(entryName, 'utf8')
  const crc = crc32(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(0, 6)
  local.writeUInt16LE(0, 8)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(content.length, 18)
  local.writeUInt32LE(content.length, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(content.length, 20)
  central.writeUInt32LE(content.length, 24)
  central.writeUInt16LE(name.length, 28)

  const centralOffset = local.length + name.length + content.length
  const centralSize = central.length + name.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, name, content, central, name, end])
}

async function zipBilgisiOku(zipPath: string): Promise<{ entries: string[], manifest: any, engine: string }> {
  if (process.arch !== 'ia32') {
    const list = await execFileAsync('tar.exe', ['-tf', basename(zipPath)], {
      cwd: dirname(zipPath), windowsHide: true, maxBuffer: 8 * 1024 * 1024
    })
    const manifest = await execFileAsync('tar.exe', ['-xOf', basename(zipPath), 'manifest.json'], {
      cwd: dirname(zipPath), windowsHide: true, maxBuffer: 1024 * 1024
    })
    return {
      entries: String(list.stdout).split(/\r?\n/).filter(Boolean).map((entry) => entry.replace(/^\.\//, '')),
      manifest: JSON.parse(String(manifest.stdout)),
      engine: 'tar.exe'
    }
  }

  const yauzlModule: any = await import('yauzl')
  const openZip = yauzlModule.open || yauzlModule.default?.open
  return await new Promise((resolvePromise, rejectPromise) => {
    openZip(zipPath, { lazyEntries: true }, (openError: any, zipfile: any) => {
      if (openError || !zipfile) return rejectPromise(openError || new Error('ZIP acilamadi.'))
      const entries: string[] = []
      let manifest: any = null
      zipfile.on('error', rejectPromise)
      zipfile.on('entry', (entry: any) => {
        entries.push(entry.fileName)
        if (entry.fileName !== 'manifest.json') {
          zipfile.readEntry()
          return
        }
        zipfile.openReadStream(entry, (streamError: any, stream: any) => {
          if (streamError || !stream) return rejectPromise(streamError || new Error('Manifest okunamadi.'))
          const chunks: Buffer[] = []
          stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
          stream.on('error', rejectPromise)
          stream.on('end', () => {
            manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            zipfile.readEntry()
          })
        })
      })
      zipfile.on('end', () => resolvePromise({ entries, manifest, engine: 'yazl/yauzl-streaming' }))
      zipfile.readEntry()
    })
  })
}

async function bosPortBul(): Promise<number> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const probe = net.createServer()
    probe.once('error', rejectPromise)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? rejectPromise(error) : resolvePromise(port))
    })
  })
}

async function httpIstegi(
  port: number,
  method: string,
  requestPath: string,
  body?: string,
  headers: Record<string, string | number> = {}
): Promise<{ status: number, body: string, json: any }> {
  return await new Promise((resolvePromise, rejectPromise) => {
    const req = http.request({
      hostname: '127.0.0.1', port, method, path: requestPath,
      headers: { Connection: 'close', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf8')
        let json: any = null
        try { json = responseBody ? JSON.parse(responseBody) : null } catch {}
        resolvePromise({ status: Number(res.statusCode || 0), body: responseBody, json })
      })
    })
    req.on('error', rejectPromise)
    if (body !== undefined) req.write(body)
    req.end()
  })
}

async function calistir(): Promise<void> {
  const scenarioRoot = dogrulanmisTestDizini()
  const controlledTemp = join(scenarioRoot, 'temp')
  fsSync.mkdirSync(controlledTemp, { recursive: true })
  app.setPath('userData', scenarioRoot)
  app.setPath('temp', controlledTemp)
  await app.whenReady()

  const databaseModule = await import('../../../electron/database.js')
  const backupModule = await import('../../../electron/controllers/backupController.js')
  const phoneModule = await import('../../../electron/phoneServer.js')
  const restoreStateModule = await import('../../../electron/restoreState.js')
  const securityModule = await import('../../../electron/security.js')

  if (realpathSync(dirname(databaseModule.dbPath)) !== scenarioRoot) {
    throw new Error(`[KATIP_STAGE4_TEMP_GUARD] Veritabani test dizini disinda: ${databaseModule.dbPath}`)
  }
  if (realpathSync(app.getPath('temp')) !== realpathSync(controlledTemp)) {
    throw new Error('[KATIP_STAGE4_TEMP_GUARD] Electron temp dizini kontrol disinda.')
  }

  databaseModule.initDB()
  const db = databaseModule.getDatabase()
  let relaunchCalls = 0
  ;(app as any).relaunch = () => { relaunchCalls += 1 }

  const handlers = new Map<string, Handler>()
  backupModule.registerBackupHandlers((kanal: string, handler: Handler) => handlers.set(kanal, handler), () => ({} as any))
  const restoreHandler = handlers.get('yedekten-geri-yukle')!
  const report: Record<string, any> = {
    safety: {
      scenarioRoot,
      tempPath: app.getPath('temp'),
      dbPath: databaseModule.dbPath,
      expectedDbPath: join(scenarioRoot, 'otoservis.db')
    }
  }

  try {
    const photosDir = join(scenarioRoot, 'fotograflar')
    const smallPhotoPath = join(photosDir, 'nested', 'stage4-small.jpg')
    const largePhotoPath = join(photosDir, 'stage4-streaming.bin')
    const smallPhoto = Buffer.from('katip-stage4-small-photo', 'utf8')
    const largePhoto = Buffer.alloc(4 * 1024 * 1024, 0x5a)
    await fs.mkdir(dirname(smallPhotoPath), { recursive: true })
    await fs.writeFile(smallPhotoPath, smallPhoto)
    await fs.writeFile(largePhotoPath, largePhoto)

    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run('stage4_backup_marker', 'original')
    const customerInfo = db.prepare('INSERT INTO customers (name, phone, note, is_active) VALUES (?, ?, ?, 1)')
      .run('Stage4 Original Customer', '5554000001', 'backup fixture')
    const customerId = Number(customerInfo.lastInsertRowid)

    const backupResult = await backupModule.tamYedekPaketiOlustur('manual')
    if (!backupResult.success || !backupResult.path) {
      throw new Error(backupResult.error || 'Tam yedek olusturulamadi.')
    }
    if (!testKokuIcindeMi(backupResult.path, scenarioRoot)) {
      throw new Error(`[KATIP_STAGE4_TEMP_GUARD] Yedek test dizini disinda: ${backupResult.path}`)
    }
    const archiveInfo = await zipBilgisiOku(backupResult.path)
    report.backup = {
      result: backupResult,
      archivePath: backupResult.path,
      archiveInsideScenario: testKokuIcindeMi(backupResult.path, scenarioRoot),
      archiveSize: (await fs.stat(backupResult.path)).size,
      entries: archiveInfo.entries,
      manifest: archiveInfo.manifest,
      engine: archiveInfo.engine,
      expectedPhotoBytes: smallPhoto.length + largePhoto.length,
      hashes: { small: sha256(smallPhoto), large: sha256(largePhoto) }
    }

    const updateBackupResult = await backupModule.guncellemeOncesiYedekAlBackend()
    if (!updateBackupResult.success || !updateBackupResult.path) {
      throw new Error(updateBackupResult.error || 'Guncelleme oncesi tam yedek olusturulamadi.')
    }
    const customerAfterUpdateBackup = db.prepare('SELECT name, phone, note, is_active FROM customers WHERE id = ?')
      .get(customerId)
    report.updateBackup = {
      result: updateBackupResult,
      archiveInsideScenario: testKokuIcindeMi(updateBackupResult.path, scenarioRoot),
      filename: basename(updateBackupResult.path),
      customerAfterBackup: customerAfterUpdateBackup,
      quickCheck: String(db.pragma('quick_check', { simple: true }))
    }

    db.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run('mutated', 'stage4_backup_marker')
    db.prepare('UPDATE customers SET name = ? WHERE id = ?').run('Stage4 Mutated Customer', customerId)
    await fs.rm(photosDir, { recursive: true, force: true })
    await fs.mkdir(photosDir, { recursive: true })
    const currentOnlyPath = join(photosDir, 'current-only.txt')
    await fs.writeFile(currentOnlyPath, 'must disappear after restore', 'utf8')

    const corruptPath = join(scenarioRoot, 'fixtures', 'corrupt-backup.db')
    await fs.mkdir(dirname(corruptPath), { recursive: true })
    await fs.writeFile(corruptPath, Buffer.from('not a sqlite backup'))
    const corruptResult = await restoreHandler(null, corruptPath)
    report.corruptRestore = {
      result: corruptResult,
      marker: db.prepare('SELECT value FROM app_settings WHERE key = ?').get('stage4_backup_marker'),
      customer: db.prepare('SELECT name FROM customers WHERE id = ?').get(customerId),
      currentPhotoExists: fsSync.existsSync(currentOnlyPath),
      quickCheck: String(db.pragma('quick_check', { simple: true }))
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100))
    const slipSentinel = join(controlledTemp, 'stage4-zip-slip-sentinel.txt')
    const slipPath = join(scenarioRoot, 'fixtures', 'zip-slip.zip')
    await fs.writeFile(slipPath, tekGirdiliZipOlustur('nested/../../stage4-zip-slip-sentinel.txt', Buffer.from('escaped')))
    const slipResult = await restoreHandler(null, slipPath)
    report.zipSlip = {
      result: slipResult,
      sentinelExists: fsSync.existsSync(slipSentinel),
      marker: db.prepare('SELECT value FROM app_settings WHERE key = ?').get('stage4_backup_marker'),
      currentPhotoExists: fsSync.existsSync(currentOnlyPath),
      quickCheck: String(db.pragma('quick_check', { simple: true }))
    }

    const visibleMaster = db.prepare(`INSERT INTO masters (name, pin, is_active, hidden_from_mobile)
      VALUES (?, ?, 1, 0)`).run('Stage4 Mobile Master', securityModule.hashPin('2468'))
    const visibleMasterId = Number(visibleMaster.lastInsertRowid)
    const hiddenMaster = db.prepare(`INSERT INTO masters (name, pin, is_active, hidden_from_mobile)
      VALUES (?, ?, 1, 1)`).run('Stage4 Destek', securityModule.hashPin('9999'))
    const hiddenMasterId = Number(hiddenMaster.lastInsertRowid)

    const port = await bosPortBul()
    const startResult = await phoneModule.startPhoneServer(port)
    if (!startResult.success || startResult.port !== port) throw new Error(startResult.error || 'Telefon sunucusu baslatilamadi.')
    const requestedHosts: string[] = []
    const request = async (method: string, requestPath: string, body?: string, headers: Record<string, string | number> = {}) => {
      requestedHosts.push('127.0.0.1')
      return await httpIstegi(port, method, requestPath, body, headers)
    }

    const mastersResponse = await request('GET', '/api/masters')
    const pairInfo = phoneModule.generatePairingToken(visibleMasterId, 30)
    const pairResponse = await request('POST', '/api/pair', JSON.stringify({ pair_token: pairInfo.token }))
    const mobileToken = String(pairResponse.json?.token || '')
    const authHeaders = { Authorization: `Bearer ${mobileToken}` }
    const pingResponse = await request('GET', '/api/session/ping', undefined, authHeaders)
    const unauthorizedResponse = await request('GET', '/api/dashboard')
    const expiredPairInfo = phoneModule.generatePairingToken(visibleMasterId, -1)
    const expiredPairResponse = await request('POST', '/api/pair', JSON.stringify({ pair_token: expiredPairInfo.token }))
    report.phoneAuth = {
      port,
      startResult,
      masters: mastersResponse,
      visibleMasterId,
      hiddenMasterId,
      pairInfo,
      pairResponse,
      pingResponse,
      unauthorizedResponse,
      expiredPairResponse
    }

    const workOrderCountBefore = Number((db.prepare('SELECT COUNT(*) AS count FROM work_orders').get() as DbRow).count)
    const mutationResponse = await request('POST', '/api/service-reception', JSON.stringify({
      plate: 'S4API01', name: 'Stage4 API Customer', phone: '5554000002',
      brand: 'Test', model: 'API', mileage: 123, description: 'Authorized mutation',
      master_id: hiddenMasterId
    }), authHeaders)
    const apiWorkOrderId = Number(mutationResponse.json?.id || 0)
    const apiWorkOrder = db.prepare('SELECT id, opened_by_master_id FROM work_orders WHERE id = ?').get(apiWorkOrderId)
    const unauthMutation = await request('POST', '/api/service-reception', JSON.stringify({ plate: 'S4NOAUTH' }))
    const malformedBefore = Number((db.prepare('SELECT COUNT(*) AS count FROM work_orders').get() as DbRow).count)
    const malformedResponse = await request('POST', '/api/service-reception', '{bad json', authHeaders)
    const malformedAfter = Number((db.prepare('SELECT COUNT(*) AS count FROM work_orders').get() as DbRow).count)

    let oversizedResponse: any
    const oversizedBefore = malformedAfter
    try {
      oversizedResponse = await request('POST', '/api/service-reception', '{}', {
        ...authHeaders,
        'Content-Length': 25 * 1024 * 1024 + 1
      })
    } catch (error: any) {
      oversizedResponse = { status: 0, error: String(error?.code || error?.message || error) }
    }
    const oversizedAfter = Number((db.prepare('SELECT COUNT(*) AS count FROM work_orders').get() as DbRow).count)
    report.phoneMutation = {
      workOrderCountBefore,
      mutationResponse,
      apiWorkOrder,
      unauthMutation,
      malformedResponse,
      malformedBefore,
      malformedAfter,
      oversizedResponse,
      oversizedBefore,
      oversizedAfter
    }

    const paymentFloorPart = db.prepare(`
      INSERT INTO parts (code, name, stock, buy_price, sell_price, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run('S4-PAY-FLOOR', 'Stage4 payment floor part', 10, 20, 50)
    const paymentFloorPartId = Number(paymentFloorPart.lastInsertRowid)
    const paymentFloorAdd = await request('POST', '/api/work-order-items/part', JSON.stringify({
      work_order_id: apiWorkOrderId,
      part_id: paymentFloorPartId,
      description: 'Payment floor regression part',
      quantity: 2,
      unit_price: 50
    }), authHeaders)
    const paymentFloorItem = db.prepare(`
      SELECT id FROM work_order_items
      WHERE work_order_id = ? AND part_id = ?
    `).get(apiWorkOrderId, paymentFloorPartId) as DbRow
    const paymentFloorItemId = Number(paymentFloorItem.id)
    db.prepare(`
      INSERT INTO work_order_payments
        (work_order_id, amount, payment_method, payment_date, received_by, note)
      VALUES (?, 100, 'Nakit', date('now', 'localtime'), ?, ?)
    `).run(apiWorkOrderId, visibleMasterId, 'Stage4 mobile payment floor fixture')
    const paymentFloorSnapshot = () => ({
      order: db.prepare('SELECT total_price FROM work_orders WHERE id = ?').get(apiWorkOrderId),
      item: db.prepare(`
        SELECT id, work_order_id, part_id, quantity, total_price
        FROM work_order_items WHERE id = ?
      `).get(paymentFloorItemId),
      stock: db.prepare('SELECT stock FROM parts WHERE id = ?').get(paymentFloorPartId),
      payment: db.prepare(`
        SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
        FROM work_order_payments
        WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(apiWorkOrderId),
      movements: db.prepare(`
        SELECT type, quantity, old_stock, new_stock
        FROM stock_movements WHERE part_id = ? ORDER BY id
      `).all(paymentFloorPartId)
    })
    const paymentFloorBefore = paymentFloorSnapshot()
    const paymentFloorDelete = await request('POST', '/api/work-order-items/delete', JSON.stringify({
      item_id: paymentFloorItemId
    }), authHeaders)
    const paymentFloorAfter = paymentFloorSnapshot()
    report.phonePaymentFloor = {
      addResponse: paymentFloorAdd,
      deleteResponse: paymentFloorDelete,
      before: paymentFloorBefore,
      after: paymentFloorAfter
    }

    const insidePhoto = Buffer.from('stage4-api-photo')
    const insidePhotoPath = join(photosDir, 'stage4-api-photo.jpg')
    const outsidePhotoPath = join(scenarioRoot, 'outside-photo-secret.jpg')
    await fs.writeFile(insidePhotoPath, insidePhoto)
    await fs.writeFile(outsidePhotoPath, 'outside must not be served', 'utf8')
    const insideRow = db.prepare(`INSERT INTO work_order_photos
      (work_order_id, file_name, file_path, category, note) VALUES (?, ?, ?, ?, ?)`)
      .run(apiWorkOrderId, basename(insidePhotoPath), insidePhotoPath, 'Araç Kabul', '')
    const outsideRow = db.prepare(`INSERT INTO work_order_photos
      (work_order_id, file_name, file_path, category, note) VALUES (?, ?, ?, ?, ?)`)
      .run(apiWorkOrderId, basename(outsidePhotoPath), outsidePhotoPath, 'Araç Kabul', '')
    const insideResponse = await request('GET', `/api/photo?id=${insideRow.lastInsertRowid}&t=${encodeURIComponent(mobileToken)}`)
    const outsideResponse = await request('GET', `/api/photo?id=${outsideRow.lastInsertRowid}&t=${encodeURIComponent(mobileToken)}`)
    report.phonePhoto = {
      insideStatus: insideResponse.status,
      insideHash: sha256(Buffer.from(insideResponse.body, 'utf8')),
      expectedInsideHash: sha256(insidePhoto),
      outsideStatus: outsideResponse.status,
      outsideFileStillExists: fsSync.existsSync(outsidePhotoPath)
    }

    const hiddenLogin = await request('POST', '/api/login', JSON.stringify({ master_id: hiddenMasterId, pin: '9999' }))
    const supportMasters = mastersResponse.json?.masters || []
    report.phoneSupport = {
      hiddenLogin,
      hiddenListed: supportMasters.some((master: any) => Number(master.id) === hiddenMasterId),
      visibleListed: supportMasters.some((master: any) => Number(master.id) === visibleMasterId)
    }

    const guardedBefore = Number((db.prepare('SELECT COUNT(*) AS count FROM work_orders').get() as DbRow).count)
    restoreStateModule.setRestoreInProgress(true)
    let restoreGuardResponse: any
    try {
      restoreGuardResponse = await request('POST', '/api/service-reception', JSON.stringify({
        plate: 'S4GUARD', name: 'Blocked', phone: '0', brand: 'X', model: 'Y', description: 'blocked'
      }), authHeaders)
    } finally {
      restoreStateModule.setRestoreInProgress(false)
    }
    const guardedAfter = Number((db.prepare('SELECT COUNT(*) AS count FROM work_orders').get() as DbRow).count)
    report.phoneRestoreGuard = { response: restoreGuardResponse, guardedBefore, guardedAfter }

    const ttlPair = phoneModule.generatePairingToken(visibleMasterId, 30)
    const ttlPairResponse = await request('POST', '/api/pair', JSON.stringify({ pair_token: ttlPair.token }))
    const ttlToken = String(ttlPairResponse.json?.token || '')
    const realDateNow = Date.now
    const futureNow = realDateNow() + SESSION_TTL_MS + 1
    Date.now = () => futureNow
    let expiredSessionResponse: any
    try {
      expiredSessionResponse = await request('GET', '/api/session/ping', undefined, { Authorization: `Bearer ${ttlToken}` })
    } finally {
      Date.now = realDateNow
    }
    report.phoneSessionTtl = { pairResponse: ttlPairResponse, expiredSessionResponse }

    const rateResponses: any[] = []
    for (let index = 0; index < 15; index += 1) {
      rateResponses.push(await request('POST', '/api/login', JSON.stringify({ master_id: visibleMasterId, pin: '0000' })))
    }
    const lockedResponse = await request('POST', '/api/login', JSON.stringify({ master_id: visibleMasterId, pin: '2468' }))
    report.phoneRateLimit = {
      attempts: rateResponses.map((response) => response.json),
      lockedResponse,
      sessionCountBeforeCleanup: phoneModule.getMobileSessionsList().length
    }

    phoneModule.revokeAllMobileSessions()
    const revokedResponse = await request('GET', '/api/session/ping', undefined, authHeaders)
    const stopResult = await phoneModule.stopPhoneServer()
    report.phoneLifecycle = {
      revokedResponse,
      stopResult,
      runningAfterStop: phoneModule.isServerRunning(),
      requestedHosts,
      onlyLoopback: requestedHosts.every((host) => host === '127.0.0.1')
    }

    const restoreResult = await restoreHandler(null, backupResult.path)
    const restoredDb = databaseModule.getDatabase()
    const restoredSmall = await fs.readFile(smallPhotoPath)
    const restoredLarge = await fs.readFile(largePhotoPath)
    report.restore = {
      result: restoreResult,
      marker: restoredDb.prepare('SELECT value FROM app_settings WHERE key = ?').get('stage4_backup_marker'),
      customer: restoredDb.prepare('SELECT name FROM customers WHERE id = ?').get(customerId),
      hashes: { small: sha256(restoredSmall), large: sha256(restoredLarge) },
      currentPhotoExists: fsSync.existsSync(currentOnlyPath),
      quickCheck: String(restoredDb.pragma('quick_check', { simple: true })),
      relaunchCalls
    }
    report.quickCheck = String(restoredDb.pragma('quick_check', { simple: true }))
    console.log(RESULT_PREFIX + JSON.stringify(report))
  } finally {
    restoreStateModule.setRestoreInProgress(false)
    try { phoneModule.revokeAllMobileSessions() } catch {}
    try { await phoneModule.stopPhoneServer() } catch {}
    try { databaseModule.getDatabase().close() } catch {}
  }
}

calistir()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.quit()
    process.exitCode = 1
  })
