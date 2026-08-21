# Telefon sunucusu mimarisi

Bu belge, telefon API'sinin mevcut davranışını ve masaüstü iş kurallarıyla olan sınırlarını görünür kılar. Endpoint yolları, istek/yanıt sözleşmeleri, QR/PIN oturumu ve yetki davranışı bu ayrıştırmada değiştirilmemiştir.

## Ayrıştırılan sorumluluklar

| Modül | Sorumluluk |
| --- | --- |
| `electron/phoneAuthState.ts` | QR eşleştirme tokenları, mobil oturumlar, süre aşımı ve giriş hız sınırı |
| `electron/phoneHttpUtils.ts` | İstek gövdesi boyut sınırı, JSON okuma ve HTML kaçışlama |
| `electron/phoneMigrations.ts` | Telefon tarafının ihtiyaç duyduğu idempotent şema onarımları |
| `electron/phoneAssets.ts` | Paket içi PrimeIcons dosyalarının kontrollü ve önbellekli sunumu |
| `electron/phoneServer.ts` | HTTP yönlendirme, endpoint sözleşmeleri ve gömülü mobil arayüz |

## Masaüstüyle ortak kullanılan kritik kurallar

- İş emri toplamı `workOrderController.ts` içindeki ortak toplam güncelleyicisiyle hesaplanır. Böylece aktif tahsilat tabanı hem masaüstünde hem telefonda aynı transaction kontrolünden geçer.
- Stok hareketi kaydı `partController.ts` içindeki ortak yardımcı üzerinden yapılır. Hareket yönü ve hareket sonrası stok bilgisi iki erişim yolunda aynı kalır.
- Restore engeli, oturum/yetki kaynağı, fotoğraf yolu denetimi ve veritabanı bağlantısı mevcut ortak ana süreç modüllerini kullanır.

## Kalan bilinçli tekrar alanları

Aşağıdaki akışlar telefon endpointlerinin transaction ve yanıt sözleşmelerine bağlı olduğu için tek seferde taşınmamalıdır:

- servis kabulünde müşteri, araç ve iş emrinin birlikte oluşturulması;
- parça veya işçilik kalemi ekleme ve silme transactionları;
- iş emrini tamamlama ve aynı transaction içinde ödeme alma;
- telefon ekranlarına özel liste ve rapor sorguları.

Bu alanlarda ortaklaştırma yapılacaksa her iş kuralı ayrı küçük değişiklik olarak ele alınmalı; Aşama 3 iş kuralı testleriyle Aşama 4 telefon API testleri birlikte çalıştırılmalıdır. Masaüstü ile telefon arasında gözlenen bir davranış farkı önce iş kuralı çelişkisi olarak değerlendirilmelidir.

## Mimari sınırlar

- 64-bit sürüm modern Electron/Node kapanış API'lerini kullanabilir.
- 32-bit sürüm Electron 22 ve Node 16 uyumluluğu için açık socketleri elle izlemeye devam eder.
- Telefon sunucusu yalnız yerel ağ HTTP sunucusudur; internet servisi veya yeni bir güven sınırı değildir.
- Testler yalnız işletim sistemi geçici dizini altındaki doğrulanmış test veritabanı ve fotoğraf dizinlerini kullanır.
