<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch, nextTick } from 'vue'
import Paginator from 'primevue/paginator'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Textarea from 'primevue/textarea'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useRouter, useRoute } from 'vue-router'
import PrintPreviewDialog from '../components/work-orders/PrintPreviewDialog.vue'
import EditItemDialog from '../components/work-orders/EditItemDialog.vue'
import EmptyState from '../components/EmptyState.vue'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useFormatters } from '../composables/useFormatters'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

const router = useRouter()
const route = useRoute()
const yardimaGit = (konu) => router.push({ path: '/help', query: { konu } })
const servisKabuleGit = () => router.push('/service-reception')

const isEmirleri = ref([])
const yukleniyor = ref(true)
const araclarListesi = ref([])
const parcalarListesi = ref([])
const kalemler = ref([])
const isEmriLoglari = ref([])
const aktifUsta = ref(null)
const toast = useToast()
const confirmDialog = useConfirm()

const basariMesaji = (detay) => {
  toast.add({
    severity: 'success',
    summary: 'Başarılı',
    detail: detay,
    life: 2500
  })
}

const hataMesaji = (detay) => {
  toast.add({
    severity: 'error',
    summary: 'Hata',
    detail: detay,
    life: 4000
  })
}

const uyariMesaji = (detay) => {
  toast.add({
    severity: 'warn',
    summary: 'Uyarı',
    detail: detay,
    life: 3000
  })
}

const { destekModu, destekModundaEngelle } = useYetki()

// İş emri işlemleri usta işidir: destek (admin) oturumu ve oturumsuz durum tek yerden elenir.
// true dönerse çağıran fonksiyon durmalıdır.
const ustaIsiEngelli = (islemAdi) => {
  if (destekModundaEngelle(toast, `${islemAdi} destek modunda yapılamaz.`)) return true

  if (!aktifUsta.value?.id) {
    uyariMesaji(`${islemAdi} için önce usta girişi yapılmalıdır.`)
    return true
  }

  return false
}

const dialogAcik = ref(false)
const kalemDialogAcik = ref(false)
const tekrarAcDialogAcik = ref(false)
const tekrarAcilacakIsEmri = ref(null)

// Ödeme Takibi State
const odemeDialogAcik = ref(false)
const tamamlaDialogAcik = ref(false)
const odemeIptalDialogAcik = ref(false)
const tamamlanacakIsEmri = ref(null)

const odemeGecmisi = ref([])
const odemeOzeti = reactive({
  total_price: 0,
  toplam_tahsilat: 0,
  kalan_borc: 0,
  odeme_durumu: 'Ödenmedi'
})

const bugununTarihi = () => {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const odemeForm = reactive({
  work_order_id: null,
  amount: 0,
  payment_method: 'Nakit',
  payment_date: bugununTarihi(),
  note: ''
})

const tamamlaForm = reactive({
  id: null,
  kalan_borc: 0,
  payment_option: 'full',
  amount: 0,
  payment_method: 'Nakit',
  payment_date: bugununTarihi(),
  note: ''
})

const iptalForm = reactive({
  payment_id: null,
  cancel_reason: ''
})

const tekrarAcForm = reactive({
  reason: ''
})


const aramaKelimesi = ref('')
const durumFiltresi = ref('Açık')
const seciliIsEmri = ref(null)
const islemGecmisiAcik = ref(false)
const maliyetKarAcik = ref(false)
const printPreviewOpen = ref(false)
const bosServisFisi = ref(false)
const showPaymentSummary = ref(true)

const odemeDurumuHesapla = (row) => {
  if (!row) {
    return { status: 'Ödenmedi', text: '● Ödenmedi', color: '#ef4444' }
  }
  const total = Number(row.total_price || 0)
  const paid = Number(row.toplam_tahsilat || 0)
  const remaining = Number((total - paid).toFixed(2))

  if (paid <= 0.01) {
    return { status: 'Ödenmedi', text: '● Ödenmedi', color: '#ef4444' }
  }
  if (remaining <= 0.01) {
    return { status: 'Ödendi', text: '● Ödendi', color: '#10b981' }
  }
  if (remaining < -0.01) {
    return { status: 'Fazla Ödeme', text: '● Fazla Ödeme', color: '#a855f7' }
  }

  return {
    status: 'Kısmi',
    text: `● Kısmi · ${tlFormatla(remaining)} kaldı`,
    color: '#f59e0b'
  }
}

const tarihSaatFormatla = (tarihStr) => {
  if (!tarihStr) return '-'
  try {
    const d = new Date(tarihStr)
    if (isNaN(d.getTime())) return tarihStr
    return d.toLocaleDateString('tr-TR', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch (e) {
    return tarihStr
  }
}

const durumSecenekleri = ref(['Açık', 'Beklemede', 'Tamamlandı'])
const kalemTipleri = ref(['Parça', 'İşçilik'])
const seciliIsEmriTamamlandi = computed(() => {
  return seciliIsEmri.value?.status === 'Tamamlandı'
})
const maliyetOzeti = computed(() => {
  let parcaMaliyeti = 0
  let parcaSatisi = 0
  let iscilikGeliri = 0

  for (const kalem of kalemler.value) {
    const miktar = Number(kalem.quantity) || 0
    const toplam = Number(kalem.total_price) || 0

    if (kalem.type === 'Parça') {
      const alisFiyati = Number(kalem.part_buy_price) || 0
      parcaMaliyeti += miktar * alisFiyati
      parcaSatisi += toplam
    }

    if (kalem.type === 'İşçilik') {
      iscilikGeliri += toplam
    }
  }

  const toplamSatis = parcaSatisi + iscilikGeliri
  const toplamMaliyet = parcaMaliyeti
  const netKar = toplamSatis - toplamMaliyet
  const karOrani = toplamSatis > 0 ? (netKar / toplamSatis) * 100 : 0

  return {
    parcaMaliyeti,
    parcaSatisi,
    iscilikGeliri,
    toplamSatis,
    toplamMaliyet,
    netKar,
    karOrani
  }
})

const form = reactive({
  id: null,
  vehicle_id: null,
  description: '',
  mileage: '',
  total_price: 0,
  status: 'Açık',
})
const kalemForm = reactive({
  type: 'Parça',
  part_id: null,
  description: '',
  quantity: 1,
  unit_price: 0
})
const duzenlenenKalem = ref(null)

const kalemDuzenleForm = reactive({
  id: null,
  type: 'Parça',
  part_id: null,
  description: '',
  quantity: 1,
  unit_price: 0
})

const listeleriGetir = async () => {
  yukleniyor.value = true
  try {
    isEmirleri.value = await window.api.isEmirleriGetir()
    araclarListesi.value = await window.api.araclariGetir()
    parcalarListesi.value = await window.api.parcalariGetir()
  } finally {
    yukleniyor.value = false
  }
}

const filtrelenmisIsEmirleri = computed(() => {
  let liste = isEmirleri.value

  if (durumFiltresi.value !== 'Tümü') {
    liste = liste.filter(i => i.status === durumFiltresi.value)
  }

  if (!aramaKelimesi.value) return liste

  const aranan = aramaKelimesi.value.toLowerCase()

return liste.filter(i =>
  (i.plate || '').toLowerCase().includes(aranan) ||
  (i.customer_name || '').toLowerCase().includes(aranan) ||
  (i.description || '').toLowerCase().includes(aranan) ||
  (i.opened_by_master_name || '').toLowerCase().includes(aranan) ||
  (i.closed_by_master_name || '').toLowerCase().includes(aranan)
)
})
// ── Sayfalama ───────────────────────────────────────────────────────────
// Liste eskiden süzgeçten geçen TÜM iş emirlerini tek seferde ekrana basıyordu;
// kayıt biriktikçe sayfa doğrusal olarak ağırlaşıyordu. Ekranda aynı anda en
// fazla SAYFA_BOYUTU satır çizilir. Süzgeç/arama sonucu sayfa sayısından kısa
// kalırsa boş sayfada kalınmasın diye başlangıç sıfırlanır.
const SAYFA_BOYUTU = 50
const sayfaBaslangici = ref(0)

const sayfalanmisIsEmirleri = computed(() =>
  filtrelenmisIsEmirleri.value.slice(sayfaBaslangici.value, sayfaBaslangici.value + SAYFA_BOYUTU)
)

watch(filtrelenmisIsEmirleri, (liste) => {
  if (sayfaBaslangici.value >= liste.length) sayfaBaslangici.value = 0
})

// Şablondaki dört sekme etiketi bu sayıları kullanıyor. Eskiden her biri ayrı
// bir filter() çalıştırıyordu, yani her yeniden çizimde liste üç kez baştan
// taranıyordu. Artık tek geçişte sayılıp önbelleğe alınıyor; sonuçlar aynı.
const durumSayilari = computed(() => {
  const sayac = { 'Açık': 0, 'Beklemede': 0, 'Tamamlandı': 0 }

  for (const isEmri of isEmirleri.value) {
    if (isEmri.status in sayac) sayac[isEmri.status] += 1
  }

  return sayac
})

const durumSayisi = (durum) => {
  if (durum === 'Tümü') return isEmirleri.value.length

  return durumSayilari.value[durum] ?? 0
}
const yeniIsEmriAc = () => {
  if (ustaIsiEngelli('İş emri açma')) return

  Object.assign(form, {
    id: null,
    vehicle_id: null,
    description: '',
    mileage: '',
    total_price: 0,
    status: 'Açık',
  })

  dialogAcik.value = true
}
const duzenle = (isEmri) => {
  if (ustaIsiEngelli('İş emri düzenleme')) return

  if (isEmri?.status === 'Tamamlandı') {
    uyariMesaji('Tamamlanmış iş emri düzenlenemez. Gerekirse önce Tekrar Aç yapın.')
    return
  }

  Object.assign(form, {
    id: isEmri.id,
    vehicle_id: isEmri.vehicle_id,
    description: isEmri.description,
    mileage: isEmri.mileage || '',
    total_price: isEmri.total_price,
    status: isEmri.status
  })

  dialogAcik.value = true
}

const sil = (isEmri) => {
  if (!isEmri?.id) return
  if (ustaIsiEngelli('İş emri silme')) return

  if (isEmri.status === 'Tamamlandı') {
    uyariMesaji('Tamamlanmış iş emri silinemez. Gerekirse önce Tekrar Aç yapın.')
    return
  }

  confirmDialog.require({
    message: 'Bu iş emrini silmek istediğinize emin misiniz?',
    header: 'İş Emri Sil',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Sil',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-danger',
    rejectClass: 'p-button-secondary p-button-text',
    accept: async () => {
      const res = await window.api.isEmriSil(Number(isEmri.id))

      if (res && res.success) {
        basariMesaji('İş emri silindi.')
        await listeleriGetir()
      } else {
        hataMesaji(res?.error || 'İş emri silinemedi.')
      }
    }
  })
}

const kaydet = async () => {
  if (ustaIsiEngelli('İş emri kaydetme')) return

  if (!form.vehicle_id) {
    uyariMesaji('Lütfen işlem yapılacak aracı seçin.')
    return
  }

  try {
    const temizVeri = {
      ...JSON.parse(JSON.stringify(form)),
      active_master_id: aktifUsta.value.id,
    }

    const res = form.id
      ? await window.api.isEmriGuncelle(temizVeri)
      : await window.api.isEmriEkle(temizVeri)

    if (res && res.success) {
      basariMesaji(form.id ? 'İş emri güncellendi.' : 'İş emri kaydedildi.')

      dialogAcik.value = false

Object.assign(form, {
  id: null,
  vehicle_id: null,
  description: '',
  mileage: '',
  total_price: 0,
  status: 'Açık'
})

      await listeleriGetir()
    } else {
      hataMesaji(res?.error || 'İş emri kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji(error instanceof Error ? error.message : String(error))
  }
}
const durumKaydet = async (isEmri, yeniDurum, basariDetayi = 'İş emri durumu güncellendi.') => {
  const eskiDurum = isEmri.status

  try {
    const temizVeri = {
      ...JSON.parse(JSON.stringify(isEmri)),
      status: yeniDurum,
      active_master_id: aktifUsta.value.id
    }

    isEmri.status = yeniDurum

    if (seciliIsEmri.value?.id === isEmri.id) {
      seciliIsEmri.value.status = yeniDurum
    }

    const res = await window.api.isEmriGuncelle(temizVeri)

    if (res?.success) {
      basariMesaji(basariDetayi)

      await listeleriGetir()

      const guncel = isEmirleri.value.find(i => i.id === isEmri.id)
      if (guncel && seciliIsEmri.value?.id === isEmri.id) {
        seciliIsEmri.value = guncel
      }
    } else {
      isEmri.status = eskiDurum

      if (seciliIsEmri.value?.id === isEmri.id) {
        seciliIsEmri.value.status = eskiDurum
      }

      hataMesaji(res?.error || 'Durum güncellenemedi.')
    }
  } catch (error) {
    isEmri.status = eskiDurum

    if (seciliIsEmri.value?.id === isEmri.id) {
      seciliIsEmri.value.status = eskiDurum
    }

    hataMesaji(error instanceof Error ? error.message : String(error))
  }
}

const durumDegistir = async (isEmri, yeniDurum) => {
  if (!isEmri?.id || !yeniDurum) return
  if (isEmri.status === yeniDurum) return

  if (ustaIsiEngelli('Durum değiştirme')) return

  if (isEmri.status === 'Tamamlandı') {
    uyariMesaji('Tamamlanmış iş emrinin durumu buradan değiştirilemez. Tekrar Aç butonunu kullanın.')
    return
  }

  if (yeniDurum === 'Tamamlandı') {
    await tamamlaModalAc(isEmri)
    return
  }

  await durumKaydet(isEmri, yeniDurum)
}

const odemeleriGetir = async (workOrderId) => {
  if (!workOrderId) {
    odemeGecmisi.value = []
    return
  }

  try {
    const res = await window.api.isEmriOdemeleriGetir(workOrderId)
    if (res && res.success) {
      odemeGecmisi.value = res.odemeler || []
    } else {
      odemeGecmisi.value = []
    }

    const ozetRes = await window.api.isEmriOdemeOzetiGetir(workOrderId)
    if (ozetRes && ozetRes.success) {
      Object.assign(odemeOzeti, ozetRes.ozet)
    }
  } catch (err) {
    console.error('Ödemeleri getirme hatası:', err)
  }
}

const getOdemeSeverity = (durum) => {
  switch (durum) {
    case 'Ödendi': return 'success'
    case 'Kısmi Ödendi': return 'warn'
    case 'Ödenmedi': return 'danger'
    case 'Fazla Ödeme': return 'info'
    default: return 'secondary'
  }
}

const odemeAlModalAc = async () => {
  if (ustaIsiEngelli('Tahsilat')) return

  if (!seciliIsEmri.value?.id) {
    uyariMesaji('Lütfen önce bir iş emri seçin.')
    return
  }

  await odemeleriGetir(seciliIsEmri.value.id)

  odemeForm.work_order_id = seciliIsEmri.value.id
  odemeForm.amount = odemeOzeti.kalan_borc > 0 ? odemeOzeti.kalan_borc : 0
  odemeForm.payment_method = 'Nakit'
  odemeForm.payment_date = bugununTarihi()
  odemeForm.note = ''

  odemeDialogAcik.value = true
}

const odemeKaydet = async () => {
  if (ustaIsiEngelli('Tahsilat')) return
  if (!odemeForm.work_order_id) return
  if (!odemeForm.amount || Number(odemeForm.amount) <= 0) {
    uyariMesaji('Geçerli bir ödeme tutarı giriniz.')
    return
  }
  if (!odemeForm.payment_method) {
    uyariMesaji('Lütfen ödeme yöntemi seçin.')
    return
  }

  const aktifMaster = aktifUsta.value || JSON.parse(localStorage.getItem('aktifUsta') || 'null')

  try {
    const res = await window.api.isEmriOdemeEkle({
      ...odemeForm,
      amount: Number(odemeForm.amount),
      active_master_id: aktifMaster?.id
    })

    if (res?.success) {
      basariMesaji('Ödeme başarıyla kaydedildi.')
      odemeDialogAcik.value = false
      await odemeleriGetir(seciliIsEmri.value.id)
      await listeleriGetir()
      if (seciliIsEmri.value) {
        const guncel = isEmirleri.value.find(i => i.id === seciliIsEmri.value.id)
        if (guncel) seciliIsEmri.value = guncel
      }
    } else {
      hataMesaji(res?.error || 'Ödeme kaydedilemedi.')
    }
  } catch (err) {
    hataMesaji(err instanceof Error ? err.message : String(err))
  }
}

const odemeIptalModalAc = (odeme) => {
  if (!odeme?.id) return
  if (ustaIsiEngelli('Ödeme iptali')) return
  iptalForm.payment_id = odeme.id
  iptalForm.cancel_reason = ''
  odemeIptalDialogAcik.value = true
}

const odemeIptalKaydet = async () => {
  if (ustaIsiEngelli('Ödeme iptali')) return
  if (!iptalForm.payment_id) return
  if (!iptalForm.cancel_reason || !iptalForm.cancel_reason.trim()) {
    uyariMesaji('Ödeme iptal sebebi zorunludur.')
    return
  }

  const aktifMaster = aktifUsta.value || JSON.parse(localStorage.getItem('aktifUsta') || 'null')

  try {
    const res = await window.api.isEmriOdemeIptal({
      payment_id: iptalForm.payment_id,
      cancel_reason: iptalForm.cancel_reason.trim(),
      active_master_id: aktifMaster?.id
    })

    if (res?.success) {
      basariMesaji('Ödeme kaydı iptal edildi.')
      odemeIptalDialogAcik.value = false
      await odemeleriGetir(seciliIsEmri.value.id)
      await listeleriGetir()
      if (seciliIsEmri.value) {
        const guncel = isEmirleri.value.find(i => i.id === seciliIsEmri.value.id)
        if (guncel) seciliIsEmri.value = guncel
      }
    } else {
      hataMesaji(res?.error || 'Ödeme iptal edilemedi.')
    }
  } catch (err) {
    hataMesaji(err instanceof Error ? err.message : String(err))
  }
}

// ── İş Emri Detay Sekme Durumu ──────────────────────────────────
const detaySekmesi = ref('kalemler') // 'kalemler' | 'fotograflar' | 'odemeler' | 'gecmis'

// ── Araç Fotoğrafları (Kabul / Hasar Tespiti) Yönetimi ─────────
const fotograflar = ref([])
const fotografKategorisiFiltre = ref('tumu')
const fotograflarYukleniyor = ref(false)
const seciliFotografModal = ref(null)

// Kategoriler sabit bir liste değil, kullanıcının kendi yazdığı serbest metin.
// Daha önce kullanılanlar bütün iş emirlerinden toplanıp öneri olarak sunuluyor.
const kategoriOnerileri = ref([])
const yeniFotografKategorisi = ref('')

const kategoriOnerileriniYukle = async () => {
  if (!window.api?.fotografKategorileriGetir) return
  try {
    const res = await window.api.fotografKategorileriGetir()
    kategoriOnerileri.value = res?.success && Array.isArray(res.kategoriler) ? res.kategoriler : []
  } catch (err) {
    console.error('Fotoğraf kategorileri yüklenemedi:', err)
    kategoriOnerileri.value = []
  }
}

// Filtre şeritleri bu iş emrinde gerçekten kullanılmış kategorilerden üretiliyor
const mevcutFotografKategorileri = computed(() => {
  const gorulen = new Map()
  for (const foto of fotograflar.value) {
    const ad = String(foto?.category || '').trim()
    if (!ad) continue
    const anahtar = ad.toLocaleLowerCase('tr')
    if (!gorulen.has(anahtar)) gorulen.set(anahtar, ad)
  }
  return [...gorulen.values()].sort((a, b) => a.localeCompare(b, 'tr'))
})

// Kategori düğmelerindeki sayılar. Eskiden şablonda her düğme için ayrı bir
// filter() çalışıyordu (kategori sayısı × fotoğraf sayısı kadar iş). Tek geçişte
// sayılıyor; kategori eşleştirmesi eskisi gibi tam metin karşılaştırması.
const fotografKategoriSayilari = computed(() => {
  const sayac = {}
  for (const foto of fotograflar.value) {
    const ad = foto?.category
    if (!ad) continue
    sayac[ad] = (sayac[ad] || 0) + 1
  }
  return sayac
})

const fotograflariYukle = async (workOrderId) => {
  if (!workOrderId || !window.api?.isEmriFotograflariGetir) {
    fotograflar.value = []
    return
  }
  fotograflarYukleniyor.value = true
  try {
    const res = await window.api.isEmriFotograflariGetir(workOrderId)
    fotograflar.value = res?.success ? res.fotograflar || [] : []

    // Kategoriler serbest metin olduğu için seçili filtre silinmiş/yeniden
    // adlandırılmış olabilir; öyleyse boş liste göstermek yerine "Tümü"ye dönülür.
    if (
      fotografKategorisiFiltre.value !== 'tumu' &&
      !mevcutFotografKategorileri.value.includes(fotografKategorisiFiltre.value)
    ) {
      fotografKategorisiFiltre.value = 'tumu'
    }
  } catch (err) {
    console.error('Fotoğraflar yüklenemedi:', err)
    fotograflar.value = []
  } finally {
    fotograflarYukleniyor.value = false
  }
}

const fotografYukleModalAc = async () => {
  if (ustaIsiEngelli('Fotoğraf ekleme')) return
  if (!seciliIsEmri.value?.id || !window.api?.isEmriFotografYukleDialog) return
  try {
    // Kategori kutusu boş bırakıldıysa aktif filtreye, o da "tümü" ise genel bir ada düşülür
    const yazilan = String(yeniFotografKategorisi.value || '').trim()
    const kategori =
      yazilan ||
      (fotografKategorisiFiltre.value !== 'tumu' ? fotografKategorisiFiltre.value : 'Araç Kabul')

    const res = await window.api.isEmriFotografYukleDialog({
      work_order_id: seciliIsEmri.value.id,
      category: kategori
    })
    if (res?.success) {
      basariMesaji(`${res.count || 1} adet fotoğraf "${kategori}" kategorisine yüklendi.`)
      fotograflariYukle(seciliIsEmri.value.id)
      kategoriOnerileriniYukle()
    } else if (res?.error) {
      hataMesaji(res.error)
    }
  } catch (err) {
    hataMesaji('Fotoğraf eklenirken hata oluştu.')
  }
}

const fotografSil = async (photoId) => {
  if (ustaIsiEngelli('Fotoğraf silme')) return
  if (!photoId || !window.api?.isEmriFotografSil) return
  if (!confirm('Bu fotoğrafı silmek istediğinize emin misiniz?')) return
  try {
    const res = await window.api.isEmriFotografSil(photoId)
    if (res?.success) {
      basariMesaji('Fotoğraf silindi.')
      if (seciliFotografModal.value?.id === photoId) {
        seciliFotografModal.value = null
      }
      fotograflariYukle(seciliIsEmri.value.id)
    } else {
      hataMesaji(res?.error || 'Fotoğraf silinemedi.')
    }
  } catch (err) {
    hataMesaji('Fotoğraf silinirken hata oluştu.')
  }
}

const fotografGuncelle = async () => {
  if (ustaIsiEngelli('Fotoğraf güncelleme')) return
  if (!seciliFotografModal.value?.id || !window.api?.isEmriFotografGuncelle) return
  try {
    const res = await window.api.isEmriFotografGuncelle({
      id: seciliFotografModal.value.id,
      category: seciliFotografModal.value.category,
      note: seciliFotografModal.value.note
    })
    if (res?.success) {
      basariMesaji('Fotoğraf notu ve kategorisi güncellendi.')
      fotograflariYukle(seciliIsEmri.value.id)
      kategoriOnerileriniYukle()
    } else {
      hataMesaji(res?.error || 'Güncellenemedi.')
    }
  } catch (err) {
    hataMesaji('Güncellenirken hata oluştu.')
  }
}

const filtrelenmisFotograflar = computed(() => {
  if (fotografKategorisiFiltre.value === 'tumu') return fotograflar.value
  return fotograflar.value.filter(f => f.category === fotografKategorisiFiltre.value)
})

const tamamlaModalAc = async (isEmri) => {
  if (!isEmri?.id) return
  if (ustaIsiEngelli('İş emri tamamlama')) return
  const ozetRes = await window.api.isEmriOdemeOzetiGetir(isEmri.id)
  const ozet = ozetRes?.ozet || {}

  let defMethod = 'Nakit'
  if (window.api?.ayarlariGetir) {
    try {
      const setRes = await window.api.ayarlariGetir()
      if (setRes?.success && setRes.settings?.default_payment_method) {
        defMethod = setRes.settings.default_payment_method
      }
    } catch (e) {}
  }

  tamamlanacakIsEmri.value = isEmri
  tamamlaForm.id = isEmri.id
  tamamlaForm.kalan_borc = Number(ozet.kalan_borc !== undefined ? ozet.kalan_borc : (isEmri.total_price || 0))
  tamamlaForm.payment_option = tamamlaForm.kalan_borc <= 0 ? 'none' : 'full'
  tamamlaForm.amount = tamamlaForm.kalan_borc > 0 ? tamamlaForm.kalan_borc : 0
  tamamlaForm.payment_method = defMethod
  tamamlaForm.payment_date = bugununTarihi()
  tamamlaForm.note = ''

  tamamlaDialogAcik.value = true
}

const tamamlaVeOdemeKaydet = async () => {
  if (!tamamlaForm.id) return
  if (ustaIsiEngelli('İş emri tamamlama')) return

  const aktifMaster = aktifUsta.value

  if (tamamlaForm.kalan_borc <= 0.01) {
    tamamlaForm.payment_option = 'none'
    tamamlaForm.amount = 0
  }

  if (tamamlaForm.payment_option === 'partial') {
    if (!tamamlaForm.amount || Number(tamamlaForm.amount) <= 0) {
      uyariMesaji('Geçerli bir ödeme tutarı giriniz.')
      return
    }
    if (Number(tamamlaForm.amount) > tamamlaForm.kalan_borc + 0.01) {
      uyariMesaji(`Ödeme tutarı kalan borçtan (${tamamlaForm.kalan_borc} TL) büyük olamaz.`)
      return
    }
  }

  try {
    const res = await window.api.isEmriTamamlaVeOdemeKaydet({
      id: tamamlaForm.id,
      active_master_id: aktifMaster.id,
      payment_option: tamamlaForm.payment_option,
      amount: Number(tamamlaForm.amount || 0),
      payment_method: tamamlaForm.payment_method,
      payment_date: tamamlaForm.payment_date,
      note: tamamlaForm.note
    })

    if (res?.success) {
      basariMesaji('İş emri tamamlandı ve kaydedildi.')
      tamamlaDialogAcik.value = false
      await listeleriGetir()
      if (seciliIsEmri.value?.id === tamamlaForm.id) {
        const guncel = isEmirleri.value.find(i => i.id === tamamlaForm.id)
        if (guncel) seciliIsEmri.value = guncel
        await odemeleriGetir(tamamlaForm.id)
      }
    } else {
      hataMesaji(res?.error || 'İş emri tamamlanamadı.')
    }
  } catch (err) {
    hataMesaji(err instanceof Error ? err.message : String(err))
  }
}

const tekrarAc = (isEmri) => {
  if (!isEmri?.id) {
    hataMesaji('İş emri seçilemedi.')
    return
  }

  if (ustaIsiEngelli('İş emrini tekrar açma')) return

  if (isEmri.status !== 'Tamamlandı') {
    uyariMesaji('Sadece tamamlanmış iş emirleri tekrar açılabilir.')
    return
  }

  if (!window.api?.isEmriTekrarAc) {
    hataMesaji('Tekrar açma API bağlantısı bulunamadı.')
    return
  }

  tekrarAcilacakIsEmri.value = isEmri

  Object.assign(tekrarAcForm, {
    reason: ''
  })

  tekrarAcDialogAcik.value = true
}
const tekrarAcKaydet = async () => {
  const isEmri = tekrarAcilacakIsEmri.value

  if (!isEmri?.id) {
    hataMesaji('Tekrar açılacak iş emri bulunamadı.')
    return
  }

  if (ustaIsiEngelli('İş emrini tekrar açma')) return

  const aktifUstaBilgisi = aktifUsta.value
  const reason = String(tekrarAcForm.reason || '').trim()

  if (!reason) {
    uyariMesaji('Tekrar açma sebebi boş bırakılamaz.')
    return
  }

  try {
    const res = await window.api.isEmriTekrarAc({
      id: isEmri.id,
      active_master_id: aktifUstaBilgisi.id,
      reason
    })

    if (res?.success) {
      basariMesaji('İş emri tekrar açıldı ve işlem geçmişine kaydedildi.')

      tekrarAcDialogAcik.value = false
      tekrarAcilacakIsEmri.value = null

      Object.assign(tekrarAcForm, {
        reason: ''
      })

      durumFiltresi.value = 'Açık'

      await listeleriGetir()

      const guncel = isEmirleri.value.find(i => i.id === isEmri.id)

      if (guncel) {
        seciliIsEmri.value = guncel
        await kalemleriGetir(guncel.id)
        await isEmriLoglariGetir(guncel.id)
      } else {
        seciliIsEmri.value = null
        kalemler.value = []
        isEmriLoglari.value = []
      }
    } else {
      hataMesaji(res?.error || 'İş emri tekrar açılamadı.')
    }
  } catch (error) {
    hataMesaji(error instanceof Error ? error.message : String(error))
  }
}
const kalemleriAc = async (isEmri) => {
  if (!isEmri?.id) return

if (seciliIsEmri.value?.id === isEmri.id) {
  seciliIsEmri.value = null
  kalemler.value = []
  islemGecmisiAcik.value = false
  maliyetKarAcik.value = false

  if (typeof isEmriLoglari !== 'undefined') {
    isEmriLoglari.value = []
  }

    Object.assign(kalemForm, {
      type: 'Parça',
      part_id: null,
      description: '',
      quantity: 1,
      unit_price: 0
    })

    return
  }

  detaySekmesi.value = 'kalemler'
  seciliIsEmri.value = isEmri
  islemGecmisiAcik.value = false
maliyetKarAcik.value = false

  Object.assign(kalemForm, {
    type: 'Parça',
    part_id: null,
    description: '',
    quantity: 1,
    unit_price: 0
  })

  await kalemleriGetir(isEmri.id)
  await odemeleriGetir(isEmri.id)
  await fotograflariYukle(isEmri.id)

  if (typeof isEmriLoglariGetir === 'function') {
    await isEmriLoglariGetir(isEmri.id)
  }
}

const kalemleriGetir = async (workOrderId) => {
  const res = await window.api.isEmriKalemleriGetir(workOrderId)

  if (res && res.success) {
    kalemler.value = res.kalemler
  } else {
    kalemler.value = []
    hataMesaji(res?.error || 'Kalemler getirilemedi.')
  }
}
const isEmriLoglariGetir = async (workOrderId) => {
  if (!window.api.isEmriLoglariGetir) {
    isEmriLoglari.value = []
    return
  }

  const res = await window.api.isEmriLoglariGetir(workOrderId)

  if (res?.success) {
    isEmriLoglari.value = Array.isArray(res.loglar) ? res.loglar : []
  } else {
    isEmriLoglari.value = []
  }
}

// Katalog dışı parçada part_code/part_name boş kalır, adı description alanında durur
const kalemAciklamasiGetir = (kalem) => {
  const kod = String(kalem?.part_code || '').trim()
  const parcaAdi = String(kalem?.part_name || '').trim()
  const aciklama = String(kalem?.description || '').trim()

  if (kalem?.type !== 'Parça') return aciklama || '-'

  const ad = parcaAdi || aciklama
  if (kod && ad) return `${kod} - ${ad}`

  return ad || kod || '-'
}

const parcaSecildi = (partId) => {
  const parca = parcalarListesi.value.find(p => p.id === partId)

  if (parca) {
    kalemForm.description = parca.name
    kalemForm.unit_price = parca.sell_price || 0
  }
}
const kalemDuzenleParcaSecildi = (partId) => {
  const parca = parcalarListesi.value.find(p => p.id === partId)

  if (parca) {
    kalemDuzenleForm.description = parca.name
    kalemDuzenleForm.unit_price = parca.sell_price || 0
  }
}

const kalemDuzenle = (kalem) => {
  if (!kalem?.id) return

  if (ustaIsiEngelli('Kalem düzenleme')) return

  if (seciliIsEmriTamamlandi.value) {
    uyariMesaji('Tamamlanmış iş emrinde kalem düzenlenemez.')
    return
  }

  duzenlenenKalem.value = kalem

  Object.assign(kalemDuzenleForm, {
    id: kalem.id,
    type: kalem.type || 'Parça',
    part_id: kalem.type === 'Parça' ? kalem.part_id : null,
    description: kalem.description || kalem.part_name || '',
    quantity: Number(kalem.quantity) || 1,
    unit_price: Number(kalem.unit_price) || 0
  })

  kalemDialogAcik.value = true
}

const kalemGuncelleKaydet = async (payload) => {
  if (payload) {
    Object.assign(kalemDuzenleForm, payload)
  }
  if (!kalemDuzenleForm.id) {
    hataMesaji('Düzenlenecek kalem bulunamadı.')
    return
  }

  if (ustaIsiEngelli('Kalem düzenleme')) return

  if (seciliIsEmriTamamlandi.value) {
    uyariMesaji('Tamamlanmış iş emrinde kalem düzenlenemez.')
    return
  }

  if (!kalemDuzenleForm.type) {
    uyariMesaji('Kalem tipi seçin.')
    return
  }

  if (kalemDuzenleForm.type === 'Parça' && !kalemDuzenleForm.part_id && !kalemDuzenleForm.description) {
    uyariMesaji('Lütfen parça adı veya açıklaması yazın.')
    return
  }

  if (kalemDuzenleForm.type === 'İşçilik' && !kalemDuzenleForm.description) {
    uyariMesaji('Lütfen işçilik açıklaması yazın.')
    return
  }

  if (Number(kalemDuzenleForm.quantity) <= 0) {
    uyariMesaji('Adet/Miktar 0 olamaz.')
    return
  }

  const temizVeri = {
    id: kalemDuzenleForm.id,
    type: kalemDuzenleForm.type,
    part_id: kalemDuzenleForm.type === 'Parça' ? kalemDuzenleForm.part_id : null,
    description: kalemDuzenleForm.description,
    quantity: Number(kalemDuzenleForm.quantity) || 1,
    unit_price: Number(kalemDuzenleForm.unit_price) || 0,
    active_master_id: aktifUsta.value.id
  }

  const res = await window.api.isEmriKalemGuncelle(temizVeri)

  if (res?.success) {
    basariMesaji('Kalem güncellendi.')

    kalemDialogAcik.value = false
    duzenlenenKalem.value = null

    Object.assign(kalemDuzenleForm, {
      id: null,
      type: 'Parça',
      part_id: null,
      description: '',
      quantity: 1,
      unit_price: 0
    })

    await kalemleriGetir(seciliIsEmri.value.id)
    await listeleriGetir()

    const guncel = isEmirleri.value.find(i => i.id === seciliIsEmri.value.id)
    if (guncel) seciliIsEmri.value = guncel
  } else {
    hataMesaji(res?.error || 'Kalem güncellenemedi.')
  }
}

const kalemKaydet = async () => {
  if (!seciliIsEmri.value?.id) {
    uyariMesaji('İş emri seçilemedi.')
    return
  }
  if (ustaIsiEngelli('Kalem ekleme')) return

  if (seciliIsEmriTamamlandi.value) {
    uyariMesaji('Tamamlanmış iş emrine kalem eklenemez.')
    return
  }

  if (!kalemForm.type) {
    uyariMesaji('Kalem tipi seçin.')
    return
  }

  if (kalemForm.type === 'Parça' && !kalemForm.part_id && !kalemForm.description) {
    uyariMesaji('Lütfen parça adı veya açıklaması yazın.')
    return
  }

  if (kalemForm.type === 'İşçilik' && !kalemForm.description) {
    uyariMesaji('Lütfen işçilik açıklaması yazın.')
    return
  }

  if (Number(kalemForm.quantity) <= 0) {
    uyariMesaji('Adet/Miktar 0 olamaz.')
    return
  }

const temizVeri = {
  work_order_id: seciliIsEmri.value.id,
  type: kalemForm.type,
  part_id: kalemForm.type === 'Parça' ? kalemForm.part_id : null,
  description: kalemForm.description,
  quantity: Number(kalemForm.quantity) || 1,
  unit_price: Number(kalemForm.unit_price) || 0,
  active_master_id: aktifUsta.value.id
}

  const res = await window.api.isEmriKalemEkle(temizVeri)

  if (res && res.success) {
    basariMesaji('Kalem eklendi.')

    Object.assign(kalemForm, {
      type: 'Parça',
      part_id: null,
      description: '',
      quantity: 1,
      unit_price: 0
    })

    await kalemleriGetir(seciliIsEmri.value.id)
    await listeleriGetir()

    const guncel = isEmirleri.value.find(i => i.id === seciliIsEmri.value.id)
    if (guncel) seciliIsEmri.value = guncel
  } else {
    hataMesaji(res?.error || 'Kalem eklenemedi.')
  }
}
const kalemSil = (kalem) => {
  if (!kalem?.id) return

  if (ustaIsiEngelli('Kalem silme')) return

  if (seciliIsEmriTamamlandi.value) {
    uyariMesaji('Tamamlanmış iş emrinden kalem silinemez.')
    return
  }

  const mesaj = kalem.type === 'Parça'
    ? 'Bu parça kalemini silmek istediğinize emin misiniz? Kullanılan stok geri eklenecek.'
    : 'Bu işçilik kalemini silmek istediğinize emin misiniz?'

  confirmDialog.require({
    message: mesaj,
    header: 'Kalem Sil',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Sil',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-danger',
    rejectClass: 'p-button-secondary p-button-text',
    accept: async () => {
      const res = await window.api.isEmriKalemSil({
  id: kalem.id,
  active_master_id: aktifUsta.value.id
})

      if (res && res.success) {
        basariMesaji('Kalem silindi.')

        await kalemleriGetir(seciliIsEmri.value.id)
        await listeleriGetir()

        const guncel = isEmirleri.value.find(i => i.id === seciliIsEmri.value.id)
        if (guncel) seciliIsEmri.value = guncel
      } else {
        hataMesaji(res?.error || 'Kalem silinemedi.')
      }
    }
  })
}

const getSeverity = (status) => {
  switch (status) {
    case 'Tamamlandı': return 'success'
    case 'Beklemede': return 'warn'
    case 'Açık': return 'danger'
    default: return 'info'
  }
}

const { tlFormatla, tarihSaatFormatla: tarihFormatla } = useFormatters()
const yuzdeFormatla = (deger) => {
  return `%${Number(deger || 0).toLocaleString('tr-TR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })}`
}
const guvenliMetin = (deger) => {
  return String(deger ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

const ayariBooleanYap = (val, varsayilan = true) => {
  if (val === undefined || val === null) return varsayilan
  if (typeof val === 'boolean') return val
  const s = String(val).trim().toLowerCase()
  if (s === 'false' || s === '0' || s === 'off' || s === 'no') return false
  if (s === 'true' || s === '1' || s === 'on' || s === 'yes') return true
  return Boolean(val)
}

const servisFisiOnizle = async (bosKalemModu = false) => {
  // Load setting before opening preview
  let show = true
  try {
    const sRes = await window.api?.ayarlariGetir?.()
    if (sRes?.settings && sRes.settings.show_payment_summary_on_receipt !== undefined) {
      show = ayariBooleanYap(sRes.settings.show_payment_summary_on_receipt, true)
    }
  } catch (e) { console.error('Ayar getirilemedi', e) }
  showPaymentSummary.value = show
  bosServisFisi.value = bosKalemModu
  printPreviewOpen.value = true
}

const servisFisiYazdir = () => servisFisiOnizle(false)
const bosServisFisiYazdir = () => servisFisiOnizle(true)

const verileriYenileDetayli = async () => {
  await listeleriGetir()
  if (seciliIsEmri.value?.id) {
    const guncel = isEmirleri.value.find(i => i.id === seciliIsEmri.value.id)
    if (guncel) {
      seciliIsEmri.value = guncel
      await kalemleriGetir(guncel.id)
      await odemeleriGetir(guncel.id)
    } else {
      seciliIsEmri.value = null
      kalemler.value = []
      odemeGecmisi.value = []
    }
  }
}

const genelYenileme = genelVeriYenilemeIsleyicisi(verileriYenileDetayli)

const rotadakiIsEmriniAc = async () => {
  const isEmriId = Number(route.query.open)
  if (!isEmriId) return

  const hedefIsEmri = isEmirleri.value.find((isEmri) => Number(isEmri.id) === isEmriId)
  if (!hedefIsEmri) {
    uyariMesaji('Açılmak istenen iş emri bulunamadı.')
    return
  }

  durumFiltresi.value = hedefIsEmri.status || 'Tümü'
  await kalemleriAc(hedefIsEmri)
  await nextTick()
  document.querySelector('.inline-kalem-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

onMounted(async () => {
  aktifUsta.value = JSON.parse(localStorage.getItem('aktifUsta') || 'null')

  if (window.api?.ayarlariGetir) {
    try {
      const res = await window.api.ayarlariGetir()
      if (res?.success && res.settings?.work_orders_default_filter) {
        const filterVal = res.settings.work_orders_default_filter
        if (['Açık', 'Beklemede', 'Tümü'].includes(filterVal)) {
          durumFiltresi.value = filterVal
        }
      }
    } catch (e) {
      console.warn('İş emirleri filtre ayarı uygulanamadı:', e)
    }
  }

  await listeleriGetir()
  kategoriOnerileriniYukle()
  await rotadakiIsEmriniAc()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div style="display: flex; flex-direction: column; gap: 16px;">
    <!-- Üst Başlık -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div>
        <h2 style="margin: 0; font-size: 1.5rem; font-weight: 700; color: var(--text-title, #fff);">İş Emirleri <HelpButton konu="kalem-ekleme" /></h2>
        <p style="margin: 4px 0 0; color: var(--text-muted, #94a3b8); font-size: 0.88rem;">
          Açık, bekleyen ve tamamlanan iş emirlerini yönetin.
        </p>
      </div>

      <Button
        label="Yeni İş Emri Aç"
        icon="pi pi-plus"
        severity="info"
        size="small"
        :disabled="destekModu"
        @click="yeniIsEmriAc"
      />
    </div>

    <DestekModuUyarisi aciklama="İş emri açma / düzenleme, kalem ekleme, tamamlama ve tahsilat destek modunda kapalıdır." />

    <!-- Toolbar & Filtre Çubuğu -->
    <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; background: var(--bg-panel); border: 1px solid var(--border-color); padding: 12px 16px; border-radius: 12px;">
      <div style="display: flex; gap: 6px; flex-wrap: wrap;">
        <Button
          :label="`Açık (${durumSayisi('Açık')})`"
          icon="pi pi-wrench"
          size="small"
          :outlined="durumFiltresi !== 'Açık'"
          severity="danger"
          @click="durumFiltresi = 'Açık'"
        />

        <Button
          :label="`Beklemede (${durumSayisi('Beklemede')})`"
          icon="pi pi-clock"
          size="small"
          :outlined="durumFiltresi !== 'Beklemede'"
          severity="warn"
          @click="durumFiltresi = 'Beklemede'"
        />

        <Button
          :label="`Tamamlananlar (${durumSayisi('Tamamlandı')})`"
          icon="pi pi-check"
          size="small"
          :outlined="durumFiltresi !== 'Tamamlandı'"
          severity="success"
          @click="durumFiltresi = 'Tamamlandı'"
        />

        <Button
          :label="`Hepsi (${durumSayisi('Tümü')})`"
          icon="pi pi-list"
          size="small"
          :outlined="durumFiltresi !== 'Tümü'"
          severity="secondary"
          @click="durumFiltresi = 'Tümü'"
        />
      </div>

      <span class="p-input-icon-left" style="min-width: 280px;">
        <i class="pi pi-search" />
        <InputText
          v-model="aramaKelimesi"
          placeholder="Plaka, müşteri, usta veya açıklama ara..."
          style="width: 100%; font-size: 0.88rem;"
        />
      </span>
    </div>

    <!-- Kompakt Hibrit Liste / Tablo Paneli (72px Yükseklik) -->
    <div class="work-orders-table-panel">
      <!-- Başlık Satırı -->
      <div class="table-header-row">
        <div>Plaka ve Usta</div>
        <div>Açıklama ve Tarih</div>
        <div>Tutar ve Ödeme Durumu</div>
        <div>İş Emri Durumu</div>
        <div style="text-align: right;">İşlemler</div>
      </div>

      <!-- Satırlar Listesi -->
      <div v-if="yukleniyor" class="table-body-rows skeleton-list" style="padding: 10px 16px;">
        <div class="skeleton-row" v-for="n in 6" :key="n">
          <span class="skeleton-block" style="width:90px"></span>
          <span class="skeleton-block" style="flex:1"></span>
          <span class="skeleton-block" style="width:80px"></span>
          <span class="skeleton-block" style="width:70px"></span>
        </div>
      </div>

      <div v-else class="table-body-rows">
        <div
          v-for="isEmri in sayfalanmisIsEmirleri"
          :key="isEmri.id"
          class="work-order-table-row"
          :class="{ 'is-selected': seciliIsEmri?.id === isEmri.id }"
          @click="kalemleriAc(isEmri)"
        >
          <!-- Kolon 1: Plaka ve Usta -->
          <div class="col-plate-master">
            <span class="plate-text">{{ isEmri.plate || 'PLAKASIZ' }}</span>
            <span class="master-customer-text">
              {{ isEmri.opened_by_master_name || 'Usta' }}
              <template v-if="isEmri.customer_name"> · {{ isEmri.customer_name }}</template>
            </span>
          </div>

          <!-- Kolon 2: Açıklama ve Tarih -->
          <div class="col-desc-date">
            <span class="desc-text" :title="isEmri.description">
              {{ isEmri.description || 'Şikayet / Açıklama Girilmedi' }}
            </span>
            <span class="date-text" :title="`Açılış: ${tarihSaatFormatla(isEmri.created_at)}${isEmri.closed_at ? ' | Kapanış: ' + tarihSaatFormatla(isEmri.closed_at) : ''}`">
              {{ tarihSaatFormatla(isEmri.created_at) }}
              <template v-if="isEmri.closed_at"> · Kapanış: {{ tarihSaatFormatla(isEmri.closed_at) }}</template>
            </span>
          </div>

          <!-- Kolon 3: Tutar ve Ödeme Durumu -->
          <div 
            class="col-finance"
            :title="`Toplam: ${tlFormatla(isEmri.total_price)} | Tahsil Edilen: ${tlFormatla(isEmri.toplam_tahsilat || 0)} | Kalan: ${tlFormatla((Number(isEmri.total_price || 0) - Number(isEmri.toplam_tahsilat || 0)).toFixed(2))}`"
          >
            <span class="price-text">{{ tlFormatla(isEmri.total_price) }}</span>
            <span class="payment-badge-text" :style="{ color: odemeDurumuHesapla(isEmri).color }">
              {{ odemeDurumuHesapla(isEmri).text }}
            </span>
          </div>

          <!-- Kolon 4: İş Emri Durumu -->
          <div class="col-status" @click.stop>
            <Dropdown
              :modelValue="isEmri.status"
              :options="durumSecenekleri"
              class="durum-dropdown-compact"
              :disabled="destekModu || isEmri.status === 'Tamamlandı'"
              @change="durumDegistir(isEmri, $event.value)"
            >
              <template #value="valueSlot">
                <Tag :value="valueSlot.value" :severity="getSeverity(valueSlot.value)" style="font-size: 0.75rem; padding: 2px 8px;" />
              </template>
              <template #option="optionSlot">
                <Tag :value="optionSlot.option" :severity="getSeverity(optionSlot.option)" style="font-size: 0.75rem;" />
              </template>
            </Dropdown>
          </div>

          <!-- Kolon 5: İşlemler -->
          <div class="col-actions" @click.stop>
            <Button
              v-if="isEmri.status === 'Tamamlandı'"
              icon="pi pi-undo"
              size="small"
              severity="warning"
              text
              rounded
              :disabled="destekModu"
              :title="destekModu ? 'Destek modunda yapılamaz' : 'Tekrar Aç'"
              @click.stop="tekrarAc(isEmri)"
            />
            <Button
              icon="pi pi-pencil"
              size="small"
              severity="info"
              text
              rounded
              :disabled="destekModu || isEmri.status === 'Tamamlandı'"
              :title="destekModu ? 'Destek modunda yapılamaz' : 'Düzenle'"
              @click.stop="duzenle(isEmri)"
            />
            <Button
              icon="pi pi-trash"
              size="small"
              severity="danger"
              text
              rounded
              :disabled="destekModu || isEmri.status === 'Tamamlandı'"
              :title="destekModu ? 'Destek modunda yapılamaz' : 'Sil'"
              @click.stop="sil(isEmri)"
            />
          </div>
        </div>

        <template v-if="filtrelenmisIsEmirleri.length === 0">
          <EmptyState
            v-if="aramaKelimesi"
            icon="pi pi-search-minus"
            title="Arama sonucu bulunamadı"
            :description="`&quot;${aramaKelimesi}&quot; ile eşleşen iş emri yok. Plakayı boşluksuz yazmayı veya süzgeci &quot;Hepsi&quot; yapmayı deneyin.`"
            compact
          />
          <EmptyState
            v-else-if="isEmirleri.length > 0"
            icon="pi pi-check-circle"
            :title="durumFiltresi === 'Açık' ? 'Açık iş emri yok' : 'Bu süzgeçte iş emri yok'"
            description="Yukarıdaki sekmelerden başka bir durumu seçerek diğer iş emirlerine bakabilirsiniz."
            compact
          />
          <EmptyState
            v-else
            icon="pi pi-wrench"
            title="Henüz iş emri açılmamış"
            description="Servise gelen aracı Servis Kabul ekranından alırsanız iş emri kendiliğinden açılır. Kayıtlı bir araç için doğrudan iş emri de açabilirsiniz."
            action-label="Servis Kabul'e Git"
            action-icon="pi pi-bolt"
            hint-label="Nasıl yapılır?"
            @action="servisKabuleGit"
            @hint="yardimaGit('servis-kabul')"
          />
        </template>
      </div>

      <!-- Liste tek sayfaya sığıyorsa sayfalama çubuğu hiç görünmez; yani az
           kayıtlı kurulumlarda ekran görüntüsü eskisiyle birebir aynı kalır. -->
      <Paginator
        v-if="!yukleniyor && filtrelenmisIsEmirleri.length > SAYFA_BOYUTU"
        v-model:first="sayfaBaslangici"
        :rows="SAYFA_BOYUTU"
        :totalRecords="filtrelenmisIsEmirleri.length"
        template="FirstPageLink PrevPageLink CurrentPageReport NextPageLink LastPageLink"
        currentPageReportTemplate="{first}-{last} / {totalRecords}"
        class="work-orders-paginator"
      />
    </div>

    <div
      v-if="!seciliIsEmri"
      class="inline-empty-panel"
    >
      Kalem eklemek için listeden bir iş emri seçin.
    </div>

    <Dialog
      v-model:visible="dialogAcik"
      :header="form.id ? 'İş Emrini Düzenle / Kapat' : 'Yeni İş Emri Aç'"
      :style="{ width: '500px' }"
      modal
    >
      <div style="display: flex; flex-direction: column; gap: 15px; padding-top: 10px;">
        <div class="form-group">
          <label>İşlem Yapılacak Araç</label>

          <Dropdown
            v-model="form.vehicle_id"
            :options="araclarListesi"
            optionValue="id"
            placeholder="Plaka Seçiniz..."
            filter
            style="width: 100%"
            :disabled="form.id !== null"
          >
            <template #option="slotProps">
              <div>
                <strong>{{ slotProps.option.plate }}</strong>
                - {{ slotProps.option.customer_name }}
              </div>
            </template>

            <template #value="slotProps">
              <div v-if="slotProps.value">
                {{ araclarListesi.find(a => a.id === slotProps.value)?.plate }}
              </div>
              <span v-else>Plaka Seçiniz...</span>
            </template>
          </Dropdown>
        </div>
        
        <div class="form-group">
          <label>Genel Açıklama / Şikayet</label>
          <Textarea
            v-model="form.description"
            rows="3"
            placeholder="Örn: Yağ bakımı yapılacak, araçtan ses geliyor..."
            style="width: 100%"
          />
        </div>

<div class="form-group">
  <label>Toplam Tutar</label>
  <InputText
    :value="tlFormatla(form.total_price)"
    disabled
    style="width: 100%"
  />
</div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="dialogAcik = false" />
        <Button label="Kaydet" icon="pi pi-check" :disabled="destekModu" @click="kaydet" />
      </template>
    </Dialog>

    <Dialog
      v-model:visible="tekrarAcDialogAcik"
      header="İş Emrini Tekrar Aç"
      :style="{ width: '520px' }"
      modal
    >
      <div style="display: flex; flex-direction: column; gap: 14px; padding-top: 8px;">
        <div
          style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 12px; border-radius: 8px; color: var(--text-primary);"
        >
          <strong>Uyarı:</strong>
          Bu işlem tamamlanmış iş emrini tekrar açık duruma alır.
          Kapanış tarihi ve kapatan usta bilgisi temizlenir.
          İşlem geçmişine aktif usta, tarih ve sebep kaydedilir.
        </div>

        <div class="form-group">
          <label>Tekrar Açma Sebebi</label>
          <Textarea
            v-model="tekrarAcForm.reason"
            rows="4"
            placeholder="Örn: Eksik işlem fark edildi, müşteri ek işlem istedi, yanlışlıkla kapatıldı..."
            style="width: 100%"
          />
        </div>
      </div>

      <template #footer>
        <Button
          label="Vazgeç"
          icon="pi pi-times"
          text
          @click="tekrarAcDialogAcik = false"
        />

        <Button
          label="Tekrar Aç"
          icon="pi pi-undo"
          severity="warning"
          :disabled="destekModu"
          @click="tekrarAcKaydet"
        />
      </template>
    </Dialog>

    <!-- Ödeme Al Dialog -->
    <Dialog
      v-model:visible="odemeDialogAcik"
      header="İş Emri Ödemesi Al"
      :style="{ width: '460px' }"
      modal
    >
      <div style="display: flex; flex-direction: column; gap: 14px; padding-top: 8px;">
        <div style="background: var(--bg-active-box); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
          <div><strong>Plaka:</strong> {{ seciliIsEmri?.plate }}</div>
          <div><strong>İş Emri Toplamı:</strong> {{ tlFormatla(odemeOzeti.total_price) }}</div>
          <div><strong>Mevcut Kalan Borç:</strong> <span style="color: #f87171; font-weight: bold;">{{ tlFormatla(odemeOzeti.kalan_borc) }}</span></div>
        </div>

        <div class="form-group">
          <label>Alınan Ödeme Tutarı (TL) <span class="zorunlu-alan">*</span></label>
          <InputText
            type="number"
            step="0.01"
            v-model="odemeForm.amount"
            style="width: 100%"
            autofocus
          />
        </div>

        <div class="form-group">
          <label>Ödeme Yöntemi <span class="zorunlu-alan">*</span></label>
          <Dropdown
            v-model="odemeForm.payment_method"
            :options="['Nakit', 'Kart', 'Havale / EFT', 'Diğer']"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Ödeme Tarihi <span class="zorunlu-alan">*</span></label>
          <InputText
            type="date"
            v-model="odemeForm.payment_date"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Açıklama / Not</label>
          <InputText
            v-model="odemeForm.note"
            placeholder="Örn: Kapora, Kısmi Ödeme veya Kredi Kartı Fiş No..."
            style="width: 100%"
          />
        </div>

        <div style="font-size: 0.85rem; color: var(--text-muted, #94a3b8); padding-top: 4px;">
          Tahsilatı Alan Usta: <strong>{{ aktifUsta?.name || 'Giriş Yapılmamış' }}</strong>
        </div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="odemeDialogAcik = false" />
        <Button label="Ödemeyi Kaydet" icon="pi pi-check" severity="success" :disabled="destekModu" @click="odemeKaydet" />
      </template>
    </Dialog>

    <!-- İş Emrini Tamamla ve Kapat Dialog -->
    <Dialog
      v-model:visible="tamamlaDialogAcik"
      header="İş Emrini Tamamla ve Kapat"
      :style="{ width: '520px' }"
      modal
    >
      <div style="display: flex; flex-direction: column; gap: 16px; padding-top: 8px;">
        <div style="background: var(--bg-active-box); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
          <div><strong>Araç:</strong> {{ tamamlanacakIsEmri?.plate }} - {{ tamamlanacakIsEmri?.customer_name }}</div>
          <div><strong>İş Emri Toplamı:</strong> {{ tlFormatla(tamamlanacakIsEmri?.total_price) }}</div>
          <div><strong>Kalan Borç:</strong> <strong :style="{ color: tamamlaForm.kalan_borc <= 0.01 ? '#34d399' : '#f87171' }">{{ tlFormatla(tamamlaForm.kalan_borc) }}</strong></div>
        </div>

        <!-- Ödeme Zaten Tamamen Alınmışsa -->
        <div v-if="tamamlaForm.kalan_borc <= 0.01" style="background: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.4); color: #34d399; padding: 12px; border-radius: 8px; font-weight: 500; display: flex; align-items: center; gap: 10px;">
          <i class="pi pi-check-circle" style="font-size: 1.3rem;"></i>
          <span>Bu iş emrinin ödemesi daha önce tamamen alınmış.</span>
        </div>

        <!-- Kalan Borç Varsa Ödeme Seçenekleri -->
        <template v-else>
          <div class="form-group">
            <label>Kapanış Ödeme Seçeneği <span class="zorunlu-alan">*</span></label>
            <div style="display: flex; flex-direction: column; gap: 10px; background: var(--bg-active-box); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" value="full" v-model="tamamlaForm.payment_option" style="accent-color: #10b981;" />
                <span style="color: var(--text-title);"><strong>Tamamı ödendi</strong> ({{ tlFormatla(tamamlaForm.kalan_borc) }} tahsil edildi)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" value="partial" v-model="tamamlaForm.payment_option" style="accent-color: #f59e0b;" />
                <span style="color: var(--text-title);"><strong>Kısmi ödeme alındı</strong> (Bir kısmı tahsil edildi)</span>
              </label>
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="radio" value="none" v-model="tamamlaForm.payment_option" style="accent-color: #ef4444;" />
                <span style="color: var(--text-title);"><strong>Ödeme alınmadı / Veresiye</strong> (Açık borç olarak kalsın)</span>
              </label>
            </div>
          </div>

          <div v-if="tamamlaForm.payment_option === 'partial'" class="form-group">
            <label>Alınan Ödeme Tutarı (TL) <span class="zorunlu-alan">*</span></label>
            <InputText
              type="number"
              step="0.01"
              v-model="tamamlaForm.amount"
              style="width: 100%"
            />
          </div>

          <div v-if="tamamlaForm.payment_option !== 'none'" class="form-group">
            <label>Ödeme Yöntemi <span class="zorunlu-alan">*</span></label>
            <Dropdown
              v-model="tamamlaForm.payment_method"
              :options="['Nakit', 'Kart', 'Havale / EFT', 'Diğer']"
              style="width: 100%"
            />
          </div>

          <div v-if="tamamlaForm.payment_option !== 'none'" class="form-group">
            <label>Ödeme Tarihi</label>
            <InputText
              type="date"
              v-model="tamamlaForm.payment_date"
              style="width: 100%"
            />
          </div>

          <div v-if="tamamlaForm.payment_option !== 'none'" class="form-group">
            <label>Açıklama / Not</label>
            <InputText
              v-model="tamamlaForm.note"
              placeholder="Kapanış ödemesi açıklaması..."
              style="width: 100%"
            />
          </div>
        </template>
      </div>

      <template #footer>
        <Button label="Vazgeç" icon="pi pi-times" text @click="tamamlaDialogAcik = false" />
        <Button label="İş Emrini Tamamla" icon="pi pi-check" severity="success" :disabled="destekModu" @click="tamamlaVeOdemeKaydet" />
      </template>
    </Dialog>

    <!-- Ödeme İptal Dialog -->
    <Dialog
      v-model:visible="odemeIptalDialogAcik"
      header="Ödeme Kaydını İptal Et"
      :style="{ width: '460px' }"
      modal
    >
      <div style="display: flex; flex-direction: column; gap: 14px; padding-top: 8px;">
        <div style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); padding: 12px; border-radius: 8px; color: #f87171;">
          <strong>Dikkat:</strong> Ödeme kaydı fiziksel olarak silinmeyecek, yetkili iptal kaydı olarak işaretlenecek ve toplam tahsilattan düşecektir.
        </div>

        <div class="form-group">
          <label>İptal Sebebi <span class="zorunlu-alan">*</span></label>
          <Textarea
            v-model="iptalForm.cancel_reason"
            rows="3"
            placeholder="Örn: Hatalı tutar girildi, nakit ödeme iade edildi..."
            style="width: 100%"
            autofocus
          />
        </div>
      </div>

      <template #footer>
        <Button label="Vazgeç" icon="pi pi-times" text @click="odemeIptalDialogAcik = false" />
        <Button label="Ödemeyi İptal Et" icon="pi pi-ban" severity="danger" :disabled="destekModu" @click="odemeIptalKaydet" />
      </template>
    </Dialog>

    <PrintPreviewDialog
      v-model:visible="printPreviewOpen"
      :seciliIsEmri="seciliIsEmri"
      :kalemler="kalemler"
      :bosKalemModu="bosServisFisi"
      :showPaymentSummary="showPaymentSummary"
      :odemeOzeti="odemeOzeti"
      @error="hataMesaji"
      @warning="uyariMesaji"
    />

<div
  v-if="seciliIsEmri"
  class="inline-kalem-panel"
>
    <EditItemDialog
      v-model:visible="kalemDialogAcik"
      :form="kalemDuzenleForm"
      :parcalarListesi="parcalarListesi"
      @save="kalemGuncelleKaydet"
    />
  <div class="inline-kalem-header">
    <div>
      <h3>{{ seciliIsEmri.plate }} - İş Emri Kalemleri</h3>
      <p>Parça ve işçilik kalemlerini buradan doğrudan ekleyebilirsiniz.</p>
    </div>
  </div>
      <div v-if="seciliIsEmri" style="display: flex; flex-direction: column; gap: 20px;">
        <div style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; color: var(--text-primary);">
          <div style="display: flex; justify-content: space-between; gap: 20px;">
            <div>
<strong>Plaka:</strong> {{ seciliIsEmri.plate }} <br>
<strong>Müşteri:</strong> {{ seciliIsEmri.customer_name }} <br>
<strong>Açılış Tarihi:</strong> {{ tarihFormatla(seciliIsEmri.created_at) }} <br>
<strong>Kapanış Tarihi:</strong> {{ tarihFormatla(seciliIsEmri.closed_at) }} <br>
<strong>Açan Usta:</strong> {{ seciliIsEmri.opened_by_master_name || '-' }} <br>
<strong>Kapatan Usta:</strong> {{ seciliIsEmri.closed_by_master_name || '-' }} <br>
<strong>Durum:</strong>
              <Tag
                :value="seciliIsEmri.status"
                :severity="getSeverity(seciliIsEmri.status)"
                style="margin-left: 5px;"
              />
            </div>

<div style="text-align: right;">
  <span style="color: #aaa;">İş Emri Toplamı</span>
  <h2 style="margin: 5px 0 10px; color: #4ade80;">
    {{ tlFormatla(seciliIsEmri.total_price) }}
  </h2>

  <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
    <Button
      label="Servis Fişi Yazdır"
      icon="pi pi-print"
      size="small"
      severity="secondary"
      @click="servisFisiYazdir"
    />
    <Button
      label="Boş Servis Fişi Yazdır"
      icon="pi pi-file-edit"
      size="small"
      severity="secondary"
      outlined
      @click="bosServisFisiYazdir"
    />
    <Button
      v-if="seciliIsEmriTamamlandi"
      label="Tekrar Aç"
      icon="pi pi-undo"
      size="small"
      severity="warning"
      outlined
      :disabled="destekModu"
      @click.stop="tekrarAc(seciliIsEmri)"
    />
  </div>
</div>
          </div>
        </div>

        <!-- İş Emri Detay Sekme Menüsü -->
        <div class="work-order-tabs" style="margin-top: 14px; margin-bottom: 14px; display: flex; gap: 8px; flex-wrap: wrap;">
          <Button
            :label="`İş Emri Kalemleri (${kalemler.length})`"
            icon="pi pi-wrench"
            size="small"
            :severity="detaySekmesi === 'kalemler' ? 'primary' : 'secondary'"
            :outlined="detaySekmesi !== 'kalemler'"
            @click="detaySekmesi = 'kalemler'"
          />
          <Button
            :label="`Araç Fotoğrafları (${fotograflar.length})`"
            icon="pi pi-camera"
            size="small"
            :severity="detaySekmesi === 'fotograflar' ? 'primary' : 'secondary'"
            :outlined="detaySekmesi !== 'fotograflar'"
            @click="detaySekmesi = 'fotograflar'"
          />
          <Button
            :label="`Ödemeler & Tahsilat (${odemeOzeti.odeme_durumu || 'Ödenmedi'})`"
            icon="pi pi-credit-card"
            size="small"
            :severity="detaySekmesi === 'odemeler' ? 'primary' : 'secondary'"
            :outlined="detaySekmesi !== 'odemeler'"
            @click="detaySekmesi = 'odemeler'"
          />
          <Button
            label="İşlem Geçmişi & Maliyet"
            icon="pi pi-history"
            size="small"
            :severity="detaySekmesi === 'gecmis' ? 'primary' : 'secondary'"
            :outlined="detaySekmesi !== 'gecmis'"
            @click="detaySekmesi = 'gecmis'"
          />
        </div>

        <!-- SEKME 1: İş Emri Kalemleri (Parça & İşçilik) -->
        <div v-if="detaySekmesi === 'kalemler'" style="display: flex; flex-direction: column; gap: 14px;">
          <div
            v-if="!seciliIsEmriTamamlandi"
            style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px;"
          >
          <h3 style="margin-top: 0;">Yeni Kalem Ekle</h3>

          <div :style="{ display: 'grid', gridTemplateColumns: kalemForm.type === 'Parça' ? '120px 220px 1fr 80px 110px 100px' : '120px 1fr 80px 110px 100px', gap: '10px', alignItems: 'end' }">
            <div class="form-group">
              <label>Tip</label>
              <Dropdown
                v-model="kalemForm.type"
                :options="kalemTipleri"
                style="width: 100%"
                @change="Object.assign(kalemForm, { part_id: null, description: '', quantity: 1, unit_price: 0 })"
              />
            </div>

            <div v-if="kalemForm.type === 'Parça'" class="form-group">
              <label>Parça Seç</label>
              <Dropdown
                v-model="kalemForm.part_id"
                :options="parcalarListesi"
                optionLabel="name"
                optionValue="id"
                filter
                placeholder="Parça ara..."
                style="width: 100%"
                @change="parcaSecildi($event.value)"
              >
                <template #option="slotProps">
                  <div>
                    <strong>{{ slotProps.option.code }}</strong>
                    - {{ slotProps.option.name }}
                    <span style="color: #aaa;"> | Stok: {{ slotProps.option.stock }}</span>
                  </div>
                </template>
              </Dropdown>
            </div>

            <div class="form-group">
              <label>{{ kalemForm.type === 'Parça' ? 'Açıklama / Parça Adı' : 'İşçilik Açıklaması *' }}</label>
              <InputText
                v-model="kalemForm.description"
                :placeholder="kalemForm.type === 'Parça' ? 'Katalog dışı ise buraya yazın (Örn: 5W-30 Motor Yağı)' : 'Örn: Yağ bakım işçiliği'"
                style="width: 100%"
              />
            </div>

            <div class="form-group">
              <label>Miktar</label>
              <InputText
                type="number"
                v-model="kalemForm.quantity"
                style="width: 100%"
              />
            </div>

            <div class="form-group">
              <label>Birim Fiyat</label>
              <InputText
                type="number"
                v-model="kalemForm.unit_price"
                style="width: 100%"
              />
            </div>

            <Button
              label="Ekle"
              icon="pi pi-plus"
              severity="success"
              :disabled="destekModu"
              @click="kalemKaydet"
            />
          </div>
        </div>

        <div
          v-else
          style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; color: var(--text-secondary);"
        >
          Bu iş emri tamamlandığı için kilitlidir. Parça, işçilik, açıklama veya tutar değiştirilemez. Gerekirse Tekrar Aç butonunu kullanın.
        </div>

        <div style="background: var(--bg-panel); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px;">
<DataTable
  :value="kalemler"
  responsiveLayout="scroll"
  emptyMessage="Bu iş emrine henüz parça veya işçilik eklenmedi."
>
            <Column field="type" header="Tip"></Column>

            <Column header="Açıklama">
              <template #body="slotProps">
                {{ kalemAciklamasiGetir(slotProps.data) }}
              </template>
            </Column>

            <Column field="quantity" header="Miktar"></Column>

            <Column header="Birim Fiyat">
              <template #body="slotProps">
                {{ tlFormatla(slotProps.data.unit_price) }}
              </template>
            </Column>

            <Column header="Toplam">
              <template #body="slotProps">
                <strong>{{ tlFormatla(slotProps.data.total_price) }}</strong>
              </template>
            </Column>

           <Column header="İşlem" style="width: 130px;">
  <template #body="slotProps">
    <Button
      icon="pi pi-pencil"
      outlined
      rounded
      severity="info"
      :disabled="seciliIsEmriTamamlandi || destekModu"
      @click="kalemDuzenle(slotProps.data)"
      style="margin-right: 8px;"
    />

    <Button
      icon="pi pi-trash"
      outlined
      rounded
      severity="danger"
      :disabled="seciliIsEmriTamamlandi || destekModu"
      @click="kalemSil(slotProps.data)"
    />
  </template>
</Column>
          </DataTable>
        </div>
        </div>

        <!-- SEKME 2: Ödemeler & Tahsilat -->
        <div v-if="detaySekmesi === 'odemeler'">
          <div style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 18px; border-radius: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
            <div>
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-title);">Ödeme Durumu</h3>
              <p style="margin: 4px 0 0; font-size: 0.85rem; color: var(--text-muted);">Bu iş emrine ait ödeme özeti ve tahsilat geçmişi.</p>
            </div>
            <Button
              label="Ödeme Al"
              icon="pi pi-credit-card"
              severity="success"
              :disabled="destekModu"
              @click="odemeAlModalAc"
            />
          </div>

          <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px;">
            <div style="background: rgba(15, 23, 42, 0.4); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
              <span style="font-size: 0.8rem; color: var(--text-muted); display: block; text-transform: uppercase; font-weight: 600;">İş Emri Toplamı</span>
              <strong style="font-size: 1.1rem; color: var(--text-primary); display: block; margin-top: 4px;">{{ tlFormatla(odemeOzeti.total_price) }}</strong>
            </div>

            <div style="background: rgba(16, 185, 129, 0.1); padding: 12px; border-radius: 8px; border: 1px solid rgba(16, 185, 129, 0.2);">
              <span style="font-size: 0.8rem; color: #34d399; display: block; text-transform: uppercase; font-weight: 600;">Toplam Tahsil Edilen</span>
              <strong style="font-size: 1.1rem; color: #34d399; display: block; margin-top: 4px;">{{ tlFormatla(odemeOzeti.toplam_tahsilat) }}</strong>
            </div>

            <div style="background: rgba(239, 68, 68, 0.1); padding: 12px; border-radius: 8px; border: 1px solid rgba(239, 68, 68, 0.2);">
              <span style="font-size: 0.8rem; color: #f87171; display: block; text-transform: uppercase; font-weight: 600;">Kalan Borç</span>
              <strong style="font-size: 1.1rem; color: #f87171; display: block; margin-top: 4px;">{{ tlFormatla(odemeOzeti.kalan_borc) }}</strong>
            </div>

            <div style="background: rgba(15, 23, 42, 0.4); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; flex-direction: column; justify-content: center;">
              <span style="font-size: 0.8rem; color: var(--text-muted); display: block; text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Ödeme Durumu</span>
              <Tag
                :value="odemeOzeti.odeme_durumu"
                :severity="getOdemeSeverity(odemeOzeti.odeme_durumu)"
                style="align-self: start; font-weight: bold;"
              />
            </div>
          </div>

          <!-- Ödeme Geçmişi Tablosu -->
          <DataTable
            :value="odemeGecmisi"
            responsiveLayout="scroll"
            emptyMessage="Henüz tahsilat kaydı bulunmuyor."
            class="p-datatable-sm"
          >
            <Column header="Tarih">
              <template #body="slotProps">
                <span :style="{ textDecoration: slotProps.data.is_cancelled ? 'line-through' : 'none', color: slotProps.data.is_cancelled ? '#94a3b8' : 'inherit' }">
                  {{ tarihFormatla(slotProps.data.payment_date) }}
                </span>
              </template>
            </Column>

            <Column header="Tutar">
              <template #body="slotProps">
                <strong :style="{ textDecoration: slotProps.data.is_cancelled ? 'line-through' : 'none', color: slotProps.data.is_cancelled ? '#94a3b8' : '#34d399' }">
                  {{ tlFormatla(slotProps.data.amount) }}
                </strong>
              </template>
            </Column>

            <Column field="payment_method" header="Ödeme Yöntemi">
              <template #body="slotProps">
                <span :style="{ textDecoration: slotProps.data.is_cancelled ? 'line-through' : 'none', color: slotProps.data.is_cancelled ? '#94a3b8' : 'inherit' }">
                  {{ slotProps.data.payment_method }}
                </span>
              </template>
            </Column>

            <Column header="Alan Usta">
              <template #body="slotProps">
                <span :style="{ textDecoration: slotProps.data.is_cancelled ? 'line-through' : 'none', color: slotProps.data.is_cancelled ? '#94a3b8' : 'inherit' }">
                  {{ slotProps.data.received_by_master_name || '-' }}
                </span>
              </template>
            </Column>

            <Column header="Açıklama">
              <template #body="slotProps">
                <span :style="{ textDecoration: slotProps.data.is_cancelled ? 'line-through' : 'none', color: slotProps.data.is_cancelled ? '#94a3b8' : 'inherit' }">
                  {{ slotProps.data.note || '-' }}
                </span>
              </template>
            </Column>

            <Column header="Durum">
              <template #body="slotProps">
                <Tag
                  v-if="slotProps.data.is_cancelled"
                  value="İptal"
                  severity="danger"
                  style="font-size: 0.75rem;"
                />
                <Tag
                  v-else
                  value="Aktif"
                  severity="success"
                  style="font-size: 0.75rem;"
                />
              </template>
            </Column>

            <Column header="İşlem" style="width: 90px; text-align: center;">
              <template #body="slotProps">
                <Button
                  v-if="!slotProps.data.is_cancelled"
                  icon="pi pi-ban"
                  outlined
                  rounded
                  severity="danger"
                  title="Ödemeyi İptal Et"
                  :disabled="destekModu"
                  @click="odemeIptalModalAc(slotProps.data)"
                />
              </template>
            </Column>
          </DataTable>
        </div>
        </div>

        <!-- SEKME 3: Araç Fotoğrafları -->
        <div v-if="detaySekmesi === 'fotograflar'">
          <div style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 18px; border-radius: 10px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 12px; margin-bottom: 14px;">
            <div>
              <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-title); display: flex; align-items: center; gap: 8px;">
                <i class="pi pi-camera" style="color: var(--accent-color);"></i>
                Araç Fotoğrafları (Kabul / Hasar Tespiti)
                <Tag :value="String(fotograflar.length)" severity="info" rounded style="font-size: 0.75rem;" />
              </h3>
              <p style="margin: 4px 0 0; font-size: 0.85rem; color: var(--text-muted);">
                Araç kabulünde çekilen fotoğraflar, çizik/hasar görselleri ve sökülen parça fotoğrafları.
              </p>
            </div>
            <div style="display: flex; gap: 6px; align-items: center;">
              <Dropdown
                v-model="yeniFotografKategorisi"
                :options="kategoriOnerileri"
                editable
                placeholder="Kategori yazın (örn: Motor Bölümü)"
                :disabled="destekModu"
                style="width: 250px;"
                title="Eklenecek fotoğrafların kategorisi. İstediğiniz adı yazabilir veya daha önce kullandıklarınızdan seçebilirsiniz."
              />
              <Button
                label="Fotoğraf Ekle"
                icon="pi pi-plus"
                severity="primary"
                size="small"
                :disabled="destekModu"
                @click="fotografYukleModalAc"
              />
            </div>
          </div>

          <!-- Kategori Filtreleri: bu iş emrinde gerçekten kullanılmış kategoriler -->
          <div style="display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 14px;">
            <Button
              v-for="cat in ['tumu', ...mevcutFotografKategorileri]"
              :key="cat"
              :label="cat === 'tumu' ? `Tümü (${fotograflar.length})` : `${cat} (${fotografKategoriSayilari[cat] || 0})`"
              size="small"
              :severity="fotografKategorisiFiltre === cat ? 'info' : 'secondary'"
              :text="fotografKategorisiFiltre !== cat"
              @click="fotografKategorisiFiltre = cat"
            />
          </div>

          <!-- Fotoğraflar Grid Görünümü -->
          <div v-if="filtrelenmisFotograflar.length > 0" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
            <div
              v-for="photo in filtrelenmisFotograflar"
              :key="photo.id"
              style="position: relative; border-radius: 8px; overflow: hidden; border: 1px solid var(--border-color); background: var(--bg-card); cursor: pointer; transition: transform 0.15s ease;"
              @click="seciliFotografModal = { ...photo }"
            >
              <img
                :src="photo.url"
                :alt="photo.file_name"
                style="width: 100%; height: 130px; object-fit: cover; display: block;"
              />
              <div style="padding: 6px 8px; font-size: 0.78rem; display: flex; justify-content: space-between; align-items: center; background: rgba(0,0,0,0.6); color: #fff; position: absolute; bottom: 0; left: 0; right: 0;">
                <span style="font-weight: 600; font-size: 0.72rem; background: var(--accent-color); padding: 2px 6px; border-radius: 4px;">{{ photo.category }}</span>
                <i class="pi pi-eye" style="font-size: 0.8rem;"></i>
              </div>
            </div>
          </div>

          <!-- Boş Durum -->
          <div v-else style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 0.9rem; border: 1px dashed var(--border-color); border-radius: 8px;">
            <i class="pi pi-image" style="font-size: 2rem; margin-bottom: 8px; opacity: 0.5; display: block;"></i>
            <span>Henüz bu iş emrine ait fotoğraf yüklenmedi. "Fotoğraf Ekle" butonunu kullanarak görsel ekleyebilirsiniz.</span>
          </div>
        </div>

        <!-- Fotoğraf Önizleme & Detay Dialog -->
        <Dialog
          v-model:visible="seciliFotografModal"
          header="Fotoğraf Detayı & Önizleme"
          :style="{ width: '680px' }"
          modal
        >
          <div v-if="seciliFotografModal" style="display: flex; flex-direction: column; gap: 14px;">
            <div style="background: #000; border-radius: 8px; overflow: hidden; text-align: center; max-height: 420px; display: flex; align-items: center; justify-content: center;">
              <img :src="seciliFotografModal.url" style="max-width: 100%; max-height: 420px; object-fit: contain;" />
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
              <div class="form-group">
                <label>Kategori</label>
                <Dropdown
                  v-model="seciliFotografModal.category"
                  :options="kategoriOnerileri"
                  editable
                  placeholder="Kategori yazın"
                  style="width: 100%;"
                />
              </div>

              <div class="form-group">
                <label>Not / Açıklama</label>
                <InputText
                  v-model="seciliFotografModal.note"
                  placeholder="Örn: Sol kapıda 10 cm çizik var"
                  style="width: 100%;"
                />
              </div>
            </div>
          </div>

          <template #footer>
            <Button label="Sil" icon="pi pi-trash" severity="danger" text :disabled="destekModu" @click="fotografSil(seciliFotografModal?.id)" />
            <Button label="Kaydet" icon="pi pi-check" severity="success" :disabled="destekModu" @click="fotografGuncelle" />
          </template>
        </Dialog>
        </div>

        <!-- SEKME 4: İşlem Geçmişi & Maliyet / Kâr Hesabı -->
        <div v-if="detaySekmesi === 'gecmis'" style="display: grid; grid-template-columns: 1fr 1.2fr; gap: 20px; align-items: start;">
          <!-- Sol Kolon: İşlem Geçmişi -->
          <div class="work-order-log-panel" style="margin: 0; background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 18px; border-radius: 10px;">
            <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1.1rem; color: var(--text-title); display: flex; align-items: center; gap: 8px;">
              <i class="pi pi-history" style="color: var(--accent-color);"></i>
              İşlem Geçmişi ({{ isEmriLoglari.length }})
            </h3>
            
            <div v-if="isEmriLoglari.length === 0" style="color: var(--text-muted); font-size: 0.9rem; padding: 10px 0;">
              Henüz bir işlem kaydı bulunmuyor.
            </div>
            
            <div v-else style="max-height: 400px; overflow-y: auto; padding-right: 6px; display: flex; flex-direction: column; gap: 10px;">
              <div
                v-for="log in isEmriLoglari"
                :key="log.id"
                class="work-order-log-item"
                style="background: rgba(15, 23, 42, 0.4); border: 1px solid var(--border-color); padding: 10px 12px; border-radius: 6px;"
              >
                <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                  <strong style="color: var(--text-title); font-size: 0.9rem;">{{ log.action }}</strong>
                  <span style="font-size: 0.75rem; color: var(--text-muted); text-align: right;">
                    {{ log.master_name || 'Usta' }}<br/>{{ tarihFormatla(log.created_at) }}
                  </span>
                </div>
                <p style="margin: 4px 0 0; font-size: 0.82rem; color: var(--text-secondary); line-height: 1.3;">{{ log.reason || '-' }}</p>
              </div>
            </div>
          </div>

          <!-- Sağ Kolon: İç Maliyet / Kâr Hesabı -->
          <div class="internal-profit-panel" style="margin: 0; background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 18px; border-radius: 10px;">
            <div class="internal-profit-header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 14px;">
              <div>
                <h3 style="margin: 0; font-size: 1.1rem; color: var(--text-title); display: flex; align-items: center; gap: 8px;">
                  <i class="pi pi-chart-line" style="color: var(--accent-color);"></i>
                  İç Maliyet / Kâr Hesabı
                </h3>
                <p style="margin: 4px 0 0; font-size: 0.8rem; color: var(--text-muted);">Müşteri fişinde gösterilmeyen servis içi kâr hesabı.</p>
              </div>
              <Tag
                :value="maliyetOzeti.netKar >= 0 ? 'Kârlı' : 'Zarar'"
                :severity="maliyetOzeti.netKar >= 0 ? 'success' : 'danger'"
                style="font-weight: bold;"
              />
            </div>

            <div class="profit-grid" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px; text-align: center;">
              <div class="profit-card" style="background: rgba(15, 23, 42, 0.4); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Parça Alış Maliyeti</span>
                <strong style="font-size: 1rem; color: var(--text-primary); display: block; margin-top: 4px;">{{ tlFormatla(maliyetOzeti.parcaMaliyeti) }}</strong>
              </div>

              <div class="profit-card" style="background: rgba(15, 23, 42, 0.4); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">Parça Satış Toplamı</span>
                <strong style="font-size: 1rem; color: var(--text-primary); display: block; margin-top: 4px;">{{ tlFormatla(maliyetOzeti.parcaSatisi) }}</strong>
              </div>

              <div class="profit-card" style="background: rgba(15, 23, 42, 0.4); padding: 10px 12px; border-radius: 6px; border: 1px solid var(--border-color);">
                <span style="font-size: 0.75rem; color: var(--text-muted); display: block;">İşçilik Geliri</span>
                <strong style="font-size: 1rem; color: var(--text-primary); display: block; margin-top: 4px;">{{ tlFormatla(maliyetOzeti.iscilikGeliri) }}</strong>
              </div>

              <div class="profit-card" style="background: rgba(16, 185, 129, 0.1); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.2);">
                <span style="font-size: 0.75rem; color: #34d399; display: block;">Toplam Ciro / Satış</span>
                <strong style="font-size: 1rem; color: #34d399; display: block; margin-top: 4px;">{{ tlFormatla(maliyetOzeti.toplamSatis) }}</strong>
              </div>

              <div class="profit-card" style="background: rgba(239, 68, 68, 0.1); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.2);">
                <span style="font-size: 0.75rem; color: #f87171; display: block;">Toplam Parça Maliyeti</span>
                <strong style="font-size: 1rem; color: #f87171; display: block; margin-top: 4px;">{{ tlFormatla(maliyetOzeti.toplamMaliyet) }}</strong>
              </div>

              <div class="profit-card profit-card-main" style="background: linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(5, 150, 105, 0.2)); padding: 10px 12px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3); grid-column: span 2; display: grid; grid-template-columns: 1fr 1fr; text-align: center; align-items: center;">
                <div>
                  <span style="font-size: 0.75rem; color: #a7f3d0; display: block;">Net Kâr</span>
                  <strong style="font-size: 1.15rem; color: #10b981; display: block; margin-top: 2px;">{{ tlFormatla(maliyetOzeti.netKar) }}</strong>
                </div>
                <div>
                  <span style="font-size: 0.75rem; color: #a7f3d0; display: block;">Kâr Oranı</span>
                  <strong style="font-size: 1.15rem; color: #10b981; display: block; margin-top: 2px;">{{ yuzdeFormatla(maliyetOzeti.karOrani) }}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
        
      </div>
    </div>
</template>

<style scoped>
.form-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.form-group label {
  font-size: 0.95rem;
  color: var(--text-secondary);
}


.inline-empty-panel {
  margin-top: 18px;
  background: var(--bg-active-box);
  border: 1px dashed var(--border-color);
  color: var(--text-secondary);
  padding: 18px;
  border-radius: 8px;
  text-align: center;
}

.inline-kalem-panel {
  margin-top: 18px;
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  padding: 18px;
  border-radius: 10px;
}

.inline-kalem-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.inline-kalem-header h3 {
  margin: 0;
  color: var(--text-title);
}

.inline-kalem-header p {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}
.durum-dropdown {
  min-width: 145px;
}

.durum-dropdown :deep(.p-dropdown-label) {
  padding-top: 5px;
  padding-bottom: 5px;
}
.work-order-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.internal-profit-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  padding: 15px;
  border-radius: 8px;
}

.internal-profit-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 14px;
}

.internal-profit-header h3 {
  margin: 0;
  color: var(--text-title);
}

.internal-profit-header p {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.profit-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.profit-card {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.profit-card span {
  color: var(--text-secondary);
  font-size: 14px;
}

.profit-card strong {
  color: var(--text-title);
  font-size: 19px;
}

.profit-card small {
  color: var(--text-muted);
}

.profit-card-main {
  border-color: #22c55e;
}
.work-order-log-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  padding: 15px;
  border-radius: 8px;
}

.work-order-log-panel h3 {
  margin: 0 0 12px;
  color: var(--text-title);
}

.work-order-log-item {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 10px;
}

.work-order-log-item:last-child {
  margin-bottom: 0;
}

.work-order-log-item div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.work-order-log-item strong {
  color: var(--text-title);
}

.work-order-log-item span {
  color: var(--text-muted);
  font-size: 14px;
}

.work-order-log-item p {
  margin: 0;
  color: var(--text-secondary);
}
.work-order-description {
  max-width: 220px;
  white-space: normal;
  word-break: break-word;
  line-height: 1.3;
}
.extra-info-panel {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 14px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}

.extra-info-panel h3 {
  margin: 0;
  color: var(--text-title);
}

.extra-info-panel p {
  margin: 5px 0 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.extra-info-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

:global(html[data-theme="light"] .extra-info-panel) {
  background: #ffffff !important;
  border-color: #d1d5db !important;
  color: #111827 !important;
}

:global(html[data-theme="light"] .extra-info-panel h3) {
  color: #111827 !important;
}

:global(html[data-theme="light"] .extra-info-panel p) {
  color: #374151 !important;
}

/* Kompakt Hibrit Liste / Tablo Stilleri (72px Yükseklik) */
.work-orders-table-panel {
  background: var(--bg-panel, #1e293b);
  border: 1px solid var(--border-color, #334155);
  border-radius: 10px;
  overflow: hidden;
}

.table-header-row {
  display: grid;
  grid-template-columns: 20% 38% 18% 12% 12%;
  align-items: center;
  padding: 10px 16px;
  background: rgba(15, 23, 42, 0.6);
  border-bottom: 1px solid var(--border-color, #334155);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-muted, #94a3b8);
}

.table-body-rows {
  display: flex;
  flex-direction: column;
}

.work-order-table-row {
  display: grid;
  grid-template-columns: 20% 38% 18% 12% 12%;
  align-items: center;
  height: 72px;
  padding: 0 16px;
  border-bottom: 1px solid var(--border-color, #334155);
  background: var(--bg-panel, #1e293b);
  cursor: pointer;
  transition: background 0.15s ease-in-out;
  user-select: none;
}

.work-order-table-row:last-child {
  border-bottom: none;
}

.work-order-table-row:hover {
  background: rgba(56, 189, 248, 0.05);
}

.work-order-table-row.is-selected {
  background: rgba(56, 189, 248, 0.09);
  box-shadow: inset 3px 0 0 #38bdf8;
}

.col-plate-master {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding-right: 12px;
  min-width: 0;
}

.plate-text {
  font-size: 0.98rem;
  font-weight: 700;
  color: var(--text-title, #fff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.master-customer-text {
  font-size: 0.78rem;
  color: var(--text-muted, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-desc-date {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding-right: 16px;
  min-width: 0;
}

.desc-text {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text-title, #f1f5f9);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.date-text {
  font-size: 0.76rem;
  color: var(--text-muted, #94a3b8);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-finance {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 2px;
  padding-right: 12px;
  min-width: 0;
}

.price-text {
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--text-title, #fff);
}

.payment-badge-text {
  font-size: 0.72rem;
  font-weight: 600;
  white-space: nowrap;
}

.col-status {
  display: flex;
  align-items: center;
}

.durum-dropdown-compact {
  border: none;
  background: transparent;
  padding: 0;
}

.durum-dropdown-compact :deep(.p-dropdown-label) {
  padding: 0;
}

.col-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 2px;
}

.empty-state-row {
  padding: 32px;
  text-align: center;
  color: var(--text-muted, #94a3b8);
  font-size: 0.9rem;
}
</style>
