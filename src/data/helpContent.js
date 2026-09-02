// Yardım Merkezi içeriği.
// Metinler bilerek bileşenden ayrı tutuldu: kullanım kılavuzunu güncellemek için
// yalnızca bu dosyayı düzenlemek yeterlidir, arayüz kodu değişmez.
//
// Bölüm  -> sol taraftaki başlık
// Konu   -> açılır kapanır kart
//   ozet   : tek cümlelik özet (aramada da taranır)
//   adimlar: sıralı adımlar
//   ipucu  : sarı ipucu kutusu (isteğe bağlı)

export const yardimBolumleri = [
  {
    id: 'baslangic',
    baslik: 'Başlarken',
    ikon: 'pi pi-flag',
    konular: [
      {
        id: 'giris',
        baslik: 'Programa giriş yapma',
        ozet: 'Usta seçip 4 haneli PIN ile giriş yapılır.',
        adimlar: [
          'Açılış ekranındaki listeden kendi adınızı seçin.',
          '4 haneli PIN kodunuzu girin ve "Giriş Yap" düğmesine basın.',
          'Gün içinde başka bir usta devralacaksa, üst çubuktaki (sağ üstte, telefon simgesinin solundaki) çıkış düğmesiyle oturumu kapatın.'
        ],
        ipucu: 'Hangi iş emrini kimin açtığı ve kimin kapattığı PIN girişine göre kaydedilir; bu yüzden herkesin kendi PIN\'iyle girmesi önemlidir.'
      },
      {
        id: 'pinler',
        baslik: 'Başlangıç PIN kodları ve değiştirme',
        ozet: 'Kurulumla gelen PIN kodları ve bunların nasıl değiştirileceği.',
        adimlar: [
          'Kurulumla birlikte gelen PIN kodları: Bünyamin 1111, Yusuf 2222, Ali 3333.',
          'Destek (Admin) girişi için başlangıç PIN kodu: 4444.',
          'Değiştirmek için: Ayarlar → PIN Değiştir bölümünü açın.',
          'Eski PIN\'i ve yeni PIN\'i girip "PIN Değiştir" düğmesine basın.'
        ],
        ipucu: 'Program ilk kez kullanılmaya başlandığında herkesin kendi PIN\'ini değiştirmesi önerilir. Yeni PIN mutlaka 4 haneli olmalıdır.'
      },
      {
        id: 'ekran-duzeni',
        baslik: 'Ekranın bölümleri',
        ozet: 'Sol menü, üst şerit ve ana panelin ne işe yaradığı.',
        adimlar: [
          'Sol menü üç grup halindedir: Operasyon (Ana Sayfa, Servis Kabul, İş Emirleri), Kayıtlar (Müşteriler, Araçlar, Parça / Stok), Finans & Raporlar (Finans, Gün Sonu).',
          'Üst çubukta, sağ tarafta telefon simgesinin solunda aktif ustanın adı ve çıkış düğmesi bulunur.',
          'Sol menünün en altında Yardım ve Ayarlar bulunur.',
          'Her ekranın başlığının yanındaki küçük "?" düğmesi, doğrudan o ekranın anlatımını açar.',
          'Üst şeritteki telefon simgesi mobil erişimi açar; dairesel ok simgesi veritabanını, açık ekranı ve bilgi şeridini yeniden yükler.',
          'Sol alttaki küçük kutu sırayla saat, tarih, döviz kuru ve hava durumunu gösterir.'
        ]
      },
      {
        id: 'ilk-gun',
        baslik: 'İlk gün yapılacaklar listesi',
        ozet: 'Programı teslim aldıktan sonra sırasıyla yapılması gerekenler.',
        adimlar: [
          'Herkes kendi PIN\'iyle giriş yapıp Ayarlar → PIN Değiştir bölümünden PIN\'ini değiştirsin.',
          'Destek girişi yapıp (Admin PIN) Ayarlar → Yedekleme ve Sistem bölümünde "Çıkışta yedek al" seçeneğinin açık olduğunu doğrulayın.',
          'Parça / Stok ekranından sık kullandığınız parçaları alış ve satış fiyatlarıyla girin.',
          'Telefondan kullanacaksanız üst şeritteki telefon simgesinden erişimi açıp QR ile eşleşin.',
          'İlk aracı Servis Kabul ekranından alıp deneme iş emri açın, kalem ekleyip kapatın.'
        ],
        ipucu: 'Bu adımların tamamı Kurulum Sihirbazı ile de yapılabilir. Sihirbazı Yardım Merkezi\'nin üstündeki düğmeden istediğiniz zaman yeniden açabilirsiniz.'
      }
    ]
  },
  {
    id: 'gunluk-akis',
    baslik: 'Günlük İş Akışı',
    ikon: 'pi pi-bolt',
    konular: [
      {
        id: 'servis-kabul',
        baslik: 'Araç kabul etme ve iş emri açma',
        ozet: 'Servise gelen aracı kaydedip iş emrini tek ekrandan açma.',
        adimlar: [
          'Sol menüden "Servis Kabul" ekranını açın.',
          'Plakayı yazın. Plaka daha önce kayıtlıysa müşteri ve araç bilgileri kendiliğinden gelir.',
          'Yeni araçsa müşteri adı, telefon, marka, model, yıl, şase ve kilometre alanlarını doldurun.',
          '"Müşteri Şikayeti / Yapılacak İşlem" alanına müşterinin anlattığını yazın.',
          '"Servise Al ve İş Emri Aç" düğmesine basın.'
        ],
        ipucu: 'Zorunlu alanlar yalnızca müşteri adı ve plakadır. Diğer bilgileri sonradan Araçlar ekranından tamamlayabilirsiniz.'
      },
      {
        id: 'kalem-ekleme',
        baslik: 'İş emrine parça ve işçilik ekleme',
        ozet: 'Yapılan işleri ve takılan parçaları iş emrine işleme.',
        adimlar: [
          '"İş Emirleri" ekranından ilgili iş emrini seçin.',
          '"İş Emri Kalemleri" bölümünü açın.',
          'Parça ekliyorsanız stoktan parçayı seçin; adet girip "Ekle" düğmesine basın.',
          'İşçilik ekliyorsanız işin adını ve ücretini yazıp "Ekle" düğmesine basın.',
          'Yanlış girilen bir satırı kalem listesindeki düzenle veya sil düğmeleriyle değiştirebilirsiniz.'
        ],
        ipucu: 'Stoktan parça eklediğinizde stok adedi kendiliğinden düşer; ayrıca stok düşmenize gerek yoktur.'
      },
      {
        id: 'odeme-alma',
        baslik: 'Ödeme ve tahsilat alma',
        ozet: 'Peşin, kısmi veya sonradan yapılan tahsilatları kaydetme.',
        adimlar: [
          'İş emri detayında "Ödemeler & Tahsilat" bölümünü açın.',
          '"Ödeme Al" düğmesine basın.',
          'Tutarı yazın ve ödeme yöntemini seçin (Nakit, Kart, Havale vb.).',
          '"Ödemeyi Kaydet" düğmesine basın.',
          'Müşteri tutarın bir kısmını ödediyse yalnızca ödediği tutarı girin; kalan bakiye alacak olarak takip edilir.'
        ],
        ipucu: 'Yanlış girilen bir ödemeyi aynı bölümdeki iptal düğmesiyle geri alabilirsiniz. İptal edilen ödeme kayıt geçmişinde görünmeye devam eder.'
      },
      {
        id: 'is-emri-tamamlama',
        baslik: 'İş emrini tamamlama ve teslim',
        ozet: 'Araç teslim edilirken iş emrinin kapatılması.',
        adimlar: [
          'İş emri detayını açın ve tüm kalemlerin girildiğinden emin olun.',
          '"İş Emrini Tamamla" düğmesine basın.',
          'Ödeme sorulursa tahsil edilen tutarı ve yöntemi girin.',
          'Ödeme alınmadan kapatıyorsanız uyarıyı onaylayın; tutar müşterinin alacak bakiyesine işlenir.',
          'Tamamlanan iş emri "Tamamlananlar" sekmesine taşınır.'
        ],
        ipucu: 'Kapattığınız bir iş emrinde eksik kaldıysa, detay ekranındaki "Tekrar Aç" düğmesiyle iş emrini yeniden açabilirsiniz.'
      },
      {
        id: 'servis-fisi',
        baslik: 'Servis fişi yazdırma',
        ozet: 'Müşteriye verilecek fişin çıktısını alma.',
        adimlar: [
          'İş emri detayını açın.',
          '"Servis Fişi Yazdır" düğmesine basın.',
          'Açılan önizlemede bilgileri kontrol edin.',
          'Yazıcıyı seçip yazdırın; PDF olarak kaydetmek isterseniz yazıcı listesinden "PDF olarak kaydet" seçeneğini kullanın.'
        ],
        ipucu: 'Fişte ödeme özeti kutusunun görünüp görünmeyeceği Ayarlar → İş Emri ve Ödeme bölümünden ayarlanır (Destek girişi gerekir).'
      },
      {
        id: 'fotograf',
        baslik: 'Araç fotoğrafı ekleme',
        ozet: 'Araç kabul ve hasar fotoğraflarını iş emrine iliştirme.',
        adimlar: [
          'İş emri detayında "Araç Fotoğrafları" bölümünü açın.',
          '"Fotoğraf Ekle" düğmesine basıp bilgisayardan dosyayı seçin.',
          'Fotoğrafa kategori (örn. Araç Kabul) ve not ekleyebilirsiniz.',
          'Telefondan bağlıysanız fotoğrafı doğrudan telefon kamerasıyla da çekebilirsiniz.'
        ],
        ipucu: 'Araç kabulde çekilen çizik ve hasar fotoğrafları, sonradan çıkabilecek anlaşmazlıklarda en güçlü kaydınızdır.'
      }
    ]
  },
  {
    id: 'kayitlar',
    baslik: 'Müşteri, Araç ve Stok',
    ikon: 'pi pi-database',
    konular: [
      {
        id: 'musteri',
        baslik: 'Müşteri kaydı açma ve düzenleme',
        ozet: 'Müşteri bilgilerini ekleme, güncelleme ve pasife alma.',
        adimlar: [
          '"Müşteriler" ekranını açın.',
          '"Yeni Müşteri Ekle" düğmesine basın.',
          'Ad Soyad (zorunlu), telefon ve özel not alanlarını doldurup "Kaydet" düğmesine basın.',
          'Var olan bir müşteriyi düzenlemek için satırdaki kalem simgesine basın.',
          'Artık gelmeyen bir müşteriyi çöp kutusu simgesiyle pasife alın.'
        ],
        ipucu: 'Pasife alınan müşterinin geçmiş iş emirleri ve cari hareketleri silinmez, yalnızca listede görünmez.'
      },
      {
        id: 'arac',
        baslik: 'Araç kaydı ekleme',
        ozet: 'Aracı müşteriye bağlayarak kaydetme.',
        adimlar: [
          '"Araçlar" ekranını açın.',
          '"Yeni Araç Ekle" düğmesine basın.',
          'Aracın sahibi olan müşteriyi listeden seçin.',
          'Plaka, marka, model, yıl, şase ve kilometre bilgilerini girip kaydedin.'
        ],
        ipucu: 'Çoğu durumda araç kaydını ayrıca açmanıza gerek yoktur; Servis Kabul ekranı yeni plakayı gördüğünde aracı kendisi oluşturur.'
      },
      {
        id: 'parca',
        baslik: 'Parça ekleme ve stok girişi',
        ozet: 'Stok kartı açma, alış-satış fiyatı ve stok hareketleri.',
        adimlar: [
          '"Parça / Stok" ekranını açın.',
          '"Yeni Parça Ekle" düğmesine basın.',
          'Parça adı, kodu, marka, kategori, OEM kodu ve birim bilgilerini girin.',
          'Alış fiyatı ve satış fiyatını girin; kâr hesabı alış fiyatı üzerinden yapılır.',
          'Stok adedini ve kritik stok seviyesini belirleyip kaydedin.'
        ],
        ipucu: 'Alış fiyatını doğru girmek önemlidir: Finans ekranındaki Kârlılık sekmesi bu bilgiye göre hesaplanır.'
      },
      {
        id: 'kritik-stok',
        baslik: 'Kritik stok uyarıları',
        ozet: 'Azalan parçaların Ana Sayfa\'da uyarı vermesi.',
        adimlar: [
          'Her parça için "kritik stok" adedi belirleyin (varsayılan 5).',
          'Stok bu adedin altına düştüğünde parça Ana Sayfa\'daki kritik stok kutusunda görünür.',
          'Uyarıları kapatmak isterseniz Destek girişi yapıp Ayarlar → Görünüm ve Kullanım bölümünden kapatabilirsiniz.'
        ]
      }
    ]
  },
  {
    id: 'finans',
    baslik: 'Finans ve Gün Sonu',
    ikon: 'pi pi-wallet',
    konular: [
      {
        id: 'cari',
        baslik: 'Borç ve tedarikçi takibi',
        ozet: 'Tedarikçi ve taşeronlara olan borçları izleme.',
        adimlar: [
          '"Finans" ekranını açın.',
          'Üstten veya Borçlar sekmesinden "Yeni Borç Ekle" düğmesine basın.',
          'Kişi/firma adını yazın; geçmişte kayıtlıysa öneriden seçin.',
          'Yeni bir kişi veya firmaysa yeni hesap seçeneğini onaylayıp borç bilgilerini aynı pencerede girin.',
          'Yaptığınız ödemeleri ilgili tedarikçinin "Öde" düğmesinden kaydedin.',
          'Müşteri alacaklarını Alacaklar sekmesinde iş emirlerine bağlı olarak takip edin.'
        ],
        ipucu: 'İş emri kapatılırken tahsil edilmeyen tutar müşterinin alacak bakiyesine kendiliğinden yansır.'
      },
      {
        id: 'gider',
        baslik: 'Genel gider kaydetme',
        ozet: 'Kira, elektrik, yakıt gibi dükkan giderlerini işleme.',
        adimlar: [
          '"Finans" ekranındaki Giderler sekmesini açın.',
          'Gideri adı, tutarı ve tarihiyle birlikte kaydedin.',
          'Her ay tekrarlanan internet, kira veya aboneliklerde kayıt şeklini "Her Ay Otomatik" seçin.',
          'Sabit fiyatın geçerli olduğu taahhüt bitişini girin; bu tarihten sonra yeni aylık kayıt oluşturulmaz.',
          'Taahhüt bitince çıkan "Yeni Tutarla Yenile" düğmesinden güncel fiyatı ve yeni bitiş tarihini girin.',
          'Gider ödendiyse ödeme tarihini ve yöntemini mutlaka girin.',
          'Ödenen giderler ilgili günün Gün Sonu çıkışlarında görünür.'
        ],
        ipucu: 'Aylık döngü yalnızca zamanı gelen ayları oluşturur; gelecek ayları önceden borç toplamına eklemez.'
      },
      {
        id: 'kar-raporu',
        baslik: 'İç kâr raporu',
        ozet: 'Parça ve işçilik kârının dönemsel özeti.',
        adimlar: [
          '"Finans" ekranındaki Kârlılık sekmesini açın.',
          'Bakmak istediğiniz tarih aralığını seçin.',
          'Rapor, satış tutarı ile parça alış maliyeti arasındaki farkı gösterir.',
          'Parça kârı ile işçilik kârını ayrı ayrı inceleyebilirsiniz.'
        ],
        ipucu: 'Bu rapor dükkan içi bilgidir; müşteriye verilen fişte görünmez.'
      },
      {
        id: 'gun-sonu',
        baslik: 'Gün sonu kapanışı',
        ozet: 'Günün tahsilatlarını ve çıkışlarını sayıp günü kapatma.',
        adimlar: [
          '"Gün Sonu" ekranını açın.',
          'Günün tahsilat ve çıkış listelerini kontrol edin.',
          'Kasada saydığınız tutarı ilgili alana girin.',
          'Fark varsa açıklama notu yazın.',
          '"Günü Kapat" düğmesine basın. Dilerseniz "Yazdır" ile kapanış çıktısı alın.'
        ],
        ipucu: 'Gün sonu yapılmadan programı kapatmaya çalışırsanız uyarı alırsınız. Kapatılmış bir günü düzeltmek için "Günü Yeniden Aç" düğmesi, bir neden yazısı ve Admin PIN gerekir; kim, ne zaman ve neden açtığı "Yeniden Açma Geçmişi" tablosuna kaydedilir.'
      }
    ]
  },
  {
    id: 'telefon',
    baslik: 'Telefondan Kullanım',
    ikon: 'pi pi-mobile',
    konular: [
      {
        id: 'telefon-baglanma',
        baslik: 'Telefonu programa bağlama',
        ozet: 'QR kod okutarak telefondan giriş yapma.',
        adimlar: [
          'Bilgisayarda üst şeritteki telefon simgesine basın.',
          'Telefon erişimi kapalıysa açın; ekranda bir QR kod görünür.',
          'Telefonun kamerasıyla QR kodu okutun ve açılan bağlantıya girin.',
          'Telefonda usta adınızı seçip PIN kodunuzu girin.',
          'Telefon ile bilgisayarın aynı Wi-Fi ağında olması gerekir.'
        ],
        ipucu: 'QR kod güvenlik gereği belirli bir süre sonra geçersiz olur. Süresi dolarsa aynı ekrandan yeni QR üretebilirsiniz.'
      },
      {
        id: 'telefonda-neler',
        baslik: 'Telefondan neler yapılabilir',
        ozet: 'Mobil ekranın kapsamı.',
        adimlar: [
          'Açık iş emirlerini görebilir ve detaylarını inceleyebilirsiniz.',
          'İş emrine parça ve işçilik ekleyebilirsiniz.',
          'Araç fotoğraflarını doğrudan telefon kamerasıyla çekip yükleyebilirsiniz.',
          'Müşteri ve araç bilgilerine bakabilirsiniz.'
        ],
        ipucu: 'Gün sonu kapanışı, yedekleme ve ayarlar gibi işlemler güvenlik gereği yalnızca bilgisayardan yapılır.'
      },
      {
        id: 'telefon-baglanti-kesme',
        baslik: 'Telefon bağlantısını kesme',
        ozet: 'Kaybolan veya yetkisiz cihazın erişimini kapatma.',
        adimlar: [
          'Bilgisayarda üst şeritteki telefon simgesine basın.',
          'Bağlı cihazlar sekmesini açın.',
          'İlgili cihazın yanındaki düğmeyle bağlantısını kesin.',
          'Tüm cihazları birden çıkarmak için "Tüm oturumları kapat" düğmesini kullanın.'
        ],
        ipucu: 'Telefonu kaybolan bir çalışan olursa önce o cihazın oturumunu kapatın, sonra ilgili ustanın PIN\'ini değiştirin.'
      }
    ]
  },
  {
    id: 'bakim',
    baslik: 'Yedekleme, Bakım ve Sorun Giderme',
    ikon: 'pi pi-shield',
    konular: [
      {
        id: 'yedekleme',
        baslik: 'Yedekleme',
        ozet: 'Verilerin kopyasını almak — en önemli alışkanlık. (Destek girişi gerekir.)',
        adimlar: [
          'Giriş ekranındaki "Destek Girişi" bağlantısından Admin PIN ile girin.',
          'Ayarlar → Yedekleme ve Sistem bölümünü açın.',
          '"Çıkışta yedek al" seçeneğini açık tutun; program her kapanışta yedek alır.',
          'Elle yedek almak için "Verileri Yedekle" düğmesine basın.',
          '"Yedek Klasörünü Aç" ile yedek dosyalarına ulaşabilirsiniz.',
          'Yedek klasöründeki dosyaları ayda bir USB belleğe veya buluta kopyalayın.'
        ],
        ipucu: 'Yedek dosyaları bilgisayarın kendi diskinde durur. Bilgisayar tamamen bozulursa yedekler de gider; bu yüzden dışarıya kopya almak şarttır.'
      },
      {
        id: 'geri-yukleme',
        baslik: 'Yedekten geri yükleme',
        ozet: 'Bozulan veya yanlış silinen verileri eski yedekten döndürme. (Destek girişi gerekir.)',
        adimlar: [
          'Destek girişi yapıp Ayarlar → Yedekleme ve Sistem bölümünü açın.',
          '"Yedekten Geri Yükle" düğmesine basın.',
          'Listeden geri dönmek istediğiniz tarihli yedeği seçin.',
          '"Seçili Yedeği Yükle" düğmesine basın ve uyarıyı onaylayın.',
          'Program yeniden başladığında veriler o yedeğin tarihindeki haline döner.'
        ],
        ipucu: 'Geri yükleme, o yedekten sonra girilen tüm kayıtları siler. Emin değilseniz önce mevcut durumun yedeğini alın.'
      },
      {
        id: 'veritabani-kontrol',
        baslik: 'Veritabanı kontrolü ve bakım',
        ozet: 'Program yavaşladığında veya tuhaf davrandığında yapılacaklar. (Destek girişi gerekir.)',
        adimlar: [
          'Destek girişi yapıp Ayarlar → Veritabanı ve Bakım bölümünü açın.',
          '"Veritabanını Kontrol Et" düğmesine basın; sonuç "başarılı" olmalıdır.',
          'Liste ekranları güncel görünmüyorsa "Verileri Yenile" düğmesini kullanın.',
          'Sorun sürerse "Log Klasörünü Aç" ile kayıt dosyalarına ulaşıp destek için paylaşın.'
        ],
        ipucu: 'Kontrol sonucu başarısız çıkarsa hiçbir şey yapmadan önce yedekten geri yükleme yapın ve destek alın.'
      },
      {
        id: 'destek-girisi',
        baslik: 'Destek girişi',
        ozet: 'Yalnızca bakım ve onarım için kullanılan yönetici modu.',
        adimlar: [
          'Giriş ekranında "Destek Girişi" bağlantısına basın.',
          'Admin PIN kodunu girin.',
          'Bu modda sistem bilgileri, veritabanı bakımı ve gün yeniden açma işlemleri yapılabilir.',
          'İşiniz bitince mutlaka çıkış yapıp normal ustayla giriş yapın.'
        ],
        ipucu: 'Destek modundaki "Veritabanını Sıfırla" işlemi tüm kayıtları siler ve geri alınamaz. Bu düğmeye günlük kullanımda asla dokunmayın.'
      },
      {
        id: 'sorun-giderme',
        baslik: 'Sık karşılaşılan sorunlar',
        ozet: 'Hızlı çözüm listesi.',
        adimlar: [
          'Telefon bağlanmıyor: Telefon ile bilgisayarın aynı Wi-Fi ağında olduğunu doğrulayın, QR kodu yenileyin.',
          'PIN kabul edilmiyor: PIN 4 haneli olmalıdır; doğru ustayı seçtiğinizden emin olun.',
          'Liste boş görünüyor: Üst şeritteki yenile düğmesine basın, filtre veya arama kutusunu temizleyin.',
          'Stok yanlış görünüyor: Parça kartındaki stok hareketleri listesinden hangi iş emrinin düştüğünü kontrol edin.',
          'Gün sonu tutmuyor: Ödendi işaretli giderlerin ödeme tarihinin dolu olduğundan emin olun.'
        ]
      }
    ]
  }
]
