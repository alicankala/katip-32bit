// Destek (Admin) oturumunun yetki sınırı.
//
// Destek girişi bir usta değil; teknik bakım profilidir. Dükkanın günlük işini
// (servis kabul, iş emri, tahsilat, stok hareketi, gün sonu kapatma, müşteri /
// araç / parça kaydı) destek modunda yapmak iki soruna yol açıyordu:
//   1. resolveActiveMasterId() destek oturumunda null döndüğü için kayıtlar
//      "kim yaptı" bilgisi boş olarak düşüyordu.
//   2. Uzaktan bağlanan destek, ustaya ait bir işlemi kendi adına yapabiliyordu.
//
// Bu yüzden aşağıdaki kanallar destek oturumunda reddedilir. Görüntüleme,
// raporlar, ayarlar, yedekleme, veritabanı bakımı ve gün sonunu YENİDEN AÇMA
// destek modunda açık kalır — onlar zaten destek işidir.

export const DESTEK_ENGEL_MESAJI =
  'Bu işlem destek modunda yapılamaz. Usta girişi ile yapılmalıdır.'

export const USTA_ONLY_CHANNELS: ReadonlySet<string> = new Set([
  // İş emri
  'is-emri-ekle',
  'is-emri-guncelle',
  'is-emri-sil',
  'is-emri-tekrar-ac',
  'is-emri-tamamla-ve-odeme-kaydet',
  'is-emri-kalem-ekle',
  'is-emri-kalem-guncelle',
  'is-emri-kalem-sil',
  'is-emri-odeme-ekle',
  'is-emri-odeme-iptal',
  'is-emri-fotograf-yukle-dialog',
  'is-emri-fotograf-sil',
  'is-emri-fotograf-guncelle',

  // Müşteri
  'musteri-ekle',
  'musteri-guncelle',
  'musteri-sil',

  // Araç
  'arac-ekle',
  'arac-guncelle',
  'arac-sil',

  // Parça / stok
  'parca-ekle',
  'parca-guncelle',
  'parca-sil',
  'parca-aktiflestir',

  // Cari hesap ve kasa
  'cari-hesap-ekle',
  'cari-hesap-guncelle',
  'cari-hesap-sil',
  'cari-islem-ekle',
  'cari-islem-guncelle',
  'cari-islem-sil',
  'cari-odeme-ekle',
  'cari-odeme-sil',
  'gider-ekle',
  'gider-guncelle',
  'gider-sil',

  // Gün sonu (kapatma usta işi; yeniden açma destek işi olduğu için listede yok)
  'gun-sonu-kapat'
])

export function destekModundaYasakMi(kanal: string, oturum: number | 'admin' | null): boolean {
  return oturum === 'admin' && USTA_ONLY_CHANNELS.has(kanal)
}
