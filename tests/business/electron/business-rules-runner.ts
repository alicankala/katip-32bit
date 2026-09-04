import { app } from 'electron'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

const RESULT_PREFIX = 'KATIP_BUSINESS_RESULT:'
const TEST_DIR_PREFIX = 'katip-integration-'

type Handler = (...args: any[]) => any
type DbRow = Record<string, any>

function dogrulanmisTestDizini(): string {
  if (process.env.KATIP_TEST_MODE !== 'integration') {
    throw new Error('[KATIP_BUSINESS_TEMP_GUARD] Entegrasyon test modu etkin degil.')
  }

  const candidate = process.env.KATIP_BUSINESS_SCENARIO_ROOT
  if (!candidate) {
    throw new Error('[KATIP_BUSINESS_TEMP_GUARD] Test dizini tanimli degil.')
  }

  const tempBase = realpathSync(tmpdir())
  const resolvedRoot = realpathSync(candidate)
  const relativePath = relative(tempBase, resolvedRoot)
  const firstSegment = relativePath.split(sep)[0]

  if (
    relativePath === '' ||
    isAbsolute(relativePath) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    !firstSegment.startsWith(TEST_DIR_PREFIX)
  ) {
    throw new Error(`[KATIP_BUSINESS_TEMP_GUARD] Guvensiz test dizini reddedildi: ${resolvedRoot}`)
  }

  return resolvedRoot
}

function sayi(value: any): number {
  return Number(value) || 0
}

async function calistir(): Promise<void> {
  const scenarioRoot = dogrulanmisTestDizini()
  app.setPath('userData', scenarioRoot)
  await app.whenReady()

  const databaseModule = await import('../../../electron/database.js')
  const workOrderModule = await import('../../../electron/controllers/workOrderController.js')
  const accountModule = await import('../../../electron/controllers/accountController.js')
  const closingModule = await import('../../../electron/controllers/closingController.js')
  const sessionModule = await import('../../../electron/session.js')

  if (realpathSync(dirname(databaseModule.dbPath)) !== scenarioRoot) {
    throw new Error(`[KATIP_BUSINESS_TEMP_GUARD] Veritabani test dizini disinda: ${databaseModule.dbPath}`)
  }

  databaseModule.initDB()
  const db = databaseModule.getDatabase()
  const handlers = new Map<string, Handler>()
  const kanalEkle = (kanal: string, fonksiyon: Handler) => handlers.set(kanal, fonksiyon)
  workOrderModule.registerWorkOrderHandlers(kanalEkle)
  accountModule.registerAccountHandlers(kanalEkle)
  closingModule.registerClosingHandlers(kanalEkle)

  const master = db.prepare('SELECT id FROM masters ORDER BY id LIMIT 1').get() as DbRow
  const masterId = sayi(master?.id)
  if (!masterId) throw new Error('Test ustasi bulunamadi.')
  sessionModule.setActiveMasterSession(masterId)

  const cagir = (kanal: string, veri?: any) => {
    const handler = handlers.get(kanal)
    if (!handler) throw new Error(`Controller handler bulunamadi: ${kanal}`)
    return handler(null, veri)
  }

  let fixtureNo = 0
  const isEmriOlustur = (toplam = 0) => {
    fixtureNo += 1
    const customer = db.prepare(`
      INSERT INTO customers (name, phone, note, is_active)
      VALUES (?, ?, ?, 1)
    `).run(`Business Customer ${fixtureNo}`, `555100${String(fixtureNo).padStart(4, '0')}`, 'stage-3')
    const customerId = sayi(customer.lastInsertRowid)
    const vehicle = db.prepare(`
      INSERT INTO vehicles (customer_id, plate, brand, model, is_active)
      VALUES (?, ?, ?, ?, 1)
    `).run(customerId, `BR${String(fixtureNo).padStart(6, '0')}`, 'Test', 'Fixture')
    const vehicleId = sayi(vehicle.lastInsertRowid)
    const workOrderResult = cagir('is-emri-ekle', {
      vehicle_id: vehicleId,
      description: `Business work order ${fixtureNo}`,
      mileage: 1000 + fixtureNo,
      status: 'Açık'
    })
    if (!workOrderResult?.success) throw new Error(workOrderResult?.error || 'Is emri olusturulamadi.')
    const workOrderId = sayi(workOrderResult.id)
    let itemId: number | null = null
    if (toplam > 0) {
      const itemResult = cagir('is-emri-kalem-ekle', {
        work_order_id: workOrderId,
        type: 'İşçilik',
        description: 'Test işçiliği',
        quantity: 1,
        unit_price: toplam
      })
      if (!itemResult?.success) throw new Error(itemResult?.error || 'Is emri kalemi olusturulamadi.')
      itemId = sayi(itemResult.id)
    }
    return { customerId, vehicleId, workOrderId, itemId }
  }

  const parcaOlustur = (stock: number, codePrefix = 'BUS') => {
    fixtureNo += 1
    const info = db.prepare(`
      INSERT INTO parts (code, name, stock, buy_price, sell_price, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(`${codePrefix}-${fixtureNo}`, `Business Part ${fixtureNo}`, stock, 20, 50)
    return sayi(info.lastInsertRowid)
  }

  try {
    const report: Record<string, any> = {
      safety: {
        scenarioRoot,
        dbPath: databaseModule.dbPath,
        expectedDbPath: join(scenarioRoot, 'otoservis.db')
      }
    }

    // Stok yaşam döngüsü: ekleme, miktar artırma/azaltma ve silme.
    const stockWo = isEmriOlustur()
    const stockPartId = parcaOlustur(10, 'STOCK')
    const addResult = cagir('is-emri-kalem-ekle', {
      work_order_id: stockWo.workOrderId,
      type: 'Parça',
      part_id: stockPartId,
      description: 'Stoklu parça',
      quantity: 2,
      unit_price: 50
    })
    const stockItemId = sayi(addResult?.id)
    report.stockAdd = {
      result: addResult,
      stock: sayi(db.prepare('SELECT stock FROM parts WHERE id = ?').get(stockPartId).stock),
      item: db.prepare('SELECT quantity, total_price FROM work_order_items WHERE id = ?').get(stockItemId),
      order: db.prepare('SELECT total_price FROM work_orders WHERE id = ?').get(stockWo.workOrderId),
      movements: db.prepare(`
        SELECT type, quantity, old_stock, new_stock, master_id, note
        FROM stock_movements WHERE part_id = ? ORDER BY id
      `).all(stockPartId)
    }

    const increaseResult = cagir('is-emri-kalem-guncelle', {
      id: stockItemId,
      type: 'Parça',
      part_id: stockPartId,
      description: 'Stoklu parça',
      quantity: 5,
      unit_price: 50
    })
    report.stockIncrease = {
      result: increaseResult,
      stock: sayi(db.prepare('SELECT stock FROM parts WHERE id = ?').get(stockPartId).stock),
      item: db.prepare('SELECT quantity, total_price FROM work_order_items WHERE id = ?').get(stockItemId),
      order: db.prepare('SELECT total_price FROM work_orders WHERE id = ?').get(stockWo.workOrderId),
      movements: db.prepare(`
        SELECT type, quantity, old_stock, new_stock, master_id, note
        FROM stock_movements WHERE part_id = ? ORDER BY id
      `).all(stockPartId)
    }

    const decreaseResult = cagir('is-emri-kalem-guncelle', {
      id: stockItemId,
      type: 'Parça',
      part_id: stockPartId,
      description: 'Stoklu parça',
      quantity: 3,
      unit_price: 50
    })
    report.stockDecrease = {
      result: decreaseResult,
      stock: sayi(db.prepare('SELECT stock FROM parts WHERE id = ?').get(stockPartId).stock),
      item: db.prepare('SELECT quantity, total_price FROM work_order_items WHERE id = ?').get(stockItemId),
      order: db.prepare('SELECT total_price FROM work_orders WHERE id = ?').get(stockWo.workOrderId),
      movements: db.prepare(`
        SELECT type, quantity, old_stock, new_stock, master_id, note
        FROM stock_movements WHERE part_id = ? ORDER BY id
      `).all(stockPartId)
    }

    const deleteResult = cagir('is-emri-kalem-sil', stockItemId)
    report.stockDelete = {
      result: deleteResult,
      stock: sayi(db.prepare('SELECT stock FROM parts WHERE id = ?').get(stockPartId).stock),
      itemCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_items WHERE id = ?').get(stockItemId).count),
      order: db.prepare('SELECT total_price FROM work_orders WHERE id = ?').get(stockWo.workOrderId),
      movements: db.prepare(`
        SELECT type, quantity, old_stock, new_stock, master_id, note
        FROM stock_movements WHERE part_id = ? ORDER BY id
      `).all(stockPartId),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(stockWo.workOrderId).count)
    }

    // Mevcut iptal davranışı: durum değişir; kalem, stok ve stok hareketi korunur.
    const cancelWo = isEmriOlustur()
    const cancelPartId = parcaOlustur(6, 'CANCEL')
    const cancelItem = cagir('is-emri-kalem-ekle', {
      work_order_id: cancelWo.workOrderId,
      type: 'Parça',
      part_id: cancelPartId,
      description: 'İptal davranışı parçası',
      quantity: 2,
      unit_price: 40
    })
    const cancelMovementBefore = sayi(db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE work_order_id = ?').get(cancelWo.workOrderId).count)
    const cancelResult = cagir('is-emri-guncelle', {
      id: cancelWo.workOrderId,
      description: 'İptal edilen iş emri',
      mileage: 1500,
      status: 'İptal'
    })
    report.orderCancellation = {
      result: cancelResult,
      order: db.prepare('SELECT status, total_price, closed_at, closed_by_master_id FROM work_orders WHERE id = ?').get(cancelWo.workOrderId),
      stock: sayi(db.prepare('SELECT stock FROM parts WHERE id = ?').get(cancelPartId).stock),
      item: db.prepare('SELECT id, quantity, total_price FROM work_order_items WHERE id = ?').get(sayi(cancelItem.id)),
      movementCountBefore: cancelMovementBefore,
      movementCountAfter: sayi(db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE work_order_id = ?').get(cancelWo.workOrderId).count),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(cancelWo.workOrderId).count)
    }

    // Tahsilat ekleme ve iptal denetim izi.
    const paymentWo = isEmriOlustur(100)
    const paymentDate = '2024-01-10'
    const paymentAddResult = cagir('is-emri-odeme-ekle', {
      work_order_id: paymentWo.workOrderId,
      amount: 60,
      payment_method: 'Nakit',
      payment_date: paymentDate,
      note: 'Aşama 3 tahsilatı'
    })
    const paymentRow = db.prepare('SELECT * FROM work_order_payments WHERE work_order_id = ? ORDER BY id DESC LIMIT 1').get(paymentWo.workOrderId) as DbRow
    report.paymentAdd = {
      result: paymentAddResult,
      payment: paymentRow,
      order: db.prepare('SELECT status, total_price FROM work_orders WHERE id = ?').get(paymentWo.workOrderId),
      activeTotal: sayi(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total FROM work_order_payments
        WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(paymentWo.workOrderId).total),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(paymentWo.workOrderId).count)
    }
    const paymentCancelResult = cagir('is-emri-odeme-iptal', {
      payment_id: paymentRow.id,
      cancel_reason: 'Yanlış tahsilat kaydı'
    })
    report.paymentCancel = {
      result: paymentCancelResult,
      payment: db.prepare('SELECT * FROM work_order_payments WHERE id = ?').get(paymentRow.id),
      activeTotal: sayi(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total FROM work_order_payments
        WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(paymentWo.workOrderId).total),
      paymentCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_payments WHERE work_order_id = ?').get(paymentWo.workOrderId).count),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(paymentWo.workOrderId).count)
    }

    // Tahsilat varken toplamı aşağı düşürme girişimi tamamen geri alınmalı.
    const floorWo = isEmriOlustur(100)
    const floorPayment = cagir('is-emri-odeme-ekle', {
      work_order_id: floorWo.workOrderId,
      amount: 80,
      payment_method: 'Kart',
      payment_date: '2024-01-11',
      note: 'Toplam alt sınırı'
    })
    if (!floorPayment?.success) throw new Error(floorPayment?.error || 'Alt sinir odemesi eklenemedi.')
    const floorResult = cagir('is-emri-kalem-guncelle', {
      id: floorWo.itemId,
      type: 'İşçilik',
      description: 'Düşürülmek istenen işçilik',
      quantity: 1,
      unit_price: 50
    })
    report.paymentFloor = {
      result: floorResult,
      item: db.prepare('SELECT quantity, unit_price, total_price FROM work_order_items WHERE id = ?').get(floorWo.itemId),
      order: db.prepare('SELECT status, total_price FROM work_orders WHERE id = ?').get(floorWo.workOrderId),
      payments: db.prepare('SELECT amount, is_cancelled FROM work_order_payments WHERE work_order_id = ?').all(floorWo.workOrderId),
      movementCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE work_order_id = ?').get(floorWo.workOrderId).count),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(floorWo.workOrderId).count)
    }

    // Tamamlama + ödeme başarılı durumda tek transaction sonucu üretir.
    const atomicWo = isEmriOlustur(120)
    const atomicResult = cagir('is-emri-tamamla-ve-odeme-kaydet', {
      id: atomicWo.workOrderId,
      payment_option: 'partial',
      amount: 40,
      payment_method: 'Havale / EFT',
      payment_date: '2024-01-12',
      note: 'Atomik tamamlama'
    })
    report.atomicSuccess = {
      result: atomicResult,
      order: db.prepare('SELECT status, total_price, closed_at, closed_by_master_id FROM work_orders WHERE id = ?').get(atomicWo.workOrderId),
      payments: db.prepare('SELECT amount, payment_method, payment_date, received_by, note FROM work_order_payments WHERE work_order_id = ?').all(atomicWo.workOrderId),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(atomicWo.workOrderId).count)
    }

    // Ödeme insert'i ortada hata verirse tamamlanma da rollback olmalı.
    const atomicRollbackWo = isEmriOlustur(90)
    db.exec(`
      CREATE TRIGGER force_payment_rollback
      BEFORE INSERT ON work_order_payments
      WHEN NEW.note = 'FORCE_PAYMENT_ROLLBACK'
      BEGIN
        SELECT RAISE(ABORT, 'forced payment rollback');
      END;
    `)
    const atomicRollbackResult = cagir('is-emri-tamamla-ve-odeme-kaydet', {
      id: atomicRollbackWo.workOrderId,
      payment_option: 'partial',
      amount: 30,
      payment_method: 'Nakit',
      payment_date: '2024-01-13',
      note: 'FORCE_PAYMENT_ROLLBACK'
    })
    db.exec('DROP TRIGGER force_payment_rollback')
    report.atomicRollback = {
      result: atomicRollbackResult,
      order: db.prepare('SELECT status, total_price, closed_at, closed_by_master_id FROM work_orders WHERE id = ?').get(atomicRollbackWo.workOrderId),
      paymentCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_payments WHERE work_order_id = ?').get(atomicRollbackWo.workOrderId).count),
      itemCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_items WHERE work_order_id = ?').get(atomicRollbackWo.workOrderId).count),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(atomicRollbackWo.workOrderId).count)
    }

    // Stok düşümü ve hareket kaydından sonra kalem insert'i hata verirse hepsi rollback olmalı.
    const stockRollbackWo = isEmriOlustur()
    const stockRollbackPartId = parcaOlustur(5, 'ROLLBACK')
    db.exec(`
      CREATE TRIGGER force_item_rollback
      BEFORE INSERT ON work_order_items
      WHEN NEW.description = 'FORCE_ITEM_ROLLBACK'
      BEGIN
        SELECT RAISE(ABORT, 'forced item rollback');
      END;
    `)
    const stockRollbackResult = cagir('is-emri-kalem-ekle', {
      work_order_id: stockRollbackWo.workOrderId,
      type: 'Parça',
      part_id: stockRollbackPartId,
      description: 'FORCE_ITEM_ROLLBACK',
      quantity: 2,
      unit_price: 50
    })
    db.exec('DROP TRIGGER force_item_rollback')
    report.stockRollback = {
      result: stockRollbackResult,
      stock: sayi(db.prepare('SELECT stock FROM parts WHERE id = ?').get(stockRollbackPartId).stock),
      itemCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_items WHERE work_order_id = ?').get(stockRollbackWo.workOrderId).count),
      movementCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM stock_movements WHERE work_order_id = ?').get(stockRollbackWo.workOrderId).count),
      order: db.prepare('SELECT status, total_price FROM work_orders WHERE id = ?').get(stockRollbackWo.workOrderId),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(stockRollbackWo.workOrderId).count)
    }

    // Gün sonu yöntem toplamları, iptal ödeme dışlama ve cari/gider yönleri.
    const summaryDate = '2024-01-15'
    const summaryPayments = [
      { amount: 100, method: 'Nakit' },
      { amount: 50, method: 'Kredi Kartı' },
      { amount: 25, method: 'Havale / EFT' }
    ]
    const summaryWorkOrders: number[] = []
    for (const entry of summaryPayments) {
      const wo = isEmriOlustur(entry.amount)
      summaryWorkOrders.push(wo.workOrderId)
      const result = cagir('is-emri-odeme-ekle', {
        work_order_id: wo.workOrderId,
        amount: entry.amount,
        payment_method: entry.method,
        payment_date: summaryDate,
        note: 'Gün sonu tahsilatı'
      })
      if (!result?.success) throw new Error(result?.error || 'Gun sonu odemesi eklenemedi.')
    }
    const cancelledSummaryWo = isEmriOlustur(40)
    const cancelledSummaryAdd = cagir('is-emri-odeme-ekle', {
      work_order_id: cancelledSummaryWo.workOrderId,
      amount: 40,
      payment_method: 'Nakit',
      payment_date: summaryDate,
      note: 'İptal edilip dışlanacak'
    })
    if (!cancelledSummaryAdd?.success) throw new Error(cancelledSummaryAdd?.error || 'Iptal fixture odemesi eklenemedi.')
    const cancelledSummaryPayment = db.prepare('SELECT id FROM work_order_payments WHERE work_order_id = ?').get(cancelledSummaryWo.workOrderId) as DbRow
    const cancelledSummaryResult = cagir('is-emri-odeme-iptal', {
      payment_id: cancelledSummaryPayment.id,
      cancel_reason: 'Gün sonu dışlama kontrolü'
    })

    const alacakAccount = cagir('cari-hesap-ekle', { name: 'Alacak Cari', type: 'Müşteri', direction: 'Alacak' })
    const borcAccount = cagir('cari-hesap-ekle', { name: 'Borç Cari', type: 'Tedarikçi', direction: 'Borç' })
    const alacakPayment = cagir('cari-odeme-ekle', {
      current_account_id: alacakAccount.id,
      date: summaryDate,
      amount: 30,
      payment_method: 'Nakit',
      description: 'Müşteriden tahsilat'
    })
    const borcPayment = cagir('cari-odeme-ekle', {
      current_account_id: borcAccount.id,
      date: summaryDate,
      amount: 20,
      payment_method: 'Kart',
      description: 'Tedarikçiye ödeme'
    })
    const expenseResult = cagir('gider-ekle', {
      expense_type: 'Test gideri',
      company_name: 'Fixture Ltd',
      expense_date: summaryDate,
      amount: 15,
      status: 'Ödendi',
      payment_date: summaryDate,
      payment_method: 'Nakit',
      note: 'Gün sonu gideri'
    })
    const summaryResult = cagir('gun-sonu-ozeti-getir', summaryDate)
    report.dailySummary = {
      result: summaryResult,
      cancelledResult: cancelledSummaryResult,
      workOrderPayments: db.prepare(`
        SELECT amount, payment_method, is_cancelled, cancel_reason
        FROM work_order_payments WHERE payment_date = ? ORDER BY id
      `).all(summaryDate),
      activeWorkOrderTotal: sayi(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total FROM work_order_payments
        WHERE payment_date = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(summaryDate).total),
      cancelledWorkOrderTotal: sayi(db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS total FROM work_order_payments
        WHERE payment_date = ? AND is_cancelled = 1
      `).get(summaryDate).total),
      accountResults: { alacakAccount, borcAccount, alacakPayment, borcPayment },
      accountPayments: db.prepare(`
        SELECT p.amount, p.payment_method, ca.direction
        FROM account_payments p JOIN current_accounts ca ON ca.id = p.current_account_id
        WHERE p.date = ? ORDER BY p.id
      `).all(summaryDate),
      expenseResult,
      expenses: db.prepare(`
        SELECT amount, status, payment_date, payment_method
        FROM general_expenses WHERE payment_date = ? ORDER BY id
      `).all(summaryDate)
    }

    // Ana panel yalnızca en yüksek üç borcu döndürür; toplam ise tüm açık borçları kapsar.
    const dashboardDebtAmounts = [100, 400, 300, 200]
    const dashboardDebtAccounts = dashboardDebtAmounts.map((amount, index) => {
      const account = cagir('cari-hesap-ekle', {
        name: `Panel Borç ${index + 1}`,
        type: 'Tedarikçi',
        direction: 'Borç'
      })
      const transaction = cagir('cari-islem-ekle', {
        current_account_id: account.id,
        date: '2024-02-01',
        transaction_type: 'Borç',
        description: 'Ana panel borç testi',
        amount
      })
      return { account, transaction }
    })
    const dashboardDebtPayment = cagir('cari-odeme-ekle', {
      current_account_id: dashboardDebtAccounts[0].account.id,
      date: '2024-02-02',
      amount: 10,
      payment_method: 'Nakit',
      description: 'Ana panel borç testi ödemesi'
    })
    report.dashboardDebts = {
      result: cagir('ana-panel-borclari-getir', 3),
      accountResults: dashboardDebtAccounts,
      paymentResult: dashboardDebtPayment
    }

    const editedDashboardDebt = cagir('cari-islem-guncelle', {
      id: dashboardDebtAccounts[0].transaction.id,
      current_account_id: dashboardDebtAccounts[0].account.id,
      date: '2024-02-01',
      transaction_type: 'Mal / Parça Alışı',
      description: 'Düzeltilmiş borç',
      amount: 500,
      note: 'Yanlış tutar düzeltildi',
      due_date: '2024-02-10'
    })
    report.dashboardDebtEdit = {
      result: editedDashboardDebt,
      transaction: db.prepare(`
        SELECT current_account_id, date, transaction_type, description, amount, note, due_date
        FROM account_transactions
        WHERE id = ?
      `).get(dashboardDebtAccounts[0].transaction.id),
      dashboard: cagir('ana-panel-borclari-getir', 3)
    }

    // Kapalı güne ekleme ve iptal girişimleri hiçbir kayıt değiştirmemeli.
    const closedDate = '2024-01-16'
    const closedWo = isEmriOlustur(100)
    const closedInitialPayment = cagir('is-emri-odeme-ekle', {
      work_order_id: closedWo.workOrderId,
      amount: 30,
      payment_method: 'Nakit',
      payment_date: closedDate,
      note: 'Kapanış öncesi ödeme'
    })
    if (!closedInitialPayment?.success) throw new Error(closedInitialPayment?.error || 'Kapanis fixture odemesi eklenemedi.')
    const closedAccountTransaction = cagir('cari-islem-ekle', {
      current_account_id: borcAccount.id,
      date: closedDate,
      transaction_type: 'Borç',
      description: 'Kapanış öncesi cari işlem',
      amount: 75
    })
    if (!closedAccountTransaction?.success) throw new Error(closedAccountTransaction?.error || 'Kapanis cari islemi eklenemedi.')
    const closedPaymentRow = db.prepare('SELECT id FROM work_order_payments WHERE work_order_id = ?').get(closedWo.workOrderId) as DbRow
    const closeResult = cagir('gun-sonu-kapat', {
      closing_date: closedDate,
      counted_cash: null,
      note: 'Aşama 3 kapalı gün fixture'
    })
    const beforeClosedCounts = {
      workOrderPayments: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_payments WHERE payment_date = ?').get(closedDate).count),
      accountPayments: sayi(db.prepare('SELECT COUNT(*) AS count FROM account_payments WHERE date = ?').get(closedDate).count),
      expenses: sayi(db.prepare('SELECT COUNT(*) AS count FROM general_expenses WHERE payment_date = ?').get(closedDate).count)
    }
    const closedWorkOrderAdd = cagir('is-emri-odeme-ekle', {
      work_order_id: closedWo.workOrderId,
      amount: 10,
      payment_method: 'Kart',
      payment_date: closedDate,
      note: 'Yasak geriye dönük ödeme'
    })
    const closedWorkOrderCancel = cagir('is-emri-odeme-iptal', {
      payment_id: closedPaymentRow.id,
      cancel_reason: 'Yasak geriye dönük iptal'
    })
    const closedAccountAdd = cagir('cari-odeme-ekle', {
      current_account_id: alacakAccount.id,
      date: closedDate,
      amount: 10,
      payment_method: 'Nakit',
      description: 'Yasak cari ödeme'
    })
    const closedAccountEdit = cagir('cari-islem-guncelle', {
      id: closedAccountTransaction.id,
      current_account_id: borcAccount.id,
      date: closedDate,
      transaction_type: 'Borç',
      description: 'Yasak geriye dönük düzeltme',
      amount: 125
    })
    const closedExpenseAdd = cagir('gider-ekle', {
      expense_type: 'Yasak gider',
      expense_date: closedDate,
      amount: 10,
      status: 'Ödendi',
      payment_date: closedDate,
      payment_method: 'Nakit'
    })
    report.closedDay = {
      closeResult,
      results: { closedWorkOrderAdd, closedWorkOrderCancel, closedAccountAdd, closedAccountEdit, closedExpenseAdd },
      beforeCounts: beforeClosedCounts,
      afterCounts: {
        workOrderPayments: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_payments WHERE payment_date = ?').get(closedDate).count),
        accountPayments: sayi(db.prepare('SELECT COUNT(*) AS count FROM account_payments WHERE date = ?').get(closedDate).count),
        expenses: sayi(db.prepare('SELECT COUNT(*) AS count FROM general_expenses WHERE payment_date = ?').get(closedDate).count)
      },
      payment: db.prepare('SELECT is_cancelled, cancelled_at, cancel_reason FROM work_order_payments WHERE id = ?').get(closedPaymentRow.id),
      accountTransaction: db.prepare('SELECT description, amount FROM account_transactions WHERE id = ?').get(closedAccountTransaction.id),
      closing: db.prepare('SELECT closing_date, total_collected FROM daily_closings WHERE closing_date = ?').get(closedDate),
      logCount: sayi(db.prepare('SELECT COUNT(*) AS count FROM work_order_logs WHERE work_order_id = ?').get(closedWo.workOrderId).count)
    }

    report.quickCheck = String(Object.values(db.prepare('PRAGMA quick_check').get())[0])
    console.log(RESULT_PREFIX + JSON.stringify(report))
  } finally {
    sessionModule.clearActiveMasterSession()
    db.close()
  }
}

calistir()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
