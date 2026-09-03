import { app } from 'electron'
import { createRequire } from 'node:module'
import { readFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'

const RESULT_PREFIX = 'KATIP_INTEGRATION_RESULT:'
const TEST_DIR_PREFIX = 'katip-integration-'

type DbRow = Record<string, unknown>

function dogrulanmisTestDizini(): string {
  if (process.env.KATIP_TEST_MODE !== 'integration') {
    throw new Error('[KATIP_INTEGRATION_TEMP_GUARD] Entegrasyon test modu etkin degil.')
  }

  const candidate = process.env.KATIP_INTEGRATION_SCENARIO_ROOT
  if (!candidate) {
    throw new Error('[KATIP_INTEGRATION_TEMP_GUARD] Test dizini tanimli degil.')
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
    throw new Error(`[KATIP_INTEGRATION_TEMP_GUARD] Guvensiz test dizini reddedildi: ${resolvedRoot}`)
  }

  return resolvedRoot
}

function semaAnlikGoruntusu(db: any): DbRow[] {
  return db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'index')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY type, name
  `).all()
}

function tabloAdlari(db: any): string[] {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row: DbRow) => String(row.name))
}

function indeksAdlari(db: any): string[] {
  return db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row: DbRow) => String(row.name))
}

function kolonAdlari(db: any, tableName: string): string[] {
  return db.prepare(`PRAGMA table_info(${tableName})`).all()
    .map((row: DbRow) => String(row.name))
}

function quickCheck(db: any): string {
  const row = db.prepare('PRAGMA quick_check').get() as DbRow
  return String(Object.values(row)[0])
}

function veriAnlikGoruntusu(db: any): DbRow {
  return {
    schemaVersion: db.prepare('SELECT version FROM schema_version WHERE id = 1').get(),
    securitySalt: db.prepare("SELECT value FROM security_config WHERE key = 'pin_salt'").get(),
    masters: db.prepare('SELECT id, name, pin, is_active, hidden_from_mobile, display_order FROM masters ORDER BY id').all(),
    customers: db.prepare('SELECT id, name, phone, note, is_active FROM customers ORDER BY id').all(),
    vehicles: db.prepare('SELECT id, customer_id, plate, chassis, is_active FROM vehicles ORDER BY id').all(),
    parts: db.prepare('SELECT id, code, name, stock, buy_price, sell_price, is_active FROM parts ORDER BY id').all()
  }
}

async function calistir(): Promise<void> {
  const scenarioRoot = dogrulanmisTestDizini()
  app.setPath('userData', scenarioRoot)
  await app.whenReady()

  const scenario = process.env.KATIP_INTEGRATION_SCENARIO
  const expectedDbPath = join(scenarioRoot, 'otoservis.db')

  if (scenario === 'legacy-v8') {
    const fixturePath = process.env.KATIP_INTEGRATION_FIXTURE
    if (!fixturePath || dirname(realpathSync(fixturePath)) === scenarioRoot) {
      throw new Error('Eski sema fixture yolu gecersiz.')
    }
    const nodeRequire = createRequire(
      typeof __filename === 'string' ? __filename : import.meta.url
    )
    const Database = nodeRequire('better-sqlite3')
    const fixtureDb = new Database(expectedDbPath)
    try {
      fixtureDb.exec(readFileSync(fixturePath, 'utf8'))
    } finally {
      fixtureDb.close()
    }
  }

  const databaseModule = await import('../../../electron/database.js')
  const db = databaseModule.getDatabase()

  try {
    if (realpathSync(dirname(databaseModule.dbPath)) !== scenarioRoot) {
      throw new Error(`[KATIP_INTEGRATION_TEMP_GUARD] Veritabani test dizini disinda: ${databaseModule.dbPath}`)
    }

    databaseModule.initDB()
    const phoneMigrationsModule = await import('../../../electron/phoneMigrations.js')
    phoneMigrationsModule.runPhoneServerMigrations()
    phoneMigrationsModule.runPhoneServerMigrations()
    const phoneMigrationMarkerCount = Number(db.prepare(
      "SELECT COUNT(*) AS count FROM phone_migrations WHERE name = 'phone_data_normalization_v1'"
    ).get().count)

    const common = {
      scenarioRoot,
      dbPath: databaseModule.dbPath,
      expectedDbPath,
      schemaVersion: Number(db.prepare('SELECT version FROM schema_version WHERE id = 1').get().version),
      tables: tabloAdlari(db),
      indexes: indeksAdlari(db),
      quickCheck: quickCheck(db),
      foreignKeys: Number(db.pragma('foreign_keys', { simple: true })),
      mmapSize: Number(db.pragma('mmap_size', { simple: true })),
      phoneMigrationMarkerCount
    }

    if (scenario === 'fresh') {
      let foreignKeyRejected = false
      try {
        db.prepare(`
          INSERT INTO vehicles (customer_id, plate, brand, model)
          VALUES (?, ?, ?, ?)
        `).run(999999, 'ORPHAN-TEST', 'Test', 'Test')
      } catch (error) {
        foreignKeyRejected = String(error).includes('FOREIGN KEY constraint failed')
      }

      db.prepare(`
        INSERT INTO customers (name, phone, note, is_active)
        VALUES (?, ?, ?, ?)
      `).run('Idempotence Sentinel', '5550000099', 'keep-this-row', 1)

      const schemaBefore = semaAnlikGoruntusu(db)
      const dataBefore = veriAnlikGoruntusu(db)
      databaseModule.initDB()
      const schemaAfter = semaAnlikGoruntusu(db)
      const dataAfter = veriAnlikGoruntusu(db)

      console.log(RESULT_PREFIX + JSON.stringify({
        ...common,
        foreignKeyRejected,
        orphanCount: Number(db.prepare("SELECT COUNT(*) AS count FROM vehicles WHERE plate = 'ORPHAN-TEST'").get().count),
        schemaStable: JSON.stringify(schemaBefore) === JSON.stringify(schemaAfter),
        dataStable: JSON.stringify(dataBefore) === JSON.stringify(dataAfter),
        quickCheckAfterSecondInit: quickCheck(db)
      }))
      return
    }

    if (scenario === 'legacy-v8') {
      const legacyData = {
        customer: db.prepare('SELECT id, name, phone, note, is_active FROM customers WHERE id = 41').get(),
        vehicle: db.prepare('SELECT id, customer_id, plate, chassis, is_active FROM vehicles WHERE id = 51').get(),
        part: db.prepare('SELECT id, code, name, stock, buy_price, sell_price, is_active FROM parts WHERE id = 61').get(),
        workOrder: db.prepare('SELECT id, vehicle_id, description, total_price FROM work_orders WHERE id = 71').get(),
        workOrderItem: db.prepare('SELECT id, work_order_id, part_id, total_price, buy_price FROM work_order_items WHERE id = 81').get()
      }
      const columns = {
        masters: kolonAdlari(db, 'masters'),
        parts: kolonAdlari(db, 'parts'),
        workOrders: kolonAdlari(db, 'work_orders'),
        workOrderItems: kolonAdlari(db, 'work_order_items')
      }
      const schemaBefore = semaAnlikGoruntusu(db)
      const dataBefore = veriAnlikGoruntusu(db)
      databaseModule.initDB()

      console.log(RESULT_PREFIX + JSON.stringify({
        ...common,
        legacyData,
        columns,
        schemaStable: JSON.stringify(schemaBefore) === JSON.stringify(semaAnlikGoruntusu(db)),
        dataStable: JSON.stringify(dataBefore) === JSON.stringify(veriAnlikGoruntusu(db)),
        quickCheckAfterSecondInit: quickCheck(db)
      }))
      return
    }

    throw new Error(`Bilinmeyen entegrasyon senaryosu: ${scenario}`)
  } finally {
    db.close()
  }
}

calistir()
  .then(() => app.quit())
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })
