<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Toast from 'primevue/toast'
import { useToast } from 'primevue/usetoast'
import HelpButton from '../components/HelpButton.vue'

const toast = useToast()

const aktifUsta = ref(null)
const isAdmin = computed(() => {
  return aktifUsta.value?.role === 'admin' || String(aktifUsta.value?.id) === 'admin'
})

const kaydetYukleniyor = ref(false)
const yedekleniyor = ref(false)
const klasorAciliyor = ref(false)
const geriYukleniyor = ref(false)
const kontrolYukleniyor = ref(false)

const sonKontrolMesaji = ref(localStorage.getItem('sonKontrolMesaji') || 'Henüz yapılmadı')
const sonKontrolTarihi = ref(localStorage.getItem('sonKontrolTarihi') || '-')

const destekBilgileri = ref({
  dbPath: '',
  backupDir: '',
  dbSize: '0 B',
  musteriSayisi: 0,
  aracSayisi: 0,
  isEmriSayisi: 0,
  parcaSayisi: 0,
  lastBackupDate: 'Yapılmadı',
  lastBackupName: 'Yok',
  lastBackupSize: '0 B',
  appVersion: '1.0.0'
})

// ── Güncelleme ──────────────────────────────────────────────
const mevcutSurum = ref('1.0.0')
const guncellemeDenetleniyor = ref(false)
const guncellemeDurumu = ref({ durum: 'bilinmiyor', surum: '', yuzde: 0, hata: '', internetYok: false })

const guncellemeDurumMetni = computed(() => {
  const d = guncellemeDurumu.value
  switch (d.durum) {
    case 'denetleniyor': return 'Yeni sürüm denetleniyor...'
    case 'guncel': return 'Programınız güncel.'
    case 'indiriliyor': return `Yeni sürüm indiriliyor: %${d.yuzde || 0}`
    case 'hazir': return `Sürüm ${d.surum || ''} indirildi. Yeniden başlatınca kurulacak.`
    // Metin main process'te Türkçeleştiriliyor; ham İngilizce hata yalnızca log dosyasına yazılır.
    case 'hata': return d.hata || 'Güncelleme denetlenemedi. İnternet bağlantısını kontrol edin.'
    default: return 'Son denetim yapılmadı.'
  }
})

const guncellemeleriDenetle = async () => {
  if (!window.api?.guncellemeDenetle) return
  guncellemeDenetleniyor.value = true

  try {
    const res = await window.api.guncellemeDenetle()
    if (res?.gelistirmeModu) {
      toast.add({
        severity: 'info',
        summary: 'Güncelleme',
        detail: 'Güncelleme denetimi yalnızca kurulu uygulamada çalışır.',
        life: 4000
      })
    } else if (!res?.success) {
      // İnternet yokluğu bir arıza değil; kırmızı hata yerine sade bir bilgi gösterilir.
      toast.add({
        severity: res?.internetYok ? 'info' : 'warn',
        summary: res?.internetYok ? 'İnternet Yok' : 'Güncelleme',
        detail: res?.error || 'Güncelleme denetlenemedi.',
        life: 4000
      })
    }
  } catch (e) {
    console.error('Güncelleme denetimi hatası:', e)
  } finally {
    guncellemeDenetleniyor.value = false
  }
}

const guncellemeyiKur = async () => {
  const res = await window.api?.guncellemeyiKur?.()
  if (!res?.success) {
    toast.add({
      severity: 'error',
      summary: 'Güncelleme',
      detail: res?.error || 'Güncelleme kurulamadı.',
      life: 4000
    })
  }
}

const orijinalAyarlar = ref({})

const ayarlarForm = reactive({
  theme: 'dark',
  list_density: 'normal',
  work_orders_default_filter: 'Açık',
  show_critical_stock_warnings: true,
  show_long_open_workorder_warnings: true,
  long_open_workorder_days: '10',
  phone_server_auto_start: false,
  default_payment_method: 'Nakit',
  ask_payment_on_completion: true,
  warn_unpaid_completion: true,
  show_payment_summary_on_receipt: false,
  automatic_backup_enabled: false,
  backup_on_exit: false,
  backup_retention_count: '0',
  weather_city: 'Ankara'
})

const pinForm = reactive({
  eskiPin: '',
  yeniPin: '',
  yeniPinTekrar: ''
})

const adminPinForm = reactive({
  eskiPin: '',
  yeniPin: '',
  yeniPinTekrar: ''
})

// Options lists
const temaOptions = [
  { label: 'Koyu Tema', value: 'dark' },
  { label: 'Açık Tema', value: 'light' }
]

const yogunlukOptions = [
  { label: 'Kompakt Görünüm', value: 'compact' },
  { label: 'Normal Görünüm', value: 'normal' },
  { label: 'Rahat Görünüm', value: 'comfortable' }
]

watch(() => ayarlarForm.list_density, (yeniYogunluk) => {
  if (yeniYogunluk) {
    document.documentElement.setAttribute('data-density', yeniYogunluk)
  }
})

const filtreOptions = [
  { label: 'Açık İş Emirleri', value: 'Açık' },
  { label: 'Bekleyen İş Emirleri', value: 'Beklemede' },
  { label: 'Hepsi (Tümü)', value: 'Tümü' }
]

const odemeOptions = [
  { label: 'Nakit', value: 'Nakit' },
  { label: 'Kart', value: 'Kart' },
  { label: 'Havale / EFT', value: 'Havale/EFT' },
  { label: 'Diğer', value: 'Diğer' }
]

const retentionOptions = [
  { label: 'Son 10 yedek', value: '10' },
  { label: 'Son 20 yedek', value: '20' },
  { label: 'Son 30 yedek', value: '30' },
  { label: 'Sınırsız (Silme Yapma)', value: '0' }
]

// Elle girilen eşik günü boş/geçersiz/aralık dışı olabilir; 1-90 arasına kırpar
const esikGunTemizle = (deger) => String(Math.min(90, Math.max(1, Number(deger) || 10)))

const isDirty = computed(() => {
  if (!orijinalAyarlar.value || Object.keys(orijinalAyarlar.value).length === 0) return false
  const snapshot = {
    theme: ayarlarForm.theme,
    list_density: ayarlarForm.list_density,
    work_orders_default_filter: ayarlarForm.work_orders_default_filter,
    show_critical_stock_warnings: String(ayarlarForm.show_critical_stock_warnings),
    show_long_open_workorder_warnings: String(ayarlarForm.show_long_open_workorder_warnings),
    long_open_workorder_days: esikGunTemizle(ayarlarForm.long_open_workorder_days),
    phone_server_auto_start: String(ayarlarForm.phone_server_auto_start),
    default_payment_method: ayarlarForm.default_payment_method,
    ask_payment_on_completion: String(ayarlarForm.ask_payment_on_completion),
    warn_unpaid_completion: String(ayarlarForm.warn_unpaid_completion),
    show_payment_summary_on_receipt: String(ayarlarForm.show_payment_summary_on_receipt),
    automatic_backup_enabled: String(ayarlarForm.automatic_backup_enabled),
    backup_on_exit: String(ayarlarForm.backup_on_exit),
    backup_retention_count: String(ayarlarForm.backup_retention_count),
    weather_city: String(ayarlarForm.weather_city || 'Ankara').trim() || 'Ankara'
  }
  return JSON.stringify(snapshot) !== JSON.stringify(orijinalAyarlar.value)
})

const ayarlarYukle = async () => {
  if (!window.api?.ayarlariGetir) return
  try {
    const res = await window.api.ayarlariGetir()
    if (res?.success && res.settings) {
      const s = res.settings
      orijinalAyarlar.value = { ...s }
      ayarlarForm.theme = s.theme || 'dark'
      ayarlarForm.list_density = s.list_density || 'normal'
      ayarlarForm.work_orders_default_filter = s.work_orders_default_filter || 'Açık'
      ayarlarForm.show_critical_stock_warnings = s.show_critical_stock_warnings !== 'false'
      ayarlarForm.show_long_open_workorder_warnings = s.show_long_open_workorder_warnings !== 'false'
      ayarlarForm.long_open_workorder_days = s.long_open_workorder_days || '10'
      ayarlarForm.phone_server_auto_start = s.phone_server_auto_start === 'true'
      ayarlarForm.default_payment_method = s.default_payment_method || 'Nakit'
      ayarlarForm.ask_payment_on_completion = s.ask_payment_on_completion !== 'false'
      ayarlarForm.warn_unpaid_completion = s.warn_unpaid_completion !== 'false'
      ayarlarForm.show_payment_summary_on_receipt = s.show_payment_summary_on_receipt === 'true'
      ayarlarForm.automatic_backup_enabled = s.automatic_backup_enabled === 'true'
      ayarlarForm.backup_on_exit = s.backup_on_exit === 'true'
      ayarlarForm.backup_retention_count = s.backup_retention_count || '0'
      ayarlarForm.weather_city = s.weather_city || 'Ankara'

      // Apply theme & density live
      document.documentElement.setAttribute('data-theme', ayarlarForm.theme)
      document.documentElement.style.colorScheme = ayarlarForm.theme
      if (ayarlarForm.theme === 'dark') document.documentElement.classList.add('p-dark')
      else document.documentElement.classList.remove('p-dark')

      document.documentElement.setAttribute('data-density', ayarlarForm.list_density)
    }
  } catch (err) {
    console.error('Ayarları yükleme hatası:', err)
  }
}

const tercihleriKaydet = async () => {
  if (kaydetYukleniyor.value) return
  kaydetYukleniyor.value = true

  const payload = {
    theme: ayarlarForm.theme,
    list_density: ayarlarForm.list_density,
    work_orders_default_filter: ayarlarForm.work_orders_default_filter,
    show_critical_stock_warnings: String(ayarlarForm.show_critical_stock_warnings),
    show_long_open_workorder_warnings: String(ayarlarForm.show_long_open_workorder_warnings),
    long_open_workorder_days: esikGunTemizle(ayarlarForm.long_open_workorder_days),
    phone_server_auto_start: String(ayarlarForm.phone_server_auto_start),
    default_payment_method: ayarlarForm.default_payment_method,
    ask_payment_on_completion: String(ayarlarForm.ask_payment_on_completion),
    warn_unpaid_completion: String(ayarlarForm.warn_unpaid_completion),
    show_payment_summary_on_receipt: String(ayarlarForm.show_payment_summary_on_receipt),
    automatic_backup_enabled: String(ayarlarForm.automatic_backup_enabled),
    backup_on_exit: String(ayarlarForm.backup_on_exit),
    backup_retention_count: String(ayarlarForm.backup_retention_count),
    weather_city: String(ayarlarForm.weather_city || 'Ankara').trim() || 'Ankara'
  }

  const oncekiSehir = String(orijinalAyarlar.value?.weather_city || '').trim()

  try {
    const res = await window.api.ayarlariKaydet(payload)
    if (res?.success) {
      orijinalAyarlar.value = { ...payload }
      localStorage.setItem('uygulamaTema', ayarlarForm.theme)

      document.documentElement.setAttribute('data-theme', ayarlarForm.theme)
      document.documentElement.style.colorScheme = ayarlarForm.theme
      if (ayarlarForm.theme === 'dark') document.documentElement.classList.add('p-dark')
      else document.documentElement.classList.remove('p-dark')

      document.documentElement.setAttribute('data-density', ayarlarForm.list_density)

      toast.add({
        severity: 'success',
        summary: 'Başarılı',
        detail: 'Ayarlar kaydedildi.',
        life: 3000
      })

      // Şehir değiştiyse hemen dene: bulunduysa şeridi güncelle, bulunamadıysa söyle
      if (payload.weather_city !== oncekiSehir && window.api?.havaDurumuGetir) {
        try {
          const havaRes = await window.api.havaDurumuGetir()
          if (havaRes?.success) {
            toast.add({
              severity: 'info',
              summary: 'Hava Durumu',
              detail: `${havaRes.sehir}: ${havaRes.sicaklik}°C, ${havaRes.durum}. Bilgi şeridi güncellendi.`,
              life: 4000
            })
            window.dispatchEvent(new CustomEvent('hava-durumu-yenile'))
          } else {
            toast.add({
              severity: 'warn',
              summary: 'Hava Durumu',
              detail: havaRes?.error || `"${payload.weather_city}" şehri bulunamadı. Yazımı kontrol edin.`,
              life: 5000
            })
          }
        } catch (e) {
          console.error('Hava durumu denemesi hatası:', e)
        }
      }
    } else {
      toast.add({
        severity: 'error',
        summary: 'Hata',
        detail: res?.error || 'Ayarlar kaydedilemedi.',
        life: 4000
      })
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hata',
      detail: 'Ayarlar kaydedilirken hata oluştu.',
      life: 4000
    })
  } finally {
    kaydetYukleniyor.value = false
  }
}

const pinTemizle = (val) => String(val || '').replace(/\D/g, '').slice(0, 4)

const pinDegistir = async () => {
  pinForm.eskiPin = pinTemizle(pinForm.eskiPin)
  pinForm.yeniPin = pinTemizle(pinForm.yeniPin)
  pinForm.yeniPinTekrar = pinTemizle(pinForm.yeniPinTekrar)

  if (isAdmin.value) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Admin PIN kodunu Admin PIN bölümünden değiştirin.', life: 3000 })
    return
  }
  if (!aktifUsta.value?.id) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Aktif usta oturumu bulunamadı.', life: 3000 })
    return
  }
  if (pinForm.eskiPin.length !== 4 || pinForm.yeniPin.length !== 4) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'PIN 4 haneli olmalıdır.', life: 3000 })
    return
  }
  if (pinForm.yeniPin !== pinForm.yeniPinTekrar) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Yeni PIN tekrarı uyuşmuyor.', life: 3000 })
    return
  }

  const res = await window.api.ustaPinDegistir({
    master_id: aktifUsta.value.id,
    eski_pin: pinForm.eskiPin,
    yeni_pin: pinForm.yeniPin
  })

  if (res?.success) {
    toast.add({ severity: 'success', summary: 'Başarılı', detail: 'PIN başarıyla değiştirildi.', life: 3000 })
    Object.assign(pinForm, { eskiPin: '', yeniPin: '', yeniPinTekrar: '' })
  } else {
    toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'PIN değiştirilemedi.', life: 4000 })
  }
}

const adminPinDegistir = async () => {
  adminPinForm.eskiPin = pinTemizle(adminPinForm.eskiPin)
  adminPinForm.yeniPin = pinTemizle(adminPinForm.yeniPin)
  adminPinForm.yeniPinTekrar = pinTemizle(adminPinForm.yeniPinTekrar)

  if (adminPinForm.eskiPin.length !== 4 || adminPinForm.yeniPin.length !== 4) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'PIN 4 haneli olmalıdır.', life: 3000 })
    return
  }
  if (adminPinForm.yeniPin !== adminPinForm.yeniPinTekrar) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Yeni PIN tekrarı uyuşmuyor.', life: 3000 })
    return
  }

  const res = await window.api.adminPinDegistir({
    eski_pin: adminPinForm.eskiPin,
    yeni_pin: adminPinForm.yeniPin
  })

  if (res?.success) {
    toast.add({ severity: 'success', summary: 'Başarılı', detail: 'Admin PIN başarıyla değiştirildi.', life: 3000 })
    Object.assign(adminPinForm, { eskiPin: '', yeniPin: '', yeniPinTekrar: '' })
  } else {
    toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Admin PIN değiştirilemedi.', life: 4000 })
  }
}

const yedeklerListesi = ref([])
const seciliYedekDosyasi = ref(null)

const yedekleriYukle = async () => {
  if (!isAdmin.value || !window.api?.yedekleriListele) return
  try {
    const res = await window.api.yedekleriListele()
    if (res?.success) {
      yedeklerListesi.value = res.backups || []
    }
  } catch (err) {
    console.error('Yedekler listesi yüklenemedi:', err)
  }
}

const veritabaniYedekle = async () => {
  if (yedekleniyor.value) return
  yedekleniyor.value = true
  try {
    const res = await window.api.veritabaniYedekle()
    if (res?.success) {
      toast.add({ severity: 'success', summary: 'Yedeklendi', detail: `Veritabanı yedeklendi.`, life: 4000 })
      await destekBilgileriniYukle()
      await yedekleriYukle()
    } else {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Yedekleme başarısız.', life: 4000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Yedekleme hatası.', life: 4000 })
  } finally {
    yedekleniyor.value = false
  }
}

const yedekKlasorunuAc = async () => {
  if (klasorAciliyor.value) return
  klasorAciliyor.value = true
  try {
    const res = await window.api.yedekKlasorunuAc()
    if (!res?.success) {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Klasör açılamadı.', life: 3000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Klasör açma hatası.', life: 3000 })
  } finally {
    klasorAciliyor.value = false
  }
}

const yedektenGeriYukle = async () => {
  const onay = confirm(
    'Yedekten geri yükleme yapılacak.\n\n' +
    'Mevcut verileriniz geri yükleme öncesinde otomatik yedeklenecek.\n' +
    'Devam etmek istiyor musunuz?'
  )
  if (!onay) return

  geriYukleniyor.value = true
  try {
    const res = await window.api.yedektenGeriYukle()
    if (res?.success) {
      toast.add({ severity: 'success', summary: 'Geri Yüklendi', detail: 'Yedek başarıyla geri yüklendi.', life: 4000 })
      window.dispatchEvent(new CustomEvent('app-data-refreshed'))
      await destekBilgileriniYukle()
      await yedekleriYukle()
    } else if (!res?.cancelled) {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Geri yükleme başarısız.', life: 4000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Geri yükleme sırasında hata oluştu.', life: 4000 })
  } finally {
    geriYukleniyor.value = false
  }
}

const yedekListesindenYukle = async () => {
  if (!seciliYedekDosyasi.value) {
    toast.add({ severity: 'warn', summary: 'Uyarı', detail: 'Lütfen listeden bir yedek dosyası seçin.', life: 3000 })
    return
  }

  const onay = confirm(
    'Seçilen yedek veritabanı geri yüklenecektir.\n\n' +
    'Mevcut verileriniz geri yükleme öncesinde otomatik yedeklenecek.\n' +
    'Devam etmek istiyor musunuz?'
  )
  if (!onay) return

  geriYukleniyor.value = true
  try {
    const res = await window.api.yedektenGeriYukle(seciliYedekDosyasi.value)
    if (res?.success) {
      toast.add({ severity: 'success', summary: 'Geri Yüklendi', detail: 'Yedek başarıyla geri yüklendi.', life: 4000 })
      window.dispatchEvent(new CustomEvent('app-data-refreshed'))
      await destekBilgileriniYukle()
      await yedekleriYukle()
    } else if (!res?.cancelled) {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Geri yükleme başarısız.', life: 4000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Geri yükleme sırasında hata oluştu.', life: 4000 })
  } finally {
    geriYukleniyor.value = false
  }
}

const veritabaniKontrolEt = async () => {
  if (kontrolYukleniyor.value) return
  kontrolYukleniyor.value = true
  try {
    const res = await window.api.veritabaniKontrolEt()
    const nowStr = new Date().toLocaleString('tr-TR')
    sonKontrolTarihi.value = nowStr
    localStorage.setItem('sonKontrolTarihi', nowStr)
    if (res?.success) {
      sonKontrolMesaji.value = 'Veritabanı bütünlük kontrolü başarılı (ok)'
      localStorage.setItem('sonKontrolMesaji', sonKontrolMesaji.value)
      toast.add({ severity: 'success', summary: 'Bütünlük Başarılı', detail: res.message || 'Veritabanı kontrolü başarılı.', life: 4000 })
    } else {
      sonKontrolMesaji.value = res?.message || 'Veritabanı bütünlük kontrolü başarısız'
      localStorage.setItem('sonKontrolMesaji', sonKontrolMesaji.value)
      toast.add({ severity: 'error', summary: 'Bütünlük Hatası', detail: res?.message || 'Bütünlük kontrolü başarısız.', life: 6000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Veritabanı kontrol edilemedi.', life: 4000 })
  } finally {
    kontrolYukleniyor.value = false
  }
}

const verileriYenileBtn = async () => {
  try {
    const res = await window.api.uygulamaVerileriniYenile()
    if (res?.success) {
      toast.add({ severity: 'success', summary: 'Yenilendi', detail: res.message || 'Veriler başarıyla yenilendi.', life: 3000 })
      window.dispatchEvent(new CustomEvent('app-data-refreshed'))
      await destekBilgileriniYukle()
    } else {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.message || 'Yenileme başarısız.', life: 4000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Veriler yenilenemedi.', life: 4000 })
  }
}

const sifirlaniyor = ref(false)

const veritabaniSifirla = async () => {
  if (sifirlaniyor.value) return

  const onay1 = confirm(
    'TÜM VERİLER SİLİNECEK!\n\n' +
    'Müşteriler, araçlar, iş emirleri, stok, cari hesaplar, giderler, ' +
    'ayarlar ve araç fotoğrafları dahil her şey varsayılana dönecek.\n\n' +
    'Sıfırlamadan önce otomatik bir güvenlik yedeği alınacak ' +
    '(gerekirse Yedekten Kurtarma Sihirbazı ile geri dönebilirsiniz).\n\n' +
    'Devam etmek istiyor musunuz?'
  )
  if (!onay1) return

  const onay2 = confirm(
    'SON UYARI - Emin misiniz?\n\n' +
    'Bu işlem geri alınamaz. Onaylarsanız veritabanı fabrika ayarlarına ' +
    'sıfırlanacak ve uygulama yeniden başlatılacak.'
  )
  if (!onay2) return

  sifirlaniyor.value = true
  try {
    const res = await window.api.veritabaniSifirla()
    if (res?.success) {
      toast.add({ severity: 'success', summary: 'Sıfırlandı', detail: 'Veritabanı sıfırlandı. Uygulama yeniden başlatılıyor...', life: 4000 })
    } else {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Sıfırlama başarısız.', life: 6000 })
      sifirlaniyor.value = false
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Sıfırlama sırasında hata oluştu.', life: 6000 })
    sifirlaniyor.value = false
  }
}

const logKlasoruAc = async () => {
  try {
    const res = await window.api.logKlasoruAc()
    if (!res?.success) {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'Log klasörü açılamadı.', life: 3000 })
    }
  } catch (err) {
    toast.add({ severity: 'error', summary: 'Hata', detail: 'Log klasörü açılamadı.', life: 3000 })
  }
}

const destekBilgileriniYukle = async () => {
  if (!isAdmin.value || !window.api?.destekSistemBilgileriGetir) return
  try {
    const res = await window.api.destekSistemBilgileriGetir()
    if (res?.success && res.bilgiler) {
      destekBilgileri.value = { ...destekBilgileri.value, ...res.bilgiler }
    }
  } catch (err) {
    console.error('Destek bilgileri yüklenemedi:', err)
  }
}

onMounted(async () => {
  aktifUsta.value = JSON.parse(localStorage.getItem('aktifUsta') || 'null')
  await ayarlarYukle()

  if (window.api?.guncellemeDurumGetir) {
    try {
      const res = await window.api.guncellemeDurumGetir()
      if (res?.success) {
        mevcutSurum.value = res.mevcutSurum || mevcutSurum.value
        guncellemeDurumu.value = res
      }
    } catch (e) {}
  }

  if (window.api?.onGuncellemeDurumu) {
    const unbind = window.api.onGuncellemeDurumu((durum) => {
      guncellemeDurumu.value = durum || { durum: 'bilinmiyor' }
    })
    onUnmounted(unbind)
  }

  if (isAdmin.value) {
    await destekBilgileriniYukle()
    await yedekleriYukle()
  }
})
</script>

<template>
  <div class="page settings-page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Ayarlar <HelpButton konu="pinler" /></h1>
        <p class="page-subtitle">
          Görünüm, kullanım tercihleri ve sistem ayarlarınızı buradan yönetin.
        </p>
      </div>

      <div class="header-save-wrapper">
        <Button
          label="Tercihleri Kaydet"
          icon="pi pi-check"
          severity="success"
          :disabled="!isDirty"
          :loading="kaydetYukleniyor"
          @click="tercihleriKaydet"
        />
      </div>
    </div>

    <div class="settings-grid">
      <!-- 1. GENEL BİLGİLER -->
      <div class="settings-card panel">
        <div class="card-header">
          <div class="card-header-title">
            <i class="pi pi-info-circle card-icon icon-blue"></i>
            <h2>Genel Bilgiler</h2>
          </div>
        </div>

        <div class="compact-info-row">
          <div class="info-item">
            <span class="info-label">Uygulama</span>
            <span class="info-val">Kâtip</span>
          </div>
          <div class="info-item">
            <span class="info-label">Tür</span>
            <span class="info-val">Oto Servis Takip Sistemi</span>
          </div>
          <div class="info-item">
            <span class="info-label">Uyarı</span>
            <span class="info-val text-amber">Bu uygulama fatura kesmez.</span>
          </div>
        </div>
      </div>

      <!-- 1b. GÜNCELLEME (herkes görür: destek sırasında telefonla yönlendirilebilsin) -->
      <div class="settings-card panel">
        <div class="card-header">
          <div class="card-header-title">
            <i class="pi pi-cloud-download card-icon icon-blue"></i>
            <div>
              <h2>Güncelleme</h2>
              <div class="card-subtitle">Yeni sürüm denetimi ve kurulum</div>
            </div>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-name">Kurulu Sürüm</div>
            <div class="setting-desc">{{ guncellemeDurumMetni }}</div>
          </div>
          <div class="setting-control">
            <span class="info-val">{{ mevcutSurum }}</span>
          </div>
        </div>

        <div class="setting-row border-none">
          <div class="setting-info">
            <div class="setting-name">Yeni Sürüm Var mı?</div>
            <div class="setting-desc">
              Program açılışta kendiliğinden denetler. Buradan elle de denetleyebilirsiniz.
            </div>
          </div>
          <div class="setting-control" style="display: flex; gap: 8px;">
            <Button
              label="Güncellemeleri Denetle"
              icon="pi pi-sync"
              severity="secondary"
              outlined
              size="small"
              :loading="guncellemeDenetleniyor"
              @click="guncellemeleriDenetle"
            />
            <Button
              v-if="guncellemeDurumu.durum === 'hazir'"
              label="Şimdi Yeniden Başlat"
              icon="pi pi-refresh"
              size="small"
              @click="guncellemeyiKur"
            />
          </div>
        </div>
      </div>

      <!-- 2. GÖRÜNÜM VE KULLANIM -->
      <div class="settings-card panel">
        <div class="card-header">
          <div class="card-header-title">
            <i class="pi pi-desktop card-icon icon-blue"></i>
            <h2>Görünüm ve Kullanım</h2>
          </div>
        </div>

        <div class="setting-row" :class="{ 'border-none': !isAdmin }">
          <div class="setting-info">
            <div class="setting-name">Tema</div>
            <div class="setting-desc">Arayüz renk teması tercihi</div>
          </div>
          <div class="setting-control">
            <Dropdown
              v-model="ayarlarForm.theme"
              :options="temaOptions"
              optionLabel="label"
              optionValue="value"
              class="compact-dropdown"
            />
          </div>
        </div>

        <template v-if="isAdmin">
          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Liste Yoğunluğu</div>
              <div class="setting-desc">Listelerde satır yüksekliği ve boşluk seviyesi</div>
            </div>
            <div class="setting-control">
              <Dropdown
                v-model="ayarlarForm.list_density"
                :options="yogunlukOptions"
                optionLabel="label"
                optionValue="value"
                class="compact-dropdown"
              />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Hava Durumu Şehri</div>
              <div class="setting-desc">Sol alttaki bilgi şeridinde hava durumu gösterilecek şehir</div>
            </div>
            <div class="setting-control">
              <InputText
                v-model="ayarlarForm.weather_city"
                placeholder="Örn: Ankara"
                style="width: 160px;"
              />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">İş Emirleri Açılış Filtresi</div>
              <div class="setting-desc">İş Emirleri ekranı açıldığında varsayılan süzgeç</div>
            </div>
            <div class="setting-control">
              <Dropdown
                v-model="ayarlarForm.work_orders_default_filter"
                :options="filtreOptions"
                optionLabel="label"
                optionValue="value"
                class="compact-dropdown"
              />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Kritik Stok Uyarıları</div>
              <div class="setting-desc">Stok seviyesi kritik parçalar için uyarılama ve gösterimler</div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" v-model="ayarlarForm.show_critical_stock_warnings" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Uzun Süredir Açık İş Emri Uyarısı</div>
              <div class="setting-desc">Belirtilen süreden uzun süredir açık kalan iş emirleri için Ana Sayfa'da uyarı göster</div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" v-model="ayarlarForm.show_long_open_workorder_warnings" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row" v-if="ayarlarForm.show_long_open_workorder_warnings">
            <div class="setting-info">
              <div class="setting-name">Uyarı Eşiği</div>
              <div class="setting-desc">İş emri kaç gündür açıksa uyarı gösterilsin</div>
            </div>
            <div class="setting-control">
              <InputText
                type="number"
                min="1"
                max="90"
                v-model="ayarlarForm.long_open_workorder_days"
                class="compact-dropdown"
                style="width: 80px; text-align: center;"
              />
            </div>
          </div>

          <div class="setting-row border-none">
            <div class="setting-info">
              <div class="setting-name">Telefon Erişimini Otomatik Başlat</div>
              <div class="setting-desc">Uygulama açılışında mobil bağlantı sunucusunu otomatik başlat</div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" v-model="ayarlarForm.phone_server_auto_start" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>
        </template>
      </div>

      <!-- 3. İŞ EMRİ VE ÖDEME -->
      <div class="settings-card panel" v-if="isAdmin">
        <div class="card-header">
          <div class="card-header-title">
            <i class="pi pi-wallet card-icon icon-blue"></i>
            <h2>İş Emri ve Ödeme</h2>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-name">Varsayılan Ödeme Yöntemi</div>
            <div class="setting-desc">Yeni ödeme ekranlarında ilk seçili gelen ödeme kanalı</div>
          </div>
          <div class="setting-control">
            <Dropdown
              v-model="ayarlarForm.default_payment_method"
              :options="odemeOptions"
              optionLabel="label"
              optionValue="value"
              class="compact-dropdown"
            />
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-name">İş Emri Tamamlanırken Ödeme Durumunu Sor</div>
            <div class="setting-desc">Tamamlama aşamasında tahsilat/veresiye durumu seçeneğini göster</div>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input type="checkbox" v-model="ayarlarForm.ask_payment_on_completion" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-row">
          <div class="setting-info">
            <div class="setting-name">Ödenmemiş İş Emri Uyarısı</div>
            <div class="setting-desc">Kalan borcu bulunan iş emri kapatılırken uyarı mesajı görüntüle</div>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input type="checkbox" v-model="ayarlarForm.warn_unpaid_completion" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>

        <div class="setting-row border-none">
          <div class="setting-info">
            <div class="setting-name">Servis Fişinde Ödeme Özeti</div>
            <div class="setting-desc">Yazdırılan fişte ödeme detayları kutusunu göster</div>
          </div>
          <div class="setting-control">
            <label class="toggle-switch">
              <input type="checkbox" v-model="ayarlarForm.show_payment_summary_on_receipt" />
              <span class="toggle-slider"></span>
            </label>
          </div>
        </div>
      </div>

      <!-- 4. PIN DEĞİŞTİR -->
      <div class="settings-card panel">
        <div class="card-header">
          <div class="card-header-title">
            <i class="pi pi-key card-icon icon-amber"></i>
            <h2>PIN Değiştir</h2>
          </div>
        </div>

        <!-- Normal Usta PIN Formu -->
        <div v-if="!isAdmin">
          <div class="active-user-badge mb-12">
            <strong>Aktif Oturum:</strong> {{ aktifUsta?.name || 'Usta' }}
          </div>

          <div class="pin-form-grid">
            <div class="form-group">
              <label>Eski PIN</label>
              <InputText
                v-model="pinForm.eskiPin"
                type="password"
                maxlength="4"
                placeholder="4 hane"
                @input="pinForm.eskiPin = pinTemizle(pinForm.eskiPin)"
              />
            </div>

            <div class="form-group">
              <label>Yeni PIN</label>
              <InputText
                v-model="pinForm.yeniPin"
                type="password"
                maxlength="4"
                placeholder="4 hane"
                @input="pinForm.yeniPin = pinTemizle(pinForm.yeniPin)"
              />
            </div>

            <div class="form-group">
              <label>Yeni PIN Tekrar</label>
              <InputText
                v-model="pinForm.yeniPinTekrar"
                type="password"
                maxlength="4"
                placeholder="4 hane"
                @input="pinForm.yeniPinTekrar = pinTemizle(pinForm.yeniPinTekrar)"
              />
            </div>

            <div class="form-group form-btn-align">
              <Button
                label="PIN Değiştir"
                icon="pi pi-key"
                severity="warning"
                size="small"
                @click="pinDegistir"
              />
            </div>
          </div>
        </div>

        <!-- Admin PIN Formu -->
        <div v-else>
          <div class="active-user-badge admin-badge mb-12">
            <strong>Aktif Destek Yetkilisi:</strong> Alican Kala
          </div>

          <div class="pin-form-grid">
            <div class="form-group">
              <label>Eski Admin PIN</label>
              <InputText
                v-model="adminPinForm.eskiPin"
                type="password"
                maxlength="4"
                placeholder="4 hane"
                @input="adminPinForm.eskiPin = pinTemizle(adminPinForm.eskiPin)"
              />
            </div>

            <div class="form-group">
              <label>Yeni Admin PIN</label>
              <InputText
                v-model="adminPinForm.yeniPin"
                type="password"
                maxlength="4"
                placeholder="4 hane"
                @input="adminPinForm.yeniPin = pinTemizle(adminPinForm.yeniPin)"
              />
            </div>

            <div class="form-group">
              <label>Yeni Admin PIN Tekrar</label>
              <InputText
                v-model="adminPinForm.yeniPinTekrar"
                type="password"
                maxlength="4"
                placeholder="4 hane"
                @input="adminPinForm.yeniPinTekrar = pinTemizle(adminPinForm.yeniPinTekrar)"
              />
            </div>

            <div class="form-group form-btn-align">
              <Button
                label="Admin PIN Değiştir"
                icon="pi pi-key"
                severity="warning"
                size="small"
                @click="adminPinDegistir"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- DESTEK MODU BÖLÜMLERİ (Yalnızca Admin/Destek Modunda Görünür) -->
      <template v-if="isAdmin">
        <!-- 5. YEDEKLEME VE SİSTEM -->
        <div class="settings-card panel admin-section">
          <div class="card-header">
            <div class="card-header-title">
              <i class="pi pi-database card-icon icon-green"></i>
              <div>
                <h2>Yedekleme ve Sistem</h2>
                <div class="card-subtitle">Yedek alma, geri yükleme ve saklama kuralları</div>
              </div>
            </div>
          </div>

          <div class="action-btn-group mb-16">
            <Button
              label="Verileri Yedekle"
              icon="pi pi-download"
              severity="success"
              size="small"
              :loading="yedekleniyor"
              @click="veritabaniYedekle"
            />

            <Button
              label="Yedek Klasörünü Aç"
              icon="pi pi-folder-open"
              severity="secondary"
              outlined
              size="small"
              :loading="klasorAciliyor"
              @click="yedekKlasorunuAc"
            />

            <Button
              label="Yedekten Geri Yükle"
              icon="pi pi-upload"
              severity="warning"
              outlined
              size="small"
              :loading="geriYukleniyor"
              @click="yedektenGeriYukle"
            />
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Otomatik Yedekleme</div>
              <div class="setting-desc">Açılışta otomatik arkaplan yedeği al</div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" v-model="ayarlarForm.automatic_backup_enabled" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Uygulama Kapanırken Yedek Al</div>
              <div class="setting-desc">Uygulama kapatılırken otomatik yedek oluştur</div>
            </div>
            <div class="setting-control">
              <label class="toggle-switch">
                <input type="checkbox" v-model="ayarlarForm.backup_on_exit" />
                <span class="toggle-slider"></span>
              </label>
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-info">
              <div class="setting-name">Saklanacak Yedek Sayısı</div>
              <div class="setting-desc">Eski otomatik yedeklerin temizlenme sınırı (Manuel yedekler silinmez)</div>
            </div>
            <div class="setting-control">
              <Dropdown
                v-model="ayarlarForm.backup_retention_count"
                :options="retentionOptions"
                optionLabel="label"
                optionValue="value"
                class="compact-dropdown"
              />
            </div>
          </div>

          <div class="compact-info-row mt-12">
            <div class="info-item">
              <span class="info-label">Son Başarılı Yedek</span>
              <span class="info-val">{{ destekBilgileri.lastBackupDate }}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Son Yedek Dosyası</span>
              <span class="info-val font-mono">{{ destekBilgileri.lastBackupName }} ({{ destekBilgileri.lastBackupSize }})</span>
            </div>
            <div class="info-item">
              <span class="info-label">Yedek Klasörü</span>
              <span class="info-val font-mono break-all">{{ destekBilgileri.backupDir }}</span>
            </div>
          </div>

          <!-- Yedekten Kurtarma Sihirbazı -->
          <div style="border-top: 1px dashed var(--border-color, #334155); padding-top: 16px; margin-top: 16px;">
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 0.9rem; color: var(--text-title, #fff);">Yedekten Kurtarma Sihirbazı</div>
            <div style="color: var(--text-muted, #94a3b8); font-size: 0.8rem; margin-bottom: 12px; line-height: 1.4;">
              Aşağıdaki listeden geri dönmek istediğiniz geçmiş bir yedek paketini seçip doğrudan geri yükleyebilirsiniz.
            </div>

            <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
              <Dropdown
                v-model="seciliYedekDosyasi"
                :options="yedeklerListesi"
                optionLabel="name"
                optionValue="path"
                placeholder="Geri yüklenecek yedek dosyasını seçin"
                style="flex: 1; min-width: 280px;"
                class="compact-dropdown"
              >
                <template #option="slotProps">
                  <div style="display: flex; flex-direction: column; gap: 2px; padding: 4px 0;">
                    <div style="font-size: 0.85rem; font-weight: 500; word-break: break-all; color: var(--text-title, #fff);">{{ slotProps.option.name }}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted, #94a3b8);">Tarih: {{ slotProps.option.date }} | Boyut: {{ slotProps.option.size }}</div>
                  </div>
                </template>
              </Dropdown>

              <Button
                label="Seçili Yedeği Yükle"
                icon="pi pi-history"
                severity="danger"
                size="small"
                :loading="geriYukleniyor"
                :disabled="!seciliYedekDosyasi"
                @click="yedekListesindenYukle"
              />
            </div>
          </div>
        </div>

        <!-- 6. VERİTABANI VE BAKIM -->
        <div class="settings-card panel admin-section">
          <div class="card-header">
            <div class="card-header-title">
              <i class="pi pi-cog card-icon icon-green"></i>
              <div>
                <h2>Veritabanı ve Bakım</h2>
                <div class="card-subtitle">Bütünlük denetimi, veri yenileme ve log kontrolleri</div>
              </div>
            </div>
          </div>

          <div class="action-btn-group mb-16">
            <Button
              label="Veritabanını Kontrol Et"
              icon="pi pi-shield"
              severity="info"
              size="small"
              :loading="kontrolYukleniyor"
              @click="veritabaniKontrolEt"
            />

            <Button
              label="Verileri Yenile"
              icon="pi pi-refresh"
              severity="secondary"
              outlined
              size="small"
              @click="verileriYenileBtn"
            />

            <Button
              label="Log Klasörünü Aç"
              icon="pi pi-file"
              severity="secondary"
              outlined
              size="small"
              @click="logKlasoruAc"
            />
          </div>

          <div class="sys-metrics-grid">
            <div class="metric-card">
              <div class="metric-num">{{ destekBilgileri.dbSize }}</div>
              <div class="metric-lbl">Veritabanı Boyutu</div>
            </div>
            <div class="metric-card">
              <div class="metric-num">{{ destekBilgileri.musteriSayisi }}</div>
              <div class="metric-lbl">Müşteri Kaydı</div>
            </div>
            <div class="metric-card">
              <div class="metric-num">{{ destekBilgileri.aracSayisi }}</div>
              <div class="metric-lbl">Araç Kaydı</div>
            </div>
            <div class="metric-card">
              <div class="metric-num">{{ destekBilgileri.isEmriSayisi }}</div>
              <div class="metric-lbl">İş Emri Kaydı</div>
            </div>
            <div class="metric-card">
              <div class="metric-num">{{ destekBilgileri.parcaSayisi }}</div>
              <div class="metric-lbl">Stok Parça Kaydı</div>
            </div>
          </div>

          <div class="path-box mt-12">
            <strong>Veritabanı Dosya Yolu:</strong>
            <span class="break-all">{{ destekBilgileri.dbPath || 'Görüntülenemiyor' }}</span>
          </div>

          <!-- Fabrika Sıfırlaması (Tehlikeli Bölge) -->
          <div style="border-top: 1px dashed var(--border-color, #334155); padding-top: 16px; margin-top: 16px;">
            <div style="font-weight: bold; margin-bottom: 6px; font-size: 0.9rem; color: #f87171;">Fabrika Sıfırlaması (Tehlikeli Bölge)</div>
            <div style="color: var(--text-muted, #94a3b8); font-size: 0.8rem; margin-bottom: 12px; line-height: 1.4;">
              Tüm verileri (müşteri, araç, iş emri, stok, cari, ayarlar, fotoğraflar) kalıcı olarak siler ve
              uygulamayı ilk kurulum haline döndürür. İşlem öncesi otomatik güvenlik yedeği alınır.
            </div>
            <Button
              label="Veritabanını Sıfırla (Varsayılana Dön)"
              icon="pi pi-exclamation-triangle"
              severity="danger"
              size="small"
              :loading="sifirlaniyor"
              @click="veritabaniSifirla"
            />
          </div>
        </div>

      </template>

      <!-- Alt Kaydetme Çubuğu -->
      <div class="sticky-save-bar panel">
        <div class="save-bar-info">
          <i v-if="isDirty" class="pi pi-exclamation-circle text-amber"></i>
          <i v-else class="pi pi-check-circle text-green"></i>
          <span>{{ isDirty ? 'Kaydedilmemiş değişiklikler var.' : 'Tüm tercihler güncel.' }}</span>
        </div>

        <Button
          label="Tercihleri Kaydet"
          icon="pi pi-check"
          severity="success"
          :disabled="!isDirty"
          :loading="kaydetYukleniyor"
          @click="tercihleriKaydet"
        />
      </div>
    </div>

    <!-- Hakkında Footer -->
    <div class="settings-about-footer">
      <h3>Kâtip</h3>
      <p>Oto Servis Takip Sistemi</p>
      <span>Alican Kala tarafından hazırlanmıştır.</span>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  color: var(--text-primary);
  min-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header-save-wrapper {
  display: flex;
  align-items: center;
}

.settings-grid {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.settings-card {
  padding: 18px 20px;
  border-radius: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
}

.card-header-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.card-header-title h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 700;
  color: var(--text-title);
}

.card-subtitle {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

.card-icon {
  font-size: 18px;
  padding: 8px;
  border-radius: 8px;
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
}

.icon-blue { color: var(--accent-color); }
.icon-amber { color: #f59e0b; }
.icon-green { color: #10b981; }

/* Compact Info Box */
.compact-info-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 16px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.info-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.info-val {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text-title);
}

/* Setting Rows */
.setting-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color-soft);
  gap: 16px;
}

.setting-row.border-none {
  border-bottom: none;
  padding-bottom: 4px;
}

.setting-info {
  flex: 1;
  min-width: 0;
}

.setting-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-title);
}

.setting-desc {
  font-size: 12.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

.setting-control {
  flex-shrink: 0;
}

.compact-dropdown {
  min-width: 180px;
}

/* Custom Modern Toggle Switch */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--bg-active-box);
  border: 1px solid var(--border-color);
  transition: 0.2s ease;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 16px;
  width: 16px;
  left: 3px;
  bottom: 3px;
  background-color: var(--text-muted);
  transition: 0.2s ease;
  border-radius: 50%;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--accent-color);
  border-color: var(--accent-color);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(20px);
  background-color: #ffffff;
}

/* User Badges & PIN Grid */
.active-user-badge {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--text-title);
  display: inline-block;
}

.admin-badge {
  border-color: rgba(245, 158, 11, 0.3);
  background: rgba(245, 158, 11, 0.05);
}

.pin-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)) auto;
  gap: 12px;
  align-items: flex-end;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-secondary);
}

.form-btn-align {
  justify-content: flex-end;
}

/* Admin Sections */
.admin-section {
  border-left: 3px solid #10b981;
}

.action-btn-group {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sys-metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}

.metric-card {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  text-align: center;
}

.metric-num {
  font-size: 18px;
  font-weight: 800;
  color: var(--text-title);
}

.metric-lbl {
  font-size: 11.5px;
  color: var(--text-muted);
  margin-top: 2px;
}

.path-box {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 12.5px;
}

.path-box strong {
  display: block;
  color: var(--text-title);
  margin-bottom: 2px;
}

.font-mono {
  font-family: Consolas, Monaco, monospace;
}

.break-all {
  word-break: break-all;
  color: var(--accent-color);
}

/* Sticky Save Bar */
.sticky-save-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  border-radius: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  position: sticky;
  bottom: 12px;
  z-index: 10;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
}

.save-bar-info {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-secondary);
}

.settings-about-footer {
  margin-top: 12px;
  padding-top: 20px;
  border-top: 1px dashed var(--border-color-soft);
  text-align: center;
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.settings-about-footer h3 {
  margin: 0 0 2px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
}

.text-amber { color: #f59e0b; }
.text-green { color: #10b981; }
.font-semibold { font-weight: 600; }
.mb-12 { margin-bottom: 12px; }
.mb-16 { margin-bottom: 16px; }
.mt-12 { margin-top: 12px; }
</style>