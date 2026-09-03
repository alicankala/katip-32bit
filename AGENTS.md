# Kâtip 32-bit / Windows 7 çalışma rehberi

Bu repo Kâtip'in Windows 7, x86 ve eski/düşük donanımlı PC sürümüdür.

Ana dal: `master`

Bu repoda uyumluluk ve düşük kaynak kullanımı modern API kullanımından daha önemlidir.

## Kritik platform sınırları

Korunması gereken temel hat:

- Electron `22.3.27`
- Electron içi Node 16.17 dönemi
- CommonJS
- preload `.js`
- `better-sqlite3` `9.6.0`
- NSIS `ia32`

Açık uyumluluk incelemesi olmadan bunları yükseltme veya değiştirme.

Bu repoya:

- `type: module` ekleme
- x64 ESM varsayımlarını kopyalama
- x64 `import.meta.url` yolunu doğrudan taşıma
- global `fetch` varmış gibi davranma
- modern Node-only API kullanma
- Electron 23+ API kullanma
- x64 native `.node` dosyası kopyalama
- x64 executable kopyalama
- Windows 7'de bulunmayan yeni Windows API'lerine güvenme

Yeni native dependency gerekiyorsa Electron 22 ABI v110 + ia32 + Win7 desteğini ayrıca doğrula.

## Paketleme ve updater kanalı

Hedef:

`ia32`

Installer adı:

`Katip-Windows-x86-<version>-Setup.exe`

Updater yalnız:

`alicankala/katip-32bit`

reposunu kullanmalıdır.

64-bit installer, latest.yml, blockmap veya updater kanalını kullanma.

## Windows 7 updater ve ilk açılış

`electron/nodeHttpExecutor.ts` Win7'nin eski TLS/root certificate sorunlarını aşmak için bilinçli olarak vardır.

Bunu modern electron-updater transportuyla değiştirip silme.

x86 güncelleme denetimi uygulamanın ilk penceresinin oluşturulmasından sonra yaklaşık 15 saniye geciktirilir.

Bu gecikme eski/düşük donanımlı bilgisayarda ilk pencerenin CPU, disk, ağ ve TLS hazırlığıyla yarışmasını azaltmak içindir.

Gerçek eski cihaz başlangıç ölçümü olmadan bu gecikmeyi kaldırma.

x86 arayüzü ilk açılışta uzak font nedeniyle ağ beklememek için sistem fontu kullanır.

Sırf x64 ile aynı görünsün diye uzak font yükleme davranışı ekleme.

## Grafik ve düşük kaynak kullanımı

`app.disableHardwareAcceleration()` eski ekran kartlarında görünmeyen metin/renderer sorunlarını önlemek için bilinçli uyumluluk önlemidir.

Gerçek Windows 7 cihaz kanıtı olmadan kaldırma.

Aşağıdakileri eski PC'nin RAM/CPU/disk sınırlarını düşünmeden artırma:

- SQLite cache
- SQLite mmap
- fotoğraf boyutu
- arka plan polling
- sürekli animasyonlar
- büyük listelerin render maliyeti
- RAM kullanımı

## Masaüstü ve telefon davranışı

Bazı iş kuralları masaüstü controller'larında ve telefon API'sinde ayrı uygulanır.

Aşağıdaki değişikliklerde iki tarafı da kontrol et:

- müşteri
- araç
- iş emri
- stok
- tahsilat
- cari
- gider
- gün sonu
- fotoğraf
- yetki

Masaüstü tarafında renderer → preload → IPC/controller → SQLite zincirini dikkate al.

Telefon tarafında `phoneServer.ts` ve ilgili `phone*.ts` yardımcılarını kontrol et.

## Kritik iş kuralları

Aşağıdaki davranışları test geçirmek için değiştirme:

- iş emri toplamı aktif tahsilatların altına düşemez
- stok ve ödeme transaction bütünlüğü korunur
- kapalı gün mali mutasyonları engellenir
- gün yeniden açılması yönetici onayı ve gerekçeyle loglanır
- restore sırasında mutasyon yapılmaz
- destek/yönetici modu kritik mutasyonları sınırlar
- renderer localStorage değeri nihai yetki kanıtı değildir

Gerçek business-rule çelişkisi bulursan kullanıcıya sor.

## Veri güvenliği

Gerçek kullanıcı verisi Electron `userData` altındadır.

Başlıca:

- `otoservis.db`
- `fotograflar/`
- `yedekler/`

Testlerde yalnız doğrulanmış geçici `userData` kullan.

Gerçek DB üzerinde test yapma.

Aktif DB'ye doğrudan müdahale gerekiyorsa önce:

- uygulamanın kapalı olduğunu
- doğru hedef yolu
- SQLite bütünlüğünü

doğrula.

Kullanıcı açıkça istemeden:

- restore
- sıfırlama
- fabrika ayarı
- gerçek kullanıcı verisi değiştirme

yapma.

## Güncelleme kurulumu

`autoInstallOnAppQuit=false` kalmalıdır.

Güncelleme indirildikten sonra uygulamada `Şimdi Yeniden Başlat` aksiyonu görünür.

Kullanıcı seçtiğinde:

1. DB ve fotoğrafları kapsayan tam pre-update ZIP yedeği oluşturulur.
2. Yedek başarısızsa kurulum iptal edilir.
3. Yedek başarılıysa NSIS Next/İleri ekranları göstermeden sessiz biçimde kurulur.
4. Uygulama yeniden açılır.

Pre-update yedek güvenliğini atlama.

Normal çıkış yedeğini pre-update yedeğiyle karıştırma.

## Backup

x86 backup sistemi:

- `yazl`
- `yauzl`
- streaming ZIP

kullanır.

Windows `tar.exe` yaklaşımına geçirme.

Büyük DB/fotoğraf arşivini tamamen RAM'e alma.

Tüm arşivin geçici tam kopyasını üretme.

32-bit adres alanını dikkate al.

## Telefon sunucusu

Node 16 kısıtlarını koru.

Modern `server.closeAllConnections()` API'sini varsayma.

x86 tarafında socket'ler elle izlenip kapatılabilir.

Telefon fotoğrafları streaming gönderilir.

Tüm fotoğrafı RAM'de Buffer'a toplayan yapıya dönüştürme.

Mevcut güvenlikleri koru:

- PIN / QR
- session
- rate-limit
- body limit
- path doğrulaması
- restore 503 koruması

## Tema ve UI

Yeni kurulumda veya kayıtlı tema bulunmadığında varsayılan tema açıktır.

Daha önce kayıtlı kullanıcı tercihini koru.

Kartlar, seçim alanları ve sekmeler gereksiz açılış animasyonu beklememelidir.

Sürekli animasyon yalnız alt durum çubuğundaki döviz/hava geçişinde tutulabilir.

Eski PC'ler nedeniyle gereksiz animasyon ekleme.

## 64-bit ile ilişki

Ortak ürün özelliğinde `katip-64bit` tarafındaki davranışı da kontrol et.

Görsel ve business davranışı ortak olabilir ancak teknik implementasyon birebir aynı olmak zorunda değildir.

Win7/x86 uyumluluğu önceliklidir.

64-bit'ten özellikle şunları körlemesine kopyalama:

- `package-lock.json`
- Electron config
- ESM kodu
- native binary
- updater transport
- backup implementasyonu
- preload formatı

## Doğrulama

Dar değişiklikte önce ilgili test ve type-check'i çalıştır.

İhtiyaca göre:

- `npx vue-tsc --noEmit`
- `npm run test:unit`
- `npm run test:integration`
- `npm run test:business`
- `npm run test:stage4`
- `npm run test:smoke`
- `npm run check:sync`
- `npm run check:release-contract`
- `npm run check:win7-contract`

Paketleme gerekiyorsa:

`npm run build -- --publish never`

kullan.

Her küçük UI değişikliğinde bütün ağır suite'leri tekrar tekrar çalıştırma.

Runtime, updater, backup, native dependency veya paketleme değişikliği gerçek Windows 7 x86 cihazda ayrıca doğrulanmalıdır.

Modern Windows üzerinde başarılı ia32 build tek başına Win7 uyumluluğunu kanıtlamaz.

Kritik Win7 cihaz testi gerekiyorsa:

`docs/WINDOWS7_X86_REAL_DEVICE_TEST.md`

prosedürünü esas al.

Kullanıcı açıkça release istemeden:

`scripts/yayinla.ps1`

çalıştırma.