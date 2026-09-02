<script setup>
import { ref, reactive, onMounted, onUnmounted, computed, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import AutoComplete from 'primevue/autocomplete'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useRoute } from 'vue-router'
import { useFormatters } from '../composables/useFormatters'
import { firmaBilgileri, firmaIletisimSatirlari } from '../data/firmaBilgileri.js'

// Sub-components
import PaymentOverview from '../components/finance/PaymentOverview.vue'
import ReceivablesView from '../components/finance/ReceivablesView.vue'
import PayablesView from '../components/finance/PayablesView.vue'
import ExpensesView from '../components/finance/ExpensesView.vue'
import MovementsView from '../components/finance/MovementsView.vue'
import ProfitReport from './ProfitReport.vue'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

// Helper: Bugünün Tarihi (YYYY-MM-DD)
function bugununTarihi() {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

// State
const cariler = ref([])
const seciliCari = ref(null)
const aktifAnaSekme = ref('genel-ozet') // 'genel-ozet' | 'alacaklar' | 'borclar' | 'giderler' | 'karlilik' | 'tum-hareketler'
const sayfaYukleniyor = ref(true)

// İlişkili Veri Listeleri
const araclarListesi = ref([])
const isEmirleriListesi = ref([])
const musteriAlacaklari = ref([])
const isEmriOdemeleri = ref([])
const giderler = ref([])
const islemler = ref([])
const odemeler = ref([])
const karlilikRaporu = ref([])

// Bu liste eskiden doğrudan şablonun içinde ([...islemler, ...odemeler].sort(...))
// üretiliyordu. Orada üretilince her yeniden çizimde yeni bir dizi oluşup baştan
// sıralanıyor, üstelik dizi kimliği değiştiği için DataTable listeyi hep sıfırdan
// işliyordu. computed olarak yalnızca islemler/odemeler değişince hesaplanır.
// Sıralama ölçütü aynen korundu (tarihe göre yeniden eskiye).
const islemVeOdemeGecmisi = computed(() =>
  [...islemler.value, ...odemeler.value].sort((a, b) => new Date(b.date) - new Date(a.date))
)

// Dialog Kontrolleri
const cariDialogAcik = ref(false)
const islemDialogAcik = ref(false)
const borcKaydediliyor = ref(false)
const borcCariSecimi = ref(null)
const borcCariOnerileri = ref([])
const yeniBorcCariOlusturulacak = ref(false)
const odemeDialogAcik = ref(false)
const musteriOdemeDialogAcik = ref(false)
const giderFormDialog = ref(false)
const isEditingGider = ref(false)
const cariDetayDialog = ref(false)

const toast = useToast()
const confirmDialog = useConfirm()
const route = useRoute()

// Kasa ve cari hareketleri usta işidir; destek (admin) oturumu kayıt oluşturamaz.
const { destekModu, destekModundaEngelle } = useYetki()

const finansSekmeleri = ['genel-ozet', 'alacaklar', 'borclar', 'giderler', 'karlilik', 'tum-hareketler']
watch(() => route.query.tab, (tab) => {
  const istenenSekme = String(tab || '')
  aktifAnaSekme.value = finansSekmeleri.includes(istenenSekme) ? istenenSekme : 'genel-ozet'
}, { immediate: true })

// Toast Mesajları
const basariMesaji = (detay) => {
  toast.add({ severity: 'success', summary: 'Başarılı', detail: detay, life: 2500 })
}
const hataMesaji = (detay) => {
  toast.add({ severity: 'error', summary: 'Hata', detail: detay, life: 4000 })
}
const uyariMesaji = (detay) => {
  toast.add({ severity: 'warn', summary: 'Uyarı', detail: detay, life: 3000 })
}

// Formatters
const { tlFormatla, tarihFormatla } = useFormatters()

// Cari & Gider Tipleri
const cariTipleri = [
  'Parçacı', 'Kaportacı', 'Boyacı', 'Turbocu', 'Rektefiyeci',
  'Tornacı', 'Elektrikçi', 'Egzozcu', 'Döşemeci', 'Diğer'
]

const dinamikCariTipleri = computed(() => {
  const tipler = new Set(cariTipleri)
  ;(cariler.value || []).forEach(c => {
    if (c.type) tipler.add(c.type)
  })
  const siraliTipler = Array.from(tipler)
    .filter((tip) => tip !== 'Diğer')
    .sort((a, b) => a.localeCompare(b, 'tr-TR'))
  return [...siraliTipler, 'Diğer']
})

const cariTipOnerileri = ref([])
const cariTipiAra = ({ query }) => {
  const aranan = metniNormallestir(query)
  cariTipOnerileri.value = dinamikCariTipleri.value.filter((tip) => (
    !aranan || metniNormallestir(tip).includes(aranan)
  ))
}

const giderTurleri = [
  'İnternet', 'Elektrik', 'Doğalgaz', 'Su', 'Kira',
  'Vergi', 'Sigorta', 'Muhasebeci', 'Aidat', 'Abonelik', 'Diğer'
]

// Forms
const cariForm = reactive({
  id: null,
  name: '',
  type: '',
  phone: '',
  note: '',
  direction: 'Borç'
})

const islemForm = reactive({
  id: null,
  current_account_id: null,
  date: '',
  transaction_type: '',
  description: '',
  amount: null,
  vehicle_id: null,
  work_order_id: null,
  note: '',
  due_date: ''
})

const yeniBorcCariForm = reactive({
  type: '',
  phone: '',
  note: ''
})

const odemeForm = reactive({
  id: null,
  current_account_id: null,
  transaction_id: null,
  date: '',
  amount: null,
  payment_method: '',
  description: ''
})

const musteriOdemeForm = reactive({
  work_order_id: null,
  customer_name: '',
  plate: '',
  kalan_borc: 0,
  amount: 0,
  payment_method: 'Nakit',
  payment_date: bugununTarihi(),
  note: ''
})

const giderForm = ref({
  id: null,
  expense_type: '',
  company_name: '',
  period: '',
  expense_date: '',
  due_date: '',
  amount: null,
  status: 'Ödenmedi',
  payment_date: '',
  payment_method: '',
  note: '',
  recurrence_type: 'Tek Seferlik',
  recurrence_end_date: '',
  recurrence_root_id: null,
  renewed_from_root_id: null,
  previous_amount: null
})

// Calculations & Summaries
const summaryMetrics = computed(() => {
  let totalReceivables = 0
  let openWorkOrderCount = 0

  ;(musteriAlacaklari.value || []).forEach(item => {
    const rem = Number(item.kalan_borc || 0)
    if (rem > 0.01) {
      totalReceivables += rem
      openWorkOrderCount++
    }
  })

  let totalPayables = 0
  let debtorCariCount = 0

  ;(cariler.value || []).forEach(c => {
    const rem = Number(c.remaining_debt || 0)
    if ((c.direction || 'Borç') === 'Borç') {
      if (rem > 0.01) {
        totalPayables += rem
        debtorCariCount++
      }
    }
  })

  let unpaidExpenses = 0
  let unpaidExpenseCount = 0

  ;(giderler.value || []).forEach(g => {
    const amt = Number(g.amount || 0)
    if (g.status !== 'Ödendi') {
      unpaidExpenses += amt
      unpaidExpenseCount++
    }
  })

  const now = new Date()
  const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  let currentMonthCollections = 0

  ;(isEmriOdemeleri.value || []).forEach(pm => {
    if (!pm?.is_cancelled && pm?.payment_date && pm.payment_date.startsWith(currentMonthPrefix)) {
      currentMonthCollections += Number(pm.amount || 0)
    }
  })

  return {
    totalReceivables,
    totalPayables,
    unpaidExpenses,
    currentMonthCollections,
    openWorkOrderCount,
    debtorCariCount,
    unpaidExpenseCount
  }
})

const buAyKarlilikOzeti = computed(() => {
  const simdi = new Date()
  const ayOnEki = `${simdi.getFullYear()}-${String(simdi.getMonth() + 1).padStart(2, '0')}`
  const tamamlananlar = karlilikRaporu.value.filter((satir) => {
    const tarih = satir.closed_at || satir.created_at || ''
    return satir.status === 'Tamamlandı' && String(tarih).startsWith(ayOnEki)
  })

  const toplamSatis = tamamlananlar.reduce((toplam, satir) => toplam + Number(satir.toplam_gelir || 0), 0)
  const toplamMaliyet = tamamlananlar.reduce((toplam, satir) => toplam + Number(satir.toplam_maliyet || 0), 0)
  const netKar = tamamlananlar.reduce((toplam, satir) => toplam + Number(satir.net_kar || 0), 0)

  return {
    toplamSatis,
    toplamMaliyet,
    netKar,
    karOrani: toplamSatis > 0 ? (netKar / toplamSatis) * 100 : 0
  }
})

const borcCarileri = computed(() => (
  (cariler.value || []).filter((cari) => (cari.direction || 'Borç') === 'Borç')
))

const metniNormallestir = (deger) => String(deger || '')
  .trim()
  .replace(/\s+/g, ' ')
  .toLocaleLowerCase('tr-TR')

const yazilanBorcCariAdi = computed(() => (
  typeof borcCariSecimi.value === 'string' ? borcCariSecimi.value.trim() : ''
))

const tamEslesenBorcCari = computed(() => {
  const aranan = metniNormallestir(yazilanBorcCariAdi.value)
  if (!aranan) return null
  return borcCarileri.value.find((cari) => metniNormallestir(cari.name) === aranan) || null
})

const yakinEslesenBorcCari = computed(() => {
  const aranan = metniNormallestir(yazilanBorcCariAdi.value)
  if (!aranan || tamEslesenBorcCari.value) return null

  return borcCarileri.value.find((cari) => {
    const ad = metniNormallestir(cari.name)
    return ad.startsWith(aranan) || aranan.startsWith(ad) || ad.includes(aranan)
  }) || null
})

const borcCariAra = ({ query }) => {
  const aranan = metniNormallestir(query)
  borcCariOnerileri.value = borcCarileri.value
    .filter((cari) => !aranan || metniNormallestir(cari.name).includes(aranan))
    .slice(0, 10)
}

const borcCariSec = (cari) => {
  if (!cari) return
  borcCariSecimi.value = cari
  islemForm.current_account_id = cari.id
  seciliCari.value = cari
  yeniBorcCariOlusturulacak.value = false
}

const yeniBorcCariOlarakKullan = () => {
  if (!yazilanBorcCariAdi.value) {
    uyariMesaji('Önce kişi veya firma adını yazın.')
    return
  }
  if (tamEslesenBorcCari.value) {
    borcCariSec(tamEslesenBorcCari.value)
    return
  }

  islemForm.current_account_id = null
  seciliCari.value = null
  yeniBorcCariOlusturulacak.value = true
}

watch(borcCariSecimi, (secim) => {
  if (secim && typeof secim === 'object') {
    islemForm.current_account_id = secim.id
    seciliCari.value = secim
    yeniBorcCariOlusturulacak.value = false
    return
  }

  islemForm.current_account_id = null
  seciliCari.value = null
  yeniBorcCariOlusturulacak.value = false
})

const tumHareketlerListesi = computed(() => {
  const list = []

  ;(cariler.value || []).forEach(c => {
    const txs = c.transactions || []
    txs.forEach(tx => {
      list.push({
        tarih: tx.date,
        cari_adi: c.name,
        hareket_turu: 'İşlem',
        islem_detayi: tx.transaction_type,
        aciklama: tx.description || 'Cari İşlem',
        tutar: Number(tx.amount || 0),
        yon: c.direction === 'Alacak' ? 'Alacak' : 'Borç'
      })
    })

    const pms = c.payments || []
    pms.forEach(pm => {
      list.push({
        tarih: pm.date,
        cari_adi: c.name,
        hareket_turu: 'Ödeme/Tahsilat',
        islem_detayi: pm.payment_method,
        aciklama: pm.description || (c.direction === 'Alacak' ? 'Tahsilat' : 'Ödeme'),
        tutar: Number(pm.amount || 0),
        yon: c.direction === 'Alacak' ? 'Tahsilat' : 'Ödeme'
      })
    })
  })

  ;(giderler.value || []).forEach(g => {
    list.push({
      tarih: g.expense_date,
      cari_adi: g.company_name || 'Genel Gider',
      hareket_turu: 'Gider',
      islem_detayi: g.expense_type,
      aciklama: `${g.status === 'Ödendi' ? 'Ödendi' : 'Ödenmedi'} - ${g.note || ''}`,
      tutar: Number(g.amount || 0),
      yon: 'Gider'
    })
  })

  ;(isEmriOdemeleri.value || []).forEach(pm => {
    if (!pm?.is_cancelled) {
      list.push({
        tarih: pm.payment_date,
        cari_adi: pm.customer_name || 'Müşteri',
        hareket_turu: 'Müşteri Tahsilatı',
        islem_detayi: `İş Emri #${pm.work_order_id} (${pm.payment_method})`,
        aciklama: `${pm.plate || ''} ${pm.note ? '- ' + pm.note : ''} (Alan Usta: ${pm.received_by_master_name || '-'})`,
        tutar: Number(pm.amount || 0),
        yon: 'Tahsilat'
      })
    }
  })

  return list.sort((a, b) => new Date(b.tarih) - new Date(a.tarih))
})

// Data Fetchers
const carileriYukle = async () => {
  try {
    const res = await window.api.cariHesapleriGetir()
    if (res?.success) {
      cariler.value = res.accounts || []
      if (seciliCari.value) {
        const guncel = cariler.value.find(c => c.id === seciliCari.value.id)
        if (guncel) seciliCari.value = guncel
        else seciliCari.value = null
      }
    }
  } catch (error) {
    console.error('Cari hesaplar yüklenemedi:', error)
  }
}

const cariDetaylariniYukle = async (cari) => {
  if (!cari) return
  seciliCari.value = cari
  try {
    const islemRes = await window.api.cariIslemleriGetir(cari.id)
    if (islemRes?.success) islemler.value = islemRes.transactions || []
    
    const odemeRes = await window.api.cariOdemeleriGetir(cari.id)
    if (odemeRes?.success) odemeler.value = odemeRes.payments || []

    cariDetayDialog.value = true
  } catch (error) {
    hataMesaji('Cari detayları yüklenirken hata oluştu.')
  }
}

const iliskiliVerileriYukle = async () => {
  try {
    if (window.api?.araclariGetir) {
      const araclar = await window.api.araclariGetir()
      araclarListesi.value = Array.isArray(araclar) ? araclar : []
    }
  } catch (err) {}

  try {
    if (window.api?.isEmirleriGetir) {
      const isEmirleri = await window.api.isEmirleriGetir()
      isEmirleriListesi.value = Array.isArray(isEmirleri) ? isEmirleri : []
    }
  } catch (err) {}

  await musteriAlacaklariniYukle()
}

const musteriAlacaklariniYukle = async () => {
  try {
    if (window.api?.musteriIsEmriAlacaklariGetir) {
      const res = await window.api.musteriIsEmriAlacaklariGetir()
      if (res?.success && Array.isArray(res.alacaklar)) {
        musteriAlacaklari.value = res.alacaklar
      }
    }
  } catch (err) {}

  try {
    if (window.api?.isEmriOdemeleriGetir) {
      const odemeRes = await window.api.isEmriOdemeleriGetir()
      if (odemeRes?.success && Array.isArray(odemeRes.odemeler)) {
        isEmriOdemeleri.value = odemeRes.odemeler
      }
    }
  } catch (err) {}
}

const giderleriYukle = async () => {
  try {
    if (window.api?.giderleriGetir) {
      const res = await window.api.giderleriGetir()
      if (res?.success) {
        giderler.value = Array.isArray(res.giderler) ? res.giderler : []
      }
    }
  } catch (err) {}
}

const karlilikOzetiniYukle = async () => {
  try {
    if (window.api?.karlilikRaporuGetir) {
      const res = await window.api.karlilikRaporuGetir()
      karlilikRaporu.value = res?.success && Array.isArray(res.rapor) ? res.rapor : []
    }
  } catch (error) {
    console.error('Kârlılık özeti yüklenemedi:', error)
    karlilikRaporu.value = []
  }
}

// Dialog Actions
const handleOpenReceivablePayment = (row) => {
  if (destekModundaEngelle(toast, 'Tahsilat destek modunda yapılamaz.')) return

  musteriOdemeForm.work_order_id = row.work_order_id
  musteriOdemeForm.customer_name = row.customer_name
  musteriOdemeForm.plate = row.plate
  musteriOdemeForm.kalan_borc = row.kalan_borc
  musteriOdemeForm.amount = row.kalan_borc > 0 ? row.kalan_borc : 0
  musteriOdemeForm.payment_method = 'Nakit'
  musteriOdemeForm.payment_date = bugununTarihi()
  musteriOdemeForm.note = ''
  musteriOdemeDialogAcik.value = true
}

const musteriOdemeKaydet = async () => {
  if (destekModundaEngelle(toast, 'Tahsilat destek modunda yapılamaz.')) return

  if (!musteriOdemeForm.work_order_id) return
  if (!musteriOdemeForm.amount || Number(musteriOdemeForm.amount) <= 0) {
    uyariMesaji('Geçerli bir ödeme tutarı giriniz.')
    return
  }

  const aktifMaster = JSON.parse(localStorage.getItem('aktifUsta') || 'null')

  try {
    const res = await window.api.isEmriOdemeEkle({
      work_order_id: musteriOdemeForm.work_order_id,
      amount: Number(musteriOdemeForm.amount),
      payment_method: musteriOdemeForm.payment_method,
      payment_date: musteriOdemeForm.payment_date,
      note: musteriOdemeForm.note,
      active_master_id: aktifMaster?.id
    })

    if (res?.success) {
      basariMesaji('İş emri ödemesi kaydedildi.')
      musteriOdemeDialogAcik.value = false
      await musteriAlacaklariniYukle()
      await carileriYukle()
    } else {
      hataMesaji(res?.error || 'Ödeme kaydedilemedi.')
    }
  } catch (err) {
    hataMesaji(err instanceof Error ? err.message : String(err))
  }
}

const cariDuzenleAc = (cari) => {
  if (destekModundaEngelle(toast, 'Cari hesap düzenleme destek modunda yapılamaz.')) return

  Object.assign(cariForm, {
    id: cari.id,
    name: cari.name,
    type: cari.type,
    phone: cari.phone,
    note: cari.note,
    direction: 'Borç'
  })
  cariDetayDialog.value = false
  cariDialogAcik.value = true
}

const cariHesapSil = (cari) => {
  if (destekModundaEngelle(toast, 'Cari hesap silme destek modunda yapılamaz.')) return

  confirmDialog.require({
    message: `"${cari.name}" cari hesabını silmek istediğinize emin misiniz? Bu işlem, cariye ait tüm işlem ve ödeme kayıtlarını da silecektir.`,
    header: 'Cari Hesap Silme Onayı',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Vazgeç',
    acceptLabel: 'Sil',
    rejectClass: 'p-button-secondary p-button-outlined',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await window.api.cariHesapSil(cari.id)
        if (res?.success) {
          basariMesaji('Cari hesap silindi.')
          cariDetayDialog.value = false
          await carileriYukle()
        } else {
          hataMesaji(res?.error || 'Cari hesap silinemedi.')
        }
      } catch (error) {
        hataMesaji('Silme sırasında hata oluştu.')
      }
    }
  })
}

const cariKaydet = async () => {
  if (destekModundaEngelle(toast, 'Cari hesap kaydetme destek modunda yapılamaz.')) return

  if (!cariForm.name) {
    uyariMesaji('Cari adı boş bırakılamaz.')
    return
  }
  if (!cariForm.type) {
    uyariMesaji('Cari tipi boş bırakılamaz.')
    return
  }

  try {
    const veri = JSON.parse(JSON.stringify(cariForm))
    const res = cariForm.id 
      ? await window.api.cariHesapGuncelle(veri)
      : await window.api.cariHesapEkle(veri)

    if (res?.success) {
      basariMesaji(cariForm.id ? 'Cari hesap güncellendi.' : 'Cari hesap kaydedildi.')
      cariDialogAcik.value = false
      Object.assign(cariForm, { id: null, name: '', type: '', phone: '', note: '', direction: 'Borç' })
      await carileriYukle()
    } else {
      hataMesaji(res?.error || 'Cari kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji('Bir hata oluştu: ' + error.message)
  }
}

const islemEkleAc = (cari) => {
  if (destekModundaEngelle(toast, 'Cari işlem ekleme destek modunda yapılamaz.')) return

  const target = cari || seciliCari.value
  if (!target) return
  borcCariSec(target)
  Object.assign(yeniBorcCariForm, { type: '', phone: '', note: '' })
  Object.assign(islemForm, {
    id: null,
    current_account_id: target.id,
    date: bugununTarihi(),
    transaction_type: 'Dışarıya Yaptırılan İş',
    description: '',
    amount: null,
    vehicle_id: null,
    work_order_id: null,
    note: '',
    due_date: ''
  })
  islemDialogAcik.value = true
}

const borcEkleDialogAc = () => {
  if (destekModundaEngelle(toast, 'Borç ekleme destek modunda yapılamaz.')) return

  seciliCari.value = null
  borcCariSecimi.value = null
  borcCariOnerileri.value = borcCarileri.value.slice(0, 10)
  yeniBorcCariOlusturulacak.value = false
  Object.assign(yeniBorcCariForm, { type: '', phone: '', note: '' })
  Object.assign(islemForm, {
    id: null,
    current_account_id: null,
    date: bugununTarihi(),
    transaction_type: 'Mal / Parça Alışı',
    description: '',
    amount: null,
    vehicle_id: null,
    work_order_id: null,
    note: '',
    due_date: ''
  })
  islemDialogAcik.value = true
}

const islemKaydet = async () => {
  if (destekModundaEngelle(toast, 'Cari işlem kaydetme destek modunda yapılamaz.')) return

  if (!islemForm.date || !islemForm.transaction_type || !islemForm.amount || islemForm.amount <= 0) {
    uyariMesaji('Tarih, işlem tipi ve tutar alanlarını doğru doldurun.')
    return
  }

  if (!islemForm.current_account_id && !yazilanBorcCariAdi.value) {
    uyariMesaji('Borç eklenecek kişi veya firma adını yazın.')
    return
  }

  if (!islemForm.current_account_id && !tamEslesenBorcCari.value && !yeniBorcCariOlusturulacak.value) {
    uyariMesaji('Önerilen kaydı seçin veya yazdığınız adı yeni hesap olarak onaylayın.')
    return
  }

  if (!islemForm.current_account_id && !tamEslesenBorcCari.value && !yeniBorcCariForm.type) {
    uyariMesaji('Yeni kişi veya firma için bir tür seçin.')
    return
  }

  borcKaydediliyor.value = true
  try {
    let cariId = islemForm.current_account_id
    let yeniCariOlusturuldu = false

    if (!cariId && tamEslesenBorcCari.value) {
      cariId = tamEslesenBorcCari.value.id
    }

    if (!cariId) {
      const cariRes = await window.api.cariHesapEkle({
        name: yazilanBorcCariAdi.value,
        type: yeniBorcCariForm.type,
        phone: yeniBorcCariForm.phone,
        note: yeniBorcCariForm.note,
        direction: 'Borç'
      })
      if (!cariRes?.success || !cariRes?.id) {
        hataMesaji(cariRes?.error || 'Yeni kişi veya firma hesabı oluşturulamadı.')
        return
      }
      cariId = cariRes.id
      yeniCariOlusturuldu = true
    }

    const veri = JSON.parse(JSON.stringify({ ...islemForm, current_account_id: cariId }))
    const res = await window.api.cariIslemEkle(veri)
    if (res?.success) {
      basariMesaji(yeniCariOlusturuldu
        ? 'Yeni kişi/firma oluşturuldu ve borç kaydedildi.'
        : 'Borç başarıyla kaydedildi.')
      islemDialogAcik.value = false
      await carileriYukle()
      if (seciliCari.value) await cariDetaylariniYukle(seciliCari.value)
    } else {
      hataMesaji(res?.error || 'İşlem kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji('Bir hata oluştu.')
  } finally {
    borcKaydediliyor.value = false
  }
}

const odemeEkleAc = (cari) => {
  if (destekModundaEngelle(toast, 'Ödeme kaydı destek modunda yapılamaz.')) return

  const target = cari || seciliCari.value
  if (!target) return
  seciliCari.value = target
  Object.assign(odemeForm, {
    id: null,
    current_account_id: target.id,
    transaction_id: null,
    date: bugununTarihi(),
    amount: target.remaining_debt > 0 ? target.remaining_debt : null,
    payment_method: 'Nakit',
    description: ''
  })
  odemeDialogAcik.value = true
}

const odemeKaydet = async () => {
  if (destekModundaEngelle(toast, 'Ödeme kaydı destek modunda yapılamaz.')) return

  if (!odemeForm.date || !odemeForm.amount || odemeForm.amount <= 0 || !odemeForm.payment_method) {
    uyariMesaji('Lütfen tüm zorunlu ödeme alanlarını doldurun.')
    return
  }

  try {
    const veri = JSON.parse(JSON.stringify(odemeForm))
    const res = await window.api.cariOdemeEkle(veri)
    if (res?.success) {
      basariMesaji('Ödeme kaydı başarıyla eklendi.')
      odemeDialogAcik.value = false
      await carileriYukle()
      if (seciliCari.value) await cariDetaylariniYukle(seciliCari.value)
    } else {
      hataMesaji(res?.error || 'Ödeme kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji('Bir hata oluştu.')
  }
}

const resetGiderForm = () => {
  giderForm.value = {
    id: null,
    expense_type: '',
    company_name: '',
    period: '',
    expense_date: bugununTarihi(),
    due_date: '',
    amount: null,
    status: 'Ödenmedi',
    payment_date: '',
    payment_method: '',
    note: '',
    recurrence_type: 'Tek Seferlik',
    recurrence_end_date: '',
    recurrence_root_id: null,
    renewed_from_root_id: null,
    previous_amount: null
  }
}

// "Ödendi" seçilince ödeme tarihi/yöntemi alanları zorunlu olur; boşsa makul
// varsayılanlarla doldurulur. "Ödenmedi"ye dönülürse alanlar temizlenir.
watch(() => giderForm.value.status, (yeniDurum) => {
  if (yeniDurum === 'Ödendi') {
    if (!giderForm.value.payment_date) giderForm.value.payment_date = bugununTarihi()
    if (!giderForm.value.payment_method) giderForm.value.payment_method = 'Nakit'
  } else {
    giderForm.value.payment_date = ''
    giderForm.value.payment_method = ''
  }
})

const giderEkleDialogAc = () => {
  if (destekModundaEngelle(toast, 'Gider ekleme destek modunda yapılamaz.')) return

  isEditingGider.value = false
  resetGiderForm()
  giderFormDialog.value = true
}

const giderDuzenle = (gider) => {
  if (destekModundaEngelle(toast, 'Gider düzenleme destek modunda yapılamaz.')) return

  isEditingGider.value = true
  giderForm.value = {
    ...gider,
    recurrence_type: gider.recurrence_type || 'Tek Seferlik',
    recurrence_end_date: gider.recurrence_end_date || '',
    renewed_from_root_id: null
  }
  giderFormDialog.value = true
}

const giderDongusuYenile = (gider) => {
  if (destekModundaEngelle(toast, 'Gider döngüsü yenileme destek modunda yapılamaz.')) return

  isEditingGider.value = false
  resetGiderForm()
  Object.assign(giderForm.value, {
    expense_type: gider.expense_type || '',
    company_name: gider.company_name || '',
    amount: null,
    expense_date: bugununTarihi(),
    due_date: bugununTarihi(),
    note: gider.note || '',
    recurrence_type: 'Aylık',
    recurrence_end_date: '',
    renewed_from_root_id: gider.recurrence_root_id || gider.id,
    previous_amount: Number(gider.amount) || 0
  })
  giderFormDialog.value = true
}

const giderKaydet = async () => {
  if (destekModundaEngelle(toast, 'Gider kaydetme destek modunda yapılamaz.')) return

  if (!giderForm.value.expense_type || !giderForm.value.amount || Number(giderForm.value.amount) <= 0) {
    uyariMesaji('Gider türü ve geçerli bir tutar girilmelidir.')
    return
  }

  if (giderForm.value.status === 'Ödendi') {
    if (!giderForm.value.payment_date) {
      uyariMesaji('"Ödendi" durumundaki gider için ödeme tarihi girilmelidir.')
      return
    }
    if (!giderForm.value.payment_method) {
      uyariMesaji('"Ödendi" durumundaki gider için ödeme yöntemi seçilmelidir.')
      return
    }
  }

  if (
    giderForm.value.recurrence_type === 'Aylık' &&
    giderForm.value.recurrence_end_date &&
    giderForm.value.recurrence_end_date < giderForm.value.expense_date
  ) {
    uyariMesaji('Taahhüt bitiş tarihi gider başlangıç tarihinden önce olamaz.')
    return
  }

  try {
    const payload = {
      ...giderForm.value,
      amount: Number(giderForm.value.amount) || 0
    }

    const res = isEditingGider.value
      ? await window.api.giderGuncelle(payload)
      : await window.api.giderEkle(payload)

    if (res?.success) {
      basariMesaji(isEditingGider.value
        ? 'Gider kaydı güncellendi.'
        : giderForm.value.renewed_from_root_id
          ? 'Aylık gider yeni tutar ve taahhütle yenilendi.'
          : giderForm.value.recurrence_type === 'Aylık'
            ? 'Aylık gider döngüsü oluşturuldu.'
            : 'Gider kaydı eklendi.')
      giderFormDialog.value = false
      await giderleriYukle()
    } else {
      hataMesaji(res?.error || 'Gider kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji('Bir hata oluştu: ' + error.message)
  }
}

const giderSil = (gider) => {
  if (destekModundaEngelle(toast, 'Gider silme destek modunda yapılamaz.')) return

  confirmDialog.require({
    message: `"${gider.expense_type}" türündeki gider kaydını silmek istediğinize emin misiniz?`,
    header: 'Kayıt Silme Onayı',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Vazgeç',
    acceptLabel: 'Sil',
    rejectClass: 'p-button-secondary p-button-outlined',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await window.api.giderSil(gider.id)
        if (res?.success) {
          basariMesaji('Gider kaydı silindi.')
          await giderleriYukle()
        } else {
          hataMesaji(res?.error || 'Gider silinemedi.')
        }
      } catch (error) {
        hataMesaji('Silme sırasında hata oluştu.')
      }
    }
  })
}

const cariIslemSil = (islem) => {
  if (destekModundaEngelle(toast, 'Cari işlem silme destek modunda yapılamaz.')) return

  confirmDialog.require({
    message: `"${islem.description || 'Açıklamasız'}" başlıklı işlemi silmek istediğinize emin misiniz?`,
    header: 'İşlem Silme Onayı',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Vazgeç',
    acceptLabel: 'Sil',
    rejectClass: 'p-button-secondary p-button-outlined',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await window.api.cariIslemSil(islem.id)
        if (res?.success) {
          basariMesaji('Cari işlem silindi.')
          await cariDetaylariniYukle(seciliCari.value)
          await carileriYukle()
        } else {
          hataMesaji(res?.error || 'İşlem silinemedi.')
        }
      } catch (error) {
        hataMesaji('Silme sırasında hata oluştu.')
      }
    }
  })
}

const cariOdemeSil = (odeme) => {
  if (destekModundaEngelle(toast, 'Cari ödeme silme destek modunda yapılamaz.')) return

  confirmDialog.require({
    message: `"${odeme.description || 'Açıklamasız'}" başlıklı ödeme kaydını silmek istediğinize emin misiniz?`,
    header: 'Ödeme Silme Onayı',
    icon: 'pi pi-exclamation-triangle',
    rejectLabel: 'Vazgeç',
    acceptLabel: 'Sil',
    rejectClass: 'p-button-secondary p-button-outlined',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await window.api.cariOdemeSil(odeme.id)
        if (res?.success) {
          basariMesaji('Cari ödeme kaydı silindi.')
          await cariDetaylariniYukle(seciliCari.value)
          await carileriYukle()
        } else {
          hataMesaji(res?.error || 'Ödeme silinemedi.')
        }
      } catch (error) {
        hataMesaji('Silme sırasında hata oluştu.')
      }
    }
  })
}

const hizliOde = async (gider) => {
  if (destekModundaEngelle(toast, 'Gider ödemesi destek modunda yapılamaz.')) return

  const bugun = bugununTarihi()
  const guncelGider = {
    ...gider,
    status: 'Ödendi',
    payment_date: bugun,
    payment_method: 'EFT/Havale'
  }

  try {
    const res = await window.api.giderGuncelle(guncelGider)
    if (res?.success) {
      basariMesaji('Gider ödemesi kaydedildi (EFT/Havale).')
      await giderleriYukle()
    } else {
      hataMesaji(res?.error || 'Ödeme kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji('Ödeme sırasında hata oluştu.')
  }
}

const verileriYenileDetayli = async () => {
  await carileriYukle()
  await iliskiliVerileriYukle()
  await giderleriYukle()
  await karlilikOzetiniYukle()
  if (seciliCari.value) {
    await cariDetaylariniYukle(seciliCari.value)
  }
}

const ekstreYazdir = () => {
  if (!seciliCari.value) {
    uyariMesaji('Yazdırılacak cari hesap seçilemedi.')
    return
  }

  const cari = seciliCari.value
  const firma = firmaBilgileri

  const guvenliMetin = (str) => {
    if (str === null || str === undefined) return ''
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
  }

  const sortedHistory = [...islemler.value, ...odemeler.value].sort(
    (a, b) => new Date(a.date) - new Date(b.date)
  )

  const satirlarHtml = sortedHistory.map((item, index) => {
    const tip = item.transaction_type
      ? item.transaction_type
      : `Ödeme (${item.payment_method || 'Nakit'})`
    const aciklama = item.description || item.note || '-'
    const tutar = tlFormatla(item.amount)

    return `
      <tr>
        <td style="text-align: center;">${index + 1}</td>
        <td>${guvenliMetin(tarihFormatla(item.date))}</td>
        <td>${guvenliMetin(tip)}</td>
        <td>${guvenliMetin(aciklama)}</td>
        <td class="right strong">${guvenliMetin(tutar)}</td>
      </tr>
    `
  }).join('')

  const yazdirmaPenceresi = window.open('', '_blank')

  if (!yazdirmaPenceresi) {
    hataMesaji('Yazdırma penceresi açılması engellendi. Lütfen tarayıcı izinlerini kontrol edin.')
    return
  }

  yazdirmaPenceresi.document.write(`
    <!doctype html>
    <html lang="tr">
      <head>
        <meta charset="UTF-8" />
        <title>Cari Hesap Ekstresi - ${guvenliMetin(cari.name)}</title>
        <style>
          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 24px;
            font-family: Arial, Helvetica, sans-serif;
            color: #111827;
            background: #ffffff;
            font-size: 12.5px;
          }

          .page {
            max-width: 980px;
            margin: 0 auto;
          }

          .top-header {
            display: grid;
            grid-template-columns: 1.4fr 0.8fr;
            gap: 18px;
            align-items: stretch;
            border-bottom: 3px solid #111827;
            padding-bottom: 16px;
            margin-bottom: 18px;
          }

          .company-name {
            font-size: 20px;
            font-weight: bold;
            margin: 0;
            color: #111827;
          }

          .company-subtitle {
            font-size: 13px;
            color: #4b5563;
            margin-top: 3px;
          }

          .company-desc {
            font-size: 11px;
            color: #6b7280;
            margin-top: 5px;
          }

          .document-box {
            text-align: right;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }

          .document-title {
            font-size: 18px;
            font-weight: 800;
            letter-spacing: 0.5px;
            color: #111827;
          }

          .document-no {
            font-size: 12px;
            font-weight: bold;
            margin-top: 4px;
          }

          .muted {
            font-size: 11px;
            color: #6b7280;
            margin-top: 2px;
          }

          .section {
            margin-bottom: 18px;
          }

          .section-title {
            font-size: 12px;
            font-weight: bold;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            border-bottom: 1.5px solid #111827;
            padding-bottom: 4px;
            margin-bottom: 8px;
          }

          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 12px;
          }

          .info-item {
            font-size: 11.5px;
            line-height: 1.5;
          }

          .info-item strong {
            color: #374151;
          }

          .summary-cards {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
            margin-top: 8px;
          }

          .summary-card {
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 10px;
            background: #f9fafb;
          }

          .summary-label {
            font-size: 10.5px;
            color: #6b7280;
            margin-bottom: 4px;
            text-transform: uppercase;
          }

          .summary-value {
            font-size: 14px;
            font-weight: bold;
            color: #111827;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 8px;
          }

          th {
            background: #f3f4f6;
            color: #374151;
            font-weight: bold;
            text-align: left;
            border: 1px solid #d1d5db;
            padding: 7px 9px;
            font-size: 11px;
            text-transform: uppercase;
          }

          td {
            border: 1px solid #e5e7eb;
            padding: 7px 9px;
            font-size: 11.5px;
          }

          tr:nth-child(even) {
            background: #f9fafb;
          }

          .right {
            text-align: right;
          }

          .strong {
            font-weight: bold;
          }

          .footer-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 50px;
            margin-top: 45px;
            page-break-inside: avoid;
          }

          .signature-box {
            border-top: 1px dashed #9ca3af;
            text-align: center;
            padding-top: 8px;
            font-size: 11.5px;
            font-weight: bold;
            color: #374151;
          }

          .signature-sub {
            font-size: 10.5px;
            color: #6b7280;
            margin-top: 4px;
            font-weight: normal;
          }

          .print-actions {
            margin-bottom: 15px;
            text-align: right;
          }

          .print-btn {
            background: #2563eb;
            color: #ffffff;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 6px;
          }

          .print-btn:hover {
            background: #1d4ed8;
          }

          @media print {
            body {
              padding: 0;
            }

            .print-actions {
              display: none;
            }

            .section {
              break-inside: avoid;
            }
          }
        </style>
      </head>

      <body>
        <div class="page">
          <!-- Üst kısımdan yazdır butonu kaldırıldı, sağ alttaki yüzen butonlar kullanılacak -->

          <div class="top-header">
            <div class="company-box">
              <h1 class="company-name">${guvenliMetin(firma.unvan)}</h1>
              <div class="company-subtitle">${guvenliMetin(firma.altBaslik)}</div>
              ${firmaIletisimSatirlari().map((satir) => `<div class="company-desc">${guvenliMetin(satir)}</div>`).join('')}
            </div>

            <div class="document-box">
              <div class="document-title">CARİ HESAP EKSTRESİ</div>
              <div class="muted">Tarih: ${guvenliMetin(new Date().toLocaleString('tr-TR'))}</div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Cari Hesap Bilgileri</div>
            <div class="info-grid">
              <div class="info-item">
                <div><strong>Cari Ünvanı:</strong> ${guvenliMetin(cari.name)}</div>
                <div><strong>Cari Tipi:</strong> ${guvenliMetin(cari.type)}</div>
              </div>
              <div class="info-item">
                <div><strong>Telefon:</strong> ${guvenliMetin(cari.phone || '-')}</div>
                <div><strong>Hesap Türü:</strong> ${guvenliMetin(cari.direction === 'Alacak' ? 'Müşteri (Alacak Senedi)' : 'Tedarikçi (Borçlu Cari)')}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">Hesap Bakiyesi Özet</div>
            <div class="summary-cards">
              <div class="summary-card">
                <div class="summary-label">Toplam Borçlandırma</div>
                <div class="summary-value">${guvenliMetin(tlFormatla(cari.total_debt))}</div>
              </div>
              <div class="summary-card">
                <div class="summary-label">Yapılan Ödemeler</div>
                <div class="summary-value" style="color: #059669;">${guvenliMetin(tlFormatla(cari.total_paid))}</div>
              </div>
              <div class="summary-card" style="border-color: #fca5a5; background: #fff5f5;">
                <div class="summary-label">Kalan Bakiye (Net Borç)</div>
                <div class="summary-value" style="color: #dc2626;">${guvenliMetin(tlFormatla(cari.remaining_debt))}</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">İşlem ve Ödeme Geçmişi Detayları</div>
            <table>
              <thead>
                <tr>
                  <th style="width: 40px; text-align: center;">#</th>
                  <th style="width: 100px;">Tarih</th>
                  <th style="width: 180px;">İşlem Türü</th>
                  <th>Açıklama</th>
                  <th style="width: 130px; text-align: right;">Tutar</th>
                </tr>
              </thead>
              <tbody>
                ${satirlarHtml || '<tr><td colspan="5" style="text-align: center; color: #6b7280;">Herhangi bir işlem veya ödeme kaydı bulunamadı.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div class="footer-grid">
            <div class="signature-box">
              Cari Firma Temsilcisi
              <div class="signature-sub">Ad Soyad / İmza</div>
            </div>

            <div class="signature-box">
              Yetkili Servis Temsilcisi
              <div class="signature-sub">${guvenliMetin(firma.unvan)}</div>
            </div>
          </div>
        </div>

        <!-- Sağ alt köşede sabit duran buton paneli (yazdırma esnasında gizlenir) -->
        <div class="print-actions" style="position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; gap: 10px;">
          <button onclick="window.close()" style="background: #ef4444; color: white; border: none; padding: 10px 18px; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 6px;">
            <span>❌</span>
            <span>Kapat</span>
          </button>
          <button onclick="window.print()" style="background: #10b981; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer; box-shadow: 0 4px 6px rgba(0,0,0,0.15); display: flex; align-items: center; gap: 6px;">
            <span>🖨</span>
            <span>Yazdır / PDF Kaydet</span>
          </button>
        </div>
      </body>
    </html>
  `)

  yazdirmaPenceresi.document.close()
}

const genelYenileme = genelVeriYenilemeIsleyicisi(verileriYenileDetayli)

onMounted(async () => {
  sayfaYukleniyor.value = true
  await carileriYukle()
  await iliskiliVerileriYukle()
  await giderleriYukle()
  await karlilikOzetiniYukle()
  sayfaYukleniyor.value = false

  if (route.query.action === 'new-debt') {
    borcEkleDialogAc()
  }

  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div class="page" style="display: flex; flex-direction: column; gap: 20px;">
    <!-- Page Header -->
    <div class="page-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
      <div>
        <h2 class="page-title" style="margin: 0;">Finans <HelpButton konu="cari" /></h2>
        <p class="page-subtitle" style="margin: 4px 0 0; color: var(--text-muted, #94a3b8); font-size: 0.9rem;">
          Ödenecek giderleri ve cari borçları önceliklendirerek takip edin
        </p>
      </div>

      <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
        <Button
          label="Yeni Borç Ekle"
          icon="pi pi-plus"
          severity="danger"
          :disabled="destekModu"
          @click="borcEkleDialogAc"
        />
        <Button
          label="Yeni Gider Ekle"
          icon="pi pi-plus"
          severity="warning"
          :disabled="destekModu"
          @click="giderEkleDialogAc"
        />
      </div>
    </div>

    <DestekModuUyarisi aciklama="Tahsilat, ödeme, cari hareket ve gider kaydı destek modunda kapalıdır." />

    <!-- Üst Sekme Menüsü (6 temel sekme) -->
    <div class="tab-menu" style="display: flex; gap: 8px; border-bottom: 2px solid var(--border-color, #334155); padding-bottom: 10px; flex-wrap: wrap;">
      <Button 
        label="Genel Özet" 
        icon="pi pi-th-large" 
        :text="aktifAnaSekme !== 'genel-ozet'"
        severity="info" 
        @click="aktifAnaSekme = 'genel-ozet'" 
      />
      <Button 
        label="Borçlar" 
        icon="pi pi-arrow-up-right" 
        :text="aktifAnaSekme !== 'borclar'"
        severity="danger" 
        @click="aktifAnaSekme = 'borclar'" 
      />
      <Button
        label="Giderler"
        icon="pi pi-receipt"
        :text="aktifAnaSekme !== 'giderler'"
        severity="warning"
        @click="aktifAnaSekme = 'giderler'"
      />
      <Button
        label="Alacaklar"
        icon="pi pi-car"
        :text="aktifAnaSekme !== 'alacaklar'"
        severity="success"
        @click="aktifAnaSekme = 'alacaklar'"
      />
      <Button
        label="Kârlılık"
        icon="pi pi-chart-line"
        :text="aktifAnaSekme !== 'karlilik'"
        severity="success"
        @click="aktifAnaSekme = 'karlilik'"
      />
      <Button
        label="Geçmiş"
        icon="pi pi-list"
        :text="aktifAnaSekme !== 'tum-hareketler'"
        severity="secondary"
        @click="aktifAnaSekme = 'tum-hareketler'"
      />
    </div>

    <div v-if="sayfaYukleniyor" class="skeleton-list" style="padding: 8px 4px;">
      <div class="skeleton-row" v-for="n in 5" :key="n">
        <span class="skeleton-block" style="width:120px"></span>
        <span class="skeleton-block" style="flex:1"></span>
        <span class="skeleton-block" style="width:90px"></span>
      </div>
    </div>

    <Transition v-else name="tab-fade" mode="out-in">
      <!-- TAB 1: Genel Özet -->
      <div v-if="aktifAnaSekme === 'genel-ozet'" key="genel-ozet">
        <PaymentOverview
          :summary="summaryMetrics"
          :profitability="buAyKarlilikOzeti"
          :expenses="giderler"
          :payables="cariler"
          @navigate="tab => aktifAnaSekme = tab"
        />
      </div>

      <!-- Alacaklar (Müşteri & İş Emri Alacakları Birleşik) -->
      <div v-else-if="aktifAnaSekme === 'alacaklar'" key="alacaklar">
        <ReceivablesView
          :workOrderReceivables="musteriAlacaklari"
          :destek-modu="destekModu"
          @open-payment="handleOpenReceivablePayment"
        />
      </div>

      <!-- Borçlar (Tedarikçi & Taşeron Borçları) -->
      <div v-else-if="aktifAnaSekme === 'borclar'" key="borclar">
        <PayablesView
          :suppliers="cariler"
          :supplierTypes="dinamikCariTipleri"
          @add-debt="borcEkleDialogAc"
          @select-cari="cariDetaylariniYukle"
          :destek-modu="destekModu"
          @add-transaction="islemEkleAc"
          @add-payment="odemeEkleAc"
        />
      </div>

      <!-- TAB 4: Giderler (İşletme Giderleri) -->
      <div v-else-if="aktifAnaSekme === 'giderler'" key="giderler">
        <ExpensesView
          :expenses="giderler"
          :expenseTypes="giderTurleri"
          :destek-modu="destekModu"
          @add-expense="giderEkleDialogAc"
          @quick-pay="hizliOde"
          @edit-expense="giderDuzenle"
          @delete-expense="giderSil"
          @renew-cycle="giderDongusuYenile"
        />
      </div>

      <!-- TAB 5: Kârlılık -->
      <div v-else-if="aktifAnaSekme === 'karlilik'" key="karlilik">
        <ProfitReport />
      </div>

      <!-- TAB 6: Geçmiş (Tüm Finans Hareketleri) -->
      <div v-else-if="aktifAnaSekme === 'tum-hareketler'" key="tum-hareketler">
        <MovementsView :movements="tumHareketlerListesi" />
      </div>
    </Transition>

    <!-- MODAL 1: Müşteri İş Emri Ödemesi Al -->
    <Dialog 
      v-model:visible="musteriOdemeDialogAcik" 
      header="İş Emri Tahsilatı Al" 
      :style="{ width: '450px' }" 
      modal
    >
      <div class="dialog-form" style="display: flex; flex-direction: column; gap: 14px;">
        <div style="background: var(--bg-active-box); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
          <div><strong>Müşteri:</strong> {{ musteriOdemeForm.customer_name }}</div>
          <div><strong>Plaka:</strong> {{ musteriOdemeForm.plate }}</div>
          <div><strong>Kalan Borç:</strong> <span style="color: #f87171; font-weight: bold;">{{ tlFormatla(musteriOdemeForm.kalan_borc) }}</span></div>
        </div>

        <div class="form-group">
          <label>Alınan Ödeme Tutarı (TL) <span class="zorunlu-alan">*</span></label>
          <InputText
            type="number"
            step="0.01"
            v-model="musteriOdemeForm.amount"
            style="width: 100%"
            autofocus
          />
        </div>

        <div class="form-group">
          <label>Ödeme Yöntemi <span class="zorunlu-alan">*</span></label>
          <Dropdown
            v-model="musteriOdemeForm.payment_method"
            :options="['Nakit', 'Kart', 'Havale / EFT', 'Diğer']"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Ödeme Tarihi <span class="zorunlu-alan">*</span></label>
          <InputText
            type="date"
            v-model="musteriOdemeForm.payment_date"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Açıklama / Not</label>
          <InputText
            v-model="musteriOdemeForm.note"
            placeholder="Tahsilat notu..."
            style="width: 100%"
          />
        </div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="musteriOdemeDialogAcik = false" />
        <Button label="Tahsilatı Kaydet" icon="pi pi-check" severity="success" :disabled="destekModu" @click="musteriOdemeKaydet" />
      </template>
    </Dialog>

    <!-- MODAL 2: Tedarikçi Ekle / Düzenle -->
    <Dialog 
      v-model:visible="cariDialogAcik" 
      header="Kişi / Firma Bilgilerini Düzenle"
      :style="{ width: '460px' }" 
      modal
    >
      <div class="dialog-form" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="form-group">
          <label>Firma / Kişi Adı <span class="zorunlu-alan">*</span></label>
          <InputText v-model="cariForm.name" placeholder="Örn: Öz Hilal Rektefiye Sanayi" autofocus style="width: 100%;" />
        </div>

        <div style="font-size: 0.82rem; padding: 10px 14px; border-radius: 8px; line-height: 1.45; border: 1px solid rgba(239, 68, 68, 0.2); background: rgba(239, 68, 68, 0.08); color: #f87171; display: flex; align-items: flex-start; gap: 8px;">
          <i class="pi pi-info-circle" style="margin-top: 2px;" />
          <span>Parçacı, boyacı, rektefiyeci veya taşeron gibi <strong>ödeme yapacağınız</strong> kişi ve firmaları buraya ekleyin.</span>
        </div>
        
        <div class="form-group">
          <label>Tedarikçi / Hizmet Tipi <span class="zorunlu-alan">*</span></label>
          <AutoComplete
            v-model="cariForm.type"
            :suggestions="cariTipOnerileri"
            dropdown
            completeOnFocus
            placeholder="Listeden seçin veya yeni bir tür yazın"
            style="width: 100%;"
            inputStyle="width: 100%;"
            @complete="cariTipiAra"
          />
        </div>

        <div class="form-group">
          <label>Telefon Numarası</label>
          <InputText v-model="cariForm.phone" placeholder="05XX XXX XX XX" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Açıklama / Not</label>
          <InputText v-model="cariForm.note" placeholder="Ek açıklama..." style="width: 100%;" />
        </div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="cariDialogAcik = false" />
        <Button label="Kaydet" icon="pi pi-check" severity="info" :disabled="destekModu" @click="cariKaydet" />
      </template>
    </Dialog>

    <!-- MODAL 3: Borç Ekle -->
    <Dialog 
      v-model:visible="islemDialogAcik" 
      header="Yeni Borç Ekle"
      :style="{ width: '520px' }"
      modal
    >
      <div class="dialog-form" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="form-group">
          <label>Kişi / Firma <span class="zorunlu-alan">*</span></label>
          <AutoComplete
            v-model="borcCariSecimi"
            :suggestions="borcCariOnerileri"
            optionLabel="name"
            dropdown
            completeOnFocus
            placeholder="Geçmişten seçin veya yeni bir ad yazın"
            style="width: 100%;"
            inputStyle="width: 100%;"
            @complete="borcCariAra"
          >
            <template #option="slotProps">
              <div style="display: flex; flex-direction: column; gap: 2px;">
                <strong>{{ slotProps.option.name }}</strong>
                <small style="color: var(--text-muted);">{{ slotProps.option.type || 'Diğer' }} · Kalan: {{ tlFormatla(slotProps.option.remaining_debt) }}</small>
              </div>
            </template>
          </AutoComplete>
        </div>

        <div
          v-if="borcCariSecimi && typeof borcCariSecimi === 'object'"
          style="background: var(--bg-active-box); padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; gap: 10px;"
        >
          <span><i class="pi pi-check-circle" style="color: #34d399; margin-right: 6px;" />Geçmiş kayıt seçildi: <strong>{{ borcCariSecimi.name }}</strong></span>
          <Button label="Değiştir" size="small" text @click="borcCariSecimi = null" />
        </div>

        <div
          v-else-if="yazilanBorcCariAdi && !yeniBorcCariOlusturulacak"
          style="background: rgba(245, 158, 11, 0.08); padding: 12px; border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.28); display: flex; flex-direction: column; gap: 10px;"
        >
          <template v-if="tamEslesenBorcCari">
            <span><strong>“{{ tamEslesenBorcCari.name }}”</strong> kaydını mı demek istediniz?</span>
            <Button label="Evet, Bu Kaydı Seç" icon="pi pi-check" severity="info" size="small" @click="borcCariSec(tamEslesenBorcCari)" />
          </template>
          <template v-else>
            <span v-if="yakinEslesenBorcCari"><strong>“{{ yakinEslesenBorcCari.name }}”</strong> kaydı bu kişi/firma olabilir. Bunu mu demek istediniz?</span>
            <Button v-if="yakinEslesenBorcCari" label="Evet, Bu Kaydı Seç" icon="pi pi-check" severity="info" size="small" @click="borcCariSec(yakinEslesenBorcCari)" />
            <Button
              :label="`Hayır, “${yazilanBorcCariAdi}” Yeni Bir Hesap`"
              icon="pi pi-user-plus"
              severity="secondary"
              size="small"
              outlined
              @click="yeniBorcCariOlarakKullan"
            />
          </template>
        </div>

        <div
          v-if="yeniBorcCariOlusturulacak"
          style="display: flex; flex-direction: column; gap: 12px; padding: 12px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.08);"
        >
          <div><i class="pi pi-user-plus" style="margin-right: 6px;" /><strong>“{{ yazilanBorcCariAdi }}”</strong> yeni hesap olarak borçlarla birlikte kaydedilecek.</div>
          <div class="form-group">
            <label>Kişi / Firma Türü <span class="zorunlu-alan">*</span></label>
            <AutoComplete
              v-model="yeniBorcCariForm.type"
              :suggestions="cariTipOnerileri"
              dropdown
              completeOnFocus
              placeholder="Listeden seçin veya yeni bir tür yazın"
              style="width: 100%;"
              inputStyle="width: 100%;"
              @complete="cariTipiAra"
            />
          </div>
          <div class="form-group">
            <label>Telefon Numarası</label>
            <InputText v-model="yeniBorcCariForm.phone" placeholder="05XX XXX XX XX" style="width: 100%;" />
          </div>
          <div class="form-group">
            <label>Kişi / Firma Notu</label>
            <InputText v-model="yeniBorcCariForm.note" placeholder="İsteğe bağlı not..." style="width: 100%;" />
          </div>
        </div>

        <div class="form-group">
          <label>İşlem Tarihi <span class="zorunlu-alan">*</span></label>
          <InputText type="date" v-model="islemForm.date" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Vade / Son Ödeme Tarihi</label>
          <InputText type="date" v-model="islemForm.due_date" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>İşlem Tipi <span class="zorunlu-alan">*</span></label>
          <Dropdown v-model="islemForm.transaction_type" :options="['Mal / Parça Alışı', 'Dışarıya Yaptırılan İş', 'Genel Gider', 'Diğer']" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Tutar (TL) <span class="zorunlu-alan">*</span></label>
          <InputText type="number" step="0.01" v-model="islemForm.amount" placeholder="0.00" style="width: 100%;" autofocus />
        </div>

        <div class="form-group">
          <label>Açıklama</label>
          <InputText v-model="islemForm.description" placeholder="Örn: 2 adet turbo tamiri parçası" style="width: 100%;" />
        </div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="islemDialogAcik = false" />
        <Button label="Borcu Kaydet" icon="pi pi-check" severity="warning" :disabled="destekModu || borcKaydediliyor" :loading="borcKaydediliyor" @click="islemKaydet" />
      </template>
    </Dialog>

    <!-- MODAL 4: Cari Ödemesi Yap -->
    <Dialog 
      v-model:visible="odemeDialogAcik" 
      header="Cari Ödeme Kaydı" 
      :style="{ width: '460px' }" 
      modal
    >
      <div class="dialog-form" style="display: flex; flex-direction: column; gap: 14px;">
        <div style="background: var(--bg-active-box); padding: 10px; border-radius: 8px; border: 1px solid var(--border-color);">
          <div><strong>Cari:</strong> {{ seciliCari?.name }}</div>
          <div><strong>Kalan Borcumuz:</strong> <span style="color: #f87171; font-weight: bold;">{{ tlFormatla(seciliCari?.remaining_debt) }}</span></div>
        </div>

        <div class="form-group">
          <label>Ödeme Tarihi <span class="zorunlu-alan">*</span></label>
          <InputText type="date" v-model="odemeForm.date" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Ödenen Tutar (TL) <span class="zorunlu-alan">*</span></label>
          <InputText type="number" step="0.01" v-model="odemeForm.amount" style="width: 100%;" autofocus />
        </div>

        <div class="form-group">
          <label>Ödeme Yöntemi <span class="zorunlu-alan">*</span></label>
          <Dropdown v-model="odemeForm.payment_method" :options="['Nakit', 'Kredi Kartı', 'Havale/EFT', 'Diğer']" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Açıklama / Dekont Notu</label>
          <InputText v-model="odemeForm.description" placeholder="Örn: Garanti Bankası EFT..." style="width: 100%;" />
        </div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="odemeDialogAcik = false" />
        <Button label="Ödemeyi Kaydet" icon="pi pi-check" severity="danger" :disabled="destekModu" @click="odemeKaydet" />
      </template>
    </Dialog>

    <!-- MODAL 5: Gider Ekle / Düzenle -->
    <Dialog
      v-model:visible="giderFormDialog"
      :header="isEditingGider ? 'Gider Kaydını Düzenle' : giderForm.renewed_from_root_id ? 'Aylık Gideri Yeni Tutarla Yenile' : 'Yeni İşletme Gideri Kaydı'"
      :style="{ width: '520px' }"
      modal
    >
      <div class="dialog-form" style="display: flex; flex-direction: column; gap: 14px;">
        <div class="form-group">
          <label>Gider Türü <span class="zorunlu-alan">*</span></label>
          <Dropdown v-model="giderForm.expense_type" :options="giderTurleri" editable placeholder="Tür seçin veya yazın" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Firma / Kurum Adı</label>
          <InputText v-model="giderForm.company_name" placeholder="Örn: CK Boğaziçi Elektrik" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Gider Tutarı (TL) <span class="zorunlu-alan">*</span></label>
          <InputText type="number" step="0.01" v-model="giderForm.amount" placeholder="0.00" style="width: 100%;" />
        </div>

        <div
          v-if="giderForm.renewed_from_root_id"
          style="padding: 10px 12px; border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.3); background: rgba(245, 158, 11, 0.08); font-size: 0.84rem;"
        >
          Eski aylık tutar <strong>{{ tlFormatla(giderForm.previous_amount) }}</strong>. Yeni taahhüt için güncel tutarı yukarıya girin.
        </div>

        <div class="form-group">
          <label>Kayıt Şekli</label>
          <Dropdown
            v-model="giderForm.recurrence_type"
            :options="[
              { label: 'Tek Seferlik', value: 'Tek Seferlik' },
              { label: 'Her Ay Otomatik', value: 'Aylık' }
            ]"
            optionLabel="label"
            optionValue="value"
            :disabled="isEditingGider || Boolean(giderForm.renewed_from_root_id)"
            style="width: 100%;"
          />
        </div>

        <div
          v-if="giderForm.recurrence_type === 'Aylık'"
          style="padding: 11px 12px; border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.28); background: rgba(59, 130, 246, 0.08); font-size: 0.84rem; line-height: 1.45;"
        >
          <i class="pi pi-sync" style="margin-right: 6px;" />
          Bu tutar her ay otomatik gider olur. Taahhüt bittiğinde döngü durur; Giderler ekranından yeni fiyatla yenileyebilirsiniz.
        </div>

        <div v-if="giderForm.recurrence_type === 'Aylık'" class="form-group">
          <label>Taahhüt / Sabit Tutar Bitişi</label>
          <InputText type="date" v-model="giderForm.recurrence_end_date" style="width: 100%;" />
          <small style="color: var(--text-muted);">Bitiş yoksa boş bırakabilirsiniz; döngü siz değiştirene kadar sürer.</small>
        </div>

        <div class="form-group">
          <label>Fatura / Dönem</label>
          <InputText v-model="giderForm.period" placeholder="Örn: Temmuz 2026" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Gider Tarihi <span class="zorunlu-alan">*</span></label>
          <InputText type="date" v-model="giderForm.expense_date" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Vade / Son Ödeme Tarihi</label>
          <InputText type="date" v-model="giderForm.due_date" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Ödeme Durumu</label>
          <Dropdown v-model="giderForm.status" :options="['Ödenmedi', 'Ödendi']" style="width: 100%;" />
        </div>

        <div v-if="giderForm.status === 'Ödendi'" class="form-group">
          <label>Ödeme Tarihi <span class="zorunlu-alan">*</span></label>
          <InputText type="date" v-model="giderForm.payment_date" style="width: 100%;" />
        </div>

        <div v-if="giderForm.status === 'Ödendi'" class="form-group">
          <label>Ödeme Yöntemi <span class="zorunlu-alan">*</span></label>
          <Dropdown v-model="giderForm.payment_method" :options="['Nakit', 'Kart', 'Havale / EFT', 'Diğer']" style="width: 100%;" />
        </div>

        <div class="form-group">
          <label>Açıklama / Not</label>
          <InputText v-model="giderForm.note" placeholder="Ek not..." style="width: 100%;" />
        </div>
      </div>

      <template #footer>
        <Button label="İptal" icon="pi pi-times" text @click="giderFormDialog = false" />
        <Button label="Gideri Kaydet" icon="pi pi-check" severity="warning" :disabled="destekModu" @click="giderKaydet" />
      </template>
    </Dialog>

    <!-- MODAL 6: Seçili Cari Hesap Detayı / Geçmişi -->
    <Dialog
      v-model:visible="cariDetayDialog"
      :header="`${seciliCari?.name || ''} - Cari Hesap Detayı`"
      :style="{ width: '700px' }"
      modal
    >
      <div v-if="seciliCari" style="display: flex; flex-direction: column; gap: 16px;">
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; background: var(--bg-active-box); padding: 12px; border-radius: 8px; border: 1px solid var(--border-color);">
          <div><span style="color: var(--text-muted); font-size: 12px;">Toplam Borçlandırma:</span> <strong style="display: block; color: var(--text-title);">{{ tlFormatla(seciliCari.total_debt) }}</strong></div>
          <div><span style="color: var(--text-muted); font-size: 12px;">Yapılan Ödeme:</span> <strong style="display: block; color: #34d399;">{{ tlFormatla(seciliCari.total_paid) }}</strong></div>
          <div><span style="color: var(--text-muted); font-size: 12px;">Kalan Borcumuz:</span> <strong style="display: block; color: #f87171;">{{ tlFormatla(seciliCari.remaining_debt) }}</strong></div>
        </div>

        <h4 style="margin: 0; font-size: 14px; color: var(--text-title, #fff);">İşlem ve Ödeme Geçmişi</h4>
        
        <DataTable :value="islemVeOdemeGecmisi" class="p-datatable-sm" paginator :rows="8">
          <Column header="Tarih" style="width: 110px;">
            <template #body="slotProps">{{ tarihFormatla(slotProps.data.date) }}</template>
          </Column>
          <Column header="Tür" style="width: 140px;">
            <template #body="slotProps">
              <span :style="slotProps.data.transaction_type ? 'color: #f87171;' : 'color: #34d399;'">
                {{ slotProps.data.transaction_type || 'Ödeme (' + slotProps.data.payment_method + ')' }}
              </span>
            </template>
          </Column>
          <Column header="Açıklama">
            <template #body="slotProps">{{ slotProps.data.description || slotProps.data.note || '-' }}</template>
          </Column>
          <Column header="Tutar" style="text-align: right; width: 120px;">
            <template #body="slotProps">
              <strong>{{ tlFormatla(slotProps.data.amount) }}</strong>
            </template>
          </Column>
          <Column header="İşlem" style="width: 80px; text-align: center;">
            <template #body="slotProps">
              <Button
                icon="pi pi-trash"
                outlined
                rounded
                severity="danger"
                size="small"
                :disabled="destekModu"
                @click="slotProps.data.transaction_type ? cariIslemSil(slotProps.data) : cariOdemeSil(slotProps.data)"
              />
            </template>
          </Column>
        </DataTable>
      </div>

      <template #footer>
        <Button label="Sil" icon="pi pi-trash" severity="danger" text :disabled="destekModu" @click="cariHesapSil(seciliCari)" />
        <Button label="Düzenle" icon="pi pi-pencil" severity="secondary" :disabled="destekModu" @click="cariDuzenleAc(seciliCari)" />
        <Button label="Kapat" icon="pi pi-times" text @click="cariDetayDialog = false" />
        <Button label="Ekstre Yazdır" icon="pi pi-print" severity="info" @click="ekstreYazdir" />
      </template>
    </Dialog>
  </div>
</template>
