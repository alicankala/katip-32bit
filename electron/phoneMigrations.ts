import db from './database.js'

export function runPhoneServerMigrations(): void {
  try {
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
  } catch (error) {
    console.error('[PhoneServer] Existing work orders migration error:', error)
  }
}
