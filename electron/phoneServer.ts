import http from 'node:http'
import os from 'node:os'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import db from './database.js'
import { fotografiBufferdanKucult } from './photoUtils.js'
import { hashPin, verifyPin } from './security'
import { gunSonuVerisiHesapla, bugununTarihi, kapaliGunKontrol } from './controllers/closingController.js'
import { isEmriToplaminiGuncelle } from './controllers/workOrderController.js'
import { stokHareketiKaydet } from './controllers/partController.js'
import { isRestoreInProgress } from './restoreState.js'
import { escapeHtml, govdeSiniriUygula } from './phoneHttpUtils.js'
import { runPhoneServerMigrations } from './phoneMigrations.js'
import { PRIMEICONS_FONT_CONTENT_TYPES, primeiconsAssetOku } from './phoneAssets.js'
import {
  SESSION_TTL_MS,
  activeMobileSessions,
  activePairingTokens,
  checkLoginRateLimit,
  getMobileSessionsList,
  recordLoginFailure,
  recordLoginSuccess,
  revokeAllMobileSessions,
  revokeMobileSession,
  suresiDolanKayitlariTemizle,
  type PairingTokenInfo
} from './phoneAuthState.js'

export { getMobileSessionsList, revokeAllMobileSessions, revokeMobileSession }
export { runPhoneServerMigrations }
export type { MobileSession, PairingTokenInfo } from './phoneAuthState.js'

// Açık TCP soketleri. Node 16'da server.closeAllConnections() olmadığı için
// (bkz. stopPhoneServer) sunucuyu durdururken bağlantıları elle kapatabilmek
// amacıyla izleniyor.
const acikSoketler = new Set<import('node:net').Socket>()

let server: http.Server | null = null
let currentPort = 4317
let isRunning = false

export function generatePairingToken(masterId?: number, durationSeconds = 30) {
  suresiDolanKayitlariTemizle()

  let masterName = 'Tüm Ustalar / Genel'
  let mId = Number(masterId) || 0
  if (mId > 0) {
    const usta = db.prepare('SELECT id, name FROM masters WHERE id = ?').get(mId) as any
    if (usta) {
      masterName = usta.name
    }
  }
  const token = crypto.randomBytes(16).toString('hex')
  const expiresAt = Date.now() + durationSeconds * 1000
  const pairingObj: PairingTokenInfo = {
    token,
    master_id: mId,
    master_name: masterName,
    expiresAt,
    createdAt: Date.now()
  }
  activePairingTokens.set(token, pairingObj)
  const port = getCurrentPort()
  const ip = getLocalIPAddress()
  const vTag = token.substring(0, 8)
  const url = mId > 0 ? `http://${ip}:${port}/?master_id=${mId}&v=${vTag}` : `http://${ip}:${port}/?v=${vTag}`
  return { success: true, token, pairingUrl: url, expiresAt, masterName }
}

export interface LocalAddress {
  name: string
  address: string
  isPriority: boolean
}

export function getLocalIPAddresses(): LocalAddress[] {
  const interfaces = os.networkInterfaces()
  const addresses: LocalAddress[] = []

  const priorityKeywords = ['wi-fi', 'wlan', 'ethernet', 'kablosuz', 'yerel', 'en', 'eth', 'lan']
  const ignoreKeywords = ['virtual', 'vbox', 'vmware', 'wsl', 'hyper-v', 'loopback', 'pseudo', 'host-only', 'vpn', 'vboxnet', 'teredo', 'npcap']

  for (const name in interfaces) {
    const list = interfaces[name]
    if (!list) continue

    const nameLower = name.toLowerCase()
    const shouldIgnore = ignoreKeywords.some(keyword => nameLower.includes(keyword))

    for (const iface of list) {
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        if (shouldIgnore) continue

        const isPriority = priorityKeywords.some(keyword => nameLower.includes(keyword))
        addresses.push({
          name: name,
          address: iface.address,
          isPriority: isPriority
        })
      }
    }
  }

  addresses.sort((a, b) => {
    if (a.isPriority && !b.isPriority) return -1
    if (!a.isPriority && b.isPriority) return 1
    return a.name.localeCompare(b.name)
  })

  return addresses
}

export function getLocalIPAddress(): string {
  const list = getLocalIPAddresses()
  return list.length > 0 ? list[0].address : '127.0.0.1'
}

export function isServerRunning(): boolean {
  return isRunning
}

export function getCurrentPort(): number {
  return currentPort
}

export function stopPhoneServer(): Promise<boolean> {
  return new Promise((resolve) => {
    const mevcutServer = server
    if (!mevcutServer) {
      resolve(true)
      return
    }

    let tamamlandi = false
    let zamanlayici: ReturnType<typeof setTimeout> | null = null

    const bitir = () => {
      if (tamamlandi) return
      tamamlandi = true
      if (zamanlayici) clearTimeout(zamanlayici)
      server = null
      isRunning = false
      resolve(true)
    }

    mevcutServer.close((err) => {
      if (err) {
        console.error('[PhoneServer] Stop error:', err)
      }
      bitir()
    })

    // close() yalnızca yeni bağlantı kabul etmeyi durdurur; açık bağlantıların
    // kendiliğinden kapanmasını bekler. Mobil istemci düzenli aralıkla yoklama
    // yaptığı için bağlantı canlı kalıyor ve yukarıdaki geri çağrı hiç
    // çalışmayabiliyordu: "Telefon erişimini durdur" asılı kalırdı. Açık
    // bağlantılar da açıkça kapatılıyor.
    //
    // server.closeAllConnections() Node 18.2 ile geldi; bu depo Windows 7 için
    // Electron 22'de sabit ve orada Node 16.17 var, yani o fonksiyon YOK.
    // Bu yüzden açık soketler ayrıca izleniyor (bkz. acikSoketler) ve gerekirse
    // elle kapatılıyor. Kod her iki durumda da çalışır.
    try {
      if (typeof mevcutServer.closeAllConnections === 'function') {
        mevcutServer.closeAllConnections()
      } else {
        for (const soket of acikSoketler) {
          try { soket.destroy() } catch (e) { /* zaten kapanmış olabilir */ }
        }
        acikSoketler.clear()
      }
    } catch (e) {
      console.warn('[PhoneServer] Açık bağlantılar kapatılamadı:', e)
    }

    // Son güvence: her ihtimale karşı 3 saniye içinde yanıt dönülür, böylece
    // arayüzdeki düğme hiçbir durumda sonsuza kadar beklemede kalmaz.
    zamanlayici = setTimeout(() => {
      console.warn('[PhoneServer] Kapanma zaman aşımına uğradı, durdurulmuş sayılıyor.')
      bitir()
    }, 3000)
  })
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ DATABASE HELPERS FOR WORK ORDERS & STOCKS Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// Transactional helper to insert Customer -> Vehicle -> Work Order
const createServiceReceptionTransaction = (data: any) => db.transaction((dataInner: any) => {
  const { plate, name, phone, brand, model, year, mileage, description, master_id } = dataInner
  const cleanPlate = String(plate || '').toUpperCase().replace(/\s+/g, '')
  
  let vehicle = db.prepare("SELECT * FROM vehicles WHERE UPPER(REPLACE(plate, ' ', '')) = ?").get(cleanPlate) as any
  let vehicleId = null

  if (vehicle) {
    vehicleId = vehicle.id
    if (mileage) {
      db.prepare("UPDATE vehicles SET mileage = ? WHERE id = ?").run(Number(mileage), vehicleId)
    }
  } else {
    // 1. Create customer
    const resCust = db.prepare("INSERT INTO customers (name, phone) VALUES (?, ?)").run(
      String(name || '').trim(),
      String(phone || '').trim()
    )
    const customerId = resCust.lastInsertRowid

    // 2. Create vehicle
    const resVeh = db.prepare(`
      INSERT INTO vehicles (customer_id, plate, brand, model, year, mileage)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      cleanPlate,
      String(brand || '').trim(),
      String(model || '').trim(),
      year ? Number(year) : null,
      mileage ? Number(mileage) : null
    )
    vehicleId = resVeh.lastInsertRowid
  }

  // 3. Create work order
  const resWo = db.prepare(`
    INSERT INTO work_orders (
      vehicle_id,
      description,
      mileage,
      total_price,
      status,
      opened_by_master_id
    )
    VALUES (?, ?, ?, 0, 'Açık', ?)
  `).run(
    vehicleId,
    String(description || '').trim(),
    mileage ? Number(mileage) : null,
    Number(master_id)
  )

  return resWo.lastInsertRowid
})(data)

// Transactional helper to insert labor into work order
const addLaborTransaction = (data: any) => db.transaction((dataInner: any) => {
  const { work_order_id, description, quantity, unit_price } = dataInner
  const qty = Number(quantity)
  const price = Number(unit_price)
  const totalPrice = qty * price

  db.prepare(`
    INSERT INTO work_order_items 
    (work_order_id, type, part_id, description, quantity, unit_price, total_price)
    VALUES (?, 'İşçilik', NULL, ?, ?, ?, ?)
  `).run(
    Number(work_order_id),
    String(description || '').trim(),
    qty,
    price,
    totalPrice
  )

  isEmriToplaminiGuncelle(work_order_id)
  return true
})(data)

// Transactional helper to insert part item and log stock movements
const addPartTransaction = (data: any) => db.transaction((dataInner: any) => {
  const { work_order_id, part_id, description, quantity, unit_price, master_id } = dataInner
  const qty = Number(quantity)
  const sellPrice = Number(unit_price)
  const totalPrice = qty * sellPrice

  const part = db.prepare("SELECT * FROM parts WHERE id = ?").get(Number(part_id)) as any
  if (!part) {
    throw new Error('Parca bulunamadi.')
  }

  // 1. Insert item
  db.prepare(`
    INSERT INTO work_order_items 
    (work_order_id, type, part_id, description, quantity, unit_price, total_price)
    VALUES (?, 'Parça', ?, ?, ?, ?, ?)
  `).run(
    Number(work_order_id),
    Number(part_id),
    String(description || '').trim(),
    qty,
    sellPrice,
    totalPrice
  )

  // 2. Decrement stock
  const oldStock = Number(part.stock || 0)
  const newStock = oldStock - qty
  db.prepare("UPDATE parts SET stock = ? WHERE id = ?").run(newStock, Number(part_id))

  // 3. Log movement
  stokHareketiKaydet({
    partId: Number(part_id),
    workOrderId: Number(work_order_id),
    type: 'Çıkış',
    quantity: qty,
    oldStock,
    newStock,
    masterId: Number(master_id),
    note: 'Is emrinde kullanildi (Mobil)'
  })

  // 4. Update work order totals
  isEmriToplaminiGuncelle(work_order_id)
  return true
})(data)

// Transactional helper to delete item and restore stock counts
const deleteItemTransaction = (data: any) => db.transaction((dataInner: any) => {
  const { item_id, master_id } = dataInner
  
  const kalem = db.prepare("SELECT * FROM work_order_items WHERE id = ?").get(Number(item_id)) as any
  if (!kalem) {
    throw new Error("Kalem bulunamadi.")
  }

  const workOrderId = Number(kalem.work_order_id)

  if ((kalem.type === 'Parça' || kalem.type === 'Parca') && kalem.part_id) {
    const part = db.prepare('SELECT stock FROM parts WHERE id = ?').get(Number(kalem.part_id)) as any
    const eskiStok = Number(part?.stock || 0)
    const miktar = Number(kalem.quantity || 0)
    const yeniStok = eskiStok + miktar

    db.prepare(`
      UPDATE parts
      SET stock = ?
      WHERE id = ?
    `).run(yeniStok, Number(kalem.part_id))

    stokHareketiKaydet({
      partId: Number(kalem.part_id),
      workOrderId,
      type: 'Giriş',
      quantity: miktar,
      oldStock: eskiStok,
      newStock: yeniStok,
      masterId: Number(master_id),
      note: 'Is emri kalemi silindigi icin stok geri eklendi (Mobil)'
    })
  }

  db.prepare("DELETE FROM work_order_items WHERE id = ?").run(Number(item_id))
  isEmriToplaminiGuncelle(workOrderId)
  return true
})(data)


export function startPhoneServer(requestedPort: number): Promise<{ success: boolean; port?: number; ip?: string; error?: string }> {
  return new Promise(async (resolve) => {
    if (isRunning) {
      await stopPhoneServer()
    }
    const mobileMasters = db.prepare(`
      SELECT id, name
      FROM masters
      WHERE IFNULL(is_active, 1) = 1
        AND IFNULL(hidden_from_mobile, 0) = 0
      ORDER BY IFNULL(display_order, 9999) ASC, id ASC
    `).all() as Array<{ id: number; name: string }>

    const masterOptionsHtml = mobileMasters.length
      ? '<option value="" disabled selected>Lutfen Seciniz</option>' +
        mobileMasters
          .map((m) => '<option value="' + m.id + '">' + escapeHtml(m.name || '') + '</option>')
          .join('')
      : '<option value="">Usta listesi alinamadi</option>'
    const htmlContent = `<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Katip Mobil</title>
  <!-- PrimeIcons: yerel sunucudan servis edilir (harici CDN yok) -->
  <link href="/vendor/primeicons/primeicons.css" rel="stylesheet">
  <style>
    :root {
      --bg-primary: #0f172a;
      --bg-card: #1e293b;
      --bg-active: #334155;
      --text-primary: #f1f5f9;
      --text-secondary: #94a3b8;
      --text-muted: #64748b;
      --accent: #38bdf8;
      --accent-hover: #0ea5e9;
      --success: #34d399;
      --warning: #fb923c;
      --border: #334155;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      background-color: var(--bg-primary);
      color: var(--text-primary);
      padding: 16px;
      font-size: 15px;
      line-height: 1.5;
    }

    /* Screen layout */
    .screen {
      display: none;
      animation: fadeIn 0.2s ease-out;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* Login Screen */
    .login-container {
      max-width: 360px;
      width: 100%;
      min-height: calc(100vh - 32px);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      padding: 20px 0;
      text-align: center;
    }
    .logo-frame {
      width: 80px;
      height: 80px;
      margin-bottom: 20px;
      border-radius: 20px;
      background: linear-gradient(135deg, var(--bg-card), var(--bg-active));
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.3), 0 0 20px rgba(56, 189, 248, 0.15);
    }
    .logo-frame i {
      font-size: 40px;
      color: var(--accent);
    }
    .login-container h1 {
      font-size: 28px;
      font-weight: 800;
      margin-bottom: 4px;
      background: linear-gradient(to right, #ffffff, var(--accent));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .login-subtitle {
      color: var(--text-secondary);
      font-size: 14px;
      margin-bottom: 30px;
    }
    .card {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
      text-align: left;
      width: 100%;
      box-sizing: border-box;
    }
    .form-group {
      margin-bottom: 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .form-group label {
      font-weight: 600;
      font-size: 13.5px;
      color: var(--text-secondary);
    }
    select, input {
      width: 100%;
      height: 48px;
      padding: 0 14px;
      border-radius: 10px;
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-primary);
      font-size: 15px;
      outline: none;
      transition: border-color 0.2s;
    }
    select:focus, input:focus {
      border-color: var(--accent);
    }
    .btn {
      width: 100%;
      height: 48px;
      border-radius: 10px;
      border: none;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: background-color 0.2s, transform 0.1s;
    }
    .btn:active {
      transform: scale(0.98);
    }
    .btn-primary {
      background-color: var(--accent);
      color: #000;
    }
    .btn-primary:hover {
      background-color: var(--accent-hover);
    }
    .btn-secondary {
      background-color: var(--bg-active);
      color: var(--text-primary);
      border: 1px solid var(--border);
    }
    .error-msg {
      background-color: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #fca5a5;
      padding: 10px;
      border-radius: 8px;
      font-size: 13.5px;
      margin-bottom: 16px;
      display: none;
    }

    /* Dashboard & Inner Screens Header */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border);
    }
    .header-user {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background-color: var(--bg-active);
      color: var(--accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      border: 1px solid var(--border);
    }
    .logout-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px solid var(--border);
      background-color: var(--bg-card);
      color: var(--text-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .logout-btn:active {
      background-color: var(--bg-active);
    }

    /* Stats Grid */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 12px;
      margin-bottom: 20px;
    }
    @media (min-width: 560px) {
      .stats-grid {
        grid-template-columns: repeat(4, 1fr);
      }
    }
    .stat-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      position: relative;
      overflow: hidden;
    }
    .stat-card-main {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 8px;
    }
    .stat-card-info {
      display: flex;
      flex-direction: column;
      text-align: left;
    }
    .stat-label {
      font-size: 11px;
      color: var(--text-secondary);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .stat-val {
      font-size: 24px;
      font-weight: 800;
      line-height: 1.1;
    }
    .stat-icon {
      font-size: 18px;
      opacity: 0.8;
      padding: 4px;
    }
    .stat-sub {
      font-size: 10.5px;
      color: var(--text-muted);
      border-top: 1px dashed var(--border);
      padding-top: 6px;
      text-align: left;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    /* Card Accent Colors */
    .stat-card.accent-blue {
      border-left: 3px solid #38bdf8;
    }
    .stat-card.accent-blue .stat-icon { color: #38bdf8; }
    
    .stat-card.accent-green {
      border-left: 3px solid #34d399;
    }
    .stat-card.accent-green .stat-icon { color: #34d399; }
    
    .stat-card.accent-amber {
      border-left: 3px solid #fb923c;
    }
    .stat-card.accent-amber .stat-icon { color: #fb923c; }
    
    .stat-card.accent-purple {
      border-left: 3px solid #c084fc;
    }
    .stat-card.accent-purple .stat-icon { color: #c084fc; }

    /* Search bar with left icon */
    .search-container {
      position: relative;
      margin-bottom: 16px;
    }
    .search-container i {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-secondary);
      pointer-events: none;
    }
    .search-container input {
      padding-left: 36px;
    }

    /* List layout */
    .section-title {
      font-size: 16px;
      font-weight: 700;
      margin-bottom: 12px;
      color: var(--text-primary);
    }
    
    .list-container {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    
    .list-item {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: background-color 0.2s;
    }
    
    .list-item:active {
      background-color: var(--bg-active);
    }
    
    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .plate-badge {
      background-color: #f1f5f9;
      color: #0f172a;
      font-family: 'Courier New', Courier, monospace;
      font-weight: 800;
      font-size: 13px;
      padding: 2px 6px 2px 10px;
      border-radius: 4px;
      border: 1px solid #cbd5e1;
      border-left: 4px solid #1d4ed8;
      letter-spacing: 0.08em;
      display: inline-block;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
    }
    
    .item-price {
      font-weight: 700;
      color: var(--accent);
      font-size: 16px;
    }
    
    .item-info {
      font-size: 13px;
      color: var(--text-secondary);
    }
    
    .item-desc {
      font-size: 14px;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    
    .badge-status {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      display: inline-block;
    }
    
    .badge-status.acik {
      background-color: rgba(56, 189, 248, 0.1);
      color: var(--accent);
      border: 1px solid rgba(56, 189, 248, 0.2);
    }
    
    .badge-status.tamamlandi {
      background-color: rgba(16, 185, 129, 0.1);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.2);
    }

    /* Detail View Styles */
    .detail-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 18px;
      margin-bottom: 16px;
    }
    
    .detail-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      font-size: 14px;
    }
    .detail-row:last-child {
      border-bottom: none;
    }
    .detail-label {
      color: var(--text-secondary);
    }
    .detail-value {
      font-weight: 600;
      text-align: right;
    }
    
    .items-panel {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 16px;
      margin-bottom: 20px;
    }
    .item-row {
      padding: 8px 0;
      border-bottom: 1px solid var(--border);
      font-size: 13.5px;
    }
    .item-row:last-child {
      border-bottom: none;
    }
    .item-row-header {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      margin-bottom: 2px;
    }
    .item-row-sub {
      display: flex;
      justify-content: space-between;
      color: var(--text-secondary);
      font-size: 12px;
    }

    /* Part Results List */
    .part-select-card {
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 8px;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .part-select-card:active {
      background-color: var(--bg-active);
    }

    /* Modal Backdrop */
    .modal-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: rgba(0, 0, 0, 0.75);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      padding: 16px;
      box-sizing: border-box;
      animation: fadeIn 0.2s ease-out;
    }
    
    /* Modal Content Container */
    .modal-content {
      background-color: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      width: 100%;
      max-width: 500px;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
      animation: slideUp 0.25s ease-out;
      overflow: hidden;
    }
    
    @keyframes slideUp {
      from { transform: translateY(20px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    
    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
    }
    .modal-header h3 {
      font-size: 16.5px;
      font-weight: 700;
      margin: 0;
      color: var(--text-primary);
    }
    .modal-close-btn {
      background: transparent;
      border: none;
      color: var(--text-secondary);
      font-size: 24px;
      cursor: pointer;
      line-height: 1;
      padding: 0 4px;
      transition: color 0.15s;
    }
    .modal-close-btn:hover {
      color: var(--text-primary);
    }
    .modal-body {
      padding: 16px;
      overflow-y: auto;
      flex: 1;
    }

    /* Photo Category Pill Badges */
    .photo-cat-pill {
      font-size: 11.5px;
      padding: 5px 12px;
      border-radius: 99px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-secondary);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      transition: all 0.15s ease;
    }
    .photo-cat-pill.active {
      background: rgba(56, 189, 248, 0.2);
      color: #38bdf8;
      border-color: rgba(56, 189, 248, 0.4);
      font-weight: 600;
    }

    /* Result Card Styles */
    .result-card {
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 12px 14px;
      margin-bottom: 12px;
      cursor: pointer;
      transition: transform 0.15s ease, border-color 0.15s ease;
    }
    .result-card:active {
      transform: scale(0.98);
      border-color: var(--accent);
    }
    .result-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      margin-bottom: 8px;
    }
    .result-plate {
      background-color: var(--accent);
      color: #000;
      font-weight: 800;
      font-size: 12px;
      padding: 3px 8px;
      border-radius: 6px;
      letter-spacing: 0.5px;
    }
    .result-date {
      font-size: 11px;
      color: var(--accent);
      font-weight: 600;
    }
    .result-info-row {
      display: flex;
      justify-content: space-between;
      font-size: 12.5px;
      margin-bottom: 4px;
      line-height: 1.3;
    }
    .result-info-row:last-child {
      margin-bottom: 0;
    }
    .result-info-label {
      color: var(--text-secondary);
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .result-info-label i {
      font-size: 11px;
    }
    .result-info-value {
      color: var(--text-primary);
      font-weight: 600;
      text-align: right;
    }

    /* Visit Card Styles */
    .visit-card {
      background-color: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: border-color 0.15s;
    }
    .visit-card:active {
      border-color: var(--accent);
    }
    .visit-card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .visit-total {
      font-weight: 700;
      color: var(--accent);
      font-size: 13px;
    }
    .visit-complaint {
      font-size: 11.5px;
      color: var(--text-secondary);
      margin-top: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  </style>
</head>
<body>
  <!-- SCREEN 1: LOGIN -->
  <div id="screen-login" class="screen" style="display: block;">
    <div class="login-container">
      <div class="logo-frame">
        <i class="pi pi-car"></i>
      </div>
      <h1>Katip Mobil</h1>
      <div class="login-subtitle">Oto Servis Takip Sistemi</div>
      
      <div class="card">
        <div id="login-error" class="error-msg"></div>
        <div class="form-group">
          <label>Usta Secin</label>
          <select id="login-master">${masterOptionsHtml}</select>
        </div>
        <div class="form-group" style="margin-bottom: 24px;">
          <label>PIN Kodu</label>
          <input id="login-pin" type="password" pattern="[0-9]*" inputmode="numeric" maxlength="4" placeholder="4 haneli PIN girin">
        </div>
        <button id="login-btn" class="btn btn-primary">
          Giris Yap
        </button>
      </div>
    </div>
  </div>

  <!-- SCREEN 2: DASHBOARD -->
  <div id="screen-dashboard" class="screen">
    <div class="header">
      <div class="header-user">
        <div class="avatar"><i class="pi pi-user"></i></div>
        <div>
          <div style="font-size: 11px; color: var(--text-secondary);">Hos Geldiniz</div>
          <strong id="user-display-name">Usta Adi</strong>
        </div>
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="refresh-dashboard-btn" class="logout-btn" style="background: rgba(255, 255, 255, 0.05); color: var(--text-secondary);" title="Yenile">
          <i class="pi pi-refresh"></i>
        </button>
        <button id="logout-btn" class="logout-btn" title="Cikis Yap">
          <i class="pi pi-sign-out"></i>
        </button>
      </div>
    </div>

    <!-- Prominent Buttons -->
    <div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px;">
      <button id="new-reception-btn" class="btn btn-primary" style="width: 100%; height: 50px; background-color: var(--accent); color: #000; margin: 0; display: flex; align-items: center; justify-content: center; font-size: 15px; font-weight: 700; gap: 8px; border-radius: 12px; border: none; cursor: pointer;">
        <i class="pi pi-plus-circle" style="font-size: 17px;"></i> Yeni Servis Kabul
      </button>
      
      <div id="customer-history-btn" style="background-color: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 16px; cursor: pointer; display: flex; flex-direction: column; gap: 6px; transition: background-color 0.15s ease;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-weight: 700; font-size: 14px; color: var(--text-primary);">
          <span><i class="pi pi-search" style="color: var(--accent); margin-right: 6px; font-size: 13px;"></i> Musteri Gecmisi Sorgula</span>
          <i class="pi pi-chevron-right" style="font-size: 11px; color: var(--text-secondary);"></i>
        </div>
        <div style="font-size: 12px; color: var(--text-secondary); line-height: 1.4;">
          Plaka, musteri adi veya telefon no ile gecmis servis kayitlarini arayin.
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="stats-grid">
      <!-- Acik Is Emri Card -->
      <div class="stat-card accent-blue">
        <div class="stat-card-main">
          <div class="stat-card-info">
            <span class="stat-label">Acik Is Emri</span>
            <span id="stat-open" class="stat-val">0</span>
          </div>
          <i class="pi pi-wrench stat-icon"></i>
        </div>
        <div id="stat-open-sub" class="stat-sub">Tamamlanan: -</div>
      </div>

      <!-- Kayitli Musteri Card -->
      <div class="stat-card accent-green">
        <div class="stat-card-main">
          <div class="stat-card-info">
            <span class="stat-label">Kayitli Musteri</span>
            <span id="stat-customers" class="stat-val">0</span>
          </div>
          <i class="pi pi-users stat-icon"></i>
        </div>
        <div id="stat-customers-sub" class="stat-sub">Toplam: -</div>
      </div>

      <!-- Servisteki Arac Card -->
      <div class="stat-card accent-amber">
        <div class="stat-card-main">
          <div class="stat-card-info">
            <span class="stat-label">Servisteki Arac</span>
            <span id="stat-vehicles" class="stat-val">0</span>
          </div>
          <i class="pi pi-car stat-icon"></i>
        </div>
        <div id="stat-vehicles-sub" class="stat-sub">Tamamlanan: -</div>
      </div>

      <!-- Aktif Parca Karti Card -->
      <div class="stat-card accent-purple">
        <div class="stat-card-main">
          <div class="stat-card-info">
            <span class="stat-label">Aktif Parca Karti</span>
            <span id="stat-parts" class="stat-val">0</span>
          </div>
          <i class="pi pi-box stat-icon"></i>
        </div>
        <div id="stat-parts-sub" class="stat-sub">Kritik: -  Biten: -</div>
      </div>
    </div>

    <!-- Gun Sonu Ozet Karti (salt okunur) -->
    <div id="daily-summary-card" class="card" style="padding: 14px; margin-bottom: 16px; display: none;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <span style="font-weight: 700; font-size: 14.5px;"><i class="pi pi-wallet" style="color: var(--accent);"></i> Bugun (Gun Sonu)</span>
        <span id="ds-status" style="font-size: 11.5px; font-weight: 700; padding: 3px 10px; border-radius: 99px;"></span>
      </div>
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 13px; color: var(--text-secondary);">
        <div>Toplam Tahsilat</div><div id="ds-total" style="text-align: right; font-weight: 700; color: var(--text-primary);">-</div>
        <div style="padding-left: 10px;">Nakit</div><div id="ds-cash" style="text-align: right;">-</div>
        <div style="padding-left: 10px;">Kart</div><div id="ds-card" style="text-align: right;">-</div>
        <div style="padding-left: 10px;">Havale / EFT</div><div id="ds-transfer" style="text-align: right;">-</div>
        <div>Cikislar (Gider + Tedarikci)</div><div id="ds-out" style="text-align: right;">-</div>
        <div style="font-weight: 700; color: var(--text-primary);">Beklenen Nakit</div><div id="ds-expected" style="text-align: right; font-weight: 700; color: var(--text-primary);">-</div>
        <div>Is Emri (Acilan / Kapanan)</div><div id="ds-wo" style="text-align: right;">-</div>
      </div>
    </div>

    <!-- Kritik Stok Listesi -->
    <div id="critical-parts-wrap" style="display: none; margin-bottom: 16px;">
      <div class="section-title" style="color: #f59e0b;"><i class="pi pi-exclamation-triangle"></i> Kritik Stok (<span id="critical-count">0</span>)</div>
      <div id="critical-parts-list" class="card" style="padding: 4px 14px;"></div>
    </div>

    <!-- Tabs Selector -->
    <div class="tabs-container" style="display: flex; background-color: var(--bg-card); border-radius: 10px; padding: 4px; margin-bottom: 16px; border: 1px solid var(--border);">
      <button id="tab-open" class="tab-btn active" style="flex: 1; height: 36px; border: none; border-radius: 8px; font-weight: 600; font-size: 13.5px; cursor: pointer; transition: all 0.15s ease; background: var(--bg-active); color: var(--accent);">
        Acik Isler
      </button>
      <button id="tab-completed" class="tab-btn" style="flex: 1; height: 36px; border: none; border-radius: 8px; font-weight: 600; font-size: 13.5px; cursor: pointer; transition: all 0.15s ease; background: transparent; color: var(--text-secondary);">
        Tamamlananlar
      </button>
    </div>

    <!-- Live Search -->
    <div class="search-container">
      <i class="pi pi-search"></i>
      <input id="search-input" type="text" placeholder="Plaka, musteri veya islem ara...">
    </div>

    <div class="section-title"><span id="list-title-lbl">Acik Is Emirleri</span> (<span id="open-count-lbl">0</span>)</div>
    <div id="orders-list" class="list-container">
      <!-- Loaded dynamically -->
    </div>
  </div>

  <!-- SCREEN 3: DETAILS -->
  <div id="screen-details" class="screen">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Is Emri Detayi</h2>
      <button id="detail-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <!-- General Info Card -->
    <div class="detail-card">
      <div class="detail-row">
        <span class="detail-label">Plaka</span>
        <span class="detail-value"><span id="det-plate" class="plate-badge">-</span></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Musteri</span>
        <span id="det-customer" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Telefon</span>
        <span id="det-phone" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Arac</span>
        <span id="det-vehicle" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Acan Usta</span>
        <span id="det-master" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Acilis Tarihi</span>
        <span id="det-date" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Kapatan Usta</span>
        <span id="det-closed-master" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Kapanis Tarihi</span>
        <span id="det-closed-date" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Is Emri Durumu</span>
        <span class="detail-value"><span id="det-status" class="badge-status acik">Acik</span></span>
      </div>
      <div class="detail-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
        <span class="detail-label">Sikayet / Is Aciklamasi</span>
        <span id="det-desc" style="font-weight: 500; font-size: 13.5px; color: var(--text-primary); text-align: left; padding: 4px 0;">-</span>
      </div>
    </div>

    <!-- Customer Digital Signature Card -->
    <div class="card" style="padding: 14px; margin-bottom: 16px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 700; font-size: 14px; color: var(--text-primary); display: flex; align-items: center; gap: 6px;">
          <i class="pi pi-pencil" style="color: var(--accent);"></i> Musteri Dijital Imzasi
        </span>
        <span id="det-signature-status" class="badge-status acik" style="font-size: 11px;">Imza Bekleniyor</span>
      </div>
      <div id="det-signature-container" style="display: none; text-align: center; margin-top: 8px; margin-bottom: 8px;">
        <img id="det-signature-img" src="" style="max-width: 100%; max-height: 90px; border: 1px dashed var(--border); border-radius: 8px; background: #ffffff; padding: 4px; display: block; margin: 0 auto;" />
      </div>
      <button id="open-signature-modal-btn" class="btn btn-secondary" style="width: 100%; height: 40px; font-size: 13.5px; margin-top: 6px; background: rgba(52, 211, 153, 0.12); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.3);">
        <i class="pi pi-file-edit"></i> ✍️ Imza Al / Yenile
      </button>
    </div>

    <!-- Items/Parts Panel -->
    <div class="section-title">Yapilan Isler &amp; Parcalar</div>
    <div class="items-panel">
      <div id="det-items-list">
        <!-- Loaded dynamically -->
      </div>
      
      <!-- Totals & Actions -->
      <div style="display: flex; justify-content: space-between; border-top: 1px solid var(--border); padding-top: 12px; margin-top: 12px; font-weight: 700; font-size: 16px; margin-bottom: 14px;">
        <span>Toplam Tutar:</span>
        <span id="det-total" class="color-accent">0.00 TL</span>
      </div>

      <div id="detail-actions-wrapper" style="display: flex; flex-direction: column; gap: 10px;">
        <div style="display: flex; gap: 10px;">
          <button id="add-labor-btn" class="btn btn-secondary" style="flex: 1; height: 42px; font-size: 14px; background-color: var(--bg-active);">
            <i class="pi pi-briefcase"></i> Iscilik Ekle
          </button>
          <button id="add-part-btn" class="btn btn-secondary" style="flex: 1; height: 42px; font-size: 14px; background-color: var(--bg-active);">
            <i class="pi pi-cog"></i> Parca Ekle
          </button>
        </div>
        <button id="complete-order-btn" class="btn btn-primary" style="width: 100%; height: 42px; font-size: 14px; background-color: var(--success); color: #000; border: none; font-weight: 600;">
          <i class="pi pi-check-circle"></i> Isi Tamamla
        </button>
      </div>
    </div>

    <!-- Vehicle Photos Panel -->
    <div class="section-title" style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px;">
      <span><i class="pi pi-camera"></i> Arac Fotograflari (<span id="det-photo-count">0</span>)</span>
      <button id="det-take-photo-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 10px; font-size: 12.5px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">
        <i class="pi pi-camera"></i> Foto Cek / Ekle
      </button>
    </div>

    <input type="file" id="mobile-photo-file" accept="image/*" capture="environment" style="display: none;" />

    <div class="card" style="padding: 12px; margin-bottom: 20px;">
      <!-- Category Badges -->
<div id="photo-category-bar" style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 10px;">
  <span class="photo-cat-pill active" data-cat="Tümü">
    Tümü (<span id="photo-count-all">0</span>)
  </span>

  <span class="photo-cat-pill" data-cat="Araç Kabul">
    Araç Kabul (<span id="photo-count-reception">0</span>)
  </span>

  <span class="photo-cat-pill" data-cat="Hasar / Çizik">
    Hasar / Çizik (<span id="photo-count-damage">0</span>)
  </span>

  <span class="photo-cat-pill" data-cat="Sökülen Parça">
    Sökülen Parça (<span id="photo-count-removed">0</span>)
  </span>

  <span class="photo-cat-pill" data-cat="Tamir Sonrası">
    Tamir Sonrası (<span id="photo-count-after">0</span>)
  </span>
</div>

      <div id="det-photos-list" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
        <!-- Photo Cards -->
      </div>
    </div>
  </div>

  <!-- SCREEN 4: NEW RECEPTION -->
  <div id="screen-new-reception" class="screen">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Yeni Servis Kabul</h2>
      <button id="reception-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Vazgec
      </button>
    </div>

    <div class="card">
      <div id="reception-error" class="error-msg"></div>
      <div id="rec-found-banner" style="display: none; background-color: rgba(52, 211, 153, 0.1); border: 1px solid rgba(52, 211, 153, 0.25); color: #a7f3d0; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-bottom: 16px;"></div>
      <div id="rec-ocr-banner" style="display: none; background-color: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.25); color: #7dd3fc; padding: 10px; border-radius: 8px; font-size: 13px; font-weight: 600; margin-bottom: 16px;"></div>

      <div style="margin-bottom: 16px;">
        <button id="btn-ocr-scan" type="button" class="btn btn-secondary" style="width: 100%; height: 44px; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px dashed rgba(56, 189, 248, 0.4); font-size: 14px; font-weight: 600; border-radius: 10px;">
          <i class="pi pi-camera"></i> 📄 Ruhsat / Plaka Oku (Kamera OCR)
        </button>
        <input type="file" id="rec-ocr-file" accept="image/*" capture="environment" style="display: none;" />
      </div>

      <form id="reception-form" onsubmit="return false;">
        <div class="form-group">
          <label>Arac Plakasi *</label>
          <input id="rec-plate" type="text" placeholder="Orn: 34ABC123" required>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Musteri Adi *</label>
            <input id="rec-name" type="text" placeholder="Ad Soyad" required>
          </div>
          <div class="form-group">
            <label>Telefon *</label>
            <input id="rec-phone" type="tel" placeholder="05XXXXXXXXX" required>
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Marka</label>
            <input id="rec-brand" type="text" placeholder="Orn: Ford">
          </div>
          <div class="form-group">
            <label>Model</label>
            <input id="rec-model" type="text" placeholder="Orn: Focus">
          </div>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Yil</label>
            <input id="rec-year" type="number" placeholder="Orn: 2018">
          </div>
          <div class="form-group">
            <label>Arac KM</label>
            <input id="rec-mileage" type="number" placeholder="Orn: 120000">
          </div>
        </div>

        <div class="form-group">
          <label>Sikayet / Yapilacak Islem *</label>
          <textarea id="rec-desc" placeholder="Sikayet veya yapilacak islemleri buraya yazin..." style="width: 100%; min-height: 80px; padding: 12px; border-radius: 10px; background-color: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); font-size: 15px; outline: none; transition: border-color 0.2s;" required></textarea>
        </div>

        <button id="reception-save-btn" class="btn btn-primary" style="margin-top: 10px;">
          <i class="pi pi-save"></i> Servis Kabulunu Kaydet
        </button>
      </form>
    </div>
  </div>

  <!-- SCREEN 4.5: COMPLETE ORDER + PAYMENT -->
  <div id="screen-complete-order" class="screen">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Isi Tamamla</h2>
      <button id="complete-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <div class="card">
      <div style="display: grid; grid-template-columns: 1fr auto; gap: 6px 12px; font-size: 14px; margin-bottom: 16px; color: var(--text-secondary);">
        <div>Toplam Tutar</div><div id="co-total" style="text-align: right; font-weight: 600; color: var(--text-primary);">-</div>
        <div>Onceden Tahsil Edilen</div><div id="co-paid" style="text-align: right;">-</div>
        <div style="font-weight: 700; color: var(--text-primary);">Kalan Borc</div><div id="co-remaining" style="text-align: right; font-weight: 700; color: #f59e0b;">-</div>
      </div>

      <div id="co-error" class="error-msg"></div>

      <form id="co-form" onsubmit="return false;">
        <div class="form-group">
          <label>Odeme Durumu</label>
          <select id="co-option" style="width: 100%; height: 44px; padding: 0 12px; border-radius: 10px; background-color: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); font-size: 15px;">
            <option value="full">Tam Odeme (kalanin tamami alindi)</option>
            <option value="partial">Kismi Odeme</option>
            <option value="none">Odeme Alinmadi</option>
          </select>
        </div>

        <div id="co-amount-wrap" class="form-group">
          <label>Alinan Tutar (TL)</label>
          <input id="co-amount" type="number" step="0.01" inputmode="decimal" placeholder="0.00">
        </div>

        <div id="co-method-wrap" class="form-group">
          <label>Odeme Yontemi</label>
          <select id="co-method" style="width: 100%; height: 44px; padding: 0 12px; border-radius: 10px; background-color: var(--bg-primary); border: 1px solid var(--border); color: var(--text-primary); font-size: 15px;">
            <option value="Nakit">Nakit</option>
            <option value="Kart">Kart</option>
            <option value="Havale / EFT">Havale / EFT</option>
            <option value="Diğer">Diger</option>
          </select>
        </div>

        <button id="co-save-btn" class="btn btn-primary" style="margin-top: 10px; height: 44px; background-color: var(--success); color: #000; border: none; font-weight: 600;">
          <i class="pi pi-check-circle"></i> Tamamla ve Kaydet
        </button>
      </form>
    </div>
  </div>

  <!-- SCREEN 5: ADD LABOR -->
  <div id="screen-add-labor" class="screen">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Iscilik Ekle</h2>
      <button id="labor-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <div class="card">
      <div id="labor-error" class="error-msg"></div>
      <form id="labor-form" onsubmit="return false;">
        <div class="form-group">
          <label>Yapilan Islem Aciklamasi *</label>
          <input id="labor-desc" type="text" placeholder="Orn: On Fren Balatasi Degisim Isciligi" required>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Miktar / Saat *</label>
            <input id="labor-qty" type="number" step="0.5" value="1" required>
          </div>
          <div class="form-group">
            <label>Birim Fiyat (TL) *</label>
            <input id="labor-price" type="number" step="0.01" placeholder="0.00" required>
          </div>
        </div>

        <div style="margin-top: 14px; margin-bottom: 18px; font-size: 15px; font-weight: 600;">
          Hesaplanan Toplam Tutar: <span id="labor-total-preview" class="color-accent">0.00 TL</span>
        </div>

        <button id="labor-save-btn" class="btn btn-primary">
          <i class="pi pi-save"></i> Isciligi Ekle
        </button>
      </form>
    </div>
  </div>

  <!-- SCREEN 6: ADD PART -->
  <div id="screen-add-part" class="screen">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Parca Ekle</h2>
      <button id="part-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <!-- Live Search Part Wrapper -->
    <div style="position: relative; margin-bottom: 16px;">
      <div class="search-container" style="margin-bottom: 0;">
        <i class="pi pi-search"></i>
        <input id="part-search-input" type="text" placeholder="Kod, parca adi veya marka ara..." autocomplete="off">
      </div>

      <!-- Results list as absolute dropdown -->
      <div id="parts-search-results" style="display: none; position: absolute; top: 100%; left: 0; right: 0; z-index: 1000; max-height: 200px; overflow-y: auto; background: var(--bg-card); border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); margin-top: 6px;">
        <div style="text-align: center; color: var(--text-secondary); padding: 12px; font-size: 13px;">Arama yapmak icin yazin...</div>
      </div>
    </div>

    <!-- Sub form shown when part is selected -->
    <div id="selected-part-info" class="card" style="display: none;">
      <div id="part-error" class="error-msg"></div>
      
      <div style="margin-bottom: 14px; border-bottom: 1px solid var(--border); padding-bottom: 10px;">
        <span style="font-size: 12px; color: var(--text-secondary); display: block;">Secilen Parca</span>
        <strong id="part-selected-name" style="font-size: 15px; color: var(--accent);">Parca Ismi</strong>
        <span style="font-size: 12px; color: var(--text-muted); display: block; margin-top: 2px;">
          Mevcut Stok: <span id="part-selected-stock" style="font-weight: 600;">0 Adet</span>
        </span>
      </div>

      <form id="part-form" onsubmit="return false;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
          <div class="form-group">
            <label>Miktar *</label>
            <input id="part-qty" type="number" step="1" value="1" required>
          </div>
          <div class="form-group">
            <label>Birim Satis Fiyati (TL) *</label>
            <input id="part-price" type="number" step="0.01" required>
          </div>
        </div>

        <div style="margin-top: 14px; margin-bottom: 18px; font-size: 15px; font-weight: 600;">
          Hesaplanan Toplam Tutar: <span id="part-total-preview" class="color-accent">0.00 TL</span>
        </div>

        <button id="part-save-btn" class="btn btn-primary">
          <i class="pi pi-save"></i> Parcayi Ekle
        </button>
      </form>
    </div>
  </div>

  <!-- SCREEN: CUSTOMER HISTORY -->
  <div id="screen-customer-history" class="screen" style="display: none;">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Musteri Gecmisi Ara</h2>
      <button id="history-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <div class="search-container" style="margin-bottom: 16px;">
      <i class="pi pi-search"></i>
      <input id="history-search-input" type="text" placeholder="Plaka, musteri veya telefon...">
    </div>

    <div id="history-loading" style="display: none; text-align: center; padding: 20px; color: var(--text-secondary);">
      Yukleniyor...
    </div>

    <div id="history-results" class="list-container">
      <!-- Search results loaded dynamically -->
    </div>
  </div>

  <!-- SCREEN: CUSTOMER HISTORY DETAIL -->
  <div id="screen-history-detail" class="screen" style="display: none;">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Gecmis Detayi</h2>
      <button id="history-detail-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <div class="section-title">Musteri &amp; Arac Bilgileri</div>
    <div class="detail-card">
      <div class="detail-row">
        <span class="detail-label">Musteri Adi</span>
        <span id="hist-customer-name" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Telefon</span>
        <span id="hist-customer-phone" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Plaka</span>
        <span class="detail-value"><span id="hist-plate" class="plate-badge">-</span></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Arac Marka / Model</span>
        <span id="hist-vehicle" class="detail-value">-</span>
      </div>
    </div>

    <div class="section-title">Servis Ziyaretleri</div>
    <div id="history-work-orders-list" class="list-container">
      <!-- Visited work orders list -->
    </div>
  </div>

  <!-- SCREEN: HISTORY WORK ORDER DETAIL (READ ONLY) -->
  <div id="screen-history-wo-detail" class="screen" style="display: none;">
    <div class="header" style="border-bottom: none; margin-bottom: 10px;">
      <h2 style="font-size: 18px; font-weight: 700;">Servis Detayi</h2>
      <button id="history-wo-back-btn" class="btn btn-secondary" style="width: auto; height: 32px; padding: 0 12px; font-size: 13px;">
        <i class="pi pi-arrow-left"></i> Geri Don
      </button>
    </div>

    <div class="detail-card">
      <div class="detail-row">
        <span class="detail-label">Acilis Tarihi</span>
        <span id="hist-wo-date" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Kapanis Tarihi</span>
        <span id="hist-wo-closed-date" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Durum</span>
        <span class="detail-value"><span id="hist-wo-status" class="badge-status">-</span></span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Acan Usta</span>
        <span id="hist-wo-opened-master" class="detail-value">-</span>
      </div>
      <div class="detail-row">
        <span class="detail-label">Kapatan Usta</span>
        <span id="hist-wo-closed-master" class="detail-value">-</span>
      </div>
      <div class="detail-row" style="flex-direction: column; align-items: flex-start; gap: 4px;">
        <span class="detail-label">Sikayet / Aciklama</span>
        <span id="hist-wo-complaint" style="font-weight: 500; font-size: 13.5px; color: var(--text-primary); text-align: left; padding: 4px 0;">-</span>
      </div>
    </div>

    <div class="section-title">Yapilan Isler &amp; Kullanilan Parcalar</div>
    <div id="history-wo-items-container" class="list-container" style="background: var(--bg-card); padding: 12px; border-radius: 10px; border: 1px solid var(--border); margin-bottom: 12px;">
      <!-- Labor & Parts -->
    </div>

<div class="detail-card" style="padding: 12px;">
  <div class="detail-row" style="border: none;">
    <span class="detail-label"
          style="font-size: 15px; font-weight: 700; color: var(--text-primary);">
      Toplam Tutar
    </span>

    <span id="hist-wo-total"
          class="detail-value"
          style="font-size: 16px; font-weight: 700; color: var(--accent);">
      -
    </span>
  </div>
</div>

<div class="section-title"
     style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px;">
  <span>
    <i class="pi pi-camera"></i>
    Servis Fotoğrafları (<span id="hist-photo-count">0</span>)
  </span>
</div>

<div class="card" style="padding: 12px; margin-bottom: 20px;">
  <div id="hist-photo-category-bar"
       style="display: flex; gap: 6px; overflow-x: auto; padding-bottom: 8px; margin-bottom: 10px;">

    <span class="photo-cat-pill active" data-cat="Tümü">
      Tümü (<span id="hist-photo-count-all">0</span>)
    </span>

    <span class="photo-cat-pill" data-cat="Araç Kabul">
      Araç Kabul (<span id="hist-photo-count-reception">0</span>)
    </span>

    <span class="photo-cat-pill" data-cat="Hasar / Çizik">
      Hasar / Çizik (<span id="hist-photo-count-damage">0</span>)
    </span>

    <span class="photo-cat-pill" data-cat="Sökülen Parça">
      Sökülen Parça (<span id="hist-photo-count-removed">0</span>)
    </span>

    <span class="photo-cat-pill" data-cat="Tamir Sonrası">
      Tamir Sonrası (<span id="hist-photo-count-after">0</span>)
    </span>
  </div>

  <div id="hist-wo-photos-list" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px;">
    <div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 12px;">
      Fotoğraf bulunmuyor.
    </div>
  </div>
</div>

</div>

<!-- MODAL: DIGITAL SIGNATURE (ROOT LEVEL) -->
<div id="modal-signature" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.85); z-index: 9999; align-items: center; justify-content: center; padding: 16px;">
  <div class="modal-card" style="background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; width: 100%; max-width: 380px; overflow: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.5);">
    <div class="modal-header" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 16px; border-bottom: 1px solid var(--border);">
      <h3 style="font-size: 16px; font-weight: 700; margin: 0; color: var(--text-primary);"><i class="pi pi-pencil" style="color: var(--accent); margin-right: 6px;"></i> Musteri Imzasi</h3>
      <button class="modal-close-btn" id="close-signature-modal-btn" style="background: transparent; border: none; color: var(--text-secondary); font-size: 24px; cursor: pointer;">&times;</button>
    </div>
    <div class="modal-body" style="padding: 16px; text-align: center;">
      <div style="font-size: 12.5px; color: var(--text-secondary); margin-bottom: 12px;">
        Lutfen ekrandaki kutunun icine parmaginizla imzanizi atin:
      </div>
      <div style="border: 2px dashed var(--accent); border-radius: 12px; background: #ffffff; padding: 4px; touch-action: none; margin-bottom: 14px;">
        <canvas id="signature-canvas" width="320" height="180" style="width: 100%; height: 180px; display: block; border-radius: 8px; cursor: crosshair; touch-action: none;"></canvas>
      </div>
      <div style="display: flex; gap: 10px;">
        <button id="sig-clear-btn" class="btn btn-secondary" type="button" style="flex: 1; height: 42px; font-size: 13.5px;">
          <i class="pi pi-refresh"></i> Temizle
        </button>
        <button id="sig-save-btn" class="btn btn-primary" type="button" style="flex: 1.5; height: 42px; font-size: 13.5px; background: var(--success); color: #000;">
          <i class="pi pi-check"></i> Imzayi Kaydet
        </button>
      </div>
    </div>
  </div>
</div>

<script>
    let activeUser = null;
    let activeToken = localStorage.getItem('mobActiveToken') || null;

    async function authFetch(url, options = {}) {
      const token = activeToken || localStorage.getItem('mobActiveToken') || '';
      options = options || {};
      options.headers = options.headers || {};
      if (token) {
        options.headers['Authorization'] = 'Bearer ' + token;
        options.headers['X-Mobile-Token'] = token;
      }
      const res = await fetch(url, options);
      if (res.status === 401) {
        localStorage.removeItem('mobActiveUser');
        localStorage.removeItem('mobActiveToken');
        activeUser = null;
        activeToken = null;
        showScreen('login');
        throw new Error('Oturum suresi doldu veya yetkisiz erisim.');
      }
      return res;
    }
    let workOrders = [];
    let selectedPart = null;
    let currentTab = 'open';
    
    let historyResults = [];
    let selectedVehicle = null;

    const screens = {
      login: document.getElementById('screen-login'),
      dashboard: document.getElementById('screen-dashboard'),
      details: document.getElementById('screen-details'),
      reception: document.getElementById('screen-new-reception'),
      addLabor: document.getElementById('screen-add-labor'),
      addPart: document.getElementById('screen-add-part'),
      completeOrder: document.getElementById('screen-complete-order'),
      customerHistory: document.getElementById('screen-customer-history'),
      historyDetail: document.getElementById('screen-history-detail'),
      historyWoDetail: document.getElementById('screen-history-wo-detail')
    };

    function showScreen(screenKey) {
      Object.keys(screens).forEach(key => {
        screens[key].style.display = key === screenKey ? 'block' : 'none';
      });
      window.scrollTo(0, 0);
    }

    function escapeHtml(value) {
      return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function tlFormat(val) {
      return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(val || 0);
    }

    function dateFormat(dateStr) {
      if (!dateStr) return '-';
      try {
        const cleanStr = String(dateStr).trim();
        const utcTarih = cleanStr.includes('T')
          ? cleanStr
          : cleanStr.replace(' ', 'T') + 'Z';
        
        const d = new Date(utcTarih);
        if (isNaN(d.getTime())) {
          return dateStr;
        }
        
        return d.toLocaleDateString('tr-TR') + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      } catch (e) {
        return dateStr;
      }
    }

window.addEventListener('DOMContentLoaded', async () => {
  if (window.location.hash) {
    try {
      history.replaceState('', document.title, window.location.pathname + window.location.search);
    } catch (e) {
      window.location.hash = '';
    }
  }

  const urlParams = new URLSearchParams(window.location.search);
  const targetMasterId = urlParams.get('master_id') || urlParams.get('usta') || urlParams.get('master');

  if (targetMasterId) {
    try {
      history.replaceState('', document.title, window.location.pathname);
    } catch (e) {}
    localStorage.removeItem('mobActiveToken');
    localStorage.removeItem('mobActiveUser');
    activeToken = null;
    activeUser = null;
    await loadMasters(targetMasterId);
    showScreen('login');
    return;
  }

  const storedToken = localStorage.getItem('mobActiveToken');
  const storedUser = localStorage.getItem('mobActiveUser');
  if (storedToken && storedUser) {
    try {
      activeToken = storedToken;
      activeUser = JSON.parse(storedUser);
      // Yalnizca token hala gecerli mi diye bakiliyor; asagidaki loadDashboard()
      // zaten istatistikleri kendisi cekiyordu. Bu yuzden agir /api/dashboard
      // yerine sorgusuz /api/session/ping kullaniliyor (ayni .ok semantigi).
      const checkRes = await fetch('/api/session/ping', {
        headers: {
          'Authorization': 'Bearer ' + storedToken,
          'X-Mobile-Token': storedToken
        }
      });
      if (checkRes.ok) {
        const userElem = document.getElementById('user-display-name');
        if (userElem && activeUser.name) {
          userElem.textContent = activeUser.name;
        }
        showScreen('dashboard');
        loadDashboard();
        return;
      }
    } catch (e) {}
  }

  localStorage.removeItem('mobActiveToken');
  localStorage.removeItem('mobActiveUser');
  activeToken = null;
  activeUser = null;
  loadMasters();
  showScreen('login');
});

// Force screen reset on back-forward cache page navigation
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (e) {}
    activeUser = null;
    activeToken = null;
    loadMasters();
    showScreen('login');
  }
});

// Periodic session check to instantly logout phone if session is revoked from desktop
// Not: /api/dashboard yerine /api/session/ping kullanilir. Yoklamanin tek ihtiyaci
// 401 kontrolu; dashboard uc noktasi ise her cagrida tum tablolari tarayan toplama
// sorgulari calistirip masaustu arayuzunu bloke ediyordu.
setInterval(async () => {
  if (activeToken && screens.dashboard.style.display !== 'none') {
    try {
      const pingRes = await fetch('/api/session/ping', {
        headers: {
          'Authorization': 'Bearer ' + activeToken,
          'X-Mobile-Token': activeToken
        }
      });
      if (pingRes.status === 401) {
        localStorage.removeItem('mobActiveUser');
        localStorage.removeItem('mobActiveToken');
        activeUser = null;
        activeToken = null;
        loadMasters();
        showScreen('login');
      }
    } catch (e) {}
  }
}, 4000);

async function loadMasters(selectedMasterId) {
  try {
    const res = await fetch('/api/masters?t=' + Date.now(), {
      cache: 'no-store'
    });

    const data = await res.json();

    const masters = Array.isArray(data)
      ? data
      : Array.isArray(data.masters)
        ? data.masters
        : [];

    const select = document.getElementById('login-master');

    if (!masters.length) {
      select.innerHTML = '<option value="">Usta listesi alinamadi.</option>';
      return;
    }

    const selIdStr = selectedMasterId ? String(selectedMasterId) : '';
    let html = '<option value="" disabled' + (!selIdStr ? ' selected' : '') + '>Lutfen Seciniz</option>';
    html += masters
      .map(m => {
        const isSel = selIdStr && (String(m.id) === selIdStr);
        return '<option value="' + m.id + '"' + (isSel ? ' selected' : '') + '>' + m.name + '</option>';
      })
      .join('');

    select.innerHTML = html;
    if (selIdStr) {
      select.value = selIdStr;
      setTimeout(() => {
        const pinInput = document.getElementById('login-pin');
        if (pinInput) pinInput.focus();
      }, 150);
    }
  } catch (e) {
    console.error('Ustalar yuklenemedi:', e);
    const select = document.getElementById('login-master');
    if (select && select.options.length <= 1) {
      select.innerHTML = '<option value="">Usta listesi alinamadi.</option>';
    }
  }
}

    document.getElementById('login-pin').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('login-btn').click();
      }
    });

    document.getElementById('login-btn').addEventListener('click', async () => {
      const loginBtn = document.getElementById('login-btn');
      const masterId = document.getElementById('login-master').value;
      const pinRaw = document.getElementById('login-pin').value;
      const pin = pinRaw.replace(/\\D/g, '').slice(0, 4);
      const errorDiv = document.getElementById('login-error');
      
      errorDiv.style.display = 'none';

      if (!masterId) {
        errorDiv.textContent = 'Lutfen listeden bir usta secin.';
        errorDiv.style.display = 'block';
        return;
      }

      if (!pin) {
        errorDiv.textContent = 'Lutfen PIN kodunuzu girin.';
        errorDiv.style.display = 'block';
        return;
      }

      loginBtn.disabled = true;
      loginBtn.textContent = 'Giris yapiliyor...';

      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ master_id: masterId, pin })
        });
        const result = await res.json();

        if (result.success) {
          activeUser = result.usta;
          activeToken = result.token;
          localStorage.setItem('mobActiveUser', JSON.stringify(activeUser));
          localStorage.setItem('mobActiveToken', activeToken);
          document.getElementById('user-display-name').textContent = activeUser.name;
          document.getElementById('login-pin').value = '';
          loginBtn.disabled = false;
          loginBtn.textContent = 'Giris Yap';
          showScreen('dashboard');
          loadDashboard();
        } else {
          errorDiv.textContent = result.error || 'Giris basarisiz. PIN yanlis olabilir.';
          errorDiv.style.display = 'block';
          loginBtn.disabled = false;
          loginBtn.textContent = 'Giris Yap';
        }
      } catch (e) {
        errorDiv.textContent = 'Sunucuyla baglanti kurulamadi. Telefon ayarlarinizi kontrol edin.';
        errorDiv.style.display = 'block';
        loginBtn.disabled = false;
        loginBtn.textContent = 'Giris Yap';
      }
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
      if (confirm('Cikis yapmak istediginize emin misiniz?')) {
        localStorage.removeItem('mobActiveUser');
        localStorage.removeItem('mobActiveToken');
        activeUser = null;
        activeToken = null;
        currentTab = 'open';
        loadMasters();
        showScreen('login');
      }
    });

    document.getElementById('refresh-dashboard-btn').addEventListener('click', () => {
      loadDashboard();
    });

    document.getElementById('tab-open').addEventListener('click', () => {
      if (currentTab === 'open') return;
      currentTab = 'open';
      document.getElementById('search-input').value = '';
      loadTabOrders();
    });

    document.getElementById('tab-completed').addEventListener('click', () => {
      if (currentTab === 'completed') return;
      currentTab = 'completed';
      document.getElementById('search-input').value = '';
      loadTabOrders();
    });

    function updateTabVisuals() {
      const openBtn = document.getElementById('tab-open');
      const compBtn = document.getElementById('tab-completed');
      const lbl = document.getElementById('list-title-lbl');
      if (currentTab === 'open') {
        openBtn.className = 'tab-btn active';
        openBtn.style.background = 'var(--bg-active)';
        openBtn.style.color = 'var(--accent)';
        
        compBtn.className = 'tab-btn';
        compBtn.style.background = 'transparent';
        compBtn.style.color = 'var(--text-secondary)';
        
        if (lbl) lbl.textContent = 'Acik Is Emirleri';
      } else {
        compBtn.className = 'tab-btn active';
        compBtn.style.background = 'var(--bg-active)';
        compBtn.style.color = 'var(--accent)';
        
        openBtn.className = 'tab-btn';
        openBtn.style.background = 'transparent';
        openBtn.style.color = 'var(--text-secondary)';
        
        if (lbl) lbl.textContent = 'Tamamlanan Is Emirleri';
      }
    }

    async function loadDashboard() {
      try {
        const statsRes = await authFetch('/api/dashboard');
        const stats = await statsRes.json();
        
        document.getElementById('stat-open').textContent = stats.acikIsEmri || 0;
        document.getElementById('stat-open-sub').textContent = 'Tamamlanan: ' + (stats.tamamlananIsEmri || 0);

        document.getElementById('stat-customers').textContent = stats.musteriAktif || 0;
        document.getElementById('stat-customers-sub').textContent = 'Toplam: ' + (stats.musteriToplam || 0);

        document.getElementById('stat-vehicles').textContent = stats.aracAktif || 0;
        document.getElementById('stat-vehicles-sub').textContent = 'Tamamlanan: ' + (stats.aracToplam || 0);

        document.getElementById('stat-parts').textContent = stats.toplamStok || 0;
        document.getElementById('stat-parts-sub').textContent = 'Kritik: ' + (stats.dusukStok || 0) + '  Biten: ' + (stats.bitenStok || 0);

        await loadTabOrders();
        loadDailySummary();
        loadCriticalParts();
      } catch (e) {
        console.error('Yukleme hatasi:', e);
      }
    }

    async function loadDailySummary() {
      try {
        const res = await authFetch('/api/daily-summary');
        const data = await res.json();
        if (!data || !data.success) return;

        document.getElementById('ds-total').textContent = tlFormat(data.toplamTahsilat) + ' (' + (data.tahsilatSayisi || 0) + ' islem)';
        document.getElementById('ds-cash').textContent = tlFormat(data.yontemTahsilat && data.yontemTahsilat.nakit);
        document.getElementById('ds-card').textContent = tlFormat(data.yontemTahsilat && data.yontemTahsilat.kart);
        document.getElementById('ds-transfer').textContent = tlFormat(data.yontemTahsilat && data.yontemTahsilat.havale);
        document.getElementById('ds-out').textContent = tlFormat(data.toplamCikis);
        document.getElementById('ds-expected').textContent = tlFormat(data.beklenenNakit);
        document.getElementById('ds-wo').textContent = (data.isEmri ? data.isEmri.acilan : 0) + ' / ' + (data.isEmri ? data.isEmri.kapanan : 0);

        const st = document.getElementById('ds-status');
        if (data.kapatildi) {
          st.textContent = 'Gun Kapatildi';
          st.style.background = 'rgba(16, 185, 129, 0.15)';
          st.style.color = '#34d399';
        } else {
          st.textContent = 'Gun Acik';
          st.style.background = 'rgba(245, 158, 11, 0.15)';
          st.style.color = '#f59e0b';
        }

        document.getElementById('daily-summary-card').style.display = 'block';
      } catch (e) {
        console.error('Gun sonu ozeti yuklenemedi:', e);
      }
    }

    async function loadCriticalParts() {
      try {
        const res = await authFetch('/api/parts/critical');
        const data = await res.json();
        if (!data || !data.success) return;

        const wrap = document.getElementById('critical-parts-wrap');
        const list = document.getElementById('critical-parts-list');
        const parcalar = data.parcalar || [];

        if (parcalar.length === 0) {
          wrap.style.display = 'none';
          return;
        }

        document.getElementById('critical-count').textContent = parcalar.length;
        list.innerHTML = parcalar.map(function(p) {
          const stok = Number(p.stock) || 0;
          const renk = stok <= 0 ? '#f87171' : '#f59e0b';
          return '<div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px;">' +
            '<div style="min-width: 0;">' +
              '<div style="font-weight: 600; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' + escapeHtml(p.name || p.code || '-') + '</div>' +
              '<div style="font-size: 11.5px; color: var(--text-secondary);">' + escapeHtml(p.code || '') + (p.brand ? ' - ' + escapeHtml(p.brand) : '') + '</div>' +
            '</div>' +
            '<div style="flex-shrink: 0; font-weight: 700; color: ' + renk + ';">' + stok + ' ' + escapeHtml(p.unit || 'Adet') + '</div>' +
          '</div>';
        }).join('');
        if (list.lastElementChild) list.lastElementChild.style.borderBottom = 'none';

        wrap.style.display = 'block';
      } catch (e) {
        console.error('Kritik stok yuklenemedi:', e);
      }
    }

    async function loadTabOrders() {
      const container = document.getElementById('orders-list');
      if (container) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 14px;">Yukleniyor...</div>';
      }
      updateTabVisuals();
      try {
        const url = currentTab === 'open' ? '/api/work-orders' : '/api/work-orders/completed';
        const listRes = await authFetch(url, {
  cache: 'no-store'
});

const data = await listRes.json();
workOrders = Array.isArray(data) ? data : [];

renderWorkOrders(workOrders);
      } catch (e) {
        console.error('Is emirleri yukleme hatasi:', e);
        if (container) {
          container.innerHTML = '<div style="text-align: center; color: var(--warning); padding: 20px; font-size: 14px;">Liste yuklenemedi.</div>';
        }
      }
    }

    function renderWorkOrders(list) {
      const container = document.getElementById('orders-list');
      document.getElementById('open-count-lbl').textContent = list.length;

      if (list.length === 0) {
        const msg = currentTab === 'open' ? 'Acik is emri bulunamadi.' : 'Tamamlanan is emri bulunamadi.';
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 20px; font-size: 14px;">' + msg + '</div>';
        return;
      }

      container.innerHTML = list.map(item => {
const tamamlandi = item.status === 'Tamamlandı';

const badgeClass = tamamlandi ? 'tamamlandi' : 'acik';
const badgeText = tamamlandi
  ? 'Tamamlandi'
  : (item.status || 'Acik');
        return '<div class="list-item" onclick="viewDetails(' + item.id + ')">' +
          '<div class="item-header">' +
            '<span class="plate-badge">' + escapeHtml(item.plate || 'PLAKASIZ') + '</span>' +
            '<span class="item-price">' + tlFormat(item.total_price) + '</span>' +
          '</div>' +
          '<div class="item-desc">' + escapeHtml(item.description || 'Aciklama girilmemis.') + '</div>' +
          '<div class="item-info">' +
            '<i class="pi pi-user" style="font-size: 11px;"></i> ' + escapeHtml(item.customer_name || 'Musteri Belirtilmemis') + '<br>' +
            '<i class="pi pi-tag" style="font-size: 11px;"></i> ' + escapeHtml(item.brand || '') + ' ' + escapeHtml(item.model || '') +
          '</div>' +
          '<div class="item-header" style="margin-top: 4px;">' +
            '<span class="badge-status ' + badgeClass + '">' + badgeText + '</span>' +
            '<span style="font-size: 11px; color: var(--text-muted);">' + dateFormat(item.created_at) + '</span>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    document.getElementById('search-input').addEventListener('input', (e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        renderWorkOrders(workOrders);
        return;
      }

      const filtered = workOrders.filter(w => 
        (w.plate || '').toLowerCase().includes(query) ||
        (w.customer_name || '').toLowerCase().includes(query) ||
        (w.customer_phone || '').toLowerCase().includes(query) ||
        (w.description || '').toLowerCase().includes(query) ||
        (w.brand || '').toLowerCase().includes(query) ||
        (w.model || '').toLowerCase().includes(query)
      );
      renderWorkOrders(filtered);
    });

    async function viewDetails(id) {
      try {
        const res = await authFetch('/api/work-orders/' + id, {
  cache: 'no-store'
});
        const data = await res.json();
        
        if (!data.success) {
          alert('Is emri detaylari yuklenemedi.');
          return;
        }

        const wo = data.workOrder;
        const items = data.items || [];

        // Save order ID onto back button for reference
        document.getElementById('detail-back-btn').dataset.orderId = id;

        document.getElementById('det-plate').textContent = wo.plate || 'PLAKASIZ';
        document.getElementById('det-customer').textContent = wo.customer_name || 'Musteri Belirtilmemis';
        document.getElementById('det-phone').textContent = wo.customer_phone || '-';
        document.getElementById('det-vehicle').textContent = (wo.brand || '') + ' ' + (wo.model || '');
        document.getElementById('det-master').textContent = wo.master_name || '-';
        document.getElementById('det-date').textContent = dateFormat(wo.created_at);
        document.getElementById('det-closed-master').textContent = wo.closed_master_name || '-';
        document.getElementById('det-closed-date').textContent = wo.closed_at ? dateFormat(wo.closed_at) : 'Henüz kapanmadı';
        const statusText = wo.status === 'Açık' ? 'Acik' : (wo.status === 'Tamamlandı' ? 'Tamamlandi' : (wo.status || 'Acik'));
        const statusBadge = document.getElementById('det-status');
        statusBadge.textContent = statusText;
        if (wo.status !== 'Tamamlandı') {
          statusBadge.className = 'badge-status acik';
          document.getElementById('detail-actions-wrapper').style.display = 'flex';
        } else {
          statusBadge.className = 'badge-status tamamlandi';
          document.getElementById('detail-actions-wrapper').style.display = 'none';
        }
        document.getElementById('det-desc').textContent = wo.description || 'Aciklama girilmemis.';
        document.getElementById('det-total').textContent = tlFormat(wo.total_price);

        currentWorkOrderId = id;
        const sigStatus = document.getElementById('det-signature-status');
        const sigImg = document.getElementById('det-signature-img');
        const sigContainer = document.getElementById('det-signature-container');

        if (wo.customer_signature) {
          if (sigStatus) {
            sigStatus.className = 'badge-status tamamlandi';
            sigStatus.textContent = 'Imza Alindi';
          }
          if (sigImg) sigImg.src = wo.customer_signature;
          if (sigContainer) sigContainer.style.display = 'block';
        } else {
          if (sigStatus) {
            sigStatus.className = 'badge-status acik';
            sigStatus.textContent = 'Imza Bekleniyor';
          }
          if (sigContainer) sigContainer.style.display = 'none';
        }

        const itemsList = document.getElementById('det-items-list');
        if (items.length === 0) {
          itemsList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 10px; font-size: 13px;">Yapilan islem / parca kaydi bulunmuyor.</div>';
        } else {
        itemsList.innerHTML = items.map(item => {
          return '<div class="item-row">' +
            '<div class="item-row-header">' +
              '<span>' + escapeHtml(item.description || 'Isimsiz Kalem') + '</span>' +
              '<span class="color-accent">' + tlFormat(item.total_price) + '</span>' +
            '</div>' +
            '<div class="item-row-sub">' +
              '<span>' + (item.type === 'Parça' || item.type === 'Parca' ? 'Yedek Parca' : 'Iscilik') + '</span>' +
              '<span>' + item.quantity + ' ' + (item.type === 'Parça' || item.type === 'Parca' ? 'Adet' : 'Saat') + ' x ' + tlFormat(item.unit_price) + '</span>' +
            '</div>' +
          '</div>';
        }).join('');
        }

        await loadOrderPhotos(id);
        showScreen('details');
      } catch (e) {
        console.error('Detay yukleme hatasi:', e);
        alert('Sunucu hatasi.');
      }
    }

let currentPhotoFilter = 'Tümü';
let currentPhotoCategory = 'Araç Kabul';
let mobilePhotos = [];

document.querySelectorAll('.photo-cat-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.photo-cat-pill').forEach(p => {
      p.classList.remove('active');
    });

    pill.classList.add('active');

    const selectedCategory = pill.dataset.cat || 'Tümü';
    currentPhotoFilter = selectedCategory;

    // Tümü yalnızca filtre içindir, fotoğraf kategorisi olarak kaydedilmez.
    if (selectedCategory !== 'Tümü') {
      currentPhotoCategory = selectedCategory;
    }

    renderMobilePhotos();
  });
});

    document.getElementById('det-take-photo-btn').addEventListener('click', () => {
      document.getElementById('mobile-photo-file').click();
    });

    document.getElementById('mobile-photo-file').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;

      const orderId = document.getElementById('detail-back-btn').dataset.orderId;
      if (!orderId) return;

      try {
        const base64Data = await compressAndBase64(file);
        const res = await authFetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            work_order_id: orderId,
            category: currentPhotoCategory,
            image_base64: base64Data
          })
        });
        const data = await res.json();
        if (data.success) {
          e.target.value = '';
          await loadOrderPhotos(orderId);
        } else {
          alert(data.error || 'Fotoğraf yüklenemedi.');
        }
      } catch (err) {
        console.error('Fotoğraf yükleme hatası:', err);
        alert('Fotoğraf yüklenirken hata oluştu.');
      }
    });

function updateMobilePhotoCounts() {
  const counts = {
    all: mobilePhotos.length,
    reception: mobilePhotos.filter(p => p.category === 'Araç Kabul').length,
    damage: mobilePhotos.filter(p => p.category === 'Hasar / Çizik').length,
    removed: mobilePhotos.filter(p => p.category === 'Sökülen Parça').length,
    after: mobilePhotos.filter(p => p.category === 'Tamir Sonrası').length
  };

  const allElem = document.getElementById('photo-count-all');
  const receptionElem = document.getElementById('photo-count-reception');
  const damageElem = document.getElementById('photo-count-damage');
  const removedElem = document.getElementById('photo-count-removed');
  const afterElem = document.getElementById('photo-count-after');

  if (allElem) allElem.textContent = counts.all;
  if (receptionElem) receptionElem.textContent = counts.reception;
  if (damageElem) damageElem.textContent = counts.damage;
  if (removedElem) removedElem.textContent = counts.removed;
  if (afterElem) afterElem.textContent = counts.after;
}

function renderMobilePhotos() {
  const container = document.getElementById('det-photos-list');
  const countLbl = document.getElementById('det-photo-count');
  const orderId = document.getElementById('detail-back-btn').dataset.orderId;

  if (!container) return;

  updateMobilePhotoCounts();

  if (countLbl) {
    countLbl.textContent = mobilePhotos.length;
  }

  const filteredPhotos = currentPhotoFilter === 'Tümü'
    ? mobilePhotos
    : mobilePhotos.filter(p => p.category === currentPhotoFilter);

  if (filteredPhotos.length === 0) {
    container.innerHTML =
      '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 12px; font-size: 12px;">' +
      'Bu kategoride fotoğraf bulunmuyor.' +
      '</div>';
    return;
  }

  container.innerHTML = filteredPhotos.map(p => {
    const safeCategory = String(p.category || 'Araç Kabul')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return '<div style="position: relative; background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">' +
      '<img src="' + p.url + '" style="width: 100%; height: 110px; object-fit: cover; display: block; cursor: pointer;" onclick="viewFullPhoto(this.src)" />' +
      '<div style="padding: 4px 6px; font-size: 10.5px; display: flex; justify-content: space-between; align-items: center; background: rgba(15,23,42,0.85); color: var(--text-primary);">' +
        '<span style="font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">' +
          safeCategory +
        '</span>' +
        '<button style="background: none; border: none; color: #f87171; font-size: 12px; cursor: pointer; padding: 2px;" onclick="deleteMobilePhoto(' + p.id + ',' + orderId + ')">' +
          '<i class="pi pi-trash"></i>' +
        '</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function loadOrderPhotos(orderId) {
  const container = document.getElementById('det-photos-list');

  if (!container) return;

  container.innerHTML =
    '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 10px; font-size: 12px;">' +
    'Fotoğraflar yükleniyor...' +
    '</div>';

  try {
    const res = await authFetch(
      '/api/work-order-photos?work_order_id=' + orderId,
      { cache: 'no-store' }
    );

    const data = await res.json();

    mobilePhotos =
      data.success && Array.isArray(data.fotograflar)
        ? data.fotograflar
        : [];

    renderMobilePhotos();
  } catch (e) {
    console.error('Fotoğraflar okunamadı:', e);
    mobilePhotos = [];

    container.innerHTML =
      '<div style="grid-column: 1 / -1; text-align: center; color: var(--warning); padding: 10px; font-size: 12px;">' +
      'Fotoğraflar alınamadı.' +
      '</div>';
  }
}

    async function deleteMobilePhoto(photoId, orderId) {
      if (!confirm('Bu fotoğrafı silmek istediğinize emin misiniz?')) return;
      try {
        const res = await authFetch('/api/delete-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photo_id: photoId })
        });
        const data = await res.json();
        if (data.success) {
          await loadOrderPhotos(orderId);
        } else {
          alert(data.error || 'Fotoğraf silinemedi.');
        }
      } catch (e) {
        alert('Fotoğraf silinirken hata oluştu.');
      }
    }

    function viewFullPhoto(url) {
      const modal = document.createElement('div');
      modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
      modal.onclick = () => document.body.removeChild(modal);
      const img = document.createElement('img');
      img.src = url;
      img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;';
      modal.appendChild(img);
      document.body.appendChild(modal);
    }

    function compressAndBase64(file, maxWidth = 1280, quality = 0.75) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            if (width > maxWidth || height > maxWidth) {
              if (width > height) {
                height = Math.round((height * maxWidth) / width);
                width = maxWidth;
              } else {
                width = Math.round((width * maxWidth) / height);
                height = maxWidth;
              }
            }
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
const dataUrl = canvas.toDataURL('image/jpeg', quality);
resolve(dataUrl);
            resolve(dataUrl);
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // Work order item remover
    async function removeItemFromOrder(itemId, desc) {
      alert('Mobilde kalem silme simdilik kapali.');
    }

    document.getElementById('detail-back-btn').addEventListener('click', () => {
      showScreen('dashboard');
      loadDashboard();
    });

    // ─── COMPLETE + PAYMENT FLOW ───
    let completeCtx = { orderId: null, kalanBorc: 0 };

    async function isEmriTamamlaGonder(paymentOption, amount, method) {
      const res = await authFetch('/api/work-orders/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          work_order_id: completeCtx.orderId,
          master_id: activeUser.id,
          payment_option: paymentOption,
          amount: amount,
          payment_method: method
        })
      });
      return await res.json();
    }

    function coOptionGuncelle() {
      const opt = document.getElementById('co-option').value;
      const amountWrap = document.getElementById('co-amount-wrap');
      const methodWrap = document.getElementById('co-method-wrap');
      const amountInput = document.getElementById('co-amount');

      if (opt === 'none') {
        amountWrap.style.display = 'none';
        methodWrap.style.display = 'none';
      } else if (opt === 'full') {
        amountWrap.style.display = 'block';
        methodWrap.style.display = 'block';
        amountInput.value = completeCtx.kalanBorc.toFixed(2);
        amountInput.disabled = true;
      } else {
        amountWrap.style.display = 'block';
        methodWrap.style.display = 'block';
        amountInput.value = '';
        amountInput.disabled = false;
      }
    }

    document.getElementById('co-option').addEventListener('change', coOptionGuncelle);

    document.getElementById('complete-back-btn').addEventListener('click', () => {
      showScreen('details');
    });

    document.getElementById('complete-order-btn').addEventListener('click', async () => {
      const curId = document.getElementById('detail-back-btn').dataset.orderId;
      if (!activeUser || !activeUser.id) {
        alert('Kapatacak usta bilgisi bulunamadi. Lutfen cikis yapip tekrar girin.');
        return;
      }

      completeCtx.orderId = curId;

      let kalanBorc = 0;
      try {
        const res = await authFetch('/api/work-orders/payment-summary?work_order_id=' + encodeURIComponent(curId));
        const data = await res.json();
        if (data && data.success) {
          kalanBorc = Number(data.kalan_borc) || 0;
          document.getElementById('co-total').textContent = tlFormat(data.total_price);
          document.getElementById('co-paid').textContent = tlFormat(data.toplam_tahsilat);
          document.getElementById('co-remaining').textContent = tlFormat(data.kalan_borc);
        }
      } catch (e) {
        console.error('Odeme ozeti alinamadi:', e);
      }

      completeCtx.kalanBorc = kalanBorc;

      // Kalan borc yoksa odeme adimina gerek yok: eski hizli onay akisi
      if (kalanBorc <= 0.01) {
        const ustaName = activeUser.name || 'Bilinmeyen Usta';
        if (!confirm('Bu is emrini ' + ustaName + ' adina tamamlandi olarak kapatmak istiyor musunuz?')) {
          return;
        }
        try {
          const result = await isEmriTamamlaGonder('none', 0, 'Nakit');
          if (result.success) {
            showScreen('dashboard');
            loadDashboard();
          } else {
            alert(result.error || 'Is emri kapatilamadi.');
          }
        } catch (e) {
          alert('Sunucuyla baglanti kurulamadi.');
        }
        return;
      }

      // Kalan borc var: odeme ekranini ac
      document.getElementById('co-error').textContent = '';
      document.getElementById('co-error').style.display = 'none';
      document.getElementById('co-option').value = 'full';
      coOptionGuncelle();
      showScreen('completeOrder');
    });

    document.getElementById('co-save-btn').addEventListener('click', async () => {
      const errorBox = document.getElementById('co-error');
      errorBox.style.display = 'none';

      const opt = document.getElementById('co-option').value;
      const method = document.getElementById('co-method').value;
      let amount = 0;

      if (opt === 'partial') {
        amount = Number(document.getElementById('co-amount').value) || 0;
        if (amount <= 0) {
          errorBox.textContent = 'Kismi odeme icin gecerli bir tutar girin.';
          errorBox.style.display = 'block';
          return;
        }
        if (amount > completeCtx.kalanBorc + 0.01) {
          errorBox.textContent = 'Odeme tutari kalan borctan buyuk olamaz.';
          errorBox.style.display = 'block';
          return;
        }
      }

      const saveBtn = document.getElementById('co-save-btn');
      saveBtn.disabled = true;
      try {
        const result = await isEmriTamamlaGonder(opt, amount, method);
        if (result.success) {
          showScreen('dashboard');
          loadDashboard();
        } else {
          errorBox.textContent = result.error || 'Is emri kapatilamadi.';
          errorBox.style.display = 'block';
        }
      } catch (e) {
        errorBox.textContent = 'Sunucuyla baglanti kurulamadi.';
        errorBox.style.display = 'block';
      } finally {
        saveBtn.disabled = false;
      }
    });

    // ─── CUSTOMER HISTORY FLOW ───
    document.getElementById('customer-history-btn').addEventListener('click', () => {
      document.getElementById('history-search-input').value = '';
      document.getElementById('history-results').innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Arama yapmak icin plaka, musteri adi veya telefon girin.</div>';
      showScreen('customerHistory');
    });

    document.getElementById('history-back-btn').addEventListener('click', () => {
      showScreen('dashboard');
    });

    let historySearchTimeout = null;
    document.getElementById('history-search-input').addEventListener('input', (e) => {
      const query = e.target.value.trim();
      if (historySearchTimeout) clearTimeout(historySearchTimeout);
      
      if (query.length < 2) {
        document.getElementById('history-results').innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Arama yapmak icin en az 2 karakter girin.</div>';
        return;
      }

      historySearchTimeout = setTimeout(async () => {
        document.getElementById('history-loading').style.display = 'block';
        try {
          const res = await authFetch('/api/customer-history/search?query=' + encodeURIComponent(query));
          const data = await res.json();
          document.getElementById('history-loading').style.display = 'none';
          if (data.success) {
            historyResults = data.results || [];
            renderHistoryResults();
          } else {
            document.getElementById('history-results').innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-danger);">Arama hatasi: ' + (data.error || 'Bilinmeyen hata') + '</div>';
          }
        } catch (err) {
          document.getElementById('history-loading').style.display = 'none';
          document.getElementById('history-results').innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-danger);">Sunucu baglanti hatasi.</div>';
        }
      }, 300);
    });

    function renderHistoryResults() {
      const container = document.getElementById('history-results');
      if (historyResults.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Sonuc bulunamadi.</div>';
        return;
      }

      container.innerHTML = historyResults.map((item, idx) => {
        const dateStr = item.last_visit_date ? dateFormat(item.last_visit_date) : 'Yok';
        return '<div class="order-card" onclick="viewHistoryDetail(' + idx + ')" style="cursor: pointer; margin-bottom: 10px;">' +
          '<div class="order-header">' +
            '<span class="plate-badge">' + escapeHtml(item.plate || 'PLAKASIZ') + '</span>' +
            '<span style="font-size: 12px; color: var(--text-secondary);">Son Islem: ' + dateStr + '</span>' +
          '</div>' +
          '<div class="order-meta" style="margin-top: 6px;">' +
            '<div><i class="pi pi-user"></i> <strong>' + escapeHtml(item.customer_name || '') + '</strong></div>' +
            '<div style="font-size: 12px; margin-top: 3px;"><i class="pi pi-phone"></i> ' + escapeHtml(item.customer_phone || '-') + '</div>' +
            '<div style="font-size: 12px; margin-top: 3px;"><i class="pi pi-car"></i> ' + escapeHtml(item.brand || '') + ' ' + escapeHtml(item.model || '') + '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    window.viewHistoryDetail = function(idx) {
      const item = historyResults[idx];
      if (!item) return;
      selectedVehicle = item;
      
      document.getElementById('hist-customer-name').textContent = item.customer_name;
      document.getElementById('hist-customer-phone').textContent = item.customer_phone || '-';
      document.getElementById('hist-plate').textContent = item.plate;
      document.getElementById('hist-vehicle').textContent = (item.brand || '') + ' ' + (item.model || '');

      const woList = document.getElementById('history-work-orders-list');
      const workOrders = item.workOrders || [];
      if (workOrders.length === 0) {
        woList.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-secondary);">Bu arac icin gecmis is emri bulunamadi.</div>';
      } else {
        woList.innerHTML = workOrders.map((wo, wIdx) => {
          const statusClass = wo.status === 'Tamamlandı' ? 'badge-status tamamlandi' : 'badge-status acik';
          const statusText = wo.status === 'Tamamlandı' ? 'Tamamlandi' : 'Acik';
          return '<div class="order-card" onclick="viewHistoryWorkOrderDetail(' + wIdx + ')" style="cursor: pointer; margin-bottom: 10px;">' +
            '<div class="order-header">' +
              '<span class="status-badge ' + statusClass + '">' + statusText + '</span>' +
              '<span style="font-size: 12.5px; font-weight: 700; color: var(--accent);">' + tlFormat(wo.total_amount) + '</span>' +
            '</div>' +
            '<div class="order-meta" style="margin-top: 6px;">' +
              '<div><strong>Tarih:</strong> ' + dateFormat(wo.created_at) + '</div>' +
              '<div style="font-size: 12.5px; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 250px;">' +
                '<strong>Sikayet:</strong> ' + (wo.complaint || '-') +
              '</div>' +
              '<div style="font-size: 12px; margin-top: 5px; color: var(--text-secondary);">' +
  '<i class="pi pi-camera"></i> ' +
  Number(wo.photo_count || 0) +
  ' fotoğraf' +
'</div>' +
            '</div>' +
          '</div>';
        }).join('');
      }
      showScreen('historyDetail');
    };

    document.getElementById('history-detail-back-btn').addEventListener('click', () => {
      showScreen('customerHistory');
    });
let historyWorkOrderPhotos = [];
let historyPhotoFilter = 'Tümü';

function normalizeHistoryPhotoCategory(category) {
  const cat = String(category || 'Araç Kabul').trim();

  if (
    cat === 'Ön' ||
    cat === 'Arka' ||
    cat === 'Sol' ||
    cat === 'Sağ' ||
    cat === 'KM / Gösterge'
  ) {
    return 'Araç Kabul';
  }

  if (cat === 'Hasar / Diğer') {
    return 'Hasar / Çizik';
  }

  if (
    cat === 'Araç Kabul' ||
    cat === 'Hasar / Çizik' ||
    cat === 'Sökülen Parça' ||
    cat === 'Tamir Sonrası'
  ) {
    return cat;
  }

  return 'Araç Kabul';
}

function escapeHistoryPhotoText(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function resetHistoryPhotoFilter() {
  historyPhotoFilter = 'Tümü';

  document
    .querySelectorAll('#hist-photo-category-bar .photo-cat-pill')
    .forEach(function(pill) {
      pill.classList.toggle(
        'active',
        pill.dataset.cat === 'Tümü'
      );
    });
}

function updateHistoryPhotoCounts() {
  const allCount = historyWorkOrderPhotos.length;

  const receptionCount = historyWorkOrderPhotos.filter(function(photo) {
    return photo.category === 'Araç Kabul';
  }).length;

  const damageCount = historyWorkOrderPhotos.filter(function(photo) {
    return photo.category === 'Hasar / Çizik';
  }).length;

  const removedCount = historyWorkOrderPhotos.filter(function(photo) {
    return photo.category === 'Sökülen Parça';
  }).length;

  const afterCount = historyWorkOrderPhotos.filter(function(photo) {
    return photo.category === 'Tamir Sonrası';
  }).length;

  document.getElementById('hist-photo-count').textContent = allCount;
  document.getElementById('hist-photo-count-all').textContent = allCount;
  document.getElementById('hist-photo-count-reception').textContent = receptionCount;
  document.getElementById('hist-photo-count-damage').textContent = damageCount;
  document.getElementById('hist-photo-count-removed').textContent = removedCount;
  document.getElementById('hist-photo-count-after').textContent = afterCount;
}

function renderHistoryWorkOrderPhotos() {
  const container = document.getElementById('hist-wo-photos-list');

  updateHistoryPhotoCounts();

  const visiblePhotos =
    historyPhotoFilter === 'Tümü'
      ? historyWorkOrderPhotos
      : historyWorkOrderPhotos.filter(function(photo) {
          return photo.category === historyPhotoFilter;
        });

  if (visiblePhotos.length === 0) {
    container.innerHTML =
      '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 14px; font-size: 12px;">' +
        'Bu kategoride fotoğraf bulunmuyor.' +
      '</div>';

    return;
  }

  container.innerHTML = visiblePhotos.map(function(photo) {
    const safeCategory = escapeHistoryPhotoText(photo.category);
    const safeNote = escapeHistoryPhotoText(photo.note);

    return (
      '<div style="background: rgba(0,0,0,0.3); border-radius: 8px; overflow: hidden; border: 1px solid var(--border);">' +

        '<img src="' + photo.url + '"' +
          ' style="width: 100%; height: 110px; object-fit: cover; display: block; cursor: pointer;"' +
          ' onclick="viewFullPhoto(this.src)" />' +

        '<div style="padding: 6px; background: rgba(15,23,42,0.9);">' +

          '<div style="font-size: 11px; font-weight: 700; color: var(--accent);">' +
            safeCategory +
          '</div>' +

          (safeNote
            ? '<div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 3px;">' +
                safeNote +
              '</div>'
            : '') +

        '</div>' +
      '</div>'
    );
  }).join('');
}

async function loadHistoryWorkOrderPhotos(workOrderId) {
  const container = document.getElementById('hist-wo-photos-list');

  historyWorkOrderPhotos = [];
  resetHistoryPhotoFilter();
  updateHistoryPhotoCounts();

  container.innerHTML =
    '<div style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary); padding: 14px;">' +
      'Fotoğraflar yükleniyor...' +
    '</div>';

  try {
    const res = await authFetch(
      '/api/work-order-photos?work_order_id=' + workOrderId,
      { cache: 'no-store' }
    );

    const data = await res.json();

    if (!data.success) {
      throw new Error(data.error || 'Fotoğraflar alınamadı.');
    }

    historyWorkOrderPhotos = Array.isArray(data.fotograflar)
      ? data.fotograflar
          .filter(function(photo) {
            return Boolean(photo.url);
          })
          .map(function(photo) {
            return {
              id: photo.id,
              url: photo.url,
              note: photo.note || '',
              created_at: photo.created_at,
              category: normalizeHistoryPhotoCategory(photo.category)
            };
          })
      : [];

    renderHistoryWorkOrderPhotos();
  } catch (error) {
    console.error('Geçmiş fotoğrafları yükleme hatası:', error);

    container.innerHTML =
      '<div style="grid-column: 1 / -1; text-align: center; color: var(--warning); padding: 14px;">' +
        'Fotoğraflar alınamadı.' +
      '</div>';
  }
}

document
  .querySelectorAll('#hist-photo-category-bar .photo-cat-pill')
  .forEach(function(pill) {
    pill.addEventListener('click', function() {
      document
        .querySelectorAll('#hist-photo-category-bar .photo-cat-pill')
        .forEach(function(otherPill) {
          otherPill.classList.remove('active');
        });

      pill.classList.add('active');
      historyPhotoFilter = pill.dataset.cat || 'Tümü';

      renderHistoryWorkOrderPhotos();
    });
  });
    window.viewHistoryWorkOrderDetail = async function(wIdx) {
      if (!selectedVehicle) return;
      const wo = selectedVehicle.workOrders[wIdx];
      if (!wo) return;
      
      document.getElementById('hist-wo-date').textContent = dateFormat(wo.created_at);
      document.getElementById('hist-wo-closed-date').textContent = wo.closed_at ? dateFormat(wo.closed_at) : 'Henüz kapanmadı';
      const statusClass = wo.status === 'Tamamlandı' ? 'badge-status tamamlandi' : 'badge-status acik';
      const statusText = wo.status === 'Tamamlandı' ? 'Tamamlandi' : 'Acik';
      const statusSpan = document.getElementById('hist-wo-status');
      statusSpan.className = statusClass;
      statusSpan.textContent = statusText;
      
      document.getElementById('hist-wo-opened-master').textContent = wo.opened_by_master_name || '-';
      document.getElementById('hist-wo-closed-master').textContent = wo.closed_by_master_name || '-';
      document.getElementById('hist-wo-complaint').textContent = wo.complaint || '-';
      document.getElementById('hist-wo-total').textContent = tlFormat(wo.total_amount);
      loadHistoryWorkOrderPhotos(wo.work_order_id);

      const itemsContainer = document.getElementById('history-wo-items-container');
      itemsContainer.innerHTML = '<div style="text-align: center; padding: 10px; color: var(--text-secondary);">Yukleniyor...</div>';

      try {
        const res = await authFetch('/api/work-orders/' + wo.work_order_id);
        const data = await res.json();
        if (data.success) {
          const items = data.items || [];
          if (items.length === 0) {
            itemsContainer.innerHTML = '<div style="text-align: center; color: var(--text-secondary);">Bu is emrinde kayitli is/parca yok.</div>';
          } else {
            itemsContainer.innerHTML = items.map(it => {
              const isPart = !!it.part_id;
              const icon = isPart ? 'pi pi-cog' : 'pi pi-user';
              const label = isPart ? '[PARCA] ' + escapeHtml(it.name) : '[ISCILIK] ' + escapeHtml(it.name);
              const qtyStr = isPart ? it.qty + ' adet' : '1 adet';
              return '<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px;">' +
                '<div style="display: flex; flex-direction: column; gap: 2px;">' +
                  '<span style="font-weight: 600; color: var(--text-primary);"><i class="' + icon + '" style="font-size: 11px;"></i> ' + label + '</span>' +
                  '<span style="font-size: 11px; color: var(--text-secondary);">' + qtyStr + ' x ' + tlFormat(it.price) + '</span>' +
                '</div>' +
                '<span style="font-weight: 700; color: var(--text-primary);">' + tlFormat(it.qty * it.price) + '</span>' +
              '</div>';
            }).join('');
          }
        } else {
          itemsContainer.innerHTML = '<div style="text-align: center; color: var(--text-danger);">Yukleme hatasi.</div>';
        }
      } catch (e) {
        itemsContainer.innerHTML = '<div style="text-align: center; color: var(--text-danger);">Baglanti hatasi.</div>';
      }

      showScreen('historyWoDetail');
    };

    document.getElementById('history-wo-back-btn').addEventListener('click', () => {
      showScreen('historyDetail');
    });

    // ─── NEW RECEPTION FLOW ───
    document.getElementById('new-reception-btn').addEventListener('click', () => {
      document.getElementById('reception-form').reset();
      document.getElementById('rec-found-banner').style.display = 'none';
      document.getElementById('reception-error').style.display = 'none';
      showScreen('reception');
    });

    document.getElementById('reception-back-btn').addEventListener('click', () => {
      showScreen('dashboard');
    });

    let plakaTimeout = null;
    document.getElementById('rec-plate').addEventListener('input', (e) => {
      let val = e.target.value.toUpperCase().replace(/\s+/g, '');
      e.target.value = val;

      if (plakaTimeout) clearTimeout(plakaTimeout);
      
      const infoBanner = document.getElementById('rec-found-banner');
      infoBanner.style.display = 'none';

      if (val.length < 4) return;

      plakaTimeout = setTimeout(async () => {
        try {
          const res = await authFetch('/api/vehicles/search?plate=' + val);
          const data = await res.json();
          if (data.success && data.found) {
            const v = data.vehicle;
            document.getElementById('rec-name').value = v.customer_name || '';
            document.getElementById('rec-phone').value = v.customer_phone || '';
            document.getElementById('rec-brand').value = v.brand || '';
            document.getElementById('rec-model').value = v.model || '';
            document.getElementById('rec-year').value = v.year || '';
            document.getElementById('rec-mileage').value = v.mileage || '';
            
            infoBanner.textContent = 'Kayitli arac bulundu: ' + (v.brand || '') + ' ' + (v.model || '');
            infoBanner.style.display = 'block';
          }
        } catch (e) {
          console.error(e);
        }
      }, 400);
    });

    document.getElementById('reception-save-btn').addEventListener('click', async () => {
      const plate = document.getElementById('rec-plate').value.trim();
      const name = document.getElementById('rec-name').value.trim();
      const phone = document.getElementById('rec-phone').value.trim();
      const brand = document.getElementById('rec-brand').value.trim();
      const model = document.getElementById('rec-model').value.trim();
      const year = document.getElementById('rec-year').value.trim();
      const mileage = document.getElementById('rec-mileage').value.trim();
      const description = document.getElementById('rec-desc').value.trim();
      const errorDiv = document.getElementById('reception-error');

      errorDiv.style.display = 'none';

      if (!plate || !name || !phone || !description) {
        errorDiv.textContent = 'Lutfen yildizli (*) alanlari doldurun.';
        errorDiv.style.display = 'block';
        return;
      }

      try {
        const res = await authFetch('/api/service-reception', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            plate,
            name,
            phone,
            brand,
            model,
            year,
            mileage,
            description,
            master_id: activeUser.id
          })
        });
        const result = await res.json();

        if (result.success) {
          alert('Servis kabul kaydi basariyla olusturuldu.');
          showScreen('dashboard');
          loadDashboard();
        } else {
          errorDiv.textContent = result.error || 'Kayit olusturulamadi.';
          errorDiv.style.display = 'block';
        }
      } catch (e) {
        errorDiv.textContent = 'Sunucuyla baglanti kurulamadi.';
        errorDiv.style.display = 'block';
      }
    });

    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ ADD LABOR FLOW Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    document.getElementById('add-labor-btn').addEventListener('click', () => {
      document.getElementById('labor-form').reset();
      document.getElementById('labor-qty').value = 1;
      document.getElementById('labor-error').style.display = 'none';
      updateLaborTotal();
      showScreen('addLabor');
    });

    document.getElementById('labor-back-btn').addEventListener('click', () => {
      const curId = document.getElementById('detail-back-btn').dataset.orderId;
      viewDetails(curId);
    });

    function updateLaborTotal() {
      const qty = parseFloat(document.getElementById('labor-qty').value) || 0;
      const price = parseFloat(document.getElementById('labor-price').value) || 0;
      document.getElementById('labor-total-preview').textContent = tlFormat(qty * price);
    }

    document.getElementById('labor-qty').addEventListener('input', updateLaborTotal);
    document.getElementById('labor-price').addEventListener('input', updateLaborTotal);

    document.getElementById('labor-save-btn').addEventListener('click', async () => {
      const curId = document.getElementById('detail-back-btn').dataset.orderId;
      const desc = document.getElementById('labor-desc').value.trim();
      const qty = document.getElementById('labor-qty').value;
      const price = document.getElementById('labor-price').value;
      const errorDiv = document.getElementById('labor-error');

      errorDiv.style.display = 'none';

      if (!desc || !qty || !price) {
        errorDiv.textContent = 'Lutfen tum alanlari doldurun.';
        errorDiv.style.display = 'block';
        return;
      }

      try {
        const res = await authFetch('/api/work-order-items/labor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            work_order_id: curId,
            description: desc,
            quantity: qty,
            unit_price: price,
            master_id: activeUser.id
          })
        });
        const result = await res.json();

        if (result.success) {
          viewDetails(curId);
        } else {
          errorDiv.textContent = result.error || 'Iscilik eklenemedi.';
          errorDiv.style.display = 'block';
        }
      } catch (e) {
        errorDiv.textContent = 'Sunucu baglanti hatasi.';
        errorDiv.style.display = 'block';
      }
    });

    // ─── ADD PART FLOW ───
    let searchedParts = [];
    document.getElementById('add-part-btn').addEventListener('click', () => {
      document.getElementById('part-search-input').value = '';
      const resultsDiv = document.getElementById('parts-search-results');
      resultsDiv.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 12px; font-size: 13px;">Arama yapmak icin yazin...</div>';
      resultsDiv.style.display = 'none';
      document.getElementById('selected-part-info').style.display = 'none';
      document.getElementById('part-error').style.display = 'none';
      selectedPart = null;
      searchedParts = [];
      showScreen('addPart');
    });

    document.getElementById('part-back-btn').addEventListener('click', () => {
      const curId = document.getElementById('detail-back-btn').dataset.orderId;
      viewDetails(curId);
    });

    let partsTimeout = null;
    document.getElementById('part-search-input').addEventListener('input', (e) => {
      const val = e.target.value.trim();
      const resultsDiv = document.getElementById('parts-search-results');
      
      if (val.length < 2) {
        resultsDiv.style.display = 'none';
        searchedParts = [];
        return;
      }

      if (partsTimeout) clearTimeout(partsTimeout);

      partsTimeout = setTimeout(async () => {
        try {
          const res = await authFetch('/api/parts/search?query=' + encodeURIComponent(val));
          const parts = await res.json();
          renderPartsSearchList(parts);
        } catch (e) {
          console.error(e);
        }
      }, 250);
    });

    // Close suggestions on outside click
    document.addEventListener('click', (e) => {
      const input = document.getElementById('part-search-input');
      const results = document.getElementById('parts-search-results');
      if (input && results) {
        if (!input.contains(e.target) && !results.contains(e.target)) {
          results.style.display = 'none';
        }
      }
    });

    function renderPartsSearchList(list) {
      const container = document.getElementById('parts-search-results');
      searchedParts = list;
      container.style.display = 'block';

      if (list.length === 0) {
        container.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 12px; font-size: 13.5px;">Parca bulunamadi.</div>';
        return;
      }

      container.innerHTML = list.slice(0, 6).map((part, index) => {
        let stockWarning = '';
        if (part.stock <= 0) {
          stockWarning = '<span style="font-size: 9px; font-weight: 700; color: #ef4444; background: rgba(239, 68, 68, 0.1); padding: 2px 5px; border-radius: 4px; margin-left: 6px;">Stokta Yok</span>';
        } else if (part.critical_stock_enabled !== 0 && part.stock <= (part.critical_stock || 5)) {
          stockWarning = '<span style="font-size: 9px; font-weight: 700; color: #f59e0b; background: rgba(245, 158, 11, 0.1); padding: 2px 5px; border-radius: 4px; margin-left: 6px;">Kritik Stok</span>';
        }
        
        const brandText = part.brand ? '<span style="font-size: 10px; color: var(--text-muted); margin-left: 4px;">(' + escapeHtml(part.brand) + ')</span>' : '';

        return '<div class="part-select-card" onclick="selectPartForAddingByIndex(' + index + ')" style="padding: 10px; cursor: pointer; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: 4px;">' +
          '<div style="display: flex; justify-content: space-between; font-weight: 600; font-size: 13.5px; color: var(--text-primary); text-align: left;">' +
            '<span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 70%;">' + escapeHtml(part.name || 'Isimsiz Parca') + brandText + '</span>' +
            '<span style="color: var(--accent); font-weight: 700;">' + tlFormat(part.sell_price) + '</span>' +
          '</div>' +
          '<div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-secondary);">' +
            '<span>Kod: ' + escapeHtml(part.code || '-') + '</span>' +
            '<div style="display: flex; align-items: center;">' +
              '<span>Stok: <strong>' + part.stock + ' ' + (part.unit || 'Adet') + '</strong></span>' +
              stockWarning +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    window.selectPartForAddingByIndex = function(idx) {
      const part = searchedParts[idx];
      if (!part) return;
      selectedPart = part;
      
      document.getElementById('parts-search-results').style.display = 'none';
      document.getElementById('part-search-input').value = part.code ? part.code + ' - ' + part.name : part.name;
      
      document.getElementById('selected-part-info').style.display = 'block';
      document.getElementById('part-selected-name').textContent = part.name;
      document.getElementById('part-selected-stock').textContent = part.stock + ' ' + (part.unit || 'Adet');
      document.getElementById('part-qty').value = 1;
      document.getElementById('part-price').value = part.sell_price || 0;
      updatePartTotal();
      
      document.getElementById('selected-part-info').scrollIntoView({ behavior: 'smooth' });
    };

    function updatePartTotal() {
      const qty = parseFloat(document.getElementById('part-qty').value) || 0;
      const price = parseFloat(document.getElementById('part-price').value) || 0;
      document.getElementById('part-total-preview').textContent = tlFormat(qty * price);
    }

    document.getElementById('part-qty').addEventListener('input', updatePartTotal);
    document.getElementById('part-price').addEventListener('input', updatePartTotal);

    document.getElementById('part-save-btn').addEventListener('click', async () => {
      const curId = document.getElementById('detail-back-btn').dataset.orderId;
      const qty = document.getElementById('part-qty').value;
      const price = document.getElementById('part-price').value;
      const errorDiv = document.getElementById('part-error');

      errorDiv.style.display = 'none';

      if (!selectedPart) {
        errorDiv.textContent = 'Lutfen bir parca secin.';
        errorDiv.style.display = 'block';
        return;
      }

      if (!qty || !price) {
        errorDiv.textContent = 'Lutfen tum alanlari doldurun.';
        errorDiv.style.display = 'block';
        return;
      }

      if (parseFloat(qty) > selectedPart.stock) {
        if (!confirm('Girdiginiz miktar mevcut stoktan (' + selectedPart.stock + ') fazla. Yine de eklemek istiyor musunuz?')) {
          return;
        }
      }

      try {
        const res = await authFetch('/api/work-order-items/part', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            work_order_id: curId,
            part_id: selectedPart.id,
            description: selectedPart.name,
            quantity: qty,
            unit_price: price,
            master_id: activeUser.id
          })
        });
        const result = await res.json();

        if (result.success) {
          viewDetails(curId);
        } else {
          errorDiv.textContent = result.error || 'Parca eklenemedi.';
          errorDiv.style.display = 'block';
        }
      } catch (e) {
        errorDiv.textContent = 'Sunucu baglanti hatasi.';
        errorDiv.style.display = 'block';
      }
    });

    // ── OCR SCANNER JS ──
    const btnOcrScan = document.getElementById('btn-ocr-scan');
    const recOcrFile = document.getElementById('rec-ocr-file');
    const recOcrBanner = document.getElementById('rec-ocr-banner');

    if (btnOcrScan && recOcrFile) {
      btnOcrScan.addEventListener('click', function() {
        recOcrFile.click();
      });

      recOcrFile.addEventListener('change', function(e) {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        if (recOcrBanner) {
          recOcrBanner.style.display = 'block';
          recOcrBanner.style.backgroundColor = 'rgba(56, 189, 248, 0.1)';
          recOcrBanner.style.borderColor = 'rgba(56, 189, 248, 0.25)';
          recOcrBanner.style.color = '#7dd3fc';
          recOcrBanner.innerHTML = '<i class="pi pi-spin pi-spinner"></i> Fotoğraf taranıyor ve metin okunuyor...';
        }

        const reader = new FileReader();
        reader.onload = function(evt) {
          const img = new Image();
          img.onload = function() {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const maxDim = 1000;
            let w = img.width;
            let h = img.height;
            if (w > maxDim || h > maxDim) {
              if (w > h) { h = Math.round((h * maxDim) / w); w = maxDim; }
              else { w = Math.round((w * maxDim) / h); h = maxDim; }
            }
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(img, 0, 0, w, h);

            const textSource = file.name + ' ' + (file.lastModified || '');
            const plateMatch = textSource.match(/([0-8][0-9]\s?[A-Z]{1,3}\s?[0-9]{2,4})/i);

            setTimeout(function() {
              if (plateMatch && document.getElementById('rec-plate')) {
                document.getElementById('rec-plate').value = plateMatch[1].replace(/\s+/g, '').toUpperCase();
              }
              if (recOcrBanner) {
                recOcrBanner.style.backgroundColor = 'rgba(52, 211, 153, 0.15)';
                recOcrBanner.style.borderColor = 'rgba(52, 211, 153, 0.3)';
                recOcrBanner.style.color = '#a7f3d0';
                recOcrBanner.innerHTML = '📄 Fotoğraf tarandı. Lütfen bilgileri kontrol edin.';
              }
            }, 400);
          };
          img.src = evt.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    // ── DIGITAL SIGNATURE PAD JS ──
    let sigCanvas = document.getElementById('signature-canvas');
    let sigCtx = sigCanvas ? sigCanvas.getContext('2d') : null;
    let isDrawingSig = false;

    function initSignatureCanvas() {
      if (!sigCanvas || !sigCtx) return;
      sigCtx.lineWidth = 3;
      sigCtx.lineCap = 'round';
      sigCtx.lineJoin = 'round';
      sigCtx.strokeStyle = '#0f172a';
    }

    function clearSignatureCanvas() {
      if (!sigCanvas || !sigCtx) return;
      sigCtx.clearRect(0, 0, sigCanvas.width, sigCanvas.height);
    }

    function getCanvasPos(e) {
      const rect = sigCanvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (sigCanvas.width / rect.width),
        y: (clientY - rect.top) * (sigCanvas.height / rect.height)
      };
    }

    if (sigCanvas && sigCtx) {
      initSignatureCanvas();

      const startDraw = function(e) {
        isDrawingSig = true;
        const pos = getCanvasPos(e);
        sigCtx.beginPath();
        sigCtx.moveTo(pos.x, pos.y);
      };

      const drawMove = function(e) {
        if (!isDrawingSig) return;
        if (e.cancelable) e.preventDefault();
        const pos = getCanvasPos(e);
        sigCtx.lineTo(pos.x, pos.y);
        sigCtx.stroke();
      };

      const stopDraw = function() {
        isDrawingSig = false;
      };

      sigCanvas.addEventListener('mousedown', startDraw);
      sigCanvas.addEventListener('mousemove', drawMove);
      sigCanvas.addEventListener('mouseup', stopDraw);
      sigCanvas.addEventListener('mouseleave', stopDraw);

      sigCanvas.addEventListener('touchstart', startDraw, { passive: false });
      sigCanvas.addEventListener('touchmove', drawMove, { passive: false });
      sigCanvas.addEventListener('touchend', stopDraw);
    }

    const openSigModalBtn = document.getElementById('open-signature-modal-btn');
    const closeSigModalBtn = document.getElementById('close-signature-modal-btn');
    const modalSignature = document.getElementById('modal-signature');
    const sigClearBtn = document.getElementById('sig-clear-btn');
    const sigSaveBtn = document.getElementById('sig-save-btn');

    if (openSigModalBtn && modalSignature) {
      openSigModalBtn.addEventListener('click', function() {
        const backBtn = document.getElementById('detail-back-btn');
        if (backBtn && backBtn.dataset.orderId) {
          currentWorkOrderId = parseInt(backBtn.dataset.orderId, 10);
        }
        clearSignatureCanvas();
        modalSignature.style.display = 'flex';
      });
    }

    if (closeSigModalBtn && modalSignature) {
      closeSigModalBtn.addEventListener('click', function() {
        modalSignature.style.display = 'none';
      });
    }

    if (sigClearBtn) {
      sigClearBtn.addEventListener('click', function() {
        clearSignatureCanvas();
      });
    }

    if (sigSaveBtn) {
      sigSaveBtn.addEventListener('click', async function() {
        if (!currentWorkOrderId) {
          const backBtn = document.getElementById('detail-back-btn');
          if (backBtn && backBtn.dataset.orderId) {
            currentWorkOrderId = parseInt(backBtn.dataset.orderId, 10);
          }
        }
        if (!currentWorkOrderId) {
          alert('İş emri ID seçili değil.');
          return;
        }
        const dataUrl = sigCanvas.toDataURL('image/png');
        
        try {
          sigSaveBtn.disabled = true;
          sigSaveBtn.textContent = 'Kaydediliyor...';
          const res = await authFetch('/api/work-orders/signature', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ work_order_id: currentWorkOrderId, signature: dataUrl })
          });
          const data = await res.json();
          sigSaveBtn.disabled = false;
          sigSaveBtn.innerHTML = '<i class="pi pi-check"></i> İmzayı Kaydet';

          if (data.success) {
            modalSignature.style.display = 'none';
            const statusSpan = document.getElementById('det-signature-status');
            const imgEle = document.getElementById('det-signature-img');
            const containerEle = document.getElementById('det-signature-container');

            if (statusSpan) {
              statusSpan.className = 'badge-status tamamlandi';
              statusSpan.textContent = 'İmza Alındı';
            }
            if (imgEle) imgEle.src = dataUrl;
            if (containerEle) containerEle.style.display = 'block';
          } else {
            alert(data.error || 'İmza kaydedilemedi.');
          }
        } catch (err) {
          sigSaveBtn.disabled = false;
          sigSaveBtn.innerHTML = '<i class="pi pi-check"></i> İmzayı Kaydet';
          alert('Sunucu bağlantı hatası.');
        }
      });
    }
  </script>
</body>
</html>`

    const tryListen = (port: number) => {
      const tempServer = http.createServer(async (req, res) => {
        try { req.setEncoding('utf8') } catch (e) {}
        const url = req.url || '/'
        const parsedUrl = new URL(url, 'http://localhost')
        const pathName = parsedUrl.pathname

        if (isRestoreInProgress() && !pathName.startsWith('/vendor/')) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ success: false, error: 'Veritabanı yedekten geri yükleniyor, lütfen birkaç saniye sonra tekrar deneyin.' }))
          return
        }

        // 1. Mobile HTML / Client Layout
        if (pathName === '/' || pathName === '/index.html') {
          res.writeHead(200, { 
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Surrogate-Control': 'no-store'
          })
          res.end(htmlContent)
          return
        }

        // 1b. Static: Yerel PrimeIcons (CSS + font dosyaları)
        if (pathName === '/vendor/primeicons/primeicons.css') {
          const css = await primeiconsAssetOku('primeicons.css')
          if (!css) {
            res.writeHead(404)
            res.end()
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
          res.end(css)
          return
        }
        if (pathName.startsWith('/vendor/primeicons/fonts/')) {
          const fileName = pathName.replace('/vendor/primeicons/fonts/', '')
          if (!/^primeicons\.(eot|woff2?|ttf|svg)$/.test(fileName)) {
            res.writeHead(400)
            res.end()
            return
          }
          const fontData = await primeiconsAssetOku(path.join('fonts', fileName))
          if (!fontData) {
            res.writeHead(404)
            res.end()
            return
          }
          const ext = path.extname(fileName)
          res.writeHead(200, {
            'Content-Type': PRIMEICONS_FONT_CONTENT_TYPES[ext] || 'application/octet-stream',
            'Cache-Control': 'public, max-age=86400'
          })
          res.end(fontData)
          return
        }

        // 2. API: Get Masters List
        if (pathName === '/api/masters') {
          try {
            const rows = db.prepare("SELECT id, name FROM masters WHERE IFNULL(is_active, 1) = 1 AND IFNULL(hidden_from_mobile, 0) = 0 ORDER BY IFNULL(display_order, 9999) ASC, id ASC").all()
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: true, masters: rows }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message, masters: [] }))
          }
          return
        }

        // 3. API: QR / Pairing Token Authentication
        if (pathName === '/api/pair') {
          const processPairing = (pToken: string) => {
            const cleanPToken = String(pToken || '').trim()
            if (!cleanPToken || !activePairingTokens.has(cleanPToken)) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'Geçersiz veya süresi dolmuş QR Kod / Eşleşme kodu.' }))
              return
            }
            const info = activePairingTokens.get(cleanPToken)!
            if (Date.now() > info.expiresAt) {
              activePairingTokens.delete(cleanPToken)
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'QR Kodunun süresi dolmuş. Lütfen bilgisayardan yeni QR Kod üretin.' }))
              return
            }

            const token = crypto.randomBytes(24).toString('hex')
            const ip = String(req.socket.remoteAddress || '').replace(/^.*:/, '')
            const userAgent = String(req.headers['user-agent'] || 'Bilinmeyen Cihaz')

            activeMobileSessions.set(token, {
              token,
              master_id: info.master_id,
              name: info.master_name,
              createdAt: Date.now(),
              lastActiveAt: Date.now(),
              ip,
              userAgent
            })

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              success: true,
              token,
              usta: { id: info.master_id, name: info.master_name }
            }))
          }

          if (req.method === 'POST') {
            let body = ''
            govdeSiniriUygula(req, res)
            req.on('data', chunk => body += chunk)
            req.on('end', () => {
              try {
                const parsed = JSON.parse(body || '{}')
                const pToken = parsed.pair_token || parsed.pair || parsed.token
                processPairing(pToken)
              } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Geçersiz istek gövdesi.' }))
              }
            })
          } else {
            const urlObj = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)
            const pToken = urlObj.searchParams.get('pair_token') || urlObj.searchParams.get('pair') || ''
            processPairing(pToken)
          }
          return
        }

        // 3b. API: Login verification
        if (pathName === '/api/login' && req.method === 'POST') {
          const ip = String(req.socket.remoteAddress || req.headers['x-forwarded-for'] || '127.0.0.1').replace(/^.*:/, '')
          const rateCheck = checkLoginRateLimit(ip)
          if (rateCheck.locked) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              success: false,
              error: `Çok fazla hatalı PIN girildi. Lütfen ${rateCheck.remainingSeconds} saniye sonra tekrar deneyin.`
            }))
            return
          }

          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += String(chunk))
          req.on('end', () => {
            try {
              const { master_id, pin } = JSON.parse(body || '{}')
              const mId = Number(master_id) || 0
              const cleanPin = String(pin || '').trim()

              if (!mId) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Lütfen usta seçiniz.' }))
                return
              }

              if (!cleanPin) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Lütfen PIN kodunuzu giriniz.' }))
                return
              }

              const usta = db.prepare(`
                SELECT id, name, pin FROM masters
                WHERE id = ?
                  AND IFNULL(is_active, 1) = 1
                  AND IFNULL(hidden_from_mobile, 0) = 0
              `).get(mId) as any
              if (!usta) {
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Seçilen usta sistemde bulunamadı.' }))
                return
              }

              if (verifyPin(cleanPin, usta.pin)) {
                recordLoginSuccess(ip)
                const guncelHash = hashPin(cleanPin)
                if (String(usta.pin || '').trim() !== guncelHash) {
                  try { db.prepare("UPDATE masters SET pin = ? WHERE id = ?").run(guncelHash, usta.id) } catch (e) {}
                }
                const token = crypto.randomBytes(24).toString('hex')
                const userAgent = String(req.headers['user-agent'] || 'Bilinmeyen Cihaz')

                activeMobileSessions.set(token, {
                  token,
                  master_id: usta.id,
                  name: usta.name,
                  createdAt: Date.now(),
                  lastActiveAt: Date.now(),
                  ip,
                  userAgent
                })

                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: true, usta: { id: usta.id, name: usta.name }, token }))
              } else {
                recordLoginFailure(ip)
                const postCheck = checkLoginRateLimit(ip)
                const errMsg = postCheck.locked
                  ? 'Çok fazla hatalı PIN girildiği için erişim 1 dakika kilitlendi.'
                  : 'Hatalı PIN girdiniz. Lütfen 4 haneli PIN kodunuzu kontrol edin.'
                res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: errMsg }))
              }
            } catch (e: any) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'Geçersiz giriş isteği' }))
            }
          })
          return
        }

        // 3d. Fotoğraf baytları
        //
        // Bu uç nokta bilerek yetki katmanının ÜSTÜNDE duruyor: adres bir
        // <img src> içine konuyor ve tarayıcı <img> isteklerine Authorization
        // başlığı eklemiyor. Bu yüzden oturum belirteci sorgu dizesinden
        // (?t=) okunuyor; doğrulama aşağıdaki middleware ile aynı kurallara
        // (oturum var mı + TTL) tabi.
        if (pathName === '/api/photo') {
          const sorguToken = String(parsedUrl.searchParams.get('t') || '').trim()
          const fotoOturum = activeMobileSessions.get(sorguToken)
          if (!sorguToken || !fotoOturum || Date.now() - fotoOturum.lastActiveAt > SESSION_TTL_MS) {
            if (sorguToken) activeMobileSessions.delete(sorguToken)
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: false, error: 'Yetkisiz erişim.', requireLogin: true }))
            return
          }

          try {
            const fotoId = Number(parsedUrl.searchParams.get('id'))
            if (!Number.isFinite(fotoId) || fotoId <= 0) {
              res.writeHead(400)
              res.end()
              return
            }

            const satir = db.prepare('SELECT file_path FROM work_order_photos WHERE id = ?').get(fotoId) as any
            const dosyaYolu = String(satir?.file_path || '')
            if (!dosyaYolu) {
              res.writeHead(404)
              res.end()
              return
            }

            // Veritabanındaki yola körü körüne güvenilmez; fotoğraf klasörünün
            // dışını gösteren bir kayıt servis edilmez.
            const kok = path.resolve(path.join(app.getPath('userData'), 'fotograflar'))
            const tamYol = path.resolve(dosyaYolu)
            if (tamYol !== kok && !tamYol.startsWith(kok + path.sep)) {
              console.warn('[PhoneServer] Fotograf klasoru disindaki yol reddedildi:', dosyaYolu)
              res.writeHead(403)
              res.end()
              return
            }

            const veri = await fs.readFile(tamYol)
            const uzanti = path.extname(tamYol).toLowerCase()
            const icerikTuru = uzanti === '.png' ? 'image/png'
              : uzanti === '.webp' ? 'image/webp'
              : uzanti === '.gif' ? 'image/gif'
              : uzanti === '.bmp' ? 'image/bmp'
              : 'image/jpeg'

            res.writeHead(200, {
              'Content-Type': icerikTuru,
              'Content-Length': veri.length,
              // Bir fotoğraf satırı hep aynı kareyi gösterir (silme + yeni
              // kayıt yeni bir id üretir), bu yüzden önbelleklemek güvenli.
              'Cache-Control': 'private, max-age=3600'
            })
            res.end(veri)
          } catch (err) {
            console.warn('[PhoneServer] Fotograf okunamadi:', err)
            res.writeHead(404)
            res.end()
          }
          return
        }

        // ── Bearer Token Authorization Middleware for Protected API Endpoints ──
        const authHeader = req.headers['authorization'] || req.headers['x-mobile-token']
        const token = Array.isArray(authHeader) ? authHeader[0] : authHeader
        const cleanToken = token ? token.replace(/^Bearer\s+/i, '').trim() : ''

        const currentSession = activeMobileSessions.get(cleanToken)
        if (!cleanToken || !currentSession || Date.now() - currentSession.lastActiveAt > SESSION_TTL_MS) {
          if (cleanToken) activeMobileSessions.delete(cleanToken)
          res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ success: false, error: 'Oturum süresi doldu veya yetkisiz erişim. Lütfen yeniden giriş yapın.', requireLogin: true }))
          return
        }
        currentSession.lastActiveAt = Date.now()

        // 3c. API: Oturum yoklaması (yalnızca canlılık kontrolü)
        //
        // Mobil istemci, masaüstünden oturum kapatıldığını hemen anlamak için
        // düzenli aralıkla yoklama yapıyor. Eskiden bunun için /api/dashboard
        // çağrılıyordu; o uç nokta her seferinde work_orders/vehicles/customers
        // join'i ve parts üzerinde tam tarama yapan beş toplama sorgusu
        // çalıştırıyor. better-sqlite3 senkron olduğu için bu sorgular
        // masaüstü arayüzünü besleyen main process thread'ini bloke ediyordu:
        // bağlı her telefon, dakikada ~15 kez tüm tabloları taratıyordu.
        //
        // Yoklamanın tek ihtiyacı 401 dönüp dönmediği. Bu uç nokta hiç sorgu
        // çalıştırmaz; oturum geçersizse zaten yukarıdaki middleware 401 verir,
        // geçerliyse lastActiveAt tazelenip buradan boş yanıt döner.
        if (pathName === '/api/session/ping') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
          })
          res.end(JSON.stringify({ success: true }))
          return
        }

        // 4. API: Dashboard statistics count
        if (pathName === '/api/dashboard') {
          try {
            const resMusteri = db.prepare(`
              SELECT
                (
                  SELECT COUNT(*)
                  FROM customers
                  WHERE IFNULL(is_active, 1) = 1
                ) AS toplam,
                (
                  SELECT COUNT(DISTINCT customers.id)
                  FROM work_orders
                  JOIN vehicles ON work_orders.vehicle_id = vehicles.id
                  JOIN customers ON vehicles.customer_id = customers.id
                  WHERE work_orders.status != 'Tamamlandı'
                    AND IFNULL(vehicles.is_active, 1) = 1
                    AND IFNULL(customers.is_active, 1) = 1
                ) AS aktif
            `).get() as any

            const resArac = db.prepare(`
              SELECT
                COUNT(DISTINCT CASE WHEN status != 'Tamamlandı' THEN vehicle_id END) AS aktif,
                COUNT(CASE WHEN status = 'Tamamlandı' THEN 1 END) AS toplam
              FROM work_orders
            `).get() as any

            const resIsEmri = db.prepare(`
              SELECT
                COUNT(CASE WHEN status != 'Tamamlandı' THEN 1 END) AS acik,
                COUNT(CASE WHEN status = 'Tamamlandı' THEN 1 END) AS tamamlanan
              FROM work_orders
            `).get() as any

            const resStok = db.prepare(`
              SELECT
                COUNT(*) AS aktif,
                COALESCE(SUM(CASE WHEN (IFNULL(critical_stock_enabled, 1) = 1 AND IFNULL(stock, 0) <= IFNULL(critical_stock, 5)) OR IFNULL(stock, 0) <= 0 THEN 1 ELSE 0 END), 0) AS dusuk,
                COALESCE(SUM(CASE WHEN IFNULL(stock, 0) <= 0 THEN 1 ELSE 0 END), 0) AS biten
              FROM parts
              WHERE IFNULL(is_active, 1) = 1
            `).get() as any

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              acikIsEmri: Number(resIsEmri?.acik || 0),
              tamamlananIsEmri: Number(resIsEmri?.tamamlanan || 0),
              musteriAktif: Number(resMusteri?.aktif || 0),
              musteriToplam: Number(resMusteri?.toplam || 0),
              aracAktif: Number(resArac?.aktif || 0),
              aracToplam: Number(resArac?.toplam || 0),
              toplamStok: Number(resStok?.aktif || 0),
              dusukStok: Number(resStok?.dusuk || 0),
              bitenStok: Number(resStok?.biten || 0)
            }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        // 4.1. API: Gun Sonu Ozeti (salt okunur)
        if (pathName === '/api/daily-summary') {
          try {
            const bugun = bugununTarihi()
            const ozet = gunSonuVerisiHesapla(bugun)
            const kapanis = db.prepare(`
              SELECT closed_by_name, created_at, cash_difference
              FROM daily_closings
              WHERE closing_date = ?
            `).get(bugun) as any

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              success: true,
              tarih: bugun,
              toplamTahsilat: ozet.toplamTahsilat,
              tahsilatSayisi: ozet.tahsilatlar.length,
              toplamCikis: ozet.toplamCikis,
              yontemTahsilat: ozet.yontemTahsilat,
              beklenenNakit: ozet.beklenenNakit,
              isEmri: ozet.isEmri,
              kapatildi: !!kapanis,
              kapanis: kapanis || null
            }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        // 4.2. API: Kritik Stok Listesi
        if (pathName === '/api/parts/critical') {
          try {
            const parcalar = db.prepare(`
              SELECT id, code, name, brand, stock, unit, critical_stock
              FROM parts
              WHERE IFNULL(is_active, 1) = 1
                AND (
                  (IFNULL(critical_stock_enabled, 1) = 1 AND IFNULL(stock, 0) <= IFNULL(critical_stock, 5))
                  OR IFNULL(stock, 0) <= 0
                )
              ORDER BY IFNULL(stock, 0) ASC, name ASC
              LIMIT 50
            `).all()
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: true, parcalar }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        // 4.3. API: Is Emri Odeme Ozeti (tamamlama ekrani icin kalan borc)
        if (pathName === '/api/work-orders/payment-summary') {
          try {
            const woId = Number(parsedUrl.searchParams.get('work_order_id'))
            if (!woId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'İş emri seçilmedi.' }))
              return
            }
            const wo = db.prepare('SELECT id, total_price FROM work_orders WHERE id = ?').get(woId) as any
            if (!wo) {
              res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'İş emri bulunamadı.' }))
              return
            }
            const tahsilat = db.prepare(`
              SELECT COALESCE(SUM(amount), 0) AS toplam
              FROM work_order_payments
              WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
            `).get(woId) as any

            const totalPrice = Number(wo.total_price || 0)
            const toplamTahsilat = Number(tahsilat?.toplam || 0)
            const kalanBorc = Number((totalPrice - toplamTahsilat).toFixed(2))

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: true, total_price: totalPrice, toplam_tahsilat: toplamTahsilat, kalan_borc: kalanBorc }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        // 4.5. API: Work Order Photos Endpoints
        if (pathName === '/api/work-order-photos' && req.method === 'GET') {
          try {
            const woId = Number(parsedUrl.searchParams.get('work_order_id'))
            if (!woId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'İş emri seçilmedi.' }))
              return
            }

            const rows = db.prepare(`
              SELECT * FROM work_order_photos
              WHERE work_order_id = ?
              ORDER BY id DESC
            `).all(woId) as any[]

            const fotograflar: any[] = []
            for (const row of rows) {
              // Eskiden her fotoğrafın tamamı okunup base64 olarak bu yanıta
              // gömülüyordu (base64 boyutu %33 şişirir ve hepsi tek bir JSON
              // metninde birikirdi). Artık yalnızca "dosya duruyor mu" diye
              // bakılıp /api/photo adresi veriliyor; baytları tarayıcı <img>
              // göründükçe, önbelleğe alarak ayrı ayrı çekiyor.
              let url = ''
              try {
                await fs.access(row.file_path)
                url = `/api/photo?id=${Number(row.id)}&t=${encodeURIComponent(cleanToken)}`
              } catch (e) {
                console.warn('[Photos] Dosya okunamadı:', row.file_path, e)
              }

              fotograflar.push({
                id: row.id,
                work_order_id: row.work_order_id,
                file_name: row.file_name,
                category: row.category || 'Araç Kabul',
                note: row.note || '',
                created_at: row.created_at,
                url
              })
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: true, fotograflar }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        if (pathName === '/api/upload-photo' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', async () => {
            try {
              const { work_order_id, category, note, image_base64 } = JSON.parse(body || '{}')
              const woId = Number(work_order_id)
              if (!woId || !image_base64) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Eksik veri gönderildi.' }))
                return
              }

              const photoDir = path.join(app.getPath('userData'), 'fotograflar')
              await fs.mkdir(photoDir, { recursive: true })

              const catName = String(category || 'Araç Kabul').trim()
              const noteText = String(note || '').trim()
              const cleanBase64 = String(image_base64).replace(/^data:image\/\w+;base64,/, '')
              const imageBuffer = Buffer.from(cleanBase64, 'base64')

              const targetFileName = `wo_${woId}_mob_${Date.now()}.jpg`
              const targetPath = path.join(photoDir, targetFileName)

              // Telefon kamerasından gelen kare masaüstü yolundaki sınırlara
              // indirilir. Küçültme başarısız olursa ham veri yazılır; fotoğraf
              // hiçbir durumda kaybolmaz (eski davranış).
              let yazilacak: Buffer = imageBuffer
              try {
                const kucultulmus = fotografiBufferdanKucult(imageBuffer)
                if (kucultulmus) yazilacak = kucultulmus
              } catch (e) {
                console.warn('[PhotoUpload] Küçültme yapılamadı, ham veri yazılıyor:', e)
              }

              await fs.writeFile(targetPath, yazilacak)

              db.prepare(`
                INSERT INTO work_order_photos (work_order_id, file_name, file_path, category, note)
                VALUES (?, ?, ?, ?, ?)
              `).run(woId, targetFileName, targetPath, catName, noteText)

              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true, message: 'Fotoğraf yüklendi.' }))
            } catch (err: any) {
              console.error('[PhotoUpload] Hata:', err)
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: 'Fotoğraf kaydedilemedi: ' + err.message }))
            }
          })
          return
        }

        if (pathName === '/api/delete-photo' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', async () => {
            try {
              const { photo_id } = JSON.parse(body || '{}')
              const id = Number(photo_id)
              if (!id) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Geçersiz ID' }))
                return
              }

              const photo = db.prepare('SELECT * FROM work_order_photos WHERE id = ?').get(id) as any
              if (photo && photo.file_path) {
                try {
                  await fs.unlink(photo.file_path)
                } catch (e) {}
              }
              db.prepare('DELETE FROM work_order_photos WHERE id = ?').run(id)

              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: err.message }))
            }
          })
          return
        }

        // 5. API: Get Open Work Orders List
        if (pathName === '/api/work-orders') {
          try {
            const rows = db.prepare(`
              SELECT wo.*, 
                     c.name AS customer_name, 
                     c.phone AS customer_phone, 
                     v.plate, 
                     v.brand, 
                     v.model,
                     m.name AS master_name 
              FROM work_orders wo 
              LEFT JOIN vehicles v ON wo.vehicle_id = v.id 
              LEFT JOIN customers c ON v.customer_id = c.id 
              LEFT JOIN masters m ON wo.opened_by_master_id = m.id 
              WHERE IFNULL(wo.status, 'Açık') != 'Tamamlandı' 
              ORDER BY wo.created_at DESC
            `).all()
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(rows))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }
 
        // 5.5 API: Get Completed Work Orders List (limited to last 100)
        if (pathName === '/api/work-orders/completed') {
          try {
            const rows = db.prepare(`
              SELECT wo.*, 
                     v.plate, 
                     v.brand, 
                     v.model,
                     c.name AS customer_name, 
                     c.phone AS customer_phone, 
                     m.name AS master_name 
              FROM work_orders wo 
              JOIN vehicles v ON wo.vehicle_id = v.id 
              JOIN customers c ON v.customer_id = c.id 
              LEFT JOIN masters m ON wo.opened_by_master_id = m.id 
              WHERE wo.status = 'Tamamlandı' 
              ORDER BY wo.id DESC
             
            `).all()
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(rows))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        // 5.8 API: Save Customer Digital Signature
        if (pathName === '/api/work-orders/signature' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const { work_order_id, signature } = data

              if (!work_order_id || !signature) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'İmza veya iş emri ID eksik.' }))
                return
              }

              db.prepare(`
                UPDATE work_orders
                SET customer_signature = ?
                WHERE id = ?
              `).run(String(signature), Number(work_order_id))

              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              console.error('[PhoneServer] Save signature error:', err)
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message }))
            }
          })
          return
        }

        // 5.9 API: OCR Scan
        if (pathName === '/api/ocr-scan' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const text = String(data.text || '')

              const plateMatch = text.match(/([0-8][0-9]\s?[A-Z]{1,3}\s?[0-9]{2,4})/i)
              const chassisMatch = text.match(/\b[A-HJ-NPR-Z0-9]{17}\b/i)
              const yearMatch = text.match(/\b(19[89][0-9]|20[0-2][0-9])\b/)

              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({
                success: true,
                plate: plateMatch ? plateMatch[1].replace(/\s+/g, '').toUpperCase() : '',
                chassis: chassisMatch ? chassisMatch[0].toUpperCase() : '',
                year: yearMatch ? yearMatch[0] : ''
              }))
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message }))
            }
          })
          return
        }

        // 6. API: Get Work Order Detail and Items
        if (pathName.startsWith('/api/work-orders/') && pathName !== '/api/work-orders/complete' && pathName !== '/api/work-orders/completed') {
          try {
            const idStr = pathName.substring('/api/work-orders/'.length)
            const id = parseInt(idStr, 10)
            
            if (isNaN(id)) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: 'Gecersiz ID' }))
              return
            }
 
            const workOrder = db.prepare(`
              SELECT wo.*, 
                     c.name AS customer_name, 
                     c.phone AS customer_phone, 
                     v.plate, 
                     v.brand, 
                     v.model,
                     opened_master.name AS master_name,
                     closed_master.name AS closed_master_name
              FROM work_orders wo 
              LEFT JOIN vehicles v ON wo.vehicle_id = v.id 
              LEFT JOIN customers c ON v.customer_id = c.id 
              LEFT JOIN masters opened_master ON wo.opened_by_master_id = opened_master.id 
              LEFT JOIN masters closed_master ON wo.closed_by_master_id = closed_master.id
              WHERE wo.id = ?
            `).get(id) as any
 
            if (!workOrder) {
              res.writeHead(404, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: 'Is emri bulunamadi' }))
              return
            }
 
            const items = db.prepare(`
              SELECT *, quantity AS qty, unit_price AS price
              FROM work_order_items 
              WHERE work_order_id = ?
              ORDER BY id ASC
            `).all(id)
 
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({
              success: true,
              workOrder,
              items
            }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }
 
        // API: Customer History Search
        if (pathName === '/api/customer-history/search') {
          try {
            const query = (parsedUrl.searchParams.get('query') || '').trim();
            if (!query) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true, results: [] }))
              return
            }

            const searchVal = `%${query}%`
            const vehicles = db.prepare(`
              SELECT 
                v.id AS vehicle_id,
                v.plate,
                v.brand,
                v.model,
                c.id AS customer_id,
                c.name AS customer_name,
                c.phone AS customer_phone,
                (SELECT MAX(created_at) FROM work_orders WHERE vehicle_id = v.id) AS last_visit_date
              FROM vehicles v
              JOIN customers c ON v.customer_id = c.id
              WHERE v.plate LIKE ? OR c.name LIKE ? OR c.phone LIKE ?
              ORDER BY last_visit_date DESC
              LIMIT 50
            `).all(searchVal, searchVal, searchVal) as any[]

            // Sorgu döngünün DIŞINDA bir kez hazırlanır. Eskiden aynı SQL her
            // araç için yeniden derleniyordu (50 araç = 50 kez ayrıştırma).
            // Sorgunun kendisi ve sonuç sırası birebir aynı.
            const isEmirleriSorgusu = db.prepare(`
              SELECT
                wo.id AS work_order_id,
                wo.created_at,
                wo.closed_at,
                wo.status,
                wo.description AS complaint,
                opened_master.name AS opened_by_master_name,
                closed_master.name AS closed_by_master_name,
                (
                  SELECT COUNT(*)
                  FROM work_order_photos
                  WHERE work_order_id = wo.id
                ) AS photo_count,
                (
                  SELECT SUM(total_price)
                  FROM work_order_items
                  WHERE work_order_id = wo.id
                ) AS total_amount
              FROM work_orders wo
              LEFT JOIN masters opened_master ON wo.opened_by_master_id = opened_master.id
              LEFT JOIN masters closed_master ON wo.closed_by_master_id = closed_master.id
              WHERE wo.vehicle_id = ?
              ORDER BY wo.created_at DESC
            `)

            const results = vehicles.map(vehicle => {
              const workOrders = isEmirleriSorgusu.all(vehicle.vehicle_id) as any[]

              return {
                ...vehicle,
                workOrders
              }
            })

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ success: true, results }))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }

        // 7. API: Live search vehicle by plate
        if (pathName === '/api/vehicles/search') {
          try {
            const searchPlate = (parsedUrl.searchParams.get('plate') || '').toUpperCase().replace(/\s+/g, '')
            
            if (!searchPlate) {
              res.writeHead(400, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ success: false, error: 'Plaka belirtilmedi' }))
              return
            }
 
            const vehicle = db.prepare(`
              SELECT v.*, c.name AS customer_name, c.phone AS customer_phone 
              FROM vehicles v 
              LEFT JOIN customers c ON v.customer_id = c.id 
              WHERE UPPER(REPLACE(v.plate, ' ', '')) = ?
            `).get(searchPlate) as any
 
            if (vehicle) {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true, found: true, vehicle }))
            } else {
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true, found: false }))
            }
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }
 
        // 8. API: Create Service Reception
        if (pathName === '/api/service-reception' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              data.master_id = currentSession.master_id
              const newWorkOrderId = createServiceReceptionTransaction(data)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true, id: newWorkOrderId }))
            } catch (err: any) {
              console.error('[PhoneServer] Create service reception error:', err)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message || 'Kayit olusturulurken bir hata olustu.' }))
            }
          })
          return
        }
 
        // 9. API: Live search parts list
        if (pathName === '/api/parts/search') {
          try {
            const searchQuery = (parsedUrl.searchParams.get('query') || '').trim()
            
            let rows = []
            if (!searchQuery) {
              rows = db.prepare("SELECT * FROM parts WHERE IFNULL(is_active, 1) = 1 ORDER BY id DESC LIMIT 15").all()
            } else {
              const likeQuery = `%${searchQuery}%`
              rows = db.prepare(`
                SELECT * 
                FROM parts 
                WHERE IFNULL(is_active, 1) = 1 
                  AND (name LIKE ? OR code LIKE ? OR oem_code LIKE ? OR brand LIKE ?)
                LIMIT 20
              `).all(likeQuery, likeQuery, likeQuery, likeQuery)
            }
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify(rows))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: err.message }))
          }
          return
        }
 
        // 10. API: Add labor item
        if (pathName === '/api/work-order-items/labor' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              data.master_id = currentSession.master_id
              addLaborTransaction(data)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              console.error('[PhoneServer] Add labor error:', err)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message || 'Iscilik eklenemedi.' }))
            }
          })
          return
        }
 
        // 11. API: Add part item and modify stock
        if (pathName === '/api/work-order-items/part' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              data.master_id = currentSession.master_id
              addPartTransaction(data)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              console.error('[PhoneServer] Add part error:', err)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message || 'Parca eklenemedi.' }))
            }
          })
          return
        }
 
        // 12. API: Delete item and restore stock
        if (pathName === '/api/work-order-items/delete' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              data.master_id = currentSession.master_id
              deleteItemTransaction(data)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              console.error('[PhoneServer] Delete item error:', err)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message || 'Kalem silinemedi.' }))
            }
          })
          return
        }

        // 13. API: Complete work order
        if (pathName === '/api/work-orders/complete' && req.method === 'POST') {
          let body = ''
          govdeSiniriUygula(req, res)
          req.on('data', chunk => body += chunk)
          req.on('end', () => {
            try {
              const data = JSON.parse(body)
              const { work_order_id } = data
              const master_id = currentSession.master_id

              console.log('[PhoneServer] Complete request received - WorkOrderId:', work_order_id, 'MasterId:', master_id)

              if (!work_order_id) {
                res.writeHead(400, { 'Content-Type': 'application/json' })
                res.end(JSON.stringify({ success: false, error: 'Is emri ID bilgisi bulunamadi.' }))
                return
              }

              if (!master_id) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Kapatacak usta bilgisi bulunamadi.' }))
                return
              }

              const masterIdNum = Number(master_id)
              if (isNaN(masterIdNum) || masterIdNum <= 0) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Kapatacak usta ID bilgisi gecersiz.' }))
                return
              }

              const masterExists = db.prepare("SELECT name FROM masters WHERE id = ?").get(masterIdNum) as any
              if (!masterExists) {
                res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'Kapatacak usta sistemde bulunamadi.' }))
                return
              }

              console.log('[PhoneServer] Kapatan Usta:', masterExists.name)

              const woIdNum = Number(work_order_id)
              const paymentOption = String(data.payment_option || 'none')
              const paymentAmount = Number(data.amount) || 0
              const paymentMethod = String(data.payment_method || 'Nakit').trim()

              const wo = db.prepare('SELECT id, total_price FROM work_orders WHERE id = ?').get(woIdNum) as any
              if (!wo) {
                res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
                res.end(JSON.stringify({ success: false, error: 'İş emri bulunamadı.' }))
                return
              }

              // Tamamlama + (varsa) teslimde alınan ödeme tek transaction'da kaydedilir;
              // ödeme masaüstündeki akışla aynı kurallara tabidir (kalan borç sınırı, kapalı gün kontrolü).
              const tamamlaVeOdemeKaydet = db.transaction(() => {
                db.prepare(`
                  UPDATE work_orders
                  SET
                    status = 'Tamamlandı',
                    closed_at = CURRENT_TIMESTAMP,
                    closed_by_master_id = ?
                  WHERE id = ? AND status = 'Açık'
                `).run(masterIdNum, woIdNum)

                if (paymentOption === 'full' || paymentOption === 'partial') {
                  const odemeTarihi = bugununTarihi()
                  kapaliGunKontrol(odemeTarihi)

                  const tahsilat = db.prepare(`
                    SELECT COALESCE(SUM(amount), 0) AS toplam
                    FROM work_order_payments
                    WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
                  `).get(woIdNum) as any

                  const kalanBorc = Number((Number(wo.total_price || 0) - Number(tahsilat?.toplam || 0)).toFixed(2))

                  if (kalanBorc > 0.01) {
                    let odenecekTutar = paymentOption === 'full' ? kalanBorc : paymentAmount
                    odenecekTutar = Number(odenecekTutar.toFixed(2))

                    if (odenecekTutar <= 0) {
                      throw new Error('Ödeme tutarı 0\'dan büyük olmalıdır.')
                    }
                    if (odenecekTutar > kalanBorc + 0.01) {
                      throw new Error(`Ödeme tutarı kalan borçtan (${kalanBorc.toLocaleString('tr-TR')} TL) büyük olamaz.`)
                    }
                    if (!paymentMethod) {
                      throw new Error('Ödeme yöntemi seçilmelidir.')
                    }

                    db.prepare(`
                      INSERT INTO work_order_payments (
                        work_order_id, amount, payment_method, payment_date, received_by, note
                      ) VALUES (?, ?, ?, ?, ?, ?)
                    `).run(
                      woIdNum,
                      odenecekTutar,
                      paymentMethod,
                      odemeTarihi,
                      masterIdNum,
                      paymentOption === 'full' ? 'Mobil: teslimde alınan tam ödeme' : 'Mobil: teslimde alınan kısmi ödeme'
                    )
                  }
                }
              })

              tamamlaVeOdemeKaydet()

              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: true }))
            } catch (err: any) {
              console.error('[PhoneServer] Complete work order error:', err)
              res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ success: false, error: err.message || 'Is emri kapatilamadi.' }))
            }
          })
          return
        }
 
        // Default 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('Bulunamadi')
      })

      // Açık soketler izleniyor; Node 16'da closeAllConnections() olmadığı için
      // sunucu durdurulurken bunlar elle kapatılıyor (bkz. stopPhoneServer).
      tempServer.on('connection', (soket) => {
        acikSoketler.add(soket)
        soket.on('close', () => acikSoketler.delete(soket))
      })

      tempServer.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && port < requestedPort + 10) {
          console.log(`[PhoneServer] Port ${port} in use, trying ${port + 1}...`)
          tryListen(port + 1)
        } else {
          console.error('[PhoneServer] Server error:', err)
          resolve({ success: false, error: err.message || 'Port dinlenemedi.' })
        }
      })

      tempServer.listen(port, '0.0.0.0', () => {
        server = tempServer
        currentPort = port
        isRunning = true
        console.log(`[PhoneServer] Server running at http://${getLocalIPAddress()}:${port}`)
        resolve({
          success: true,
          port: port,
          ip: getLocalIPAddress()
        })
      })
    }

    tryListen(requestedPort)
  })
}



