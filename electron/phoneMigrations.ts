import db from './database.js'

const PHONE_NORMALIZATION_KEY = 'phone_data_normalization_v1'

export function runPhoneServerMigrations(): void {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS phone_migrations (
        name TEXT PRIMARY KEY,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `)
    const tamamlandi = db.prepare('SELECT 1 AS applied FROM phone_migrations WHERE name = ?')
      .get(PHONE_NORMALIZATION_KEY) as { applied?: number } | undefined
    if (tamamlandi?.applied === 1) return

    const normalizeEt = db.transaction(() => {
      db.prepare("UPDATE work_orders SET status = 'Açık' WHERE status = 'Acik'").run()
      db.prepare("UPDATE work_orders SET status = 'Tamamlandı' WHERE status = 'Tamamlandi'").run()
      db.prepare('UPDATE work_orders SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL').run()
      db.prepare("UPDATE work_order_items SET type = 'İşçilik' WHERE type = 'Iscilik'").run()
      db.prepare("UPDATE work_order_items SET type = 'Parça' WHERE type = 'Parca'").run()
      db.prepare("UPDATE stock_movements SET type = 'Çıkış' WHERE type = 'Cikis'").run()
      db.prepare("UPDATE stock_movements SET type = 'Giriş' WHERE type = 'Giris'").run()
      db.prepare(`
        UPDATE work_order_photos
        SET category = 'Araç Kabul'
        WHERE category IN ('Ön', 'Arka', 'Sol', 'Sağ', 'KM / Gösterge')
      `).run()
      db.prepare(`
        UPDATE work_order_photos
        SET category = 'Hasar / Çizik'
        WHERE category = 'Hasar / Diğer'
      `).run()
      db.prepare(`
        UPDATE work_order_photos
        SET category = 'Araç Kabul'
        WHERE category IS NULL OR TRIM(category) = ''
      `).run()
      db.prepare(`
        INSERT OR IGNORE INTO phone_migrations (name, applied_at)
        VALUES (?, CURRENT_TIMESTAMP)
      `).run(PHONE_NORMALIZATION_KEY)
    })

    normalizeEt()
  } catch (error) {
    console.error('[PhoneServer] Existing work orders migration error:', error)
  }
}
