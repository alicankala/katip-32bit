import db from '../database.js'
import { kapaliGunKontrol } from './closingController.js'

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

const TARIH_FORMATI = /^\d{4}-\d{2}-\d{2}$/
const AY_ADLARI = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'
]

function tarihiAyKaydir(tarih: string, aySayisi: number): string | null {
  const eslesme = TARIH_FORMATI.exec(String(tarih || ''))
  if (!eslesme) return null

  const [yil, ay, gun] = tarih.split('-').map(Number)
  const toplamAy = yil * 12 + (ay - 1) + aySayisi
  const hedefYil = Math.floor(toplamAy / 12)
  const hedefAy = toplamAy % 12
  const ayinSonGunu = new Date(Date.UTC(hedefYil, hedefAy + 1, 0)).getUTCDate()
  const hedefGun = Math.min(gun, ayinSonGunu)
  return `${hedefYil}-${String(hedefAy + 1).padStart(2, '0')}-${String(hedefGun).padStart(2, '0')}`
}

function aySirasi(tarih: string): number {
  const [yil, ay] = String(tarih || '').split('-').map(Number)
  return yil * 12 + (ay - 1)
}

// Aylık giderlerde gelecek aylar topluca oluşturulmaz. Ekran açıldığında yalnızca
// gelmiş ayların eksik kayıtları tamamlanır; böylece bakiye bugünü doğru yansıtır.
function aylikGiderKayitlariniOlustur() {
  const simdi = new Date()
  const buAySirasi = simdi.getFullYear() * 12 + simdi.getMonth()
  const kokKayitlar = db.prepare(`
    SELECT * FROM general_expenses
    WHERE recurrence_type = 'Aylık'
      AND recurrence_root_id = id
      AND recurrence_renewed_by_id IS NULL
  `).all() as any[]

  const ekle = db.prepare(`
    INSERT OR IGNORE INTO general_expenses (
      expense_type, company_name, period, expense_date, due_date, amount,
      status, payment_date, payment_method, note, recurrence_type,
      recurrence_end_date, recurrence_root_id, recurrence_renewed_by_id
    ) VALUES (?, ?, ?, ?, ?, ?, 'Ödenmedi', NULL, NULL, ?, 'Aylık', ?, ?, NULL)
  `)

  const eksikleriTamamla = db.transaction(() => {
    for (const kok of kokKayitlar) {
      const baslangicAySirasi = aySirasi(kok.expense_date)
      if (!Number.isFinite(baslangicAySirasi)) continue

      const enFazlaAy = Math.min(buAySirasi - baslangicAySirasi, 1200)
      for (let ayFarki = 1; ayFarki <= enFazlaAy; ayFarki++) {
        const giderTarihi = tarihiAyKaydir(kok.expense_date, ayFarki)
        if (!giderTarihi) break
        if (kok.recurrence_end_date && giderTarihi > kok.recurrence_end_date) break

        const sonOdemeTarihi = kok.due_date ? tarihiAyKaydir(kok.due_date, ayFarki) : null
        const [yil, ay] = giderTarihi.split('-').map(Number)
        const donem = `${AY_ADLARI[ay - 1]} ${yil}`
        ekle.run(
          kok.expense_type,
          kok.company_name,
          donem,
          giderTarihi,
          sonOdemeTarihi,
          Number(kok.amount) || 0,
          kok.note,
          kok.recurrence_end_date || null,
          kok.id
        )
      }
    }
  })

  eksikleriTamamla()
}

// Gider "Ödendi" ise ödeme tarihi ve yöntemi zorunludur; aksi halde gider hiçbir
// günün gün sonu çıkışında görünmez. "Ödenmedi" durumunda bu alanlar temizlenir.
function giderOdemeAlanlariniDogrula(gider: any): { payment_date: string | null; payment_method: string | null } {
  const status = String(gider.status || 'Ödenmedi').trim()
  const paymentDate = gider.payment_date ? String(gider.payment_date).trim() : ''
  const paymentMethod = gider.payment_method ? String(gider.payment_method).trim() : ''

  if (status !== 'Ödendi') {
    return { payment_date: null, payment_method: null }
  }

  if (!paymentDate || !TARIH_FORMATI.test(paymentDate)) {
    throw new Error('"Ödendi" durumundaki gider için geçerli bir ödeme tarihi girilmelidir.')
  }
  if (!paymentMethod) {
    throw new Error('"Ödendi" durumundaki gider için ödeme yöntemi seçilmelidir.')
  }

  return { payment_date: paymentDate, payment_method: paymentMethod }
}

export function registerAccountHandlers(kanalEkle: (kanal: string, fonksiyon: (...args: any[]) => any) => void) {
  // 1. Cari Hesaplar - Getir
  kanalEkle('cari-hesaplari-getir', () => {
    try {
      const accounts = db.prepare(`
        SELECT
          ca.*,
          COALESCE((SELECT SUM(amount) FROM account_transactions WHERE current_account_id = ca.id), 0) AS total_debt,
          COALESCE((SELECT SUM(amount) FROM account_payments WHERE current_account_id = ca.id), 0) AS total_paid,
          (COALESCE((SELECT SUM(amount) FROM account_transactions WHERE current_account_id = ca.id), 0) -
           COALESCE((SELECT SUM(amount) FROM account_payments WHERE current_account_id = ca.id), 0)) AS remaining_debt
        FROM current_accounts ca
        WHERE IFNULL(ca.is_active, 1) = 1
        ORDER BY ca.name ASC
      `).all()
      return { success: true, accounts }
    } catch (error) {
      console.error('Cari hesapları getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // Ana panel için yalnızca özet ve en yüksek üç açık borç döndürülür.
  // Tüm cari listesini renderer'a taşımamak x86 cihazlarda RAM ve render yükünü düşük tutar.
  kanalEkle('ana-panel-borclari-getir', (_event, limitDegeri: any = 3) => {
    try {
      const limit = Math.min(Math.max(Number.parseInt(String(limitDegeri), 10) || 3, 1), 5)
      const satirlar = db.prepare(`
        WITH islem_toplamlari AS (
          SELECT current_account_id, SUM(amount) AS total_debt
          FROM account_transactions
          GROUP BY current_account_id
        ),
        odeme_toplamlari AS (
          SELECT current_account_id, SUM(amount) AS total_paid
          FROM account_payments
          GROUP BY current_account_id
        ),
        acik_borclar AS (
          SELECT
            ca.id,
            ca.name,
            ca.type,
            COALESCE(it.total_debt, 0) - COALESCE(ot.total_paid, 0) AS remaining_debt
          FROM current_accounts ca
          LEFT JOIN islem_toplamlari it ON it.current_account_id = ca.id
          LEFT JOIN odeme_toplamlari ot ON ot.current_account_id = ca.id
          WHERE IFNULL(ca.is_active, 1) = 1
            AND IFNULL(ca.direction, 'Borç') = 'Borç'
            AND COALESCE(it.total_debt, 0) - COALESCE(ot.total_paid, 0) > 0.01
        )
        SELECT
          id,
          name,
          type,
          remaining_debt,
          COUNT(*) OVER () AS open_account_count,
          SUM(remaining_debt) OVER () AS total_debt
        FROM acik_borclar
        ORDER BY remaining_debt DESC, name COLLATE NOCASE ASC
        LIMIT ?
      `).all(limit) as any[]

      return {
        success: true,
        totalDebt: Number(satirlar[0]?.total_debt || 0),
        openAccountCount: Number(satirlar[0]?.open_account_count || 0),
        debts: satirlar.map(({ id, name, type, remaining_debt }) => ({
          id,
          name,
          type,
          remaining_debt: Number(remaining_debt || 0)
        }))
      }
    } catch (error) {
      console.error('Ana panel borç özeti hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 2. Cari Hesap - Ekle
  kanalEkle('cari-hesap-ekle', (_event, hesap: any) => {
    try {
      const name = String(hesap.name || '').trim()
      const type = String(hesap.type || '').trim()
      const phone = String(hesap.phone || '').trim()
      const note = String(hesap.note || '').trim()

      const direction = String(hesap.direction || 'Borç').trim()

      if (!name) {
        throw new Error('Cari hesap adı boş bırakılamaz.')
      }
      if (!type) {
        throw new Error('Cari hesap tipi seçilmelidir.')
      }

      const stmt = db.prepare(`
        INSERT INTO current_accounts (name, type, phone, note, direction, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `)
      const info = stmt.run(name, type, phone, note, direction)
      return { success: true, id: info.lastInsertRowid }
    } catch (error) {
      console.error('Cari hesap ekleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 3. Cari Hesap - Güncelle
  kanalEkle('cari-hesap-guncelle', (_event, hesap: any) => {
    try {
      const id = Number(hesap.id)
      const name = String(hesap.name || '').trim()
      const type = String(hesap.type || '').trim()
      const phone = String(hesap.phone || '').trim()
      const note = String(hesap.note || '').trim()
      const direction = String(hesap.direction || 'Borç').trim()

      if (!id) {
        throw new Error('Güncellenecek cari hesap bulunamadı.')
      }
      if (!name) {
        throw new Error('Cari hesap adı boş bırakılamaz.')
      }
      if (!type) {
        throw new Error('Cari hesap tipi seçilmelidir.')
      }

      db.prepare(`
        UPDATE current_accounts
        SET name = ?, type = ?, phone = ?, note = ?, direction = ?
        WHERE id = ?
      `).run(name, type, phone, note, direction, id)
      return { success: true }
    } catch (error) {
      console.error('Cari hesap güncelleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 4. Cari Hesap - Sil (Pasife Al)
  kanalEkle('cari-hesap-sil', (_event, id: number) => {
    try {
      const accountId = Number(id)
      if (!accountId) {
        throw new Error('Silinecek cari hesap bulunamadı.')
      }

      db.prepare(`
        UPDATE current_accounts
        SET is_active = 0
        WHERE id = ?
      `).run(accountId)
      return { success: true }
    } catch (error) {
      console.error('Cari hesap silme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 5. Cari İşlemleri Getir
  kanalEkle('cari-islemleri-getir', (_event, currentAccountId: number) => {
    try {
      const accountId = Number(currentAccountId)
      if (!accountId) {
        throw new Error('Cari hesap bilgisi geçersiz.')
      }

      const transactions = db.prepare(`
        SELECT
          t.*,
          v.plate AS vehicle_plate,
          v.brand AS vehicle_brand,
          v.model AS vehicle_model
        FROM account_transactions t
        LEFT JOIN vehicles v ON t.vehicle_id = v.id
        WHERE t.current_account_id = ?
        ORDER BY t.date DESC, t.id DESC
      `).all(accountId)
      return { success: true, transactions }
    } catch (error) {
      console.error('Cari işlemleri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 6. Cari İşlem Ekle
  kanalEkle('cari-islem-ekle', (_event, islem: any) => {
    try {
      const current_account_id = Number(islem.current_account_id)
      const date = String(islem.date || '').trim()
      const transaction_type = String(islem.transaction_type || '').trim()
      const description = String(islem.description || '').trim()
      const amount = Number(islem.amount) || 0
      const vehicle_id = islem.vehicle_id ? Number(islem.vehicle_id) : null
      const work_order_id = islem.work_order_id ? Number(islem.work_order_id) : null
      const note = String(islem.note || '').trim()
      const due_date = String(islem.due_date || '').trim() || null

      if (!current_account_id) {
        throw new Error('İşlem için cari hesap seçilmelidir.')
      }
      if (!date) {
        throw new Error('Tarih alanı boş bırakılamaz.')
      }
      if (!transaction_type) {
        throw new Error('İşlem tipi seçilmelidir.')
      }
      if (amount <= 0) {
        throw new Error('İşlem tutarı sıfırdan büyük olmalıdır.')
      }

      const stmt = db.prepare(`
        INSERT INTO account_transactions (
          current_account_id, date, transaction_type, description, amount, vehicle_id, work_order_id, note, due_date
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const info = stmt.run(current_account_id, date, transaction_type, description, amount, vehicle_id, work_order_id, note, due_date)
      return { success: true, id: info.lastInsertRowid }
    } catch (error) {
      console.error('Cari işlem ekleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 7. Cari İşlem Güncelle
  kanalEkle('cari-islem-guncelle', (_event, islem: any) => {
    try {
      const id = Number(islem.id)
      const current_account_id = Number(islem.current_account_id)
      const date = String(islem.date || '').trim()
      const transaction_type = String(islem.transaction_type || '').trim()
      const description = String(islem.description || '').trim()
      const amount = Number(islem.amount) || 0
      const vehicle_id = islem.vehicle_id ? Number(islem.vehicle_id) : null
      const work_order_id = islem.work_order_id ? Number(islem.work_order_id) : null
      const note = String(islem.note || '').trim()
      const due_date = String(islem.due_date || '').trim() || null

      if (!id) throw new Error('Güncellenecek cari işlem bulunamadı.')
      if (!current_account_id) throw new Error('İşlem için cari hesap seçilmelidir.')
      if (!date) throw new Error('Tarih alanı boş bırakılamaz.')
      if (!transaction_type) throw new Error('İşlem tipi seçilmelidir.')
      if (amount <= 0) throw new Error('İşlem tutarı sıfırdan büyük olmalıdır.')

      const mevcutIslem = db.prepare(`
        SELECT id, date
        FROM account_transactions
        WHERE id = ?
      `).get(id) as any
      if (!mevcutIslem) throw new Error('Güncellenecek cari işlem bulunamadı.')

      // Kapanmış bir günün kaydı değiştirilemez ve kayıt kapanmış başka bir güne taşınamaz.
      kapaliGunKontrol(mevcutIslem.date)
      if (date !== mevcutIslem.date) kapaliGunKontrol(date)

      db.prepare(`
        UPDATE account_transactions
        SET current_account_id = ?, date = ?, transaction_type = ?, description = ?,
            amount = ?, vehicle_id = ?, work_order_id = ?, note = ?, due_date = ?
        WHERE id = ?
      `).run(
        current_account_id,
        date,
        transaction_type,
        description,
        amount,
        vehicle_id,
        work_order_id,
        note,
        due_date,
        id
      )

      return { success: true }
    } catch (error) {
      console.error('Cari işlem güncelleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 8. Cari İşlem Sil
  kanalEkle('cari-islem-sil', (_event, id: number) => {
    try {
      const transactionId = Number(id)
      if (!transactionId) {
        throw new Error('Silinecek işlem bulunamadı.')
      }

      db.prepare(`
        DELETE FROM account_transactions
        WHERE id = ?
      `).run(transactionId)
      return { success: true }
    } catch (error) {
      console.error('Cari işlem silme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 8. Cari Ödemeleri Getir
  kanalEkle('cari-odemeleri-getir', (_event, currentAccountId: number) => {
    try {
      const accountId = Number(currentAccountId)
      if (!accountId) {
        throw new Error('Cari hesap bilgisi geçersiz.')
      }

      const payments = db.prepare(`
        SELECT
          p.*,
          t.description AS transaction_description
        FROM account_payments p
        LEFT JOIN account_transactions t ON p.transaction_id = t.id
        WHERE p.current_account_id = ?
        ORDER BY p.date DESC, p.id DESC
      `).all(accountId)
      return { success: true, payments }
    } catch (error) {
      console.error('Cari ödemeleri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 9. Cari Ödeme Ekle
  kanalEkle('cari-odeme-ekle', (_event, odeme: any) => {
    try {
      const current_account_id = Number(odeme.current_account_id)
      const transaction_id = odeme.transaction_id ? Number(odeme.transaction_id) : null
      const date = String(odeme.date || '').trim()
      const amount = Number(odeme.amount) || 0
      const payment_method = String(odeme.payment_method || '').trim()
      const description = String(odeme.description || '').trim()

      if (!current_account_id) {
        throw new Error('Ödeme için cari hesap seçilmelidir.')
      }
      if (!date) {
        throw new Error('Tarih alanı boş bırakılamaz.')
      }
      if (amount <= 0) {
        throw new Error('Ödeme tutarı sıfırdan büyük olmalıdır.')
      }
      if (!payment_method) {
        throw new Error('Ödeme yöntemi seçilmelidir.')
      }

      kapaliGunKontrol(date)

      const stmt = db.prepare(`
        INSERT INTO account_payments (
          current_account_id, transaction_id, date, amount, payment_method, description
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      const info = stmt.run(current_account_id, transaction_id, date, amount, payment_method, description)
      return { success: true, id: info.lastInsertRowid }
    } catch (error) {
      console.error('Cari ödeme ekleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 10. Cari Ödeme Sil
  kanalEkle('cari-odeme-sil', (_event, id: number) => {
    try {
      const paymentId = Number(id)
      if (!paymentId) {
        throw new Error('Silinecek ödeme kaydı bulunamadı.')
      }

      const mevcutOdeme = db.prepare('SELECT date FROM account_payments WHERE id = ?').get(paymentId) as any
      if (mevcutOdeme) {
        kapaliGunKontrol(mevcutOdeme.date)
      }

      db.prepare(`
        DELETE FROM account_payments
        WHERE id = ?
      `).run(paymentId)
      return { success: true }
    } catch (error) {
      console.error('Cari ödeme silme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 11. Genel Giderler - Getir
  kanalEkle('giderleri-getir', () => {
    try {
      aylikGiderKayitlariniOlustur()
      const giderler = db.prepare(`
        SELECT * FROM general_expenses
        ORDER BY expense_date DESC, id DESC
      `).all()
      return { success: true, giderler }
    } catch (error) {
      console.error('Giderleri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 12. Genel Gider - Ekle
  kanalEkle('gider-ekle', (_event, gider: any) => {
    try {
      const { expense_type, company_name, period, expense_date, due_date, amount, status, payment_date, payment_method, note } = gider
      const recurrenceType = gider.recurrence_type === 'Aylık' ? 'Aylık' : 'Tek Seferlik'
      const recurrenceEndDate = gider.recurrence_end_date ? String(gider.recurrence_end_date).trim() : null

      if (!expense_type || !String(expense_type).trim()) {
        throw new Error('Gider türü boş bırakılamaz.')
      }
      if (!expense_date || !String(expense_date).trim()) {
        throw new Error('Gider tarihi boş bırakılamaz.')
      }
      if (recurrenceEndDate && (!TARIH_FORMATI.test(recurrenceEndDate) || recurrenceEndDate < String(expense_date).trim())) {
        throw new Error('Taahhüt bitiş tarihi gider tarihinden önce olamaz.')
      }

      const odemeAlanlari = giderOdemeAlanlariniDogrula(gider)
      kapaliGunKontrol(odemeAlanlari.payment_date)

      const info = db.prepare(`
        INSERT INTO general_expenses (
          expense_type, company_name, period, expense_date, due_date, amount, status,
          payment_date, payment_method, note, recurrence_type, recurrence_end_date,
          recurrence_root_id, recurrence_renewed_by_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
      `).run(
        String(expense_type).trim(),
        company_name ? String(company_name).trim() : null,
        period ? String(period).trim() : null,
        String(expense_date).trim(),
        due_date ? String(due_date).trim() : null,
        Number(amount) || 0,
        status || 'Ödenmedi',
        odemeAlanlari.payment_date,
        odemeAlanlari.payment_method,
        note ? String(note).trim() : null,
        recurrenceType,
        recurrenceEndDate
      )
      const yeniGiderId = Number(info.lastInsertRowid)

      if (recurrenceType === 'Aylık') {
        db.prepare('UPDATE general_expenses SET recurrence_root_id = ? WHERE id = ?').run(yeniGiderId, yeniGiderId)
      }

      const yenilenenKokId = Number(gider.renewed_from_root_id) || null
      if (yenilenenKokId) {
        db.prepare(`
          UPDATE general_expenses
          SET recurrence_renewed_by_id = ?
          WHERE id = ? AND recurrence_root_id = id
        `).run(yeniGiderId, yenilenenKokId)
      }

      return { success: true, id: yeniGiderId }
    } catch (error) {
      console.error('Gider ekleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 13. Genel Gider - Güncelle
  kanalEkle('gider-guncelle', (_event, gider: any) => {
    try {
      const { id, expense_type, company_name, period, expense_date, due_date, amount, status, payment_date, payment_method, note } = gider
      const recurrenceType = gider.recurrence_type === 'Aylık' ? 'Aylık' : 'Tek Seferlik'
      const recurrenceEndDate = gider.recurrence_end_date ? String(gider.recurrence_end_date).trim() : null

      if (!id) {
        throw new Error('Güncellenecek gider kaydı bulunamadı.')
      }
      if (!expense_type || !String(expense_type).trim()) {
        throw new Error('Gider türü boş bırakılamaz.')
      }
      if (!expense_date || !String(expense_date).trim()) {
        throw new Error('Gider tarihi boş bırakılamaz.')
      }
      if (recurrenceEndDate && (!TARIH_FORMATI.test(recurrenceEndDate) || recurrenceEndDate < String(expense_date).trim())) {
        throw new Error('Taahhüt bitiş tarihi gider tarihinden önce olamaz.')
      }

      const odemeAlanlari = giderOdemeAlanlariniDogrula(gider)

      // Hem eski hem yeni ödeme tarihi kapatılmış bir güne denk gelmemeli
      // (kapalı günden ödeme çıkarmak da eklemek kadar tutarsızlık yaratır)
      const mevcutGider = db.prepare('SELECT status, payment_date FROM general_expenses WHERE id = ?').get(Number(id)) as any
      if (mevcutGider?.status === 'Ödendi') {
        kapaliGunKontrol(mevcutGider.payment_date)
      }
      kapaliGunKontrol(odemeAlanlari.payment_date)

      db.prepare(`
        UPDATE general_expenses
        SET expense_type = ?,
            company_name = ?,
            period = ?,
            expense_date = ?,
            due_date = ?,
            amount = ?,
            status = ?,
            payment_date = ?,
            payment_method = ?,
            note = ?,
            recurrence_type = ?,
            recurrence_end_date = ?
        WHERE id = ?
      `).run(
        String(expense_type).trim(),
        company_name ? String(company_name).trim() : null,
        period ? String(period).trim() : null,
        String(expense_date).trim(),
        due_date ? String(due_date).trim() : null,
        Number(amount) || 0,
        status || 'Ödenmedi',
        odemeAlanlari.payment_date,
        odemeAlanlari.payment_method,
        note ? String(note).trim() : null,
        recurrenceType,
        recurrenceEndDate,
        Number(id)
      )
      return { success: true }
    } catch (error) {
      console.error('Gider güncelleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 14. Genel Gider - Sil
  kanalEkle('gider-sil', (_event, id: number) => {
    try {
      const expenseId = Number(id)
      if (!expenseId) {
        throw new Error('Silinecek gider kaydı bulunamadı.')
      }

      const mevcutGider = db.prepare('SELECT status, payment_date FROM general_expenses WHERE id = ?').get(expenseId) as any
      if (mevcutGider?.status === 'Ödendi') {
        kapaliGunKontrol(mevcutGider.payment_date)
      }

      db.prepare(`
        DELETE FROM general_expenses
        WHERE id = ?
      `).run(expenseId)
      return { success: true }
    } catch (error) {
      console.error('Gider silme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
