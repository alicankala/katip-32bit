# Kâtip release ve destek doğrulama rehberi

Bu belge release üretmez. Yayın öncesi kontrolleri, eski sürümden güncelleme denemesini ve kullanıcı gizliliğini koruyan destek akışını tekrar edilebilir hale getirir.

## Mimari matrisi

| Ürün | Paket hedefi | Installer | Güncelleme deposu |
| --- | --- | --- | --- |
| Kâtip 64-bit | NSIS `x64` | `Katip-Windows-<sürüm>-Setup.exe` | `alicankala/katip-64bit` |
| Kâtip 32-bit | NSIS `ia32` | `Katip-Windows-x86-<sürüm>-Setup.exe` | `alicankala/katip-32bit` |

İki mimarinin installer, `latest.yml`, blockmap ve GitHub release kanalları karıştırılmamalıdır. Normal CI/build doğrulaması her zaman `npm run build -- --publish never` kullanır. `scripts/yayinla.ps1` yalnız açık bir yayın kararıyla çalıştırılır; taslak release'i, üç artefaktı ve dosya boyutlarını doğruladıktan sonra release'i yayımlar.

## Yayın öncesi kontrol listesi

1. Doğru repo, `master` ve temiz çalışma ağacı doğrulanır.
2. Sürüm ve hedef mimari kontrol edilir.
3. Tüm testler, type-check, Electron smoke ve NSIS build çalıştırılır.
4. `npm run check:release-contract` çalıştırılır.
5. x86 için ayrıca `npm run check:win7-contract` ve gerçek 32-bit Windows 7 prosedürü uygulanır.
6. Installer adı, `latest.yml`, blockmap, repo hedefi ve dosya boyutları karşılaştırılır.
7. Desteklenen eski sürüm gerçek test cihazına kurulur; uygulama içinden güncelleme indirme, kurulum, yeniden açılış ve mevcut DB/fotoğrafların korunması doğrulanır.
8. Installer imzası ve zaman damgası `Get-AuthenticodeSignature` ile kontrol edilir.
9. Ancak açık yayın onayından sonra release betiği çalıştırılır.

Hosted GitHub Actions, gerçek Windows 7 testi değildir. x86 güncelleme, native SQLite, kurulum ve veri koruma akışı `WINDOWS7_X86_REAL_DEVICE_TEST.md` ile fiziksel cihazda doğrulanmalıdır.

## Loglar ve crash teşhisi

Uygulama updater, yedek/restore, controller ve ana süreç hatalarını yerel `electron-log` dosyasına yazar. Ana süreç yakalanmamış hataları, renderer/child process kapanmalarını ve pencerenin yanıt vermez/yeniden yanıt verir durumlarını da yerel olarak kaydeder. Otomatik telemetry veya crash upload yoktur.

Native çökme ve işletim sistemi seviyesindeki sorunlarda uygulama loguna ek olarak Windows Olay Görüntüleyicisi gerekebilir. Mevcut kayıtlar hata nedenini daraltmaya yardımcı olur; tüm native crash'lerde stack dump garantisi vermez.

## Güvenli destek paketi toplama

1. Kullanıcı Ayarlar'daki **Log Klasörünü Aç** işlemini kendisi başlatır.
2. Yalnız sorun zamanını kapsayan ilgili log dosyaları ayrı bir geçici klasöre kopyalanır.
3. Göndermeden önce müşteri/araç bilgileri, kullanıcı adları, tam dosya yolları, IP adresleri, token ve PIN benzeri değerler gözle incelenip karartılır.
4. DB, fotoğraflar ve yedekler varsayılan destek paketine eklenmez. Bunlar ancak ayrıca ve açıkça yetkilendirilirse değerlendirilir.
5. İncelenmiş dosyalar yerelde ZIP yapılır ve kullanıcının seçtiği kanaldan gönderilir. Uygulama kendiliğinden veri yüklemez.

Şu anda tek tıklamalı, otomatik sansürlü bir tanılama paketi yoktur. Yanlışlıkla özel veri gönderme riskini artırmamak için bu çalışma kapsamında yeni bir yükleme özelliği eklenmemiştir.

## Code signing ve SmartScreen

Yerel olarak üretilen mevcut x64 ve x86 installer/uygulama dosyaları `NotSigned` durumundadır. Bu nedenle SmartScreen itibarı ve yayıncı kimliği garanti edilemez. Uygulanabilir çözüm, güvenilir bir sağlayıcıdan OV veya EV Authenticode sertifikası edinmek, installer ve uygulama dosyalarını zaman damgalı imzalamak ve sertifika/anahtarları güvenli release ortamında tutmaktır. Bu seçim ücret, kimlik doğrulama ve gizli anahtar yönetimi gerektirdiğinden otomatik yapılmaz.
