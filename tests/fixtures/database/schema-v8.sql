PRAGMA foreign_keys = OFF;

CREATE TABLE schema_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version INTEGER NOT NULL DEFAULT 0
);
INSERT INTO schema_version (id, version) VALUES (1, 8);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  phone TEXT,
  note TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE parts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  name TEXT,
  stock INTEGER DEFAULT 0,
  buy_price REAL DEFAULT 0,
  sell_price REAL DEFAULT 0,
  shelf TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER,
  plate TEXT UNIQUE,
  brand TEXT,
  model TEXT,
  year INTEGER,
  mileage INTEGER,
  chassis TEXT,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY(customer_id) REFERENCES customers(id)
);

CREATE TABLE work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER,
  description TEXT,
  mileage INTEGER,
  total_price REAL DEFAULT 0,
  status TEXT DEFAULT 'Acik',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  closed_at DATETIME,
  FOREIGN KEY(vehicle_id) REFERENCES vehicles(id)
);

CREATE TABLE work_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_order_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  part_id INTEGER,
  description TEXT,
  quantity REAL DEFAULT 1,
  unit_price REAL DEFAULT 0,
  total_price REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(work_order_id) REFERENCES work_orders(id),
  FOREIGN KEY(part_id) REFERENCES parts(id)
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  part_id INTEGER NOT NULL,
  work_order_id INTEGER,
  type TEXT NOT NULL,
  quantity REAL NOT NULL,
  note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(part_id) REFERENCES parts(id),
  FOREIGN KEY(work_order_id) REFERENCES work_orders(id)
);

INSERT INTO customers (id, name, phone, note, is_active)
VALUES (41, 'Migration Fixture Customer', '5550000041', 'preserve-me', 1);

INSERT INTO vehicles (id, customer_id, plate, brand, model, year, mileage, chassis, is_active)
VALUES (51, 41, 'TESTV8', 'Fixture', 'Legacy', 2008, 123456, 'FIXTURE-CHASSIS', 1);

INSERT INTO parts (id, code, name, stock, buy_price, sell_price, shelf, is_active)
VALUES (61, 'FIXTURE-PART', 'Legacy Part', 7, 12.5, 20, 'F-8', 1);

INSERT INTO work_orders (id, vehicle_id, description, mileage, total_price, status)
VALUES (71, 51, 'Legacy work order', 123456, 25, 'Acik');

INSERT INTO work_order_items (
  id, work_order_id, type, part_id, description, quantity, unit_price, total_price
) VALUES (81, 71, 'Parca', 61, 'Legacy part line', 1, 20, 20);

PRAGMA foreign_keys = ON;
