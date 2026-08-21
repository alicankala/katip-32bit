# Windows 7 / x86 gerçek cihaz doğrulama prosedürü

Bu prosedür yalnız `katip-32bit` kurulum paketini gerçek 32-bit Windows 7 SP1 cihazda doğrulamak içindir. GitHub Actions, modern Windows üzerinde ia32 paket üretse bile Windows 7 uyumluluğunu kanıtlamaz.

> Aşağıdaki cihaz adımlarının tamamı için **manuel gerçek Win7 testi gerekiyor**.

## Güvenli test ortamı

- İnternete ve yerel ağa kontrollü erişebilen, üretim kullanıcısına ait olmayan bir Windows 7 SP1 x86 test PC veya geri döndürülebilir fiziksel disk imajı kullan.
- Gerçek müşteri verisi kopyalama. Yalnız sentetik müşteri, araç, fotoğraf ve tutarlar kullan.
- Testten önce işletim sistemi sürümünü (`winver`), 32-bit mimariyi, RAM miktarını ve boş disk alanını kayıt altına al.
- Test edilecek `Katip-Windows-x86-<sürüm>-Setup.exe` dosyasının SHA-256 özetini ve GitHub release kaynağını kaydet.
- Başlangıçtaki `%APPDATA%`/Electron `userData` durumunu not et. Veri koruma senaryosu dışında test profili temiz olmalıdır.

Her adım için sonuç `Geçti / Kaldı / Uygulanamadı`, tarih, testçi, ekran/log kanıtı ve varsa hata adımı kaydedilir. PIN, token, müşteri bilgisi veya özel log içeriği kanıta eklenmez.

## A. Temiz kurulum ve ilk açılış

1. Önceki test kurulumunu Windows program kaldırma ekranından kaldır; yalnız sentetik test verisi kullanıldığını doğrula.
2. x86 NSIS kurulumunu standart kullanıcı akışıyla çalıştır. Kurulum yolu seçimi, masaüstü/Başlat menüsü kısayolları ve uygulama adı doğru olmalıdır.
3. Görev Yöneticisi'nde çalışan uygulamanın 32-bit olduğunu doğrula.
4. İlk açılış sihirbazını tamamla; uygulamanın beyaz/boş pencere olmadan giriş ekranına geldiğini doğrula.
5. İlk açılışta `otoservis.db` ve gerekli dizinlerin yalnız test kullanıcısının `userData` alanında oluştuğunu doğrula.
6. Uygulamayı kapatıp yeniden başlat; PIN girişi ve ana ekran tekrar çalışmalıdır.

## B. Temel iş akışları

1. Sentetik müşteri ve araç oluştur; düzenle, ara ve uygulama yeniden başladıktan sonra kalıcı olduğunu doğrula.
2. Araç için iş emri aç; işçilik ve stoklu parça ekle. Stok yalnız kullanılan miktar kadar düşmelidir.
3. Parça miktarını artır/azalt ve kalemi sil; stok farkları ve iadeler doğru görünmelidir.
4. Nakit, kart ve havale ödeme örnekleri ekle; ödeme iptalini gerekçeyle dene.
5. İş emrini tamamla; tahsilat altına toplam düşürme korumasını doğrula.
6. Sentetik gider/cari hareketi ekle ve gün sonu nakit/kart/havale toplamlarını kayıtlarla karşılaştır.
7. Günü kapat; kapalı güne geriye dönük ödeme/gider eklenemediğini doğrula. Test sonunda gerekiyorsa yönetici gerekçesiyle yeniden açma logunu kontrol et.

## C. Telefon, fotoğraf ve uzun kullanım

1. Aynı yerel ağdaki telefonla QR ve PIN üzerinden ayrı ayrı bağlan. QR süresi, oturum ve çıkış akışını doğrula.
2. Telefondan iş emri listeleme, kalem ekleme/silme ve ödeme/tamamlama akışını sentetik kayıtla dene.
3. PC ve telefondan fotoğraf ekle; küçük resim/tam görüntü açılışı, yeniden başlatma sonrası kalıcılık ve silme akışını doğrula.
4. Telefon sunucusunu kapat/aç ve uygulamayı yeniden başlat; portun serbest kaldığını ve yeniden bağlantının çalıştığını doğrula.
5. Uygulamayı en az bir iş günü açık bırak; artan RAM, takılı kalan pencere, tekrarlanan ağ isteği veya kapanmayan süreç gözlenirse zaman ve RAM değerini kaydet.

## D. Yedek ve restore

1. Sentetik DB kayıtları ile birden çok fotoğraf varken manuel yedek oluştur.
2. ZIP'i bağımsız bir arşiv okuyucuyla aç; DB ve fotoğrafların bulunduğunu doğrula. Arşivi değiştirme.
3. Yedekten sonra ayırt edilebilir sentetik bir kayıt ve fotoğraf ekle.
4. Yedeği restore et; yedek anındaki müşteri/araç/iş emri/stok/ödeme ve fotoğraflar eksiksiz gelmeli, sonradan eklenen işaret kaydı bulunmamalıdır.
5. Uygulamayı yeniden başlatıp SQLite sağlık kontrolü ve fotoğraf açılışını tekrar doğrula.
6. Ayrı bir bozuk test ZIP'inin güvenle reddedildiğini ve mevcut sentetik verinin değişmediğini doğrula.

## E. Güncelleme ve veri koruma

1. Ayrı güncelleme kanalında bulunan bilinen eski bir x86 Kâtip sürümünü temiz test profiline kur.
2. Eski sürümde ayırt edilebilir sentetik müşteri, araç, iş emri, ödeme, fotoğraf ve yedek oluştur.
3. Uygulama içi otomatik güncellemeyi çalıştır. GitHub TLS erişimi, indirme ilerlemesi, yeniden başlatma ve x86 installer seçimi doğru olmalıdır.
4. Güncelleme sonrası sürümü doğrula; eski sentetik DB, fotoğraf ve yedekler korunmuş olmalıdır.
5. Uygulamayı Windows program kaldırma ekranından kaldır. Kullanıcı verisinin silinmediğini doğrula.
6. Aynı x86 sürümü yeniden kur; mevcut verinin migration sonrası açıldığını, kayıt/fotoğraf/yedeklerin korunduğunu doğrula.

## F. Sonuç ve kanıt

Test ancak tüm zorunlu adımlar geçtiğinde gerçek Win7 doğrulaması sayılır. Aşağıdakiler sonuç kaydına eklenir:

- cihaz/Windows/mimari/RAM özeti;
- kurulan eski ve yeni Kâtip sürümleri ile installer SHA-256 değerleri;
- her bölümün geçti/kaldı durumu;
- uygulama logundaki ilgili zaman aralığı (gizli/müşteri verisi ayıklanmış);
- güncelleme, restore ve yeniden kurma sonrası veri koruma sonucu;
- bulunan hatanın tam yeniden üretim adımları.

CI'daki `check:win7-contract` yalnız Electron 22.3.27, CommonJS, `better-sqlite3` 9.6.0, ia32 paketleme, x86 artefakt adı, Win7 updater yolu ve streaming ZIP bağımlılıklarını korur. Bu otomatik kontrol fiziksel cihaz sonucunun yerine geçmez.
