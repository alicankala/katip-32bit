# Düşük donanım ve düşük çözünürlük denetimi

Bu denetim özellikle `katip-32bit` için yapıldı; ortak davranış gösteren alanlar 64-bit sürümde de kontrol edildi. Üretim verisi kullanılmadı. Otomatik testler yalnız doğrulanmış geçici dizinlerde çalışır.

## Uygulanan küçük optimizasyonlar

- Telefon fotoğraf endpointi artık bir fotoğrafın tamamını ana süreçte `Buffer` olarak tutmak yerine dosyayı HTTP yanıtına akışla gönderir. URL, yetki, yol güvenliği, içerik türü ve cache sözleşmesi değişmedi.
- x86 SQLite `mmap_size` üst sınırı 256 MB'den 64 MB'ye indirildi. 16 MB sayfa cache'i ve diğer SQLite ayarları korunurken 32-bit sanal adres alanında daha fazla pay bırakıldı. Entegrasyon testi iki mimarinin kendi tavanını doğrular.

## İncelenen alanlar

| Alan | Bulgular | Karar |
| --- | --- | --- |
| RAM / SQLite | Sayfa cache'i yaklaşık 16 MB; x86 mmap tavanı gereğinden büyüktü | x86 mmap 64 MB yapıldı |
| Büyük müşteri listesi | Aktif müşteriler tek sorgu/renderer dizisi olarak yüklenip istemcide filtreleniyor | Ölçülmüş bir donma olmadan IPC/pagination sözleşmesi değiştirilmedi; gerçek büyük fixture ile manuel profil gerekli |
| Büyük iş emri listesi | Ana liste sınırsız; servis geçmişi önerisi 50 ile sınırlı, tam diyalog bilinçli sınırsız | Sayfalama kullanıcı akışını etkiler; gerçek veri hacmiyle manuel profil gerekli |
| SQLite sorguları | FK/status/tarih/ilişki indeksleri migration testlerinde doğrulanıyor; başında `%` olan normalize aramalar indeks kullanamaz | Davranış değiştiren arama tasarımı yapılmadı |
| Çok sayıda fotoğraf | Renderer özel protokolle URL alıyor, tüm fotoğraflar base64 IPC yükü olmuyor; yüklemede uzun kenar 1280 | Telefon indirmesi streaming yapıldı |
| Telefon server | Oturum kontrolü yalnız görünür dashboard'da hafif `/api/session/ping` ile 4 saniyede bir; ağır dashboard sorgusu polling'den çıkarılmış | Yetki iptal gecikmesini değiştirmemek için süre korunuyor |
| Uzun süre açık kullanım | App timerları unmount sırasında temizleniyor; otomatik yedek 15 dakikada yalnız süre kontrolü yapıyor; çakışan yedeği bayrak engelliyor | Gerçek bir iş günü boyunca x86 süreç/RAM ölçümü manuel gerekli |
| Backup/restore | x86 `yazl`/`yauzl` ile dosya bazlı streaming yapıyor; tam arşivi RAM'e almıyor | Tasarım korundu; büyük fotoğraf arşiviyle gerçek cihaz testi gerekli |

## Çözünürlük denetimi

- Ana pencerenin minimumu 1024×640'tır; Electron smoke testi bu uygulama zincirini gerçek renderer/preload ile açar.
- Ana kabukta içerik alanları dikey kaydırmalı, fotoğraf satırları yatay kaydırmalı ve önemli diyaloglar viewport tabanlı genişlik/yükseklik sınırları kullanır.
- 1024×640 ve 1366×768 için ekranların tamamında piksel/screenshot kanıtı bulunmadığından kesin taşma varsayımıyla CSS değiştirilmedi.

Manuel görsel kontrolde Dashboard, Servis Kabul, İş Emirleri (kalem/ödeme/fotoğraf/tamamlama diyalogları), Müşteriler, Araçlar, Parçalar, Cari Hesaplar, Gün Sonu, Ayarlar ve Yardım ekranları iki çözünürlükte; normal ve kompakt yoğunlukta denenmelidir. Klavye ile son buton/alanlara erişim, yatay tablo kaydırması ve diyalog alt eylemleri ayrı ayrı doğrulanmalıdır.

## Gerçek cihazda kalan ölçümler

Gerçek düşük donanımlı x86/Win7 cihazda manuel test gerekiyor:

1. 10 bin sentetik müşteri ve 20 bin sentetik iş emriyle açılış, arama ve ekran geçiş süreleri;
2. yüzlerce fotoğraflı iş emirlerinde renderer ve telefon RAM tepe değeri;
3. en az 5 GB sentetik fotoğraf arşivinde yedek/restore süre ve RAM tepe değeri;
4. telefon server açıkken sekiz saat ana süreç/renderer RAM eğrisi;
5. 1024×640 ve 1366×768 gerçek ekranlarda tüm kritik diyalogların erişilebilirliği.

Hosted GitHub Actions bu donanım ve çözünürlük ölçümlerinin yerine geçmez.
