<script setup>
import Menu from 'primevue/menu'
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import Toast from 'primevue/toast'
import ConfirmDialog from 'primevue/confirmdialog'
import Dialog from 'primevue/dialog'
import Dropdown from 'primevue/dropdown'
import InputText from 'primevue/inputtext'
import Button from 'primevue/button'
import { useToast } from 'primevue/usetoast'
import SetupWizard from './components/SetupWizard.vue'
import { aktifUstaDegistiginiBildir } from './composables/useYetki.js'

const router = useRouter()
const toast = useToast()

const ustalar = ref([])
const seciliUstaId = ref(null)
const pin = ref('')
const girisHatasi = ref('')
const girisYukleniyor = ref(false)
const aktifUsta = ref(null)
const isAdminLogin = ref(false)
const toggleAdminLogin = () => {
  isAdminLogin.value = !isAdminLogin.value
  pin.value = ''
  girisHatasi.value = ''
}
const mevcutTema = ref(localStorage.getItem('uygulamaTema') || 'light')
const temaUygula = () => {
  const kayitliTema = localStorage.getItem('uygulamaTema') || 'light'
  mevcutTema.value = kayitliTema
  document.documentElement.setAttribute('data-theme', kayitliTema)
  document.documentElement.style.colorScheme = kayitliTema
  if (kayitliTema === 'dark') {
    document.documentElement.classList.add('p-dark')
  } else {
    document.documentElement.classList.remove('p-dark')
  }
}

const menuItems = ref([
  { label: 'Ana Sayfa', icon: 'pi pi-home', path: '/dashboard', command: () => router.push('/dashboard') },
  { label: 'Servis Kabul', icon: 'pi pi-bolt', path: '/service-reception', command: () => router.push('/service-reception') },
  { label: 'İş Emirleri', icon: 'pi pi-wrench', path: '/work-orders', command: () => router.push('/work-orders') },
  { label: 'Müşteriler', icon: 'pi pi-users', path: '/customers', command: () => router.push('/customers') },
  { label: 'Araçlar', icon: 'pi pi-car', path: '/vehicles', command: () => router.push('/vehicles') },
  { label: 'Parça / Stok', icon: 'pi pi-box', path: '/parts', command: () => router.push('/parts') },
  { label: 'Finans', icon: 'pi pi-wallet', path: '/current-accounts', command: () => router.push('/current-accounts') },
  { label: 'Gün Sonu', icon: 'pi pi-lock', path: '/daily-closing', command: () => router.push('/daily-closing') },
  { label: 'Ayarlar', icon: 'pi pi-cog', path: '/settings', command: () => router.push('/settings') },
  { label: 'Yardım', icon: 'pi pi-question-circle', path: '/help', command: () => router.push('/help') }
])

// Kurulum Sihirbazı: ilk girişte bir kez açılır, Yardım Merkezi'nden yeniden çağrılabilir.
const kurulumSihirbaziAcik = ref(false)
const kurulumSihirbaziGerekli = ref(false)

const kurulumSihirbaziniKontrolEt = () => {
  if (kurulumSihirbaziGerekli.value) {
    kurulumSihirbaziGerekli.value = false
    kurulumSihirbaziAcik.value = true
  }
}

const kurulumSihirbaziniAc = () => {
  kurulumSihirbaziAcik.value = true
}

// ── Durum çubuğu: gün sonu göstergesi ───────────────
const gunSonuOzet = ref(null)
const gunSonuKapanis = ref(null)

const gunSonuDurumunuYukle = async () => {
  if (!window.api?.gunSonuOzetiGetir) return
  try {
    const res = await window.api.gunSonuOzetiGetir()
    if (res?.success) {
      gunSonuOzet.value = res.ozet || null
      gunSonuKapanis.value = res.kapanis || null
    }
  } catch (e) {
    console.error('Gün sonu durumu yüklenemedi:', e)
  }
}

const gunSonunaGit = () => {
  router.push('/daily-closing')
}

// ── Güncelleme şeridi ────────────────────────────────────────────────
// Windows'un İngilizce sistem bildirimi dükkanda fark edilmediği için
// güncelleme hazır olduğunda uygulamanın içinde şerit gösteriliyor.
const guncelleme = ref({ durum: 'bilinmiyor', surum: '', yuzde: 0 })
const guncellemeKuruluyor = ref(false)

const guncellemeSeridiGorunur = computed(() =>
  ['indiriliyor', 'hazir', 'kuruluyor'].includes(guncelleme.value.durum)
)

const guncellemeYuzdesi = computed(() => {
  if (guncelleme.value.durum !== 'indiriliyor') return 100
  return Math.min(100, Math.max(0, Number(guncelleme.value.yuzde) || 0))
})

const guncellemeyiKur = async () => {
  if (guncellemeKuruluyor.value) return
  guncellemeKuruluyor.value = true

  try {
    const res = await window.api?.guncellemeyiKur?.()
    if (!res?.success) {
      guncellemeKuruluyor.value = false
      toast.add({
        severity: 'error',
        summary: 'Güncelleme',
        detail: res?.error || 'Güncelleme kurulamadı.',
        life: 4000
      })
    }
    // Başarılıysa uygulama kapanıp kurulum başlayacağı için durum sıfırlanmaz.
  } catch (e) {
    guncellemeKuruluyor.value = false
    console.error('Güncelleme kurulum hatası:', e)
  }
}

const ustalariYukle = async () => {
  try {
    const res = await window.api.ustalariGetir()

    if (res?.success) {
      ustalar.value = Array.isArray(res.ustalar) ? res.ustalar : []

      if (ustalar.value.length > 0) {
        seciliUstaId.value = ustalar.value[0].id
      }
    } else {
      girisHatasi.value = res?.error || 'Ustalar yüklenemedi.'
    }
  } catch (error) {
    console.error('Ustalar yüklenemedi:', error)
    girisHatasi.value = 'Ustalar yüklenemedi.'
  }
}

const girisYap = async () => {
  if (girisYukleniyor.value) return

  girisHatasi.value = ''

  // Admin girişi
  if (isAdminLogin.value) {
    if (!pin.value.trim() || pin.value.length !== 4) {
      girisHatasi.value = 'Admin PIN 4 haneli olmalıdır.'
      return
    }
    girisYukleniyor.value = true
    try {
      const res = await window.api.adminPinDogrula(pin.value)
      if (res?.success) {
        const adminUser = { id: 'admin', name: 'Alican Kala', role: 'admin' }
        aktifUsta.value = adminUser
        localStorage.setItem('aktifUsta', JSON.stringify(adminUser))
        aktifUstaDegistiginiBildir()
        pin.value = ''
      } else {
        girisHatasi.value = res?.error || 'Hatalı Admin PIN.'
      }
    } catch (e) {
      console.error('Admin giriş hatası:', e)
      girisHatasi.value = 'Giriş hatası.'
    } finally {
      girisYukleniyor.value = false
    }
    if (aktifUsta.value) {
      router.push('/dashboard')
      kurulumSihirbaziniKontrolEt()
    }
    return
  }

  // Normal usta girişi
  if (!seciliUstaId.value) {
    girisHatasi.value = 'Lütfen usta seçin.'
    return
  }
  if (!pin.value.trim() || pin.value.length !== 4) {
    girisHatasi.value = 'PIN 4 haneli olmalıdır.'
    return
  }
  if (!window.api || typeof window.api.ustaGirisYap !== 'function') {
    girisHatasi.value = 'Uygulama hazır değil. Lütfen kapatıp yeniden açın.'
    return
  }

  girisYukleniyor.value = true
  let timerHandle = null

  try {
    const zamanAsimi = new Promise(function(_, reject) {
      timerHandle = setTimeout(function() {
        reject(new Error('Bağlantı zaman aşımı. Uygulamayı yeniden başlatın.'))
      }, 10000)
    })

    const res = await Promise.race([
      window.api.ustaGirisYap({ master_id: seciliUstaId.value, pin: pin.value }),
      zamanAsimi
    ])

    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null }

    // Çoklu format desteği: success / ok
    const basarili = res && (res.success === true || res.ok === true)
    if (!basarili) {
      girisHatasi.value = (res && (res.error || res.message || res.hata)) || 'Usta veya PIN hatalı.'
      return
    }

    // Çoklu format desteği: usta / user / master
    let ustaObj = res.usta || res.user || res.master || null
    if (!ustaObj && res.id) {
      ustaObj = { id: res.id, name: res.name || '' }
    }

    if (!ustaObj || !ustaObj.id) {
      girisHatasi.value = 'Sunucudan geçersiz kullanıcı bilgisi döndü.'
      return
    }

    const ustaBilgisi = { id: Number(ustaObj.id), name: String(ustaObj.name || '') }
    aktifUsta.value = ustaBilgisi
    localStorage.setItem('aktifUsta', JSON.stringify(ustaBilgisi))
    aktifUstaDegistiginiBildir()
    pin.value = ''
    router.push('/dashboard')
    kurulumSihirbaziniKontrolEt()
  } catch (err) {
    if (timerHandle) { clearTimeout(timerHandle); timerHandle = null }
    console.error('Usta giriş hatası:', err)
    girisHatasi.value = (err && err.message) ? err.message : 'Giriş yapılamadı.'
  } finally {
    girisYukleniyor.value = false
  }
}

const pinInputDuzenle = (event) => {
  pin.value = String(event.target.value || '').replace(/\D/g, '').slice(0, 4)
}

const isMaximized = ref(false)

const pencereKucult = async () => {
  await window.api?.pencereKucult()
}

const pencereBuyutKucult = async () => {
  const res = await window.api?.pencereBuyutKucult()
  if (res && typeof res.isMaximized === 'boolean') {
    isMaximized.value = res.isMaximized
  }
}

const pencereKapat = async () => {
  await window.api?.pencereKapat()
}

const cikisYap = () => {
  aktifUsta.value = null
  localStorage.removeItem('aktifUsta')
  aktifUstaDegistiginiBildir()
  pin.value = ''
  router.push('/dashboard')
  window.api?.ustaCikisYap?.().catch(() => {})
}
const disaridanCikisYap = () => {
  cikisYap()
}
const showPhoneAccessModal = ref(false)
const activePhoneTab = ref('qr')
const qrCodeUrl = ref('')
const pairingUrl = ref('')
const qrMasterId = ref(null)
const qrExpiresAt = ref(null)
const qrKalanSaniye = ref(0)
let qrTimer = null
const mobilOturumlar = ref([])
const qrYukleniyor = ref(false)

const togglePhoneAccessModal = async () => {
  showPhoneAccessModal.value = !showPhoneAccessModal.value
  if (showPhoneAccessModal.value) {
    await telefonErisimiDurumGetir()
    await mobilOturumlariYukle()
    if (telefonErisimi.value.running && (!qrCodeUrl.value || qrKalanSaniye.value <= 0)) {
      await qrKodOlustur()
    }
  }
}

const qrKodOlustur = async () => {
  if (!window.api?.telefonEslesmeQrOlustur) return
  qrYukleniyor.value = true
  try {
    const res = await window.api.telefonEslesmeQrOlustur(qrMasterId.value)
    if (res?.success) {
      qrCodeUrl.value = res.qrDataUrl || ''
      pairingUrl.value = res.pairingUrl || ''
      qrExpiresAt.value = res.expiresAt || 0
      startQrTimer()
    } else {
      toast.add({ severity: 'error', summary: 'Hata', detail: res?.error || 'QR üretilemedi', life: 3000 })
    }
  } catch (e) {
    console.error('QR Oluşturma Hatası:', e)
  } finally {
    qrYukleniyor.value = false
  }
}

const startQrTimer = () => {
  if (qrTimer) clearInterval(qrTimer)
  const updateKalan = () => {
    if (!qrExpiresAt.value) {
      qrKalanSaniye.value = 0
      return
    }
    const diff = Math.max(0, Math.floor((qrExpiresAt.value - Date.now()) / 1000))
    qrKalanSaniye.value = diff
    if (diff <= 0) {
      if (qrTimer) {
        clearInterval(qrTimer)
        qrTimer = null
      }
      if (showPhoneAccessModal.value && telefonErisimi.value.running && activePhoneTab.value === 'qr') {
        qrKodOlustur()
      }
    }
  }
  updateKalan()
  qrTimer = setInterval(updateKalan, 1000)
}

const formatKalanSaniye = (sec) => {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

const mobilOturumlariYukle = async () => {
  if (!window.api?.telefonOturumlariGetir) return
  try {
    const res = await window.api.telefonOturumlariGetir()
    if (res?.success) {
      mobilOturumlar.value = res.sessions || []
    }
  } catch (e) {
    console.error('Mobil oturumları yükleme hatası:', e)
  }
}

const oturumKapat = async (token) => {
  if (!window.api?.telefonOturumKapat) return
  try {
    const res = await window.api.telefonOturumKapat(token)
    if (res?.success) {
      toast.add({ severity: 'info', summary: 'Bilgi', detail: 'Cihaz bağlantısı kesildi.', life: 2500 })
      await mobilOturumlariYukle()
    }
  } catch (e) {
    console.error('Oturum kapatma hatası:', e)
  }
}

const tumOturumlariKapat = async () => {
  if (!window.api?.telefonTumOturumlariKapat) return
  try {
    const res = await window.api.telefonTumOturumlariKapat()
    if (res?.success) {
      toast.add({ severity: 'warn', summary: 'Bilgi', detail: 'Tüm cihaz bağlantıları kesildi.', life: 2500 })
      await mobilOturumlariYukle()
    }
  } catch (e) {
    console.error('Tüm oturumları kapatma hatası:', e)
  }
}

const kopyalaAdres = async (text) => {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
    } else {
      const input = document.createElement('input')
      input.value = text
      document.body.appendChild(input)
      input.select()
      document.execCommand('copy')
      document.body.removeChild(input)
    }
    toast.add({ severity: 'success', summary: 'Başarılı', detail: 'Bağlantı adresi kopyalandı.', life: 2000 })
  } catch (err) {
    console.error('Kopyalama hatasi:', err)
  }
}

const telefonErisimi = ref({
  running: false,
  port: 4317,
  ip: '',
  ips: []
})

const telefonErisimiDurumGetir = async () => {
  if (window.api?.telefonErisimiDurumGetir) {
    const res = await window.api.telefonErisimiDurumGetir()
    if (res?.success) {
      telefonErisimi.value.running = res.running
      telefonErisimi.value.port = res.port
      telefonErisimi.value.ip = res.ip
      telefonErisimi.value.ips = res.ips || []
    }
  }
}

const telefonErisimiBaslat = async () => {
  if (!window.api?.telefonErisimiBaslat) return
  try {
    const res = await window.api.telefonErisimiBaslat(Number(telefonErisimi.value.port))
    if (res?.success) {
      telefonErisimi.value.running = true
      telefonErisimi.value.port = res.port
      telefonErisimi.value.ip = res.ip
      telefonErisimi.value.ips = res.ips || []
      await qrKodOlustur()
    } else {
      alert('Telefon erişimi başlatılamadı: ' + (res?.error || 'Bilinmeyen hata'))
    }
  } catch (error) {
    console.error('Telefon erişimi başlatma hatası:', error)
  }
}

const telefonErisimiDurdur = async () => {
  if (!window.api?.telefonErisimiDurdur) return
  try {
    const res = await window.api.telefonErisimiDurdur()
    if (res?.success) {
      telefonErisimi.value.running = false
      qrCodeUrl.value = ''
    } else {
      alert('Telefon erişimi durdurulamadı.')
    }
  } catch (error) {
    console.error('Telefon erişimi durdurma hatası:', error)
  }
}

// ── Bilgi Şeridi: saat / tarih / döviz (NTV alt bandı tarzı döngü) ──
const simdikiZaman = ref(new Date())
const dovizKurlari = ref(null)
const havaDurumu = ref(null)
const tickerIndex = ref(0)
let saatTimer = null
let tickerTimer = null
let kurTimer = null

const kurFormatla = (kur) => {
  const f = (v) => Number(v).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (kur.alis && kur.satis) return `${f(kur.alis)} / ${f(kur.satis)} ₺`
  return `${f(kur.satis || kur.alis)} ₺`
}

const tickerItems = computed(() => {
  const items = [
    {
      icon: 'pi pi-clock',
      label: 'Saat',
      value: simdikiZaman.value.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    },
    {
      icon: 'pi pi-calendar',
      label: 'Tarih',
      value: simdikiZaman.value.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', weekday: 'long' })
    }
  ]
  const k = dovizKurlari.value
  if (k?.USD && (k.USD.alis || k.USD.satis)) {
    items.push({ icon: 'pi pi-dollar', label: 'Dolar (Alış / Satış)', value: kurFormatla(k.USD) })
  }
  if (k?.EUR && (k.EUR.alis || k.EUR.satis)) {
    items.push({ icon: 'pi pi-euro', label: 'Euro (Alış / Satış)', value: kurFormatla(k.EUR) })
  }
  if (k?.GBP && (k.GBP.alis || k.GBP.satis)) {
    items.push({ icon: 'pi pi-pound', label: 'Sterlin (Alış / Satış)', value: kurFormatla(k.GBP) })
  }
  const h = havaDurumu.value
  if (h?.sicaklik !== undefined && h?.sicaklik !== null) {
    const kod = Number(h.kod)
    const havaIkonu = kod >= 95 ? 'pi pi-bolt' : (kod <= 1 && kod >= 0 ? 'pi pi-sun' : 'pi pi-cloud')
    items.push({
      icon: havaIkonu,
      label: `Hava — ${h.sehir || ''}`,
      value: `${h.sicaklik}°C, ${h.durum || ''}`
    })
  }
  return items
})

const aktifTickerItem = computed(() => {
  const items = tickerItems.value
  if (items.length === 0) return null
  return items[tickerIndex.value % items.length]
})

const dovizYukle = async () => {
  if (!window.api?.dovizKurlariGetir) return
  try {
    const res = await window.api.dovizKurlariGetir()
    if (res?.success && res.kurlar) {
      dovizKurlari.value = res.kurlar
    }
  } catch (e) {
    console.error('Döviz kuru yüklenemedi:', e)
  }
}

const havaYukle = async () => {
  if (!window.api?.havaDurumuGetir) return
  try {
    const res = await window.api.havaDurumuGetir()
    if (res?.success) {
      havaDurumu.value = res
    }
  } catch (e) {
    console.error('Hava durumu yüklenemedi:', e)
  }
}

// ── Çıkışta Gün Sonu Hatırlatması ────────────────
const gunSonuHatirlatmaAcik = ref(false)

const gunSonuHatirlatmasiGeldi = () => {
  // Giriş ekranındaysa günü kapatacak kimse yok; hatırlatmadan kapat
  if (!aktifUsta.value) {
    window.api?.pencereKapatZorla?.()
    return
  }
  gunSonuHatirlatmaAcik.value = true
}

const gunSonunaGitVeKapat = () => {
  gunSonuHatirlatmaAcik.value = false
  router.push('/daily-closing')
}

const kapatmadanCik = () => {
  gunSonuHatirlatmaAcik.value = false
  window.api?.pencereKapatZorla?.()
}

const verilerYenileniyor = ref(false)

const verileriYenile = async () => {
  if (verilerYenileniyor.value) return
  verilerYenileniyor.value = true

  toast.add({
    severity: 'info',
    summary: 'Yenileniyor',
    detail: 'Veriler yenileniyor...',
    life: 2000
  })

  try {
    const res = await window.api.uygulamaVerileriniYenile()
    if (res?.success) {
      const bekleyenSayfaYenilemeleri = []
      const yenilemeOlayi = new CustomEvent('app-data-refreshed', {
        detail: {
          waitUntil(islem) {
            if (islem && typeof islem.then === 'function') {
              bekleyenSayfaYenilemeleri.push(Promise.resolve(islem))
            }
          }
        }
      })

      window.dispatchEvent(yenilemeOlayi)
      const genelYenilemeIslemleri = [
        ...bekleyenSayfaYenilemeleri,
        ustalariYukle(),
        gunSonuDurumunuYukle(),
        dovizYukle(),
        havaYukle(),
        telefonErisimiDurumGetir(),
        mobilOturumlariYukle()
      ]
      await Promise.allSettled(genelYenilemeIslemleri)

      toast.add({
        severity: 'success',
        summary: 'Başarılı',
        detail: 'Veritabanı ve açık ekrandaki tüm bilgiler yeniden yüklendi.',
        life: 3000
      })
    } else {
      toast.add({
        severity: 'error',
        summary: 'Hata',
        detail: res?.message || 'Veriler yenilenemedi. Veritabanı bağlantısını kontrol edin.',
        life: 5000
      })
    }
  } catch (err) {
    console.error('Veri yenileme hatası:', err)
    toast.add({
      severity: 'error',
      summary: 'Hata',
      detail: 'Veriler yenilenemedi. Veritabanı bağlantısını kontrol edin.',
      life: 5000
    })
  } finally {
    verilerYenileniyor.value = false
  }
}

onMounted(async () => {
  temaUygula()
  localStorage.removeItem('aktifUsta')
  // Önceki oturumdan kalan kayıt silindi; yetki durumu da sıfırlanmalı.
  aktifUstaDegistiginiBildir()
  ustalariYukle()
  window.addEventListener('usta-cikis-yapildi', disaridanCikisYap)
  window.addEventListener('hava-durumu-yenile', havaYukle)
  window.addEventListener('kurulum-sihirbazi-ac', kurulumSihirbaziniAc)
  window.addEventListener('app-data-refreshed', gunSonuDurumunuYukle)
  onUnmounted(() => window.removeEventListener('app-data-refreshed', gunSonuDurumunuYukle))
  gunSonuDurumunuYukle()

  if (window.api?.onGuncellemeDurumu) {
    const unbindGuncelleme = window.api.onGuncellemeDurumu((durum) => {
      guncelleme.value = durum || { durum: 'bilinmiyor' }
    })
    onUnmounted(unbindGuncelleme)
  }

  if (window.api?.guncellemeDurumGetir) {
    try {
      const gRes = await window.api.guncellemeDurumGetir()
      if (gRes?.success) guncelleme.value = gRes
    } catch (e) {}
  }

  // Bilgi şeridi zamanlayıcıları
  saatTimer = setInterval(() => { simdikiZaman.value = new Date() }, 1000)
  tickerTimer = setInterval(() => {
    const adet = tickerItems.value.length
    if (adet > 0) tickerIndex.value = (tickerIndex.value + 1) % adet
  }, 5000)
  dovizYukle()
  havaYukle()
  kurTimer = setInterval(() => {
    dovizYukle()
    havaYukle()
  }, 30 * 60 * 1000)

  let autoStartPhone = false
  if (window.api?.ayarlariGetir) {
    try {
      const sRes = await window.api.ayarlariGetir()
      if (sRes?.success && sRes.settings) {
        const set = sRes.settings
        const savedTheme = set.theme || localStorage.getItem('uygulamaTema') || 'light'
        mevcutTema.value = savedTheme
        document.documentElement.setAttribute('data-theme', savedTheme)
        document.documentElement.style.colorScheme = savedTheme
        if (savedTheme === 'dark') {
          document.documentElement.classList.add('p-dark')
        } else {
          document.documentElement.classList.remove('p-dark')
        }

        const density = set.list_density || 'normal'
        document.documentElement.setAttribute('data-density', density)

        if (set.phone_server_auto_start === 'true') {
          autoStartPhone = true
        }

        // Sihirbaz giriş ekranında değil, girişten sonra açılır.
        kurulumSihirbaziGerekli.value = set.setup_wizard_done !== 'true'
      }
    } catch (err) {
      console.error('Ayarlar uygulanamadı:', err)
    }
  }
  
  if (window.api?.pencereDurumGetir) {
    try {
      const pRes = await window.api.pencereDurumGetir()
      if (pRes?.success) {
        isMaximized.value = pRes.isMaximized
      }
    } catch (e) {}
  }

  if (window.api?.onPencereDurumDegisti) {
    const unbind = window.api.onPencereDurumDegisti((maximized) => {
      isMaximized.value = maximized
    })
    onUnmounted(unbind)
  }

  if (window.api?.onGunSonuHatirlatma) {
    const unbindGunSonu = window.api.onGunSonuHatirlatma(gunSonuHatirlatmasiGeldi)
    onUnmounted(unbindGunSonu)
  }

  if (window.api?.telefonErisimiDurumGetir) {
    try {
      const res = await window.api.telefonErisimiDurumGetir()
      if (res?.success) {
        telefonErisimi.value.running = res.running
        telefonErisimi.value.port = res.port || 4317
        telefonErisimi.value.ip = res.ip
        telefonErisimi.value.ips = res.ips || []

        if (!res.running && autoStartPhone && window.api?.telefonErisimiBaslat) {
          const startRes = await window.api.telefonErisimiBaslat(Number(telefonErisimi.value.port))
          if (startRes?.success) {
            telefonErisimi.value.running = true
            telefonErisimi.value.port = startRes.port
            telefonErisimi.value.ip = startRes.ip
            telefonErisimi.value.ips = startRes.ips || []
          }
        }

        if (telefonErisimi.value.running) {
          await mobilOturumlariYukle()
        }
      }
    } catch (error) {
      console.error('Telefon erişimi kontrolü hatası:', error)
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('usta-cikis-yapildi', disaridanCikisYap)
  window.removeEventListener('hava-durumu-yenile', havaYukle)
  window.removeEventListener('kurulum-sihirbazi-ac', kurulumSihirbaziniAc)
  if (saatTimer) clearInterval(saatTimer)
  if (tickerTimer) clearInterval(tickerTimer)
  if (kurTimer) clearInterval(kurTimer)
})
</script>

<template>
  <Toast />
  <ConfirmDialog />

  <!-- Çıkışta Gün Sonu Hatırlatması -->
  <Dialog
    v-model:visible="gunSonuHatirlatmaAcik"
    header="Gün Sonu Yapılmadı"
    modal
    :closable="true"
    :style="{ width: '400px' }"
  >
    <div class="gunsonu-reminder-body">
      <i class="pi pi-lock-open gunsonu-reminder-icon"></i>
      <p>
        Bugün için <strong>gün sonu kapanışı yapılmadı</strong> ve gün içinde
        kayıtlı hareketler var. Kasayı sayıp günü kapatmadan çıkmak üzeresiniz.
      </p>
    </div>

    <template #footer>
      <Button
        label="Kapatmadan Çık"
        icon="pi pi-sign-out"
        severity="secondary"
        text
        @click="kapatmadanCik"
      />
      <Button
        label="Gün Sonu'na Git"
        icon="pi pi-lock"
        severity="warn"
        @click="gunSonunaGitVeKapat"
      />
    </template>
  </Dialog>

  <div class="custom-titlebar" @dblclick="pencereBuyutKucult">
    <div class="custom-titlebar-left">
      <img
        src="/icon.ico"
        alt="Kâtip"
        class="custom-titlebar-icon"
      />
      <span class="custom-titlebar-title">Kâtip</span>
      <span class="custom-titlebar-separator">|</span>
      <span class="custom-titlebar-subtitle">Servis Takip Sistemi</span>
    </div>

    <div class="custom-titlebar-actions" @dblclick.stop>
      <button
        type="button"
        class="window-btn refresh-btn-titlebar"
        :disabled="verilerYenileniyor"
        @click.stop="verileriYenile"
        title="Verileri Yenile"
      >
        <i :class="['pi', 'pi-refresh', { 'pi-spin': verilerYenileniyor }]"></i>
      </button>

      <button
        type="button"
        class="window-btn window-control-btn"
        @click.stop="pencereKucult"
        title="Simge Durumuna Küçült"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg">
          <line x1="0" y1="5.5" x2="11" y2="5.5" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>

      <button
        type="button"
        class="window-btn window-control-btn"
        @click.stop="pencereBuyutKucult"
        :title="isMaximized ? 'Aşağı Getir' : 'Ekranı Kapla'"
      >
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="0.6" y="0.6" width="8.8" height="8.8" stroke="currentColor" stroke-width="1.2"/>
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M 2.5 0.6 H 9.4 V 7.5 H 7.5 M 0.6 2.5 H 7.5 V 9.4 H 0.6 Z" stroke="currentColor" stroke-width="1.1" fill="none"/>
        </svg>
      </button>

      <button
        type="button"
        class="window-btn window-control-btn btn-close"
        @click.stop="pencereKapat"
        title="Kapat"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M 0.5 0.5 L 9.5 9.5 M 9.5 0.5 L 0.5 9.5" stroke="currentColor" stroke-width="1.2"/>
        </svg>
      </button>
    </div>
  </div>

  <div
    v-if="!aktifUsta"
    class="login-page"
  >
    <div class="login-card">
      <div class="login-logo">
        <div class="brand-hero">
          <div class="brand-logo-frame">
            <img
              src="/logo.png"
              alt="Kâtip"
              class="brand-logo"
            />
          </div>

          <h1>Kâtip</h1>

          <div class="brand-subtitle">
            {{ isAdminLogin ? 'Destek ve Bakım' : 'Servis Takip Sistemi' }}
          </div>
        </div>
      </div>

      <div class="login-form">
        <!-- Normal Usta Giriş Alanı -->
        <div v-if="!isAdminLogin" class="form-group">
          <label>Usta Seçin</label>
          <Dropdown
            v-model="seciliUstaId"
            :options="ustalar"
            optionLabel="name"
            optionValue="id"
            placeholder="Usta seçin"
            style="width: 100%;"
          />
        </div>

        <!-- Admin Başlık Göstergesi -->
        <div v-else class="form-group admin-login-indicator">
          <i class="pi pi-shield"></i>
          <span>Sistem Destek Girişi</span>
        </div>

        <!-- PIN Giriş Alanı (Ortak) -->
        <div class="form-group">
          <label>{{ isAdminLogin ? 'Admin PIN' : 'PIN' }}</label>
          <InputText
            v-model="pin"
            type="password"
            maxlength="4"
            inputmode="numeric"
            placeholder="PIN girin"
            style="width: 100%;"
            @input="pinInputDuzenle"
            @keyup.enter="girisYap"
          />
        </div>

        <div
          v-if="girisHatasi"
          class="login-error"
        >
          {{ girisHatasi }}
        </div>

        <Button
          :label="isAdminLogin ? 'Destek Girişi Yap' : 'Giriş Yap'"
          icon="pi pi-sign-in"
          :loading="girisYukleniyor"
          class="login-button"
          @click="girisYap"
        />

        <!-- Giriş Tipi Değiştirme Linki -->
        <div class="login-toggle-wrapper">
          <a href="#" @click.prevent="toggleAdminLogin" class="login-toggle-link">
            {{ isAdminLogin ? 'Normal Girişe Dön' : 'Destek Girişi' }}
          </a>
        </div>
      </div>
    </div>
  </div>

  <div
    v-else
    class="app-layout"
  >
    <aside class="app-sidebar">
      <!-- Navigation -->
      <nav class="sidebar-nav">
        <div class="nav-group">
          <div class="nav-group-label">Operasyon</div>
          <a
            v-for="item in menuItems.slice(0, 3)"
            :key="item.label"
            class="nav-item"
            :class="{ active: $route.path === item.path }"
            @click.prevent="item.command()"
            href="#"
          >
            <i :class="item.icon" class="nav-icon"></i>
            <span>{{ item.label }}</span>
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Kayıtlar</div>
          <a
            v-for="item in menuItems.slice(3, 6)"
            :key="item.label"
            class="nav-item"
            :class="{ active: $route.path === item.path }"
            @click.prevent="item.command()"
            href="#"
          >
            <i :class="item.icon" class="nav-icon"></i>
            <span>{{ item.label }}</span>
          </a>
        </div>

        <div class="nav-group">
          <div class="nav-group-label">Finans &amp; Raporlar</div>
          <a
v-for="item in menuItems.slice(6, 8)"
            :key="item.label"
            class="nav-item"
            :class="{ active: $route.path === item.path }"
            @click.prevent="item.command()"
            href="#"
          >
            <i :class="item.icon" class="nav-icon"></i>
            <span>{{ item.label }}</span>
          </a>
        </div>

<div class="nav-group nav-group-bottom">
  <a
    class="nav-item"
    :class="{ active: $route.path === menuItems[9].path }"
    @click.prevent="menuItems[9].command()"
    href="#"
  >
    <i :class="menuItems[9].icon" class="nav-icon"></i>
    <span>{{ menuItems[9].label }}</span>
  </a>

  <a
    class="nav-item"
    :class="{ active: $route.path === menuItems[8].path }"
    @click.prevent="menuItems[8].command()"
    href="#"
  >
    <i :class="menuItems[8].icon" class="nav-icon"></i>
    <span>{{ menuItems[8].label }}</span>
  </a>
</div>
      </nav>
    </aside>

    <main class="app-content">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
  </div>

  <!-- Alt Durum Çubuğu: aktif usta + bilgi şeridi (saat/tarih/döviz) -->
  <div v-if="aktifUsta" class="app-status-bar">
    <div class="status-master-box" :class="{ 'admin-mode-box': aktifUsta?.role === 'admin' }">
      <div class="status-master-avatar" :class="{ 'admin-avatar': aktifUsta?.role === 'admin' }">
        {{ aktifUsta?.name?.charAt(0)?.toUpperCase() }}
      </div>
      <span class="status-master-label">{{ aktifUsta?.role === 'admin' ? 'Destek Modu' : 'Aktif Usta' }}</span>
      <strong class="status-master-name">{{ aktifUsta?.name }}</strong>
      <button class="status-master-logout-btn" @click="cikisYap" title="Çıkış Yap">
        <i class="pi pi-sign-out"></i>
      </button>
    </div>

    <div v-if="aktifTickerItem" class="status-bar-sep"></div>

    <div v-if="aktifTickerItem" class="status-ticker" title="Kurlar TCMB'den alınır, 30 dakikada bir yenilenir">
      <Transition name="ticker-slide" mode="out-in">
        <div :key="aktifTickerItem.label" class="status-ticker-item">
          <i :class="aktifTickerItem.icon" class="status-ticker-icon"></i>
          <span class="status-ticker-label">{{ aktifTickerItem.label }}:</span>
          <strong class="status-ticker-value">{{ aktifTickerItem.value }}</strong>
        </div>
      </Transition>
    </div>

    <div class="status-bar-spacer"></div>

    <div
      v-if="gunSonuOzet"
      class="status-gunsonu"
      :class="gunSonuKapanis ? 'is-closed' : 'is-open'"
      role="button"
      tabindex="0"
      :title="gunSonuKapanis ? 'Bugün kapatıldı — Kapatan: ' + (gunSonuKapanis.master_name || gunSonuKapanis.closed_by_name || '-') : 'Bugün henüz kapatılmadı — Gün Sonu ekranına git'"
      @click="gunSonunaGit"
      @keyup.enter="gunSonunaGit"
    >
      <i :class="['pi', gunSonuKapanis ? 'pi-lock' : 'pi-lock-open']"></i>
      <span class="status-gunsonu-text">{{ gunSonuKapanis ? 'Gün Kapatıldı' : 'Gün Açık' }}</span>
    </div>

    <div class="status-bar-sep"></div>

    <div
      class="status-phone"
      :class="{ 'is-active': telefonErisimi.running }"
      role="button"
      tabindex="0"
      title="Telefon Erişimi"
      @click="togglePhoneAccessModal"
      @keyup.enter="togglePhoneAccessModal"
    >
      <span class="status-dot"></span>
      <i class="pi pi-mobile"></i>
      <span class="status-phone-text">
        {{ telefonErisimi.running
          ? ('Açık' + (mobilOturumlar.length ? ' · ' + mobilOturumlar.length + ' cihaz' : ''))
          : 'Kapalı' }}
      </span>
    </div>

  </div>

  <!-- Güncelleme şeridi giriş ekranında da görünür; kurulum sessiz ilerler. -->
  <div v-if="guncellemeSeridiGorunur" class="update-bar">
    <i :class="guncelleme.durum === 'kuruluyor' ? 'pi pi-cog' : guncelleme.durum === 'hazir' ? 'pi pi-download' : 'pi pi-cloud-download'" class="update-bar-icon"></i>

    <div class="update-bar-body">
      <div class="update-bar-texts">
        <template v-if="guncelleme.durum === 'kuruluyor'">
          <strong>Güncelleme kuruluyor{{ guncelleme.surum ? ` (${guncelleme.surum})` : '' }}</strong>
          <span>{{ guncelleme.asama === 'kurulum-basliyor' ? 'Program kapanacak ve kurulum otomatik tamamlanacak.' : 'Müşteri kayıtları ve fotoğraflar güvenle yedekleniyor.' }}</span>
        </template>
        <template v-else-if="guncelleme.durum === 'hazir'">
          <strong>Yeni sürüm hazır{{ guncelleme.surum ? ` (${guncelleme.surum})` : '' }}</strong>
          <span>Kurulumdan önce müşteri kayıtları ve fotoğraflar güvenli biçimde yedeklenecek.</span>
        </template>
        <template v-else>
          <strong>Yeni sürüm indiriliyor{{ guncelleme.surum ? ` (${guncelleme.surum})` : '' }}</strong>
          <span>%{{ guncellemeYuzdesi }} tamamlandı. Çalışmaya devam edebilirsiniz.</span>
        </template>
      </div>

      <div class="update-progress-track" role="progressbar" aria-label="Güncelleme ilerlemesi" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="guncellemeYuzdesi">
        <div class="update-progress-fill" :style="{ width: `${guncellemeYuzdesi}%` }"></div>
      </div>
    </div>

    <Button
      v-if="guncelleme.durum === 'hazir'"
      label="Şimdi Yeniden Başlat"
      icon="pi pi-refresh"
      size="small"
      :loading="guncellemeKuruluyor"
      @click="guncellemeyiKur"
    />

  </div>

  <!-- Kurulum Sihirbazı (ilk giriş) -->
  <SetupWizard
    v-model:visible="kurulumSihirbaziAcik"
    :is-admin="aktifUsta?.role === 'admin'"
    :mevcut-tema="mevcutTema"
    @telefon-ac="togglePhoneAccessModal"
  />

  <!-- Telefon Erişimi Modalı -->
  <div v-if="showPhoneAccessModal" class="phone-modal-overlay" @click.self="showPhoneAccessModal = false">
    <div class="phone-modal-content">
      <div class="phone-card-header">
        <i class="pi pi-mobile phone-icon"></i>
        <h3>Mobil Telefon Erişimi</h3>
        <span class="status-badge" :class="{ 'status-active': telefonErisimi.running }">
          {{ telefonErisimi.running ? 'Açık' : 'Kapalı' }}
        </span>
      </div>
      
      <!-- Tab Butonları -->
      <div class="phone-tab-bar">
        <button 
          class="phone-tab-btn" 
          :class="{ active: activePhoneTab === 'qr' }"
          @click="activePhoneTab = 'qr'"
        >
          <i class="pi pi-qrcode"></i> QR ile Bağlan
        </button>
        <button 
          class="phone-tab-btn" 
          :class="{ active: activePhoneTab === 'devices' }"
          @click="activePhoneTab = 'devices'; mobilOturumlariYukle()"
        >
          <i class="pi pi-desktop"></i> Bağlı Cihazlar ({{ mobilOturumlar.length }})
        </button>
      </div>

      <div class="phone-card-body">
        <!-- Tab 1: QR Kod ile Bağlan -->
        <div v-if="activePhoneTab === 'qr'" class="phone-tab-content">
          <div v-if="telefonErisimi.running" class="qr-section">
            <div class="qr-master-selector">
              <label>Giriş Yapacak Usta:</label>
              <select v-model="qrMasterId" @change="qrKodOlustur" class="qr-select">
                <option :value="null">Tüm Ustalar / Genel</option>
                <option v-for="u in ustalar" :key="u.id" :value="u.id">{{ u.name }}</option>
              </select>
            </div>

            <div class="qr-display-box">
              <img v-if="qrCodeUrl" :src="qrCodeUrl" alt="Mobil Eşleşme QR Kodu" class="qr-img" />
              <div v-else class="qr-spinner">
                <i class="pi pi-spin pi-spinner" style="font-size: 24px;"></i>
                <span>QR Kod Hazırlanıyor...</span>
              </div>
            </div>

            <div class="qr-info-row">
              <span class="qr-timer-badge" :class="{ expired: qrKalanSaniye <= 0 }">
                <i class="pi pi-clock"></i>
                {{ qrKalanSaniye > 0 ? `Geçerlilik: ${formatKalanSaniye(qrKalanSaniye)}` : 'Süresi Doldu' }}
              </span>
              <button class="phone-btn btn-refresh-qr" @click="qrKodOlustur" :disabled="qrYukleniyor" title="Yeni QR Üret">
                <i class="pi pi-refresh" :class="{ 'pi-spin': qrYukleniyor }"></i> Yeni QR
              </button>
            </div>

            <div class="phone-address-box">
              <span class="address-label">Bağlantı Adresi:</span>
              <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
                <code class="address-value" style="flex: 1;">{{ pairingUrl || ('http://' + telefonErisimi.ip + ':' + telefonErisimi.port) }}</code>
                <button 
                  class="phone-btn btn-refresh" 
                  style="width: 32px; height: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0;"
                  @click="kopyalaAdres(pairingUrl || ('http://' + telefonErisimi.ip + ':' + telefonErisimi.port))"
                  title="Adresi Kopyala"
                >
                  <i class="pi pi-copy"></i>
                </button>
              </div>
            </div>
          </div>

          <div v-else class="phone-info-text text-center" style="padding: 24px 12px;">
            <i class="pi pi-power-off" style="font-size: 32px; color: var(--text-muted); margin-bottom: 8px; display: block;"></i>
            Telefon bağlantısını başlatmak için aşağıdaki "Başlat" butonuna tıklayın.
          </div>
        </div>

        <!-- Tab 2: Bağlı Mobil Cihazlar -->
        <div v-if="activePhoneTab === 'devices'" class="phone-tab-content">
          <div class="devices-header">
            <span>Aktif Mobil Oturumlar</span>
            <button 
              v-if="mobilOturumlar.length > 0" 
              class="phone-btn btn-stop-all"
              @click="tumOturumlariKapat"
            >
              Tümünü Kes
            </button>
          </div>

          <div v-if="mobilOturumlar.length === 0" class="empty-devices">
            <i class="pi pi-mobile" style="font-size: 28px; color: var(--text-muted);"></i>
            <span>Henüz bağlı mobil cihaz bulunmuyor.</span>
          </div>

          <div v-else class="devices-list">
            <div v-for="s in mobilOturumlar" :key="s.token" class="device-card">
              <div class="device-info">
                <div class="device-name">
                  <i class="pi pi-user"></i> {{ s.name }}
                  <span class="device-ip">({{ s.ip || 'Yerel Ağ' }})</span>
                </div>
                <div class="device-meta">
                  <span>Giriş: {{ new Date(s.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }}</span>
                  <span>· Son Aktif: {{ new Date(s.lastActiveAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) }}</span>
                </div>
              </div>
              <button 
                class="btn-revoke-device" 
                @click="oturumKapat(s.token)" 
                title="Cihaz Bağlantısını Kes"
              >
                <i class="pi pi-times"></i> Kes
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <div class="phone-card-actions">
        <button 
          v-if="!telefonErisimi.running"
          class="phone-btn btn-start" 
          @click="telefonErisimiBaslat"
        >
          <i class="pi pi-play"></i> Başlat
        </button>
        <button 
          v-else
          class="phone-btn btn-stop" 
          @click="telefonErisimiDurdur"
        >
          <i class="pi pi-stop"></i> Durdur
        </button>
        <button class="phone-btn btn-refresh" @click="telefonErisimiDurumGetir(); mobilOturumlariYukle();" title="Yenile">
          <i class="pi pi-refresh"></i>
        </button>
        <button class="phone-btn btn-close" @click="showPhoneAccessModal = false">
          Kapat
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: var(--bg-primary);
}

:global(*) {
  box-sizing: border-box;
}

/* ── Titlebar ─────────────────────────────────────── */
.custom-titlebar {
  height: 52px;
  width: 100vw;
  flex-shrink: 0;
  background: var(--bg-active-box);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text-primary);
  user-select: none;
  -webkit-app-region: drag;
}

.custom-titlebar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-left: 16px;
  color: var(--text-title);
  letter-spacing: -0.01em;
}

.custom-titlebar-separator {
  color: var(--border-color);
  font-weight: 300;
  user-select: none;
}

.custom-titlebar-subtitle {
  font-size: 11.5px;
  color: var(--text-muted);
  font-weight: 500;
  letter-spacing: 0.02em;
}

.custom-titlebar-icon {
  width: 30px;
  height: 30px;
  object-fit: contain;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
  padding: 3px;
  border: 1px solid var(--border-color-soft);
}

.custom-titlebar-title {
  font-size: 17px;
  font-weight: 800;
}

.custom-titlebar-actions {
  height: 100%;
  display: flex;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 20;
}

.custom-titlebar-actions * {
  -webkit-app-region: no-drag;
}

.window-btn {
  width: 46px;
  height: 52px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s ease, color 0.12s ease;
}

.window-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--text-title);
}

:global(html[data-theme="light"]) .window-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-title);
}

.window-btn.btn-close:hover {
  background: #e81123 !important;
  color: #ffffff !important;
}

.window-btn.btn-close:active {
  background: #f1707a !important;
  color: #ffffff !important;
}

/* ── Login Page ──────────────────────────────────── */
.login-page {
  height: calc(100vh - 52px);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

/* ── Phone Modal Overlay ─────────────────────────── */
.phone-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.phone-modal-content {
  width: 100%;
  max-width: 420px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 22px 24px;
  box-shadow: 0 24px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.phone-card-header {
  display: flex;
  align-items: center;
  gap: 10px;
}

.phone-icon {
  font-size: 16px;
  color: var(--accent-color);
  background: rgba(45, 125, 210, 0.1);
  padding: 6px;
  border-radius: 6px;
}

.phone-card-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  color: var(--text-title);
  flex: 1;
}

.status-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-muted);
}

.status-badge.status-active {
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(16, 185, 129, 0.2);
  color: #34d399;
}

.phone-tab-bar {
  display: flex;
  gap: 6px;
  background: var(--bg-primary, rgba(0,0,0,0.2));
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-color-soft);
}

.phone-tab-btn {
  flex: 1;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
}

.phone-tab-btn:hover {
  color: var(--text-title);
}

.phone-tab-btn.active {
  background: var(--bg-active-box, rgba(255,255,255,0.08));
  color: var(--accent-color, #38bdf8);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
}

.phone-card-body {
  font-size: 12.5px;
}

.phone-tab-content {
  width: 100%;
}

.qr-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.qr-master-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-secondary);
}

.qr-select {
  flex: 1;
  padding: 5px 10px;
  border-radius: 6px;
  background: var(--bg-input, #1e293b);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 12px;
}

.qr-display-box {
  background: #ffffff;
  padding: 14px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 190px;
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
}

.qr-img {
  width: 175px;
  height: 175px;
  object-fit: contain;
}

.qr-spinner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #334155;
  font-size: 12px;
  font-weight: 600;
}

.qr-info-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.qr-timer-badge {
  font-size: 11px;
  font-weight: 600;
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
  padding: 3px 8px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.qr-timer-badge.expired {
  color: #f87171;
  background: rgba(248, 113, 113, 0.1);
}

.btn-refresh-qr {
  padding: 4px 10px;
  font-size: 11px;
}

.qr-help-text {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
  display: flex;
  align-items: center;
  gap: 6px;
}

.devices-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-title);
  margin-bottom: 10px;
}

.btn-stop-all {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  padding: 2px 8px;
  font-size: 11px;
}

.empty-devices {
  text-align: center;
  padding: 32px 12px;
  color: var(--text-muted);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.devices-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 220px;
  overflow-y: auto;
}

.device-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid var(--border-color-soft);
  border-radius: 8px;
  padding: 8px 12px;
}

.device-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.device-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.device-ip {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-muted);
}

.device-meta {
  font-size: 10.5px;
  color: var(--text-muted);
}

.btn-revoke-device {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.btn-revoke-device:hover {
  background: rgba(239, 68, 68, 0.2);
}

.phone-address-box {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.address-label {
  color: var(--text-secondary);
  font-size: 10.5px;
  font-weight: 600;
}

.address-value {
  display: block;
  font-family: monospace;
  font-size: 11.5px;
  color: #34d399;
  background: rgba(16, 185, 129, 0.05);
  border: 1px dashed rgba(16, 185, 129, 0.2);
  padding: 4px 8px;
  border-radius: 6px;
  word-break: break-all;
  user-select: all;
}

.phone-info-text {
  color: var(--text-muted);
  font-style: italic;
}

.phone-card-actions {
  display: flex;
  gap: 8px;
}

.phone-btn {
  height: 32px;
  border: none;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  transition: all 0.15s ease;
}

.btn-start {
  flex: 1;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  color: #4ade80;
}
.btn-start:hover {
  background: rgba(34, 197, 94, 0.2);
}

.btn-stop {
  flex: 1;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.2);
  color: #f87171;
}
.btn-stop:hover {
  background: rgba(239, 68, 68, 0.2);
}

.btn-refresh {
  width: 32px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.btn-refresh:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-title);
}

.btn-close {
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}
.btn-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--text-title);
}

.login-toggle-separator {
  color: var(--text-muted);
  font-size: 12px;
  margin: 0 8px;
  user-select: none;
}

.login-card {
  width: 100%;
  max-width: 390px;
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 16px;
  padding: 36px 32px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
}

.login-logo {
  text-align: center;
  margin-bottom: 28px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 14px;
}

.login-error {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.4);
  color: #fca5a5;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 14px;
}

.login-button {
  width: 100%;
  justify-content: center;
  font-weight: 600;
  height: 42px;
  background: linear-gradient(135deg, var(--accent-color), var(--accent-color-hover)) !important;
  border: none !important;
  box-shadow: 0 4px 12px rgba(45, 125, 210, 0.2);
  transition: all 0.2s ease;
}
.login-button:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(45, 125, 210, 0.3);
}

.brand-hero {
  padding: 8px 0 16px;
  text-align: center;
}

.brand-logo-frame {
  width: 135px;
  height: 135px;
  margin: 0 auto 20px;
  border-radius: 28px;
  background: linear-gradient(135deg, var(--bg-panel), var(--bg-active-box));
  border: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.25), 0 0 25px rgba(45, 125, 210, 0.18);
  transition: transform 0.3s ease, box-shadow 0.3s ease;
}
.brand-logo-frame:hover {
  transform: scale(1.05);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.3), 0 0 30px rgba(45, 125, 210, 0.28);
}

.brand-logo {
  width: 96px;
  height: 96px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.2));
}

:global(html[data-theme="light"] .brand-logo-frame) {
  background: #ffffff;
  border-color: #d7dee8;
  box-shadow: 0 8px 18px rgba(30, 64, 105, 0.10), 0 0 18px rgba(45, 125, 210, 0.10);
}

:global(html[data-theme="light"] .brand-logo) {
  filter: drop-shadow(0 4px 8px rgba(30, 64, 105, 0.10));
}

:global(html[data-theme="light"] .login-card) {
  box-shadow: var(--shadow-xl);
}

.brand-hero h1 {
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(to right, #ffffff, #8fa5be);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

:global(html[data-theme="light"] .brand-hero h1) {
  background: linear-gradient(to right, #0f172a, #475569);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.brand-subtitle {
  display: inline-flex;
  margin-top: 8px;
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(45, 125, 210, 0.1);
  border: 1px solid rgba(45, 125, 210, 0.25);
  color: #5ba4f5;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

/* ── App Layout ──────────────────────────────────── */
.app-layout {
  height: calc(100vh - 52px - 42px);
  width: 100vw;
  overflow: hidden;
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  background: var(--bg-primary);
}

.app-sidebar {
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.app-content {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-primary);
  padding: 22px 24px;
}



/* ── Alt Durum Çubuğu (aktif usta + bilgi şeridi) ── */
.app-status-bar {
  height: 42px;
  flex-shrink: 0;
  width: 100vw;
  background: var(--bg-active-box);
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 14px;
  color: var(--text-primary);
}

.status-master-box {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  cursor: default;
}

.status-master-box.admin-mode-box {
  background: rgba(245, 158, 11, 0.06);
  border-radius: 8px;
  padding: 4px 10px;
  margin: 0 -10px 0 0;
}

.status-master-avatar {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--accent-color);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  flex-shrink: 0;
}

.status-master-avatar.admin-avatar {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.25);
}

.status-master-label {
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
}

.status-master-name {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-title);
  white-space: nowrap;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-master-logout-btn {
  width: 24px;
  height: 24px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.status-master-logout-btn:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.4);
  color: #f87171;
}

.status-bar-sep {
  width: 1px;
  height: 22px;
  background: var(--border-color);
  flex-shrink: 0;
}

.status-ticker {
  display: flex;
  align-items: center;
  min-width: 0;
  overflow: hidden;
  user-select: none;
}

.status-ticker-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.status-ticker-icon {
  font-size: 13px;
  color: var(--accent-color, #38bdf8);
  flex-shrink: 0;
}

.status-ticker-label {
  font-size: 11px;
  color: var(--text-muted);
  font-weight: 600;
  white-space: nowrap;
}

.status-ticker-value {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-title);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

:global(html[data-theme="light"] .app-status-bar) {
  background: #ffffff;
  border-top-color: var(--border-color);
}

.status-bar-spacer {
  flex: 1;
}

.status-gunsonu {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 5px 11px;
  border: 1px solid transparent;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s ease;
}
.status-gunsonu:hover {
  background: var(--bg-card-hover);
}
.status-gunsonu i {
  font-size: 12.5px;
}
.status-gunsonu.is-open {
  color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
  border-color: rgba(245, 158, 11, 0.24);
}
.status-gunsonu.is-closed {
  color: #34d399;
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.24);
}

.status-phone {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 5px 11px;
  border: 1px solid rgba(148, 163, 184, 0.18);
  border-radius: 6px;
  background: rgba(148, 163, 184, 0.07);
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
}
.status-phone:hover {
  background: var(--bg-card-hover);
  color: var(--text-title);
}
.status-phone i {
  font-size: 12px;
}
.status-phone.is-active {
  color: #34d399;
  background: rgba(52, 211, 153, 0.1);
  border-color: rgba(52, 211, 153, 0.24);
}
.status-phone.is-active:hover {
  color: #34d399;
}

.status-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
}
.status-phone.is-active .status-dot {
  background: #34d399;
  box-shadow: 0 0 6px rgba(52, 211, 153, 0.5);
}

/* ── Sidebar Navigation ──────────────────────────── */
.sidebar-nav {
  flex: 1;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 0;
  overflow-y: auto;
}

.nav-group {
  margin-bottom: 4px;
}

.nav-group-bottom {
  margin-top: auto;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.nav-group-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  padding: 14px 12px 6px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 9px;
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  border-left: 3px solid transparent;
  transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease, border-left-color 0.2s ease;
  margin-bottom: 2px;
}

.nav-item:hover {
  background: var(--bg-card-hover);
  color: var(--text-title);
  transform: translateX(2px);
}

.nav-item.active {
  background: rgba(45, 125, 210, 0.1);
  color: #5ba4f5;
  font-weight: 600;
  border-left-color: var(--accent-color);
}

.nav-icon {
  font-size: 15px;
  width: 18px;
  text-align: center;
  flex-shrink: 0;
  color: var(--text-muted);
  transition: color 0.15s ease, transform 0.15s ease;
}
.nav-item:hover .nav-icon,
.nav-item.active .nav-icon {
  color: var(--accent-color);
}
.nav-item:hover .nav-icon {
  transform: scale(1.12);
}

/* ── Light theme sidebar overrides ──────────────── */
:global(html[data-theme="light"] .app-sidebar) {
  background: #ffffff;
  border-right-color: var(--border-color);
}

:global(html[data-theme="light"] .nav-item.active) {
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  border-left-color: #2563eb;
}
:global(html[data-theme="light"] .nav-item:hover) {
  background: #f1f5f9;
  color: #0f172a;
}
:global(html[data-theme="light"] .nav-group-bottom) {
  border-top-color: var(--border-color);
}

/* Specialized state components overrides for light mode */
:global(html[data-theme="light"] .low-stock-box) {
  background: #fff7ed !important;
  border-color: #fb923c !important;
  color: #9a3412 !important;
}

:global(html[data-theme="light"] .low-stock-box h3),
:global(html[data-theme="light"] .low-stock-box strong),
:global(html[data-theme="light"] .low-stock-box span),
:global(html[data-theme="light"] .low-stock-box em),
:global(html[data-theme="light"] .low-stock-box p) {
  color: #9a3412 !important;
}

:global(html[data-theme="light"] .existing-vehicle-box) {
  background: #f0fdf4 !important;
  border-color: #22c55e !important;
  color: #166534 !important;
}

:global(html[data-theme="light"] .existing-vehicle-box strong),
:global(html[data-theme="light"] .existing-vehicle-box span) {
  color: #166534 !important;
}

@media (max-width: 900px) {
  .app-layout {
    grid-template-columns: 220px minmax(0, 1fr);
  }
  .app-content {
    padding: 16px;
  }
}

.login-toggle-wrapper {
  text-align: center;
  margin-top: 8px;
}

.login-toggle-link {
  font-size: 12px;
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.15s ease;
}

.login-toggle-link:hover {
  color: var(--accent-color);
}

.admin-login-indicator {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(245, 158, 11, 0.05);
  border: 1px dashed rgba(245, 158, 11, 0.25);
  border-radius: 8px;
  padding: 10px 12px;
  color: #f59e0b;
  font-size: 13.5px;
  font-weight: 600;
  margin-bottom: 4px;
}

.admin-login-indicator i {
  font-size: 15px;
}


/* ── Güncelleme şeridi ───────────────────────────── */
.update-bar {
  position: fixed;
  right: 20px;
  bottom: 62px;
  z-index: 9000;
  display: flex;
  align-items: center;
  gap: 14px;
  max-width: min(560px, calc(100vw - 40px));
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--accent-color);
  box-shadow: var(--shadow-xl);
  animation: update-bar-in 0.25s ease;
}

.update-bar-icon {
  font-size: 20px;
  color: var(--accent-color);
  flex-shrink: 0;
}

.update-bar-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.update-bar-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
  min-width: 210px;
}

.update-progress-track {
  width: 100%;
  height: 8px;
  overflow: hidden;
  border: 1px solid var(--border-color);
  border-radius: 999px;
  background: var(--bg-active-box);
}

.update-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--accent-color), #22c55e);
  transition: width 0.2s ease;
}

.update-bar-texts strong {
  color: var(--text-title);
  font-size: 14px;
  font-weight: 600;
}

.update-bar-texts span {
  color: var(--text-muted);
  font-size: 12.5px;
  line-height: 1.45;
}

@keyframes update-bar-in {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}

.refresh-btn-titlebar {
  font-size: 15px !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.refresh-btn-titlebar:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.gunsonu-reminder-body {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.gunsonu-reminder-body p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--text-secondary);
}

.gunsonu-reminder-icon {
  font-size: 22px;
  color: #f59e0b;
  margin-top: 2px;
  flex-shrink: 0;
}

/* ── Bilgi Şeridi geçiş animasyonu (durum çubuğunda kullanılır) ── */
.ticker-slide-enter-active,
.ticker-slide-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease !important;
}

.ticker-slide-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.ticker-slide-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

</style>
