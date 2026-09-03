import path from 'node:path'
import crypto from 'node:crypto'
import { app } from 'electron'
import { createRequire } from 'node:module'
import { hashPin, verifyPin, setActiveSalt } from './security'

// Paket CommonJS üretildiği için __filename hazır geliyor; native modül Vite'in
// paketleyicisine girmeden Node'un gerçek require'ıyla yükleniyor.
const nodeRequire = createRequire(__filename)
const Database = nodeRequire('better-sqlite3')

const dbPath = path.join(app.getPath('userData'), 'otoservis.db')
let activeDb = new Database(dbPath)

export function getDatabase() {
  return activeDb
}

const db = new Proxy({}, {
  get(_target, prop) {
    const targetDb = getDatabase();
    const val = targetDb[prop];
    return typeof val === 'function' ? val.bind(targetDb) : val;
  }
});

// Turkish character and case insensitive normalization function
function normalizeString(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o');
}

function ozellestirilmisFonksiyonlariTanimla(targetDb) {
  try {
    targetDb.pragma('foreign_keys = ON;');
    targetDb.pragma('journal_mode = WAL;');
    targetDb.pragma('synchronous = NORMAL;');
    targetDb.pragma('temp_store = MEMORY;');
    targetDb.pragma('cache_size = -16000;'); // ~16MB sayfa önbelleği
    // 32-bit süreçte 256 MB'lik eşleme tavanı sınırlı sanal adres alanını gereksiz
    // daraltıyordu. 64 MB, büyük listelerde mmap okumasını korurken x86'a alan bırakır.
    targetDb.pragma('mmap_size = 67108864;');
  } catch (err) {
    console.warn('[DB] PRAGMA set warning:', err);
  }
  targetDb.function('normalize_text', { deterministic: true }, (val) => {
    return normalizeString(val);
  });
}

ozellestirilmisFonksiyonlariTanimla(activeDb);

function schemaVersionTablosuHazirla() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL DEFAULT 0
    );
  `)

  const row = db.prepare(`
    SELECT version
    FROM schema_version
    WHERE id = 1
  `).get()

  if (!row) {
    db.prepare(`
      INSERT INTO schema_version (id, version)
      VALUES (1, 0)
    `).run()
  }
}

function schemaVersionGetir() {
  schemaVersionTablosuHazirla()

  const row = db.prepare(`
    SELECT version
    FROM schema_version
    WHERE id = 1
  `).get()

  return Number(row?.version) || 0
}

function schemaVersionAyarla(version) {
  schemaVersionTablosuHazirla()

  db.prepare(`
    UPDATE schema_version
    SET version = ?
    WHERE id = 1
  `).run(version)
}

function ensureSecuritySalt() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)

  let row = db.prepare('SELECT value FROM security_config WHERE key = ?').get('pin_salt')

  if (!row || !row.value) {
    const salt = crypto.randomBytes(32).toString('hex')
    db.prepare(`
      INSERT INTO security_config (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('pin_salt', salt)
    row = { value: salt }
  }

  setActiveSalt(row.value)
}

const GECERLI_SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/

function sqlIdentifierDogrula(value, label) {
  if (typeof value !== 'string' || !GECERLI_SQL_IDENTIFIER.test(value)) {
    throw new Error(`Geçersiz SQL tanımlayıcı (${label}): ${value}`)
  }
  return value
}

function kolonVarMi(tableName, columnName) {
  sqlIdentifierDogrula(tableName, 'tableName')

  const kolonlar = db.prepare(`PRAGMA table_info(${tableName})`).all()

  return kolonlar.some((kolon) => kolon.name === columnName)
}

function kolonEkleEksikse(tableName, columnName, columnDefinition) {
  sqlIdentifierDogrula(tableName, 'tableName')
  sqlIdentifierDogrula(columnName, 'columnName')

  if (kolonVarMi(tableName, columnName)) {
    return
  }

  db.exec(`
    ALTER TABLE ${tableName}
    ADD COLUMN ${columnName} ${columnDefinition};
  `)
}

function migrationCalistir(version, callback) {
  const mevcutVersion = schemaVersionGetir()

  if (mevcutVersion >= version) {
    return
  }

  const transaction = db.transaction(() => {
    callback()
    schemaVersionAyarla(version)
  })

  transaction()
}

export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      note TEXT,
      is_active INTEGER DEFAULT 1
    );

CREATE TABLE IF NOT EXISTS parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT,
  brand TEXT,
  category TEXT,
  oem_code TEXT,
  stock INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'Adet',
  buy_price REAL DEFAULT 0,
  sell_price REAL DEFAULT 0,
  shelf TEXT,
  critical_stock INTEGER DEFAULT 5,
  critical_stock_enabled INTEGER DEFAULT 1,
  note TEXT
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  plate TEXT UNIQUE,
  brand TEXT,
  model TEXT,
  year INTEGER,
  mileage INTEGER,
  chassis TEXT,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS masters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  description TEXT,
  mileage INTEGER,
  total_price REAL DEFAULT 0,
  status TEXT DEFAULT 'Açık',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  opened_by_master_id INTEGER,
  closed_by_master_id INTEGER,
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
  FOREIGN KEY(opened_by_master_id) REFERENCES masters(id),
  FOREIGN KEY(closed_by_master_id) REFERENCES masters(id)
);

    CREATE TABLE IF NOT EXISTS work_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      part_id INTEGER,
      description TEXT,
      quantity REAL DEFAULT 1,
      unit_price REAL DEFAULT 0,
      total_price REAL DEFAULT 0,
      buy_price REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id),
      FOREIGN KEY(part_id) REFERENCES parts(id)
    );

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  work_order_id INTEGER,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  old_stock REAL,
  new_stock REAL,
  master_id INTEGER,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(part_id) REFERENCES parts(id),
  FOREIGN KEY(work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY(master_id) REFERENCES masters(id)
);

  `)

  ensureSecuritySalt()

  // Onarım: migration 22 ve 25 bir dönem kaynak kodda numara sırasının dışında
  // çağrıldığı için şema sürümü erken yükseliyor ve aradaki migration'lar hiç
  // çalışmadan atlanıyordu. Bu duruma düşmüş bir veritabanında sürüm geri
  // çekilir; migration'lar idempotent olduğundan yeniden çalışmaları güvenlidir.
  const tabloVarMi = (name) => !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
  ).get(name)

  if (schemaVersionGetir() >= 15 && !tabloVarMi('current_accounts')) {
    schemaVersionAyarla(8)
  }

  migrationCalistir(1, () => {
    kolonEkleEksikse('work_orders', 'total_price', 'REAL DEFAULT 0')
  })

  migrationCalistir(2, () => {
    kolonEkleEksikse('vehicles', 'chassis', 'TEXT')
  })

  migrationCalistir(3, () => {
    kolonEkleEksikse('work_orders', 'mileage', 'INTEGER')
  })
    migrationCalistir(4, () => {
    kolonEkleEksikse('customers', 'is_active', 'INTEGER DEFAULT 1')
  })

  migrationCalistir(5, () => {
    kolonEkleEksikse('vehicles', 'is_active', 'INTEGER DEFAULT 1')
  })

migrationCalistir(6, () => {
  kolonEkleEksikse('parts', 'is_active', 'INTEGER DEFAULT 1')
})

migrationCalistir(7, () => {
  kolonEkleEksikse('vehicles', 'mileage', 'INTEGER')
})

migrationCalistir(8, () => {
  kolonEkleEksikse('work_orders', 'closed_at', 'DATETIME')
})
migrationCalistir(9, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS masters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Sıra, listelerde göründükleri sıradır (bkz. migration 30 / display_order).
  // Başlangıç PIN'leri bilinçli olarak sabittir; kurulumdan sonra Ayarlar'dan
  // değiştirilmesi önerilir (bkz. migration 31).
  const seedUstalar = [
    { name: 'Bünyamin Kala', pin: '1111' },
    { name: 'Yusuf Kala', pin: '2222' },
    { name: 'Ali Kala', pin: '3333' }
  ]

  for (const usta of seedUstalar) {
    const eklendi = db.prepare(`
      INSERT INTO masters (name, pin, is_active)
      SELECT ?, ?, ?
      WHERE NOT EXISTS (
        SELECT 1 FROM masters WHERE name = ?
      )
    `).run(usta.name, hashPin(usta.pin), 1, usta.name)

    if (eklendi.changes > 0) {
      // PIN değeri destek loguna hiçbir koşulda yazılmaz.
      console.log('[Kâtip] Bir usta için başlangıç PIN hash kaydı oluşturuldu; Ayarlar bölümünden değiştirilmesi önerilir.')
    }
  }
})

migrationCalistir(10, () => {
  kolonEkleEksikse('work_orders', 'opened_by_master_id', 'INTEGER')
  kolonEkleEksikse('work_orders', 'closed_by_master_id', 'INTEGER')
})

migrationCalistir(11, () => {
  kolonEkleEksikse('parts', 'critical_stock', 'INTEGER DEFAULT 5')
})
migrationCalistir(12, () => {
  kolonEkleEksikse('parts', 'brand', 'TEXT')
  kolonEkleEksikse('parts', 'category', 'TEXT')
  kolonEkleEksikse('parts', 'oem_code', 'TEXT')
  kolonEkleEksikse('parts', 'unit', 'TEXT DEFAULT "Adet"')
  kolonEkleEksikse('parts', 'note', 'TEXT')
})
migrationCalistir(13, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_order_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      old_status TEXT,
      new_status TEXT,
      master_id INTEGER,
      reason TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id),
      FOREIGN KEY(master_id) REFERENCES masters(id)
    );
  `)
})
migrationCalistir(14, () => {
  kolonEkleEksikse('stock_movements', 'old_stock', 'REAL')
  kolonEkleEksikse('stock_movements', 'new_stock', 'REAL')
  kolonEkleEksikse('stock_movements', 'master_id', 'INTEGER')
})

migrationCalistir(15, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS current_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      phone TEXT,
      note TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS account_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      current_account_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      transaction_type TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL DEFAULT 0,
      vehicle_id INTEGER,
      work_order_id INTEGER,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(current_account_id) REFERENCES current_accounts(id),
      FOREIGN KEY(vehicle_id) REFERENCES vehicles(id),
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id)
    );

    CREATE TABLE IF NOT EXISTS account_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      current_account_id INTEGER NOT NULL,
      transaction_id INTEGER,
      date TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(current_account_id) REFERENCES current_accounts(id),
      FOREIGN KEY(transaction_id) REFERENCES account_transactions(id) ON DELETE SET NULL
    );
  `)
})

migrationCalistir(16, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS general_expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_type TEXT NOT NULL,
      company_name TEXT,
      period TEXT,
      expense_date TEXT NOT NULL,
      due_date TEXT,
      amount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'Ödenmedi',
      payment_date TEXT,
      payment_method TEXT,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
})

migrationCalistir(17, () => {
  kolonEkleEksikse('current_accounts', 'direction', "TEXT DEFAULT 'Borç'")
})

migrationCalistir(18, () => {
  kolonEkleEksikse('parts', 'critical_stock_enabled', 'INTEGER DEFAULT 1')
})

migrationCalistir(19, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_order_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Nakit',
      payment_date TEXT NOT NULL,
      received_by INTEGER,
      note TEXT,
      is_cancelled INTEGER NOT NULL DEFAULT 0,
      cancelled_at TEXT,
      cancelled_by INTEGER,
      cancel_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_work_order_payments_work_order
    ON work_order_payments(work_order_id);

    CREATE INDEX IF NOT EXISTS idx_work_order_payments_date
    ON work_order_payments(payment_date);
  `)
})

migrationCalistir(20, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `)
})

migrationCalistir(21, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_order_photos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      work_order_id INTEGER NOT NULL,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      category TEXT DEFAULT 'Araç Kabul',
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(work_order_id) REFERENCES work_orders(id)
    );

    CREATE INDEX IF NOT EXISTS idx_work_order_photos_wo
    ON work_order_photos(work_order_id);
  `)
})

migrationCalistir(22, () => {
  const masters = db.prepare("SELECT id, pin FROM masters").all()
  const updateStmt = db.prepare("UPDATE masters SET pin = ? WHERE id = ?")
  for (const m of masters) {
    if (m.pin && m.pin.length <= 6) {
      updateStmt.run(hashPin(m.pin), m.id)
    }
  }
})

migrationCalistir(23, () => {
  db.exec(`
    -- Foreign Key and Fast Search Performance Indexes
    CREATE INDEX IF NOT EXISTS idx_vehicles_customer_id ON vehicles(customer_id);
    CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);

    CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle_id ON work_orders(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_work_orders_created_at ON work_orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_work_orders_opened_master ON work_orders(opened_by_master_id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_closed_master ON work_orders(closed_by_master_id);

    CREATE INDEX IF NOT EXISTS idx_work_order_items_wo_id ON work_order_items(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_items_part_id ON work_order_items(part_id);

    CREATE INDEX IF NOT EXISTS idx_stock_movements_part_id ON stock_movements(part_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_wo_id ON stock_movements(work_order_id);

    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);
  `)
})

migrationCalistir(24, () => {
  kolonEkleEksikse('work_order_items', 'buy_price', 'REAL DEFAULT 0')
  db.exec(`
    UPDATE work_order_items
    SET buy_price = (
      SELECT IFNULL(parts.buy_price, 0)
      FROM parts
      WHERE parts.id = work_order_items.part_id
    )
    WHERE type = 'Parça' AND part_id IS NOT NULL;
  `)
})

migrationCalistir(25, () => {
  kolonEkleEksikse('work_orders', 'customer_signature', 'TEXT')
})

migrationCalistir(26, () => {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_account_transactions_account ON account_transactions(current_account_id);
    CREATE INDEX IF NOT EXISTS idx_account_transactions_date ON account_transactions(date);
    CREATE INDEX IF NOT EXISTS idx_account_payments_account ON account_payments(current_account_id);
    CREATE INDEX IF NOT EXISTS idx_account_payments_transaction ON account_payments(transaction_id);
    CREATE INDEX IF NOT EXISTS idx_general_expenses_status ON general_expenses(status);
    CREATE INDEX IF NOT EXISTS idx_general_expenses_date ON general_expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_general_expenses_due_date ON general_expenses(due_date);
    CREATE INDEX IF NOT EXISTS idx_current_accounts_active ON current_accounts(is_active);
  `)
})

// Mobil sunucudan gizlenecek ustalar artık isim eşleşmesi yerine (name LIKE '%Admin%')
// ayrı bir sütunla belirleniyor; mevcut davranışı bozmamak için o isimlere sahip
// kayıtlar bu sütunla işaretlenip sorgular sütuna geçiyor.
migrationCalistir(27, () => {
  kolonEkleEksikse('masters', 'hidden_from_mobile', 'INTEGER DEFAULT 0')
  db.exec(`
    UPDATE masters
    SET hidden_from_mobile = 1
    WHERE name LIKE '%Admin%' OR name LIKE '%Destek%'
  `)
})

migrationCalistir(28, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_date TEXT NOT NULL UNIQUE,
      total_collected REAL NOT NULL DEFAULT 0,
      cash_total REAL NOT NULL DEFAULT 0,
      card_total REAL NOT NULL DEFAULT 0,
      transfer_total REAL NOT NULL DEFAULT 0,
      other_total REAL NOT NULL DEFAULT 0,
      total_out REAL NOT NULL DEFAULT 0,
      expected_cash REAL NOT NULL DEFAULT 0,
      counted_cash REAL,
      cash_difference REAL,
      opened_wo_count INTEGER NOT NULL DEFAULT 0,
      closed_wo_count INTEGER NOT NULL DEFAULT 0,
      open_wo_count INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      closed_by_master_id INTEGER,
      closed_by_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(closed_by_master_id) REFERENCES masters(id)
    );
  `)
})

// Onarım: "Ödendi" işaretlenmiş ama ödeme tarihi/yöntemi boş bırakılmış giderler
// hiçbir günün gün sonu çıkışında görünmüyordu. Tarih gider tarihinden alınır,
// yöntem bilinmediği için 'Diğer' yazılır. Yeni kayıtlarda bu alanlar artık zorunlu.
migrationCalistir(29, () => {
  db.exec(`
    UPDATE general_expenses
    SET payment_date = expense_date
    WHERE status = 'Ödendi' AND (payment_date IS NULL OR TRIM(payment_date) = '');

    UPDATE general_expenses
    SET payment_method = 'Diğer'
    WHERE status = 'Ödendi' AND (payment_method IS NULL OR TRIM(payment_method) = '');
  `)
})

// Usta listelerinin sırası kayıt id'sine bağlıydı; kurulu veritabanlarında sıra
// ancak id değiştirilerek düzeltilebilirdi, o da iş emri/stok kayıtlarındaki usta
// referanslarını bozardı. Sıra artık ayrı bir sütunda tutuluyor.
migrationCalistir(30, () => {
  kolonEkleEksikse('masters', 'display_order', 'INTEGER')
  const sira = ['Bünyamin Kala', 'Yusuf Kala', 'Ali Kala']
  const guncelle = db.prepare('UPDATE masters SET display_order = ? WHERE name = ?')
  sira.forEach((name, index) => guncelle.run(index + 1, name))
})

// Teslim öncesi PIN normalizasyonu: başlangıç PIN'leri Bünyamin/Yusuf/Ali için
// 1111/2222/3333 olarak yeniden belirlendi. Migration 9'un seed'i yalnızca kayıt
// yoksa çalıştığından, kurulu veritabanları eski PIN'lerde kalıyordu.
migrationCalistir(31, () => {
  const baslangicPinleri = [
    { name: 'Bünyamin Kala', pin: '1111' },
    { name: 'Yusuf Kala', pin: '2222' },
    { name: 'Ali Kala', pin: '3333' }
  ]
  const guncelle = db.prepare('UPDATE masters SET pin = ? WHERE name = ?')
  for (const usta of baslangicPinleri) {
    guncelle.run(hashPin(usta.pin), usta.name)
  }
})

// Günü yeniden açma işlemi eskiden yalnızca console/electron-log dosyasına
// yazılıyordu; kullanıcı arayüzünde kimin, ne zaman, neden açtığı görünmüyordu.
// Artık her yeniden açma bu tabloya kaydedilip Gün Sonu ekranında listeleniyor.
migrationCalistir(32, () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_closing_reopen_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      closing_date TEXT NOT NULL,
      reason TEXT NOT NULL,
      reopened_by_master_id INTEGER,
      reopened_by_name TEXT,
      total_collected REAL,
      counted_cash REAL,
      cash_difference REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reopened_by_master_id) REFERENCES masters(id)
    );
  `)
})

// Cari borçlara isteğe bağlı vade tarihi eklenir. Eski kayıtlar değişmeden kalır.
migrationCalistir(33, () => {
  kolonEkleEksikse('account_transactions', 'due_date', 'TEXT')
})

// Aylık gider serileri aynı gider tablosunda tutulur. İlk kayıt serinin köküdür;
// sonraki aylar gerektiğinde üretilir ve eski tek seferlik kayıtlar aynen kalır.
migrationCalistir(34, () => {
  kolonEkleEksikse('general_expenses', 'recurrence_type', "TEXT DEFAULT 'Tek Seferlik'")
  kolonEkleEksikse('general_expenses', 'recurrence_end_date', 'TEXT')
  kolonEkleEksikse('general_expenses', 'recurrence_root_id', 'INTEGER')
  kolonEkleEksikse('general_expenses', 'recurrence_renewed_by_id', 'INTEGER')
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_general_expenses_recurrence_date
    ON general_expenses(recurrence_root_id, expense_date)
    WHERE recurrence_root_id IS NOT NULL;
  `)
})

  // Index'ler migration'lardan SONRA oluşturulmalı: bazı sütun ve tablolar
  // (ör. customers.is_active, work_order_payments) ancak migration'larla ekleniyor.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
    CREATE INDEX IF NOT EXISTS idx_customers_active ON customers(is_active);
    CREATE INDEX IF NOT EXISTS idx_vehicles_plate ON vehicles(plate);
    CREATE INDEX IF NOT EXISTS idx_vehicles_customer ON vehicles(customer_id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_vehicle ON work_orders(vehicle_id);
    CREATE INDEX IF NOT EXISTS idx_work_orders_status ON work_orders(status);
    CREATE INDEX IF NOT EXISTS idx_parts_code ON parts(code);
    CREATE INDEX IF NOT EXISTS idx_work_order_items_wo ON work_order_items(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_work_order_payments_wo ON work_order_payments(work_order_id);
    CREATE INDEX IF NOT EXISTS idx_stock_movements_part ON stock_movements(part_id);
  `)

  console.log('Veritabanı hazır ve tablolar oluşturuldu! Yol:', dbPath)
}

export const DEFAULT_SETTINGS = {
  theme: 'light',
  list_density: 'normal',
  work_orders_default_filter: 'Açık',
  show_critical_stock_warnings: 'true',
  show_long_open_workorder_warnings: 'true',
  long_open_workorder_days: '10',
  phone_server_auto_start: 'false',
  default_payment_method: 'Nakit',
  ask_payment_on_completion: 'true',
  warn_unpaid_completion: 'true',
  show_payment_summary_on_receipt: 'false',
  automatic_backup_enabled: 'false',
  backup_on_exit: 'true',
  backup_retention_count: '0',
  weather_city: 'Ankara'
}

export function ayarlariGetirBackend() {
  const currentDb = getDatabase()
  try {
    const rows = currentDb.prepare('SELECT key, value FROM app_settings').all()
    const settings = { ...DEFAULT_SETTINGS }
    for (const row of rows) {
      if (row.key && row.value !== undefined && row.value !== null) {
        settings[row.key] = String(row.value)
      }
    }
    return { success: true, settings }
  } catch (err) {
    console.error('Ayarları getirme hatası:', err)
    return { success: true, settings: { ...DEFAULT_SETTINGS } }
  }
}

export function ayarKaydetBackend(key, value) {
  const currentDb = getDatabase()
  try {
    const stmt = currentDb.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `)
    stmt.run(String(key), String(value));
    return { success: true }
  } catch (err) {
    console.error('Ayar kaydetme hatası:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function topluAyarlariKaydetBackend(settingsObj) {
  const currentDb = getDatabase()
  try {
    const stmt = currentDb.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
    `)
    const transaction = currentDb.transaction((obj) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined && v !== null) {
          stmt.run(String(k), String(v))
        }
      }
    })
    transaction(settingsObj)
    return { success: true }
  } catch (err) {
    console.error('Toplu ayar kaydetme hatası:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function veritabaniKontrolEtBackend() {
  const currentDb = getDatabase()
  try {
    const row = currentDb.prepare('PRAGMA quick_check;').get()
    const result = row ? Object.values(row)[0] : ''
    if (result === 'ok') {
      return {
        success: true,
        message: 'Veritabanı bütünlük kontrolü başarılı. Tüm tablolar ve indeksler sağlıklı.',
        checkedAt: new Date().toISOString()
      }
    } else {
      return {
        success: false,
        message: `Veritabanı bütünlük kontrolü başarısız oldu: ${result}. Admin / Destek bölümünden yedekleri kontrol edin.`
      }
    }
  } catch (err) {
    console.error('Veritabanı kontrol hatası:', err)
    return {
      success: false,
      message: 'Veritabanı kontrolü sırasında hata oluştu.'
    }
  }
}

export function verifyBackupDatabase(filePath) {
  let tempDb;
  try {
    tempDb = new Database(filePath, { readonly: true });
    const integrity = tempDb.prepare('PRAGMA integrity_check').get();
    const integrityOk = integrity && Object.values(integrity)[0] === 'ok';
    if (!integrityOk) {
      return { valid: false, error: 'Veritabanı bütünlük kontrolü başarısız veya dosya bozuk.' };
    }

    const tables = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    const tableNames = tables.map(t => t.name);

    const essentialTables = ['customers', 'vehicles', 'work_orders', 'parts'];
    const missingTables = essentialTables.filter(t => !tableNames.includes(t));

    if (missingTables.length > 0) {
      return {
        valid: false,
        error: `Geçersiz veritabanı şeması. Eksik tablolar: ${missingTables.join(', ')}`
      };
    }

    return { valid: true };
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (tempDb) {
      try {
        tempDb.close();
      } catch (e) {
        console.error('Geçici yedek veritabanı kapatılırken hata oluştu:', e);
      }
    }
  }
}

let isRefreshing = false

export async function uygulamaVerileriniYenileBackend() {
  if (isRefreshing) {
    return {
      success: false,
      message: 'Yenileme işlemi zaten devam ediyor.'
    }
  }

  isRefreshing = true

  try {
    if (activeDb) {
      try {
        activeDb.close()
      } catch (err) {
        console.warn('[DB] Eski veritabanı bağlantısı kapatılırken uyarı:', err)
      }
    }

    try {
      activeDb = new Database(dbPath)
      ozellestirilmisFonksiyonlariTanimla(activeDb)
    } catch (err) {
      console.error('[DB] Bağlantı yeniden açılamadı:', err)
      return {
        success: false,
        message: 'Veritabanı bağlantısı yeniden açılamadı. Veritabanı dosyasını kontrol edin.'
      }
    }

    initDB()

    const checkRow = activeDb.prepare('PRAGMA quick_check;').get()
    const checkResult = checkRow ? Object.values(checkRow)[0] : ''

    if (checkResult !== 'ok') {
      return {
        success: false,
        message: 'Veritabanı bütünlük kontrolü başarısız oldu. Veriler değiştirilmedi. Admin / Destek bölümünden yedekleri kontrol edin.'
      }
    }

    return {
      success: true,
      message: 'Veriler başarıyla yenilendi.',
      refreshedAt: new Date().toISOString()
    }
  } catch (err) {
    console.error('[DB] Veri yenileme hatası:', err)
    return {
      success: false,
      message: 'Veriler yenilenemedi. Veritabanı bağlantısını kontrol edin.'
    }
  } finally {
    isRefreshing = false
  }
}

export default db
export { dbPath }
