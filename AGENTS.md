# Katip geliştirme notları

- `electron/database.js` içindeki migration sürümü değiştiğinde `tests/integration/database-migrations.test.ts` içindeki `CURRENT_SCHEMA_VERSION` değerini aynı sürüme güncelle.
- Migration değişikliklerinden sonra `npm run test:integration` çalıştır; testte 32/34 benzeri şema sürümü uyuşmazlığı bırakma.
