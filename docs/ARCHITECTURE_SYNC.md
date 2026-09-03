# Kâtip mimari eşleme matrisi

Bu matris iki Kâtip deposunun aynı ürün davranışını korurken mimari gereksinimler nedeniyle bilinçli olarak farklı kalmasını sağlar. Bir ortak özellik değişikliğinde ilgili satır iki repoda da kontrol edilmelidir.

## Ortak özellikler

| Alan | 64-bit | 32-bit / Win7 | Doğrulama kaynağı |
| --- | --- | --- | --- |
| Müşteri ve araç yönetimi | Var | Var | controller, preload, renderer |
| İş emri, kalem ve stok transactionları | Var | Var | Aşama 3 testleri |
| Tahsilat, gider ve gün sonu kuralları | Var | Var | Aşama 3 testleri |
| SQLite şema/migration onarımı | Var | Var | Aşama 2 testleri |
| Telefon API, QR/PIN ve oturum | Var | Var | Aşama 4 testleri |
| DB + fotoğraf yedek/restore | Var | Var | Aşama 4 testleri |
| Electron açılış/IPC smoke | Var | Var | Aşama 5 smoke testleri |
| NSIS ve ayrı güncelleme kanalı | x64 | ia32 | builder ve CI build çıktısı |

Sürüm numarası iki mimaride aynı olmak zorunda değildir. Güncel uygulama, Electron ve bağımlılık sürümleri her zaman ilgili `package.json`, `package-lock.json` ve `electron-builder.json5` dosyalarından okunur.

## Otomatik ortak dosya kontrolü

`npm run check:sync` iki repo yan yana bulunduğunda ortak kritik controller, güvenlik/oturum modülleri ve iş kuralı testlerini içerik olarak karşılaştırır. Alternatif konum için `node scripts/check-architecture-sync.cjs --peer <dizin>` kullanılabilir. Kontrol bir dosya eksikse veya ortak kabul edilen içerik ayrışmışsa başarısız olur.

GitHub Actions ayrıca kardeş depoyu geçici olarak checkout edip aynı kontrolü çalıştırır. Bu kontrol bir davranış testinin yerini almaz; unutulan mimari eşlemeyi erken görünür kılar.

## Bilinçli farklılıklar

Aşağıdaki alanlar otomatik eşitlik kontrolüne alınmaz:

| Alan/dosya | 64-bit | 32-bit / Win7 |
| --- | --- | --- |
| Modül sistemi | ESM, `type: module` | CommonJS |
| Electron | Modern hat | Tam sabit 22.3.27 |
| `better-sqlite3` | Modern x64 sürümü | Tam sabit 9.6.0 / ia32 ABI |
| Preload çıktısı | `preload.mjs` | `preload.js` |
| Updater ağı | electron-updater varsayılan transport | `nodeHttpExecutor.ts`, Node CA ve ilk pencereyle yarışmaması için 15 saniye gecikmeli başlangıç denetimi |
| Arayüz yazı tipi | Inter ağ kaynağı, sistem fontu fallback | Açılışta ağ beklememek için doğrudan Segoe UI/sistem fontu |
| Yedekleme | Windows `tar.exe` | `yazl`/`yauzl` streaming ZIP |
| Paketleme | NSIS x64 | NSIS ia32 ve `-x86` artefakt adı |
| Telefon server kapanışı | `closeAllConnections` kullanılabilir | Socketler elle izlenir/kapatılır |
| `database.js` / `photoUtils.ts` | Modern runtime ayrımları olabilir | Node 16/Win7 uyumlu yol korunur |
| Lockfile | x64 bağımlılık ağacı | ia32/Electron 22 bağımlılık ağacı |

Bir dosya ancak somut mimari gerekçeyle bu listeye eklenmelidir. Ortak listeden çıkarma, aynı değişiklikte bu belgeye gerekçe eklenerek yapılmalıdır.

## Ortak değişiklik kontrol listesi

1. Renderer, preload, IPC/controller, veritabanı ve telefon API katmanlarını ayrı ayrı değerlendir.
2. Ortak iş kuralını iki repoda eşle; x86 implementasyonu gerekirse farklı tut.
3. `npm run check:sync` çalıştır.
4. İki repoda tüm testleri, type-check, smoke ve `--publish never` NSIS build çalıştır.
5. İki repoyu ayrı commit/push et; release kanallarını ve artefaktları karıştırma.
