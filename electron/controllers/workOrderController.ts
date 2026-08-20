import db from '../database.js'
import { stokHareketiKaydet } from './partController.js'
import { app, dialog } from 'electron'
import fsSync, { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveActiveMasterId } from '../session.js'
import { kapaliGunKontrol, bugununTarihi } from './closingController.js'
import { fotografAdresi } from '../photoProtocol.js'
import { fotografiYoldanKucult } from '../photoUtils.js'

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function isEmriToplaminiGuncelle(workOrderId: number | string): void {
  const woId = Number(workOrderId)
  const toplam = db.prepare(`
    SELECT COALESCE(SUM(total_price), 0) AS toplam
    FROM work_order_items
    WHERE work_order_id = ?
  `).get(woId) as any

  const yeniToplam = Number(toplam?.toplam || 0)

  const tahsilat = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS toplam
    FROM work_order_payments
    WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
  `).get(woId) as any

  const toplamTahsilat = Number(tahsilat?.toplam || 0)

  if (yeniToplam < toplamTahsilat - 0.01) {
    throw new Error('İş emri toplamı alınmış ödemelerin altına düşürülemez.')
  }

  db.prepare(`
    UPDATE work_orders
    SET total_price = ?
    WHERE id = ?
  `).run(yeniToplam, woId)
}

export function registerWorkOrderHandlers(kanalEkle: (kanal: string, fonksiyon: (...args: any[]) => any) => void) {
  // 1. İş emirlerini getir
  kanalEkle('is-emirleri-getir', () => {
    return db.prepare(`
      SELECT 
        work_orders.*,
        vehicles.plate,
        vehicles.brand,
        vehicles.model,
        vehicles.chassis,
        customers.name AS customer_name,
        customers.phone AS customer_phone,
        opened_master.name AS opened_by_master_name,
        closed_master.name AS closed_by_master_name,
        COALESCE((
          SELECT SUM(amount)
          FROM work_order_payments
          WHERE work_order_id = work_orders.id AND IFNULL(is_cancelled, 0) = 0
        ), 0) AS toplam_tahsilat
      FROM work_orders
      JOIN vehicles ON work_orders.vehicle_id = vehicles.id
      JOIN customers ON vehicles.customer_id = customers.id
      LEFT JOIN masters opened_master ON work_orders.opened_by_master_id = opened_master.id
      LEFT JOIN masters closed_master ON work_orders.closed_by_master_id = closed_master.id
      WHERE IFNULL(vehicles.is_active, 1) = 1
        AND IFNULL(customers.is_active, 1) = 1
      ORDER BY work_orders.id DESC
    `).all()
  })

  // 2. İş emri ekle
  kanalEkle('is-emri-ekle', (_event, isEmri: any) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO work_orders (
          vehicle_id,
          description,
          mileage,
          total_price,
          status,
          closed_at,
          opened_by_master_id,
          closed_by_master_id
        )
        VALUES (
          ?,
          ?,
          ?,
          ?,
          ?,
          CASE WHEN ? = 'Tamamlandı' THEN CURRENT_TIMESTAMP ELSE NULL END,
          ?,
          ?
        )
      `)

      const mileage =
        isEmri.mileage !== undefined &&
        isEmri.mileage !== null &&
        isEmri.mileage !== ''
          ? Number(isEmri.mileage)
          : null

      const vehicleId = Number(isEmri.vehicle_id)
      const status = String(isEmri.status || 'Açık').trim() || 'Açık'

      const activeMasterId = resolveActiveMasterId()

      const closedByMasterId = status === 'Tamamlandı'
        ? activeMasterId
        : null

      const info = stmt.run(
        vehicleId,
        String(isEmri.description || '').trim(),
        mileage,
        Number(isEmri.total_price) || 0,
        status,
        status,
        activeMasterId,
        closedByMasterId
      )

      if (mileage !== null) {
        db.prepare(`
          UPDATE vehicles
          SET mileage = ?
          WHERE id = ?
        `).run(mileage, vehicleId)
      }

      return { success: true, id: info.lastInsertRowid }
    } catch (error) {
      console.error('İş emri kayıt hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 3. İş emri sil
  kanalEkle('is-emri-sil', (_event, id: any) => {
    const transaction = db.transaction(() => {
      const workOrderId =
        typeof id === 'object' && id !== null
          ? Number(id.id)
          : Number(id)

      const activeMasterId = resolveActiveMasterId()

      if (!workOrderId) {
        throw new Error('Silinecek iş emri bulunamadı.')
      }

      const isEmri = db.prepare(`
        SELECT *
        FROM work_orders
        WHERE id = ?
      `).get(workOrderId) as any

      if (!isEmri) {
        throw new Error('Silinecek iş emri bulunamadı.')
      }

      const aktifOdeme = db.prepare(`
        SELECT COUNT(*) AS count
        FROM work_order_payments
        WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(workOrderId) as any

      if (aktifOdeme && Number(aktifOdeme.count) > 0) {
        throw new Error('Bu iş emrinde tahsilat kaydı bulunduğu için silinemez. Önce tahsilat kaydını iptal edin.')
      }

      const fotograflar = db.prepare(`
        SELECT *
        FROM work_order_photos
        WHERE work_order_id = ?
      `).all(workOrderId) as any[]

      const kalemler = db.prepare(`
        SELECT *
        FROM work_order_items
        WHERE work_order_id = ?
      `).all(workOrderId) as any[]

      for (const kalem of kalemler) {
        if ((kalem.type === 'Parça' || kalem.type === 'Parca') && kalem.part_id) {
          const partId = Number(kalem.part_id)
          const miktar = Number(kalem.quantity) || 0

          if (partId && miktar > 0) {
            const parca = db.prepare(`
              SELECT stock
              FROM parts
              WHERE id = ?
            `).get(partId) as any

            const eskiStok = Number(parca?.stock) || 0
            const yeniStok = eskiStok + miktar

            db.prepare(`
              UPDATE parts
              SET stock = ?
              WHERE id = ?
            `).run(yeniStok, partId)

            stokHareketiKaydet({
              partId,
              workOrderId: null,
              type: 'Giriş',
              quantity: miktar,
              oldStock: eskiStok,
              newStock: yeniStok,
              masterId: activeMasterId,
              note: `İş emri #${workOrderId} silindiği için stok geri eklendi`
            })
          }
        }
      }

      try {
        db.prepare(`
          UPDATE stock_movements
          SET work_order_id = NULL
          WHERE work_order_id = ?
        `).run(workOrderId)
      } catch (e) {
        db.prepare(`
          DELETE FROM stock_movements
          WHERE work_order_id = ?
        `).run(workOrderId)
      }

      db.prepare(`
        DELETE FROM work_order_payments
        WHERE work_order_id = ?
      `).run(workOrderId)

      db.prepare(`
        DELETE FROM work_order_photos
        WHERE work_order_id = ?
      `).run(workOrderId)

      db.prepare(`
        DELETE FROM work_order_logs
        WHERE work_order_id = ?
      `).run(workOrderId)

      db.prepare(`
        DELETE FROM work_order_items
        WHERE work_order_id = ?
      `).run(workOrderId)

      db.prepare(`
        DELETE FROM work_orders
        WHERE id = ?
      `).run(workOrderId)

      for (const fotograf of fotograflar) {
        const filePath = String(fotograf.file_path || '')
        if (!filePath) continue

        try {
          if (fsSync.existsSync(filePath)) {
            fsSync.unlinkSync(filePath)
          }
        } catch (e) {
          console.warn('[Photos] İş emri silinirken fotoğraf dosyası silinemedi:', filePath, e)
        }
      }

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri silme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 4. İş emri güncelle / kapat
  kanalEkle('is-emri-guncelle', (_event, isEmri: any) => {
    const transaction = db.transaction(() => {
      const workOrderId = Number(isEmri.id)

      if (!workOrderId) {
        throw new Error('Güncellenecek iş emri bulunamadı.')
      }

      const mileage =
        isEmri.mileage !== undefined &&
        isEmri.mileage !== null &&
        isEmri.mileage !== ''
          ? Number(isEmri.mileage)
          : null

      const status = String(isEmri.status || 'Açık').trim() || 'Açık'

      const activeMasterId = resolveActiveMasterId()

      db.prepare(`
        UPDATE work_orders
        SET
          description = ?,
          mileage = ?,
          status = ?,
          closed_at = CASE
            WHEN ? = 'Tamamlandı' THEN COALESCE(closed_at, CURRENT_TIMESTAMP)
            ELSE NULL
          END,
          closed_by_master_id = CASE
            WHEN ? = 'Tamamlandı' THEN COALESCE(closed_by_master_id, ?)
            ELSE NULL
          END
        WHERE id = ?
      `).run(
        String(isEmri.description || '').trim(),
        mileage,
        status,
        status,
        status,
        activeMasterId,
        workOrderId
      )

      if (mileage !== null) {
        const mevcutIsEmri = db.prepare(`
          SELECT vehicle_id
          FROM work_orders
          WHERE id = ?
        `).get(workOrderId) as any

        if (mevcutIsEmri?.vehicle_id) {
          db.prepare(`
            UPDATE vehicles
            SET mileage = ?
            WHERE id = ?
          `).run(mileage, Number(mevcutIsEmri.vehicle_id))
        }
      }

      isEmriToplaminiGuncelle(workOrderId)
    })

    try {
      transaction()
      return { success: true }
    } catch (error) {
      console.error('İş emri güncelleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 5. İş emri işlem geçmişini getir
  kanalEkle('is-emri-loglari-getir', (_event, workOrderId: any) => {
    try {
      const loglar = db.prepare(`
        SELECT
          work_order_logs.*,
          masters.name AS master_name
        FROM work_order_logs
        LEFT JOIN masters ON work_order_logs.master_id = masters.id
        WHERE work_order_logs.work_order_id = ?
        ORDER BY work_order_logs.id DESC
      `).all(Number(workOrderId))

      return { success: true, loglar }
    } catch (error) {
      console.error('İş emri işlem geçmişi hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 6. Tamamlanan iş emrini sebep girerek tekrar aç
  kanalEkle('is-emri-tekrar-ac', (_event, veri: any) => {
    const transaction = db.transaction(() => {
      const workOrderId = Number(veri.id)
      const activeMasterId = resolveActiveMasterId()
      const reason = String(veri.reason || '').trim()

      if (!workOrderId) {
        throw new Error('Tekrar açılacak iş emri bulunamadı.')
      }

      if (!activeMasterId) {
        throw new Error('İş emrini tekrar açmak için önce usta girişi yapılmalıdır.')
      }

      if (!reason) {
        throw new Error('Tekrar açma sebebi boş bırakılamaz.')
      }

      const isEmri = db.prepare(`
        SELECT *
        FROM work_orders
        WHERE id = ?
      `).get(workOrderId) as any

      if (!isEmri) {
        throw new Error('İş emri bulunamadı.')
      }

      if (isEmri.status !== 'Tamamlandı') {
        throw new Error('Sadece tamamlanmış iş emirleri tekrar açılabilir.')
      }

      db.prepare(`
        UPDATE work_orders
        SET
          status = 'Açık',
          closed_at = NULL,
          closed_by_master_id = NULL
        WHERE id = ?
      `).run(workOrderId)

      db.prepare(`
        INSERT INTO work_order_logs (
          work_order_id,
          action,
          old_status,
          new_status,
          master_id,
          reason
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        workOrderId,
        'Tekrar Açıldı',
        isEmri.status,
        'Açık',
        activeMasterId,
        reason
      )

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri tekrar açma hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 7. İş emri ödemelerini getir
  kanalEkle('is-emri-odemeleri-getir', (_event, workOrderId?: any) => {
    try {
      let query = `
        SELECT 
          work_order_payments.*,
          m1.name AS received_by_master_name,
          m2.name AS cancelled_by_master_name,
          vehicles.plate,
          customers.name AS customer_name
        FROM work_order_payments
        JOIN work_orders ON work_order_payments.work_order_id = work_orders.id
        JOIN vehicles ON work_orders.vehicle_id = vehicles.id
        JOIN customers ON vehicles.customer_id = customers.id
        LEFT JOIN masters m1 ON work_order_payments.received_by = m1.id
        LEFT JOIN masters m2 ON work_order_payments.cancelled_by = m2.id
      `
      const params: any[] = []

      if (workOrderId) {
        query += ` WHERE work_order_payments.work_order_id = ? `
        params.push(Number(workOrderId))
      }

      query += ` ORDER BY work_order_payments.id DESC `

      const odemeler = db.prepare(query).all(...params)

      return { success: true, odemeler }
    } catch (error) {
      console.error('İş emri ödemeleri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 8. İş emri ödemesi ekle
  kanalEkle('is-emri-odeme-ekle', (_event, odeme: any) => {
    const transaction = db.transaction(() => {
      const workOrderId = Number(odeme.work_order_id)
      const amount = Number(odeme.amount) || 0
      const paymentMethod = String(odeme.payment_method || 'Nakit').trim()
      const paymentDate = String(odeme.payment_date || bugununTarihi()).trim()
      const note = String(odeme.note || '').trim()
      const activeMasterId = resolveActiveMasterId()

      if (!workOrderId) {
        throw new Error('İş emri seçilmelidir.')
      }

      const isEmri = db.prepare(`
        SELECT * FROM work_orders WHERE id = ?
      `).get(workOrderId) as any

      if (!isEmri) {
        throw new Error('İş emri bulunamadı.')
      }

      if (amount <= 0) {
        throw new Error('Ödeme tutarı 0\'dan büyük olmalıdır.')
      }

      if (!paymentMethod) {
        throw new Error('Ödeme yöntemi seçilmelidir.')
      }

      kapaliGunKontrol(paymentDate)

      const tahsilat = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS toplam
        FROM work_order_payments
        WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(workOrderId) as any

      const toplamTahsilat = Number(tahsilat?.toplam || 0)
      const kalanBorc = Number((isEmri.total_price - toplamTahsilat).toFixed(2))

      if (amount > kalanBorc + 0.01) {
        throw new Error(`Ödeme tutarı kalan borçtan (${kalanBorc.toLocaleString('tr-TR')} TL) büyük olamaz.`)
      }

      db.prepare(`
        INSERT INTO work_order_payments (
          work_order_id,
          amount,
          payment_method,
          payment_date,
          received_by,
          note
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(workOrderId, amount, paymentMethod, paymentDate, activeMasterId, note)

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri ödeme ekleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 9. İş emri ödemesi iptal et
  kanalEkle('is-emri-odeme-iptal', (_event, veri: any) => {
    const transaction = db.transaction(() => {
      const paymentId = Number(veri.payment_id)
      const cancelReason = String(veri.cancel_reason || '').trim()
      const activeMasterId = resolveActiveMasterId()

      if (!paymentId) {
        throw new Error('İptal edilecek ödeme kaydı bulunamadı.')
      }

      if (!cancelReason) {
        throw new Error('İptal sebebi girilmesi zorunludur.')
      }

      const odeme = db.prepare(`
        SELECT * FROM work_order_payments WHERE id = ?
      `).get(paymentId) as any

      if (!odeme) {
        throw new Error('Ödeme kaydı bulunamadı.')
      }

      if (odeme.is_cancelled === 1) {
        throw new Error('Bu ödeme kaydı zaten iptal edilmiş.')
      }

      kapaliGunKontrol(odeme.payment_date)

      const cancelledAt = new Date().toISOString()

      db.prepare(`
        UPDATE work_order_payments
        SET 
          is_cancelled = 1,
          cancelled_at = ?,
          cancelled_by = ?,
          cancel_reason = ?
        WHERE id = ?
      `).run(cancelledAt, activeMasterId, cancelReason, paymentId)

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri ödeme iptal hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 10. İş emri ödeme özetini getir
  kanalEkle('is-emri-odeme-ozeti-getir', (_event, workOrderId: any) => {
    try {
      const woId = Number(workOrderId)
      const isEmri = db.prepare(`
        SELECT id, total_price FROM work_orders WHERE id = ?
      `).get(woId) as any

      if (!isEmri) {
        throw new Error('İş emri bulunamadı.')
      }

      const tahsilat = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) AS toplam
        FROM work_order_payments
        WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
      `).get(woId) as any

      const totalPrice = Number(isEmri.total_price || 0)
      const toplamTahsilat = Number(tahsilat?.toplam || 0)
      const kalanBorc = Number((totalPrice - toplamTahsilat).toFixed(2))

      let odemeDurumu = 'Ödenmedi'
      if (toplamTahsilat <= 0) {
        odemeDurumu = 'Ödenmedi'
      } else if (kalanBorc > 0.01) {
        odemeDurumu = 'Kısmi Ödendi'
      } else if (Math.abs(kalanBorc) <= 0.01) {
        odemeDurumu = 'Ödendi'
      } else {
        odemeDurumu = 'Fazla Ödeme'
      }

      return {
        success: true,
        ozet: {
          work_order_id: woId,
          total_price: totalPrice,
          toplam_tahsilat: toplamTahsilat,
          kalan_borc: kalanBorc,
          odeme_durumu: odemeDurumu
        }
      }
    } catch (error) {
      console.error('İş emri ödeme özeti hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 11. Müşteri iş emri alacaklarını getir (Cari Hesap için)
  kanalEkle('musteri-is-emri-alacaklari-getir', (_event, customerId?: any) => {
    try {
      let query = `
        SELECT
          work_orders.id AS work_order_id,
          work_orders.vehicle_id,
          work_orders.total_price,
          work_orders.status AS work_order_status,
          work_orders.created_at,
          work_orders.closed_at,
          vehicles.plate,
          vehicles.brand,
          vehicles.model,
          customers.id AS customer_id,
          customers.name AS customer_name,
          customers.phone AS customer_phone,
          COALESCE((
            SELECT SUM(amount)
            FROM work_order_payments
            WHERE work_order_id = work_orders.id AND IFNULL(is_cancelled, 0) = 0
          ), 0) AS toplam_tahsilat
        FROM work_orders
        JOIN vehicles ON work_orders.vehicle_id = vehicles.id
        JOIN customers ON vehicles.customer_id = customers.id
      `
      const params: any[] = []

      if (customerId) {
        query += ` WHERE customers.id = ? `
        params.push(Number(customerId))
      }

      query += ` ORDER BY work_orders.id DESC`

      const list = db.prepare(query).all(...params) as any[]

      const alacaklar = list.map(item => {
        const totalPrice = Number(item.total_price || 0)
        const toplamTahsilat = Number(item.toplam_tahsilat || 0)
        const kalanBorc = Number((totalPrice - toplamTahsilat).toFixed(2))

        let odemeDurumu = 'Ödenmedi'
        if (toplamTahsilat <= 0) {
          odemeDurumu = 'Ödenmedi'
        } else if (kalanBorc > 0.01) {
          odemeDurumu = 'Kısmi Ödendi'
        } else if (Math.abs(kalanBorc) <= 0.01) {
          odemeDurumu = 'Ödendi'
        } else {
          odemeDurumu = 'Fazla Ödeme'
        }

        return {
          ...item,
          total_price: totalPrice,
          toplam_tahsilat: toplamTahsilat,
          kalan_borc: kalanBorc,
          odeme_durumu: odemeDurumu
        }
      })

      return { success: true, alacaklar }
    } catch (error) {
      console.error('Müşteri iş emri alacakları hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 12. İş emri tamamla ve ödeme kaydet (Tek transaction)
  kanalEkle('is-emri-tamamla-ve-odeme-kaydet', (_event, veri: any) => {
    const transaction = db.transaction(() => {
      const workOrderId = Number(veri.id)
      const activeMasterId = resolveActiveMasterId()
      const paymentOption = String(veri.payment_option || 'none')
      const amount = Number(veri.amount) || 0
      const paymentMethod = String(veri.payment_method || 'Nakit').trim()
      const paymentDate = String(veri.payment_date || bugununTarihi()).trim()
      const note = String(veri.note || '').trim()

      if (!workOrderId) {
        throw new Error('İş emri seçilmelidir.')
      }

      const wo = db.prepare('SELECT * FROM work_orders WHERE id = ?').get(workOrderId) as any
      if (!wo) {
        throw new Error('İş emri bulunamadı.')
      }

      db.prepare(`
        UPDATE work_orders
        SET 
          status = 'Tamamlandı',
          closed_at = COALESCE(closed_at, CURRENT_TIMESTAMP),
          closed_by_master_id = COALESCE(closed_by_master_id, ?)
        WHERE id = ?
      `).run(activeMasterId, workOrderId)

      if (paymentOption === 'full' || paymentOption === 'partial') {
        kapaliGunKontrol(paymentDate)

        const tahsilat = db.prepare(`
          SELECT COALESCE(SUM(amount), 0) AS toplam
          FROM work_order_payments
          WHERE work_order_id = ? AND IFNULL(is_cancelled, 0) = 0
        `).get(workOrderId) as any

        const toplamTahsilat = Number(tahsilat?.toplam || 0)
        const kalanBorc = Number((wo.total_price - toplamTahsilat).toFixed(2))

        if (kalanBorc > 0.01) {
          let odenecekTutar = paymentOption === 'full' ? kalanBorc : amount
          odenecekTutar = Number(odenecekTutar.toFixed(2))

          if (odenecekTutar > 0) {
            if (odenecekTutar > kalanBorc + 0.01) {
              throw new Error(`Ödeme tutarı kalan borçtan (${kalanBorc.toLocaleString('tr-TR')} TL) büyük olamaz.`)
            }

            db.prepare(`
              INSERT INTO work_order_payments (
                work_order_id,
                amount,
                payment_method,
                payment_date,
                received_by,
                note
              ) VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              workOrderId,
              odenecekTutar,
              paymentMethod,
              paymentDate,
              activeMasterId,
              note || (paymentOption === 'full' ? 'İş emri kapatılırken alınan tam ödeme' : 'İş emri kapatılırken alınan kısmi ödeme')
            )
          }
        }
      }

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri tamamlama ve ödeme kaydetme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 13. İş emri kalemlerini getir
  kanalEkle('is-emri-kalemleri-getir', (_event, workOrderId: any) => {
    try {
      const kalemler = db.prepare(`
        SELECT 
          work_order_items.*,
          parts.code AS part_code,
          parts.name AS part_name,
          work_order_items.buy_price AS part_buy_price,
          parts.sell_price AS part_sell_price
        FROM work_order_items
        LEFT JOIN parts ON work_order_items.part_id = parts.id
        WHERE work_order_items.work_order_id = ?
        ORDER BY work_order_items.id DESC
      `).all(Number(workOrderId))

      return { success: true, kalemler }
    } catch (error) {
      console.error('İş emri kalemleri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 14. İş emrine kalem ekle
  kanalEkle('is-emri-kalem-ekle', (_event, kalem: any) => {
    const transaction = db.transaction(() => {
      const workOrderId = Number(kalem.work_order_id)
      const type = String(kalem.type || '').trim()
      const quantity = Number(kalem.quantity) || 1
      const unitPrice = Number(kalem.unit_price) || 0
      const totalPrice = quantity * unitPrice
      const partId = kalem.part_id ? Number(kalem.part_id) : null
      const activeMasterId = resolveActiveMasterId()
      let buyPrice = 0

      if (!workOrderId) {
        throw new Error('İş emri seçilmedi.')
      }

      if (!type) {
        throw new Error('Kalem tipi seçilmedi.')
      }

      if (type === 'Parça' && partId) {
        const parca = db.prepare('SELECT * FROM parts WHERE id = ?').get(partId) as any

        if (!parca) {
          throw new Error('Seçilen parça bulunamadı.')
        }

        buyPrice = Number(parca.buy_price) || 0

        if (Number(parca.stock || 0) < quantity) {
          throw new Error(`Stok yetersiz. Mevcut stok: ${parca.stock}`)
        }

        const eskiStok = Number(parca.stock) || 0
        const yeniStok = eskiStok - quantity

        db.prepare(`
          UPDATE parts
          SET stock = ?
          WHERE id = ?
        `).run(yeniStok, partId)

        stokHareketiKaydet({
          partId,
          workOrderId,
          type: 'Çıkış',
          quantity,
          oldStock: eskiStok,
          newStock: yeniStok,
          masterId: activeMasterId,
          note: 'İş emrinde kullanıldı'
        })
      }

      const aciklama = String(kalem.description || '').trim()

      const info = db.prepare(`
        INSERT INTO work_order_items 
        (work_order_id, type, part_id, description, quantity, unit_price, total_price, buy_price)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workOrderId,
        type,
        partId,
        aciklama,
        quantity,
        unitPrice,
        totalPrice,
        buyPrice
      )

      isEmriToplaminiGuncelle(workOrderId)

      return { success: true, id: info.lastInsertRowid }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri kalem ekleme hatası:', error)
      const err = error as Error
      return { success: false, error: err.message || String(error) }
    }
  })

  // 15. İş emri kalemi güncelle
  kanalEkle('is-emri-kalem-guncelle', (_event, veri: any) => {
    const transaction = db.transaction(() => {
      const kalemId = Number(veri.id)
      const yeniTip = String(veri.type || '').trim()
      const yeniPartId = yeniTip === 'Parça' && veri.part_id
        ? Number(veri.part_id)
        : null
      const yeniAciklama = String(veri.description || '').trim()
      const yeniMiktar = Number(veri.quantity) || 1
      const yeniBirimFiyat = Number(veri.unit_price) || 0
      const yeniToplam = yeniMiktar * yeniBirimFiyat

      const activeMasterId = resolveActiveMasterId()

      if (!kalemId) {
        throw new Error('Güncellenecek kalem bulunamadı.')
      }

      if (!activeMasterId) {
        throw new Error('Kalem düzenlemek için önce usta girişi yapılmalıdır.')
      }

      if (!yeniTip) {
        throw new Error('Kalem tipi seçilmelidir.')
      }

      if (yeniTip === 'Parça' && !yeniPartId && !yeniAciklama) {
        throw new Error('Katalog dışı parça için açıklama/ad belirtilmelidir.')
      }

      if (yeniTip === 'İşçilik' && !yeniAciklama) {
        throw new Error('İşçilik açıklaması boş bırakılamaz.')
      }

      if (yeniMiktar <= 0) {
        throw new Error('Miktar 0 olamaz.')
      }

      const eskiKalem = db.prepare(`
        SELECT
          work_order_items.*,
          work_orders.status AS work_order_status
        FROM work_order_items
        JOIN work_orders ON work_order_items.work_order_id = work_orders.id
        WHERE work_order_items.id = ?
      `).get(kalemId) as any

      if (!eskiKalem) {
        throw new Error('Güncellenecek kalem bulunamadı.')
      }

      if (eskiKalem.work_order_status === 'Tamamlandı') {
        throw new Error('Tamamlanmış iş emrinde kalem düzenlenemez.')
      }

      const workOrderId = Number(eskiKalem.work_order_id)
      const eskiTip = String(eskiKalem.type || '').trim()
      const eskiPartId = eskiKalem.part_id ? Number(eskiKalem.part_id) : null
      const eskiMiktar = Number(eskiKalem.quantity) || 0

      const stokGirisYap = (partId: number, miktar: number, not: string) => {
        if (!partId || miktar <= 0) return

        const parca = db.prepare(`
          SELECT *
          FROM parts
          WHERE id = ?
        `).get(partId) as any

        if (!parca) {
          throw new Error('Stok girişi yapılacak parça bulunamadı.')
        }

        const eskiStok = Number(parca.stock) || 0
        const yeniStok = eskiStok + miktar

        db.prepare(`
          UPDATE parts
          SET stock = ?
          WHERE id = ?
        `).run(yeniStok, partId)

        stokHareketiKaydet({
          partId,
          workOrderId,
          type: 'Giriş',
          quantity: miktar,
          oldStock: eskiStok,
          newStock: yeniStok,
          masterId: activeMasterId,
          note: not
        })
      }

      const stokCikisYap = (partId: number, miktar: number, not: string) => {
        if (!partId || miktar <= 0) return

        const parca = db.prepare(`
          SELECT *
          FROM parts
          WHERE id = ?
        `).get(partId) as any

        if (!parca) {
          throw new Error('Stok çıkışı yapılacak parça bulunamadı.')
        }

        const eskiStok = Number(parca.stock) || 0

        if (eskiStok < miktar) {
          throw new Error(`Stok yetersiz. Mevcut stok: ${eskiStok}`)
        }

        const yeniStok = eskiStok - miktar

        db.prepare(`
          UPDATE parts
          SET stock = ?
          WHERE id = ?
        `).run(yeniStok, partId)

        stokHareketiKaydet({
          partId,
          workOrderId,
          type: 'Çıkış',
          quantity: miktar,
          oldStock: eskiStok,
          newStock: yeniStok,
          masterId: activeMasterId,
          note: not
        })
      }

      if (
        eskiTip === 'Parça' &&
        yeniTip === 'Parça' &&
        eskiPartId &&
        yeniPartId &&
        eskiPartId === yeniPartId
      ) {
        const fark = yeniMiktar - eskiMiktar

        if (fark > 0) {
          stokCikisYap(
            yeniPartId,
            fark,
            'İş emri kalemi düzenlendi, miktar artırıldı'
          )
        } else if (fark < 0) {
          stokGirisYap(
            eskiPartId,
            Math.abs(fark),
            'İş emri kalemi düzenlendi, miktar azaltıldı'
          )
        }
      } else {
        if (eskiTip === 'Parça' && eskiPartId) {
          stokGirisYap(
            eskiPartId,
            eskiMiktar,
            'İş emri kalemi düzenlendi, eski parça stoka geri eklendi'
          )
        }

        if (yeniTip === 'Parça' && yeniPartId) {
          stokCikisYap(
            yeniPartId,
            yeniMiktar,
            'İş emri kalemi düzenlendi, yeni parça stoktan düşüldü'
          )
        }
      }

      let yeniBuyPrice = 0
      if (yeniTip === 'Parça') {
        if (yeniPartId === eskiPartId) {
          yeniBuyPrice = Number(eskiKalem.buy_price) || 0
        } else {
          const parca = db.prepare('SELECT buy_price FROM parts WHERE id = ?').get(yeniPartId) as any
          yeniBuyPrice = parca ? (Number(parca.buy_price) || 0) : 0
        }
      }

      db.prepare(`
        UPDATE work_order_items
        SET
          type = ?,
          part_id = ?,
          description = ?,
          quantity = ?,
          unit_price = ?,
          total_price = ?,
          buy_price = ?
        WHERE id = ?
      `).run(
        yeniTip,
        yeniPartId,
        yeniAciklama,
        yeniMiktar,
        yeniBirimFiyat,
        yeniToplam,
        yeniBuyPrice,
        kalemId
      )

      isEmriToplaminiGuncelle(workOrderId)

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri kalemi güncelleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 16. İş emri kalemi sil
  kanalEkle('is-emri-kalem-sil', (_event, itemId: any) => {
    const transaction = db.transaction(() => {
      const kalemId =
        typeof itemId === 'object' && itemId !== null
          ? Number(itemId.id)
          : Number(itemId)

      const activeMasterId = resolveActiveMasterId()

      const kalem = db.prepare(`
        SELECT *
        FROM work_order_items
        WHERE id = ?
      `).get(kalemId) as any

      if (!kalem) {
        throw new Error('Silinecek kalem bulunamadı.')
      }

      if (kalem.type === 'Parça' && kalem.part_id) {
        const partId = Number(kalem.part_id)
        const miktar = Number(kalem.quantity) || 0

        const parca = db.prepare(`
          SELECT *
          FROM parts
          WHERE id = ?
        `).get(partId) as any

        const eskiStok = Number(parca?.stock) || 0
        const yeniStok = eskiStok + miktar

        db.prepare(`
          UPDATE parts
          SET stock = ?
          WHERE id = ?
        `).run(yeniStok, partId)

        stokHareketiKaydet({
          partId,
          workOrderId: Number(kalem.work_order_id),
          type: 'Giriş',
          quantity: miktar,
          oldStock: eskiStok,
          newStock: yeniStok,
          masterId: activeMasterId,
          note: 'İş emri kalemi silindiği için stok geri eklendi'
        })
      }

      db.prepare(`
        DELETE FROM work_order_items
        WHERE id = ?
      `).run(kalemId)

      isEmriToplaminiGuncelle(Number(kalem.work_order_id))

      return { success: true }
    })

    try {
      return transaction()
    } catch (error) {
      console.error('İş emri kalemi silme hatası:', error)
      const err = error as Error
      return { success: false, error: err.message || String(error) }
    }
  })

  // 17. İç kârlılık raporu getir
  kanalEkle('karlilik-raporu-getir', () => {
    try {
      const rapor = db.prepare(`
        SELECT
          work_orders.id,
          work_orders.status,
          work_orders.created_at,
          work_orders.closed_at,
          work_orders.total_price,

          vehicles.plate,
          vehicles.brand,
          vehicles.model,

          customers.name AS customer_name,
          customers.phone AS customer_phone,

          opened_master.name AS opened_by_master_name,
          closed_master.name AS closed_by_master_name,

          COALESCE(SUM(CASE
            WHEN work_order_items.type = 'Parça'
            THEN work_order_items.total_price
            ELSE 0
          END), 0) AS parca_satis_toplami,

          COALESCE(SUM(CASE
            WHEN work_order_items.type = 'Parça'
            THEN work_order_items.quantity * IFNULL(work_order_items.buy_price, 0)
            ELSE 0
          END), 0) AS parca_maliyet_toplami,

          COALESCE(SUM(CASE
            WHEN work_order_items.type = 'İşçilik'
            THEN work_order_items.total_price
            ELSE 0
          END), 0) AS iscilik_geliri,

          COALESCE(SUM(work_order_items.total_price), 0) AS toplam_gelir,

          COALESCE(SUM(CASE
            WHEN work_order_items.type = 'Parça'
            THEN work_order_items.quantity * IFNULL(work_order_items.buy_price, 0)
            ELSE 0
          END), 0) AS toplam_maliyet

        FROM work_orders
        JOIN vehicles ON work_orders.vehicle_id = vehicles.id
        JOIN customers ON vehicles.customer_id = customers.id
        LEFT JOIN masters opened_master ON work_orders.opened_by_master_id = opened_master.id
        LEFT JOIN masters closed_master ON work_orders.closed_by_master_id = closed_master.id
        LEFT JOIN work_order_items ON work_order_items.work_order_id = work_orders.id
        -- LEFT JOIN parts kaldırıldı: parts hiçbir SELECT/WHERE/GROUP BY
        -- ifadesinde kullanılmıyordu. part_id birincil anahtara bağlandığı için
        -- en fazla bir satır eşleşiyordu, yani satır çoğaltmıyor ve toplamları
        -- etkilemiyordu; sadece boşuna maliyetti.

        GROUP BY work_orders.id
        ORDER BY work_orders.id DESC
      `).all() as any[]

      const veriler = rapor.map((satir) => {
        const toplamGelir = Number(satir.toplam_gelir || 0)
        const toplamMaliyet = Number(satir.toplam_maliyet || 0)
        const netKar = toplamGelir - toplamMaliyet
        const karOrani = toplamGelir > 0 ? (netKar / toplamGelir) * 100 : 0

        return {
          ...satir,
          parca_satis_toplami: Number(satir.parca_satis_toplami || 0),
          parca_maliyet_toplami: Number(satir.parca_maliyet_toplami || 0),
          iscilik_geliri: Number(satir.iscilik_geliri || 0),
          toplam_gelir: toplamGelir,
          toplam_maliyet: toplamMaliyet,
          net_kar: netKar,
          kar_orani: karOrani
        }
      })

      return {
        success: true,
        rapor: veriler
      }
    } catch (error) {
      console.error('Kârlılık raporu hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 18. Ana panel istatistikleri
  kanalEkle('istatistikleri-getir', () => {
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
          COALESCE(SUM(CASE WHEN IFNULL(stock, 0) <= IFNULL(critical_stock, 5) THEN 1 ELSE 0 END), 0) AS dusuk,
          COALESCE(SUM(CASE WHEN IFNULL(stock, 0) <= 0 THEN 1 ELSE 0 END), 0) AS biten
        FROM parts
        WHERE IFNULL(is_active, 1) = 1
      `).get() as any

      return {
        success: true,
        veriler: {
          musteriSayisi: Number(resMusteri?.aktif || 0),
          aracSayisi: Number(resArac?.aktif || 0),
          musteriAktif: Number(resMusteri?.aktif || 0),
          musteriToplam: Number(resMusteri?.toplam || 0),
          aracAktif: Number(resArac?.aktif || 0),
          aracToplam: Number(resArac?.toplam || 0),
          acikIsEmri: Number(resIsEmri?.acik || 0),
          tamamlananIsEmri: Number(resIsEmri?.tamamlanan || 0),
          toplamStok: Number(resStok?.aktif || 0),
          dusukStok: Number(resStok?.dusuk || 0),
          bitenStok: Number(resStok?.biten || 0)
        }
      }
    } catch (error) {
      console.error('Dashboard hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 19. Müşteri servis geçmişi
  kanalEkle('musteri-gecmisi-getir', (_event, musteriId: any) => {
    try {
      const gecmis = db.prepare(`
        SELECT 
          work_orders.*,
          vehicles.plate,
          vehicles.brand,
          vehicles.model,
          vehicles.chassis,
          opened_master.name AS opened_by_master_name,
          closed_master.name AS closed_by_master_name,
          COALESCE((
            SELECT SUM(amount)
            FROM work_order_payments
            WHERE work_order_id = work_orders.id AND IFNULL(is_cancelled, 0) = 0
          ), 0) AS toplam_tahsilat
        FROM work_orders
        JOIN vehicles ON work_orders.vehicle_id = vehicles.id
        LEFT JOIN masters opened_master ON work_orders.opened_by_master_id = opened_master.id
        LEFT JOIN masters closed_master ON work_orders.closed_by_master_id = closed_master.id
        WHERE vehicles.customer_id = ?
        ORDER BY work_orders.id DESC
      `).all(Number(musteriId))

      return { success: true, gecmis }
    } catch (error) {
      console.error('Müşteri geçmişi hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 20. Servis geçmişi ara
  // limit: yalnızca ana paneldeki arama kutusunun altında açılan öneri listesi
  // için verilir; o liste sonucun ilk birkaç aracını gösterdiği hâlde eskiden
  // eşleşen TÜM iş emirleri her tuş vuruşunda çekiliyordu. Limit verilmezse
  // (tam arama diyaloğu) davranış eskisiyle birebir aynı: sınır yok.
  kanalEkle('servis-gecmisi-ara', (_event, aramaMetni: any, limit?: any) => {
    try {
      const arama = String(aramaMetni || '').trim()
      // SQLite'ta negatif LIMIT "sınır yok" demektir.
      const satirSiniri = Number(limit) > 0 ? Math.floor(Number(limit)) : -1

      const normalizeString = (str: string) => {
        if (str === null || str === undefined) return ''
        return String(str)
          .replace(/İ/g, 'i')
          .replace(/I/g, 'ı')
          .toLowerCase()
          .replace(/ı/g, 'i')
          .replace(/ş/g, 's')
          .replace(/ç/g, 'c')
          .replace(/ğ/g, 'g')
          .replace(/ü/g, 'u')
          .replace(/ö/g, 'o')
      }

      if (!arama) {
        return { success: true, gecmis: [] }
      }

      const temizArama = normalizeString(arama)
      const temizAramaLike = `%${temizArama}%`
      const bosluksuzArama = `%${temizArama.replace(/[\s\-()]/g, '')}%`

      // normalize_text SQLite tarafında Türkçe karakter/büyük-küçük harf farkını siler
      const sadelestir = (kolon: string) =>
        `REPLACE(REPLACE(REPLACE(REPLACE(normalize_text(${kolon}), ' ', ''), '-', ''), '(', ''), ')', '')`

      const gecmis = db.prepare(`
        SELECT 
          work_orders.*,
          vehicles.plate,
          vehicles.brand,
          vehicles.model,
          vehicles.chassis,
          customers.name AS customer_name,
          customers.phone AS customer_phone,
          opened_master.name AS opened_by_master_name,
          closed_master.name AS closed_by_master_name,
          COALESCE((
            SELECT SUM(amount)
            FROM work_order_payments
            WHERE work_order_id = work_orders.id AND IFNULL(is_cancelled, 0) = 0
          ), 0) AS toplam_tahsilat
        FROM work_orders
        JOIN vehicles ON work_orders.vehicle_id = vehicles.id
        JOIN customers ON vehicles.customer_id = customers.id
        LEFT JOIN masters opened_master ON work_orders.opened_by_master_id = opened_master.id
        LEFT JOIN masters closed_master ON work_orders.closed_by_master_id = closed_master.id
        WHERE
          normalize_text(customers.name) LIKE :arama OR
          ${sadelestir('customers.phone')} LIKE :bosluksuz OR
          ${sadelestir('vehicles.plate')} LIKE :bosluksuz OR
          normalize_text(vehicles.brand) LIKE :arama OR
          normalize_text(vehicles.model) LIKE :arama OR
          normalize_text(vehicles.chassis) LIKE :arama OR
          normalize_text(work_orders.description) LIKE :arama OR
          CAST(work_orders.id AS TEXT) LIKE :arama OR
          EXISTS (
            SELECT 1
            FROM work_order_items
            WHERE work_order_items.work_order_id = work_orders.id
              AND normalize_text(work_order_items.description) LIKE :arama
          )
        ORDER BY work_orders.id DESC
        LIMIT :limit
      `).all({
        arama: temizAramaLike,
        bosluksuz: bosluksuzArama,
        limit: satirSiniri
      })

      return { success: true, gecmis }
    } catch (error) {
      console.error('Servis geçmişi arama hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 20b. Fotoğraf kategorileri (serbest metin; daha önce kullanılanlar öneri olarak sunulur)
  kanalEkle('fotograf-kategorileri-getir', () => {
    try {
      const satirlar = db.prepare(`
        SELECT TRIM(category) AS kategori, COUNT(*) AS adet
        FROM work_order_photos
        WHERE category IS NOT NULL AND TRIM(category) <> ''
        GROUP BY LOWER(TRIM(category))
        ORDER BY adet DESC, kategori ASC
      `).all() as any[]

      return { success: true, kategoriler: satirlar.map((s) => s.kategori) }
    } catch (error) {
      console.error('Fotoğraf kategorileri getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 21. İş Emri Fotoğraflarını Getir
  kanalEkle('is-emri-fotograflari-getir', async (_event, workOrderId: number) => {
    try {
      const woId = Number(workOrderId)
      if (!woId) return { success: false, error: 'İş emri ID geçersiz.' }

      const rows = db.prepare(`
        SELECT * FROM work_order_photos
        WHERE work_order_id = ?
        ORDER BY id DESC
      `).all(woId) as any[]

      const fotograflar: any[] = []
      for (const row of rows) {
        // Eskiden dosyanın tamamı okunup base64 olarak IPC'ye konuyordu; artık
        // yalnızca "dosya duruyor mu" diye bakılıp katip-foto:// adresi
        // veriliyor, baytları <img> göründükçe protokol servis ediyor
        // (bkz. electron/photoProtocol.ts). Okunamayan dosyada url yine boş
        // kalır, arayüz o kaydı eskisi gibi görmezden gelir.
        let url = ''
        try {
          await fs.access(row.file_path)
          url = fotografAdresi(row.id)
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

      return { success: true, fotograflar }
    } catch (error) {
      console.error('Fotoğrafları getirme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 22. İş Emrine Fotoğraf Yükle (Dialog İle)
  kanalEkle('is-emri-fotograf-yukle-dialog', async (_event, veri: { work_order_id: number; category?: string; note?: string }) => {
    try {
      const woId = Number(veri?.work_order_id)
      if (!woId) return { success: false, error: 'İş emri seçilmedi.' }

      const result = await dialog.showOpenDialog({
        title: 'Fotoğraf Seçin (Araç Kabul / Hasar Tespiti)',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Resim Dosyaları', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
      })

      if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      const photoDir = path.join(app.getPath('userData'), 'fotograflar')
      await fs.mkdir(photoDir, { recursive: true })

      const category = String(veri?.category || 'Araç Kabul').trim()
      const note = String(veri?.note || '').trim()

      let addedCount = 0
      for (let i = 0; i < result.filePaths.length; i++) {
        const srcPath = result.filePaths[i]
        const targetFileName = `wo_${woId}_${Date.now()}_${i}.jpg`
        const targetPath = path.join(photoDir, targetFileName)

        try {
          // Küçültme mantığı mobil yükleme yoluyla ortak (bkz. photoUtils.ts).
          // Görüntü çözülemezse null döner ve dosya olduğu gibi kopyalanır;
          // eskiden bu durumda toJPEG boş buffer döndürüp 0 baytlık bozuk bir
          // dosya yazılıyordu (hata fırlatmadığı için kopyalama yedeği de
          // devreye girmiyordu).
          const kucultulmus = fotografiYoldanKucult(srcPath)
          if (kucultulmus) {
            await fs.writeFile(targetPath, kucultulmus)
          } else {
            await fs.copyFile(srcPath, targetPath)
          }
        } catch (e) {
          await fs.copyFile(srcPath, targetPath)
        }

        db.prepare(`
          INSERT INTO work_order_photos (work_order_id, file_name, file_path, category, note)
          VALUES (?, ?, ?, ?, ?)
        `).run(woId, targetFileName, targetPath, category, note)

        addedCount++
      }

      return { success: true, count: addedCount }
    } catch (error) {
      console.error('Fotoğraf yükleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 23. İş Emri Fotoğrafı Sil
  kanalEkle('is-emri-fotograf-sil', async (_event, photoId: number) => {
    try {
      const id = Number(photoId)
      if (!id) return { success: false, error: 'Fotoğraf ID geçersiz.' }

      const photo = db.prepare('SELECT * FROM work_order_photos WHERE id = ?').get(id) as any
      if (photo && photo.file_path) {
        try {
          await fs.unlink(photo.file_path)
        } catch (e) {
          console.warn('[Photos] Fiziksel dosya silinemedi veya zaten yok:', photo.file_path)
        }
      }

      db.prepare('DELETE FROM work_order_photos WHERE id = ?').run(id)
      return { success: true }
    } catch (error) {
      console.error('Fotoğraf silme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })

  // 24. Fotoğraf Notu / Kategorisi Güncelle
  kanalEkle('is-emri-fotograf-guncelle', (_event, veri: { id: number; category?: string; note?: string }) => {
    try {
      const id = Number(veri?.id)
      if (!id) return { success: false, error: 'Fotoğraf seçilmedi.' }

      db.prepare(`
        UPDATE work_order_photos
        SET category = ?, note = ?
        WHERE id = ?
      `).run(
        String(veri.category || 'Araç Kabul').trim(),
        String(veri.note || '').trim(),
        id
      )
      return { success: true }
    } catch (error) {
      console.error('Fotoğraf güncelleme hatası:', error)
      return { success: false, error: getErrorMessage(error) }
    }
  })
}
