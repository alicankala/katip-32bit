<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRouter } from 'vue-router'
import { useFormatters } from '../composables/useFormatters'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Tag from 'primevue/tag'
import EmptyState from '../components/EmptyState.vue'
import HelpButton from '../components/HelpButton.vue'

const router = useRouter()

const istatistikler = ref({
  musteriSayisi: 0,
  aracSayisi: 0,
  musteriAktif: 0,
  musteriToplam: 0,
  aracAktif: 0,
  aracToplam: 0,
  acikIsEmri: 0,
  tamamlananIsEmri: 0,
toplamStok: 0,
dusukStok: 0,
bitenStok: 0
})

const sonAcikIsEmirleri = ref([])
const tumAcikIsEmirleri = ref([])
const dusukStokParcalari = ref([])
const borcOzeti = ref({
  toplamBorc: 0,
  acikCariSayisi: 0,
  borclar: []
})
const yukleniyor = ref(true)
const uzunSureAcikAyarlari = ref({ enabled: true, gun: 3 })

const uzunSureAcikIsEmirleri = computed(() => {
  if (!uzunSureAcikAyarlari.value.enabled) return []
  const simdi = Date.now()

  return tumAcikIsEmirleri.value
    .filter((wo) => wo.status !== 'Tamamlandı' && wo.created_at)
    .map((wo) => {
      const acilisZamani = new Date(String(wo.created_at).includes('T') ? wo.created_at : String(wo.created_at).replace(' ', 'T') + 'Z').getTime()
      return { ...wo, gecenGun: Math.floor((simdi - acilisZamani) / (24 * 60 * 60 * 1000)) }
    })
    .filter((wo) => wo.gecenGun >= uzunSureAcikAyarlari.value.gun)
    .sort((a, b) => b.gecenGun - a.gecenGun)
})

const secereVerileri = ref([])
const dashSeciliFotograf = ref(null)
const gecmisAramaMetni = ref('')
const gecmisArandi = ref(false)
const gecmisYukleniyor = ref(false)

const verileriYukle = async () => {
  yukleniyor.value = true
  try {
    const [istatistikRes, borcRes] = await Promise.all([
      window.api.istatistikleriGetir(),
      window.api.anaPanelBorclariGetir?.(3)
    ])

    if (istatistikRes?.success) {
      istatistikler.value = {
        ...istatistikler.value,
        ...istatistikRes.veriler
      }
    }

    if (borcRes?.success) {
      borcOzeti.value = {
        toplamBorc: Number(borcRes.totalDebt || 0),
        acikCariSayisi: Number(borcRes.openAccountCount || 0),
        borclar: Array.isArray(borcRes.debts) ? borcRes.debts : []
      }
    }

    const isEmirleri = await window.api.isEmirleriGetir()
    const isEmirleriListesi = Array.isArray(isEmirleri) ? isEmirleri : []

    tumAcikIsEmirleri.value = isEmirleriListesi
    sonAcikIsEmirleri.value = isEmirleriListesi
      .filter((isEmri) => isEmri.status !== 'Tamamlandı')
      .slice(0, 5)

    let ayarlar = null
    if (window.api.ayarlariGetir) {
      try {
        const sRes = await window.api.ayarlariGetir()
        if (sRes?.success) ayarlar = sRes.settings
      } catch (e) {}
    }

    uzunSureAcikAyarlari.value = {
      enabled: ayarlar?.show_long_open_workorder_warnings !== 'false',
      gun: Number(ayarlar?.long_open_workorder_days) || 3
    }

    if (window.api.dusukStokParcalariGetir) {
      const showWarnings = ayarlar?.show_critical_stock_warnings !== 'false'
      dusukStokParcalari.value = showWarnings ? await window.api.dusukStokParcalariGetir(5) : []
    }
  } finally {
    yukleniyor.value = false
  }
}

const aramaSonuclariDialogAcik = ref(false)
const detayDialogAcik = ref(false)
const seciliArac = ref(null)

const oneriler = ref([])
const onerilerAcik = ref(false)
let debounceTimer = null

const benzersizAraclar = computed(() => {
  const groups = {}
  secereVerileri.value.forEach(wo => {
    const key = wo.plate || 'PLAKASIZ'
    if (!groups[key] || new Date(wo.created_at) > new Date(groups[key].last_visit_date)) {
      groups[key] = {
        plate: wo.plate,
        customer_name: wo.customer_name,
        customer_phone: wo.customer_phone,
        brand: wo.brand,
        model: wo.model,
        last_visit_date: wo.created_at,
        last_visit_status: wo.status,
        last_visit_description: wo.description,
        workOrders: []
      }
    }
  })
  
  secereVerileri.value.forEach(wo => {
    const key = wo.plate || 'PLAKASIZ'
    if (groups[key]) {
      groups[key].workOrders.push(wo)
    }
  })
  
  Object.keys(groups).forEach(key => {
    groups[key].workOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
  })
  
  return Object.values(groups)
})

const seciliAracWorkOrders = computed(() => {
  return seciliArac.value ? seciliArac.value.workOrders : []
})

// İş emri kalemleri ve fotoğrafları arama sorgusuyla birlikte gelmiyor; fotoğraflar
// base64 gömülü döndüğü için tüm sonuçlar için peşin çekmek ağır olurdu. Bu yüzden
// yalnızca seçilen aracın iş emirleri için, bir kez, istendiğinde yükleniyor.
const woDetaylari = ref({})
const detayYukleniyor = ref(false)

const seciliAracDetaylariniYukle = async (arac) => {
  const isEmirleri = arac?.workOrders || []
  const eksikler = isEmirleri.filter((wo) => wo?.id && !woDetaylari.value[wo.id])
  if (eksikler.length === 0) return

  detayYukleniyor.value = true
  try {
    await Promise.all(
      eksikler.map(async (wo) => {
        try {
          const [kalemRes, fotoRes] = await Promise.all([
            window.api.isEmriKalemleriGetir(wo.id),
            window.api.isEmriFotograflariGetir(wo.id)
          ])

          woDetaylari.value[wo.id] = {
            kalemler: kalemRes?.success && Array.isArray(kalemRes.kalemler) ? kalemRes.kalemler : [],
            fotograflar: fotoRes?.success && Array.isArray(fotoRes.fotograflar) ? fotoRes.fotograflar : []
          }
        } catch (e) {
          console.error('İş emri detayı yüklenemedi:', wo.id, e)
          woDetaylari.value[wo.id] = { kalemler: [], fotograflar: [] }
        }
      })
    )
  } finally {
    detayYukleniyor.value = false
  }
}

const detayGoster = (arac) => {
  seciliArac.value = arac
  seciliAracDetaylariniYukle(arac)
}

const gecmisSorgula = async () => {
  onerilerAcik.value = false
  gecmisArandi.value = true
  gecmisYukleniyor.value = true

  try {
    const res = await window.api.servisGecmisiAra(gecmisAramaMetni.value)

    if (res?.success) {
      secereVerileri.value = Array.isArray(res.gecmis) ? res.gecmis : []
      if (secereVerileri.value.length > 0) {
        aramaSonuclariDialogAcik.value = true
        // Auto-select the first vehicle to give a rich, instant overview
        const uAraclar = benzersizAraclar.value
        if (uAraclar.length > 0) {
          seciliArac.value = uAraclar[0]
          seciliAracDetaylariniYukle(uAraclar[0])
        } else {
          seciliArac.value = null
        }
      } else {
        seciliArac.value = null
      }
    } else {
      secereVerileri.value = []
      seciliArac.value = null
    }
  } catch (error) {
    console.error('Servis geçmişi arama hatası:', error)
    secereVerileri.value = []
    seciliArac.value = null
  } finally {
    gecmisYukleniyor.value = false
  }
}

const gecmisTemizle = () => {
  gecmisAramaMetni.value = ''
  gecmisArandi.value = false
  secereVerileri.value = []
  aramaSonuclariDialogAcik.value = false
  seciliArac.value = null
  woDetaylari.value = {}
  oneriler.value = []
  onerilerAcik.value = false
}

const onerileriGoster = () => {
  if (oneriler.value.length > 0) {
    onerilerAcik.value = true
  }
}

const sadelestir = (deger) => String(deger || '').toLowerCase().replace(/[\s\-()]/g, '')

const oneriTuruGetir = (oneri) => {
  const query = sadelestir(gecmisAramaMetni.value)
  if (!query) return 'Müşteri'

  if (sadelestir(oneri.plate).includes(query)) {
    return 'Plaka'
  }
  if (sadelestir(oneri.customer_phone).includes(query)) {
    return 'Telefon'
  }
  return 'Müşteri'
}

const oneriSec = (oneri) => {
  gecmisAramaMetni.value = oneri.plate || oneri.customer_name
  onerilerAcik.value = false
  oneriler.value = []
  gecmisSorgula()
}

const onerileriGetir = () => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }

  const query = (gecmisAramaMetni.value || '').trim()
  if (query.length < 2) {
    oneriler.value = []
    onerilerAcik.value = false
    return
  }

  debounceTimer = setTimeout(async () => {
    try {
      // Öneri listesi en fazla 6 araç gösteriyor (aşağıdaki slice). Her tuş
      // vuruşunda eşleşen tüm iş emirlerini çekmeye gerek yok; en yeni 300 kayıt
      // 6 farklı plakayı fazlasıyla kapsar. Enter ile yapılan tam arama
      // (gecmisSorgula) sınırsız kalmaya devam ediyor.
      const res = await window.api.servisGecmisiAra(query, 300)
      if (res?.success && Array.isArray(res.gecmis)) {
        const groups = {}
        res.gecmis.forEach(wo => {
          const key = wo.plate || 'PLAKASIZ'
          if (!groups[key] || new Date(wo.created_at) > new Date(groups[key].last_visit_date)) {
            groups[key] = {
              plate: wo.plate,
              customer_name: wo.customer_name,
              customer_phone: wo.customer_phone,
              brand: wo.brand,
              model: wo.model,
              last_visit_date: wo.created_at,
              status: wo.status,
              description: wo.description,
              workOrders: []
            }
          }
        })
        
        res.gecmis.forEach(wo => {
          const key = wo.plate || 'PLAKASIZ'
          if (groups[key]) {
            groups[key].workOrders.push(wo)
          }
        })
        
        Object.keys(groups).forEach(key => {
          groups[key].workOrders.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        })

        oneriler.value = Object.values(groups).slice(0, 6)
        onerilerAcik.value = oneriler.value.length > 0
      } else {
        oneriler.value = []
        onerilerAcik.value = false
      }
    } catch (e) {
      console.error('Öneri getirme hatası:', e)
      oneriler.value = []
      onerilerAcik.value = false
    }
  }, 250)
}

const closeSuggestionsOnOutsideClick = (e) => {
  const container = document.querySelector('.search-module')
  if (container && !container.contains(e.target)) {
    onerilerAcik.value = false
  }
}

const kalemBasligiGetir = (kalem) => {
  const parcaAdi = String(kalem?.part_name || '').trim()
  const aciklama = String(kalem?.description || '').trim()

  if (parcaAdi && aciklama && parcaAdi !== aciklama) {
    return `${parcaAdi} - ${aciklama}`
  }

  return parcaAdi || aciklama || 'Kalem'
}

const { tlFormatla, tarihSaatFormatla: tarihFormatla } = useFormatters()

const getSeverity = (status) => {
  if (status === 'Tamamlandı') return 'success'
  if (status === 'Beklemede') return 'warning'
  if (status === 'Açık') return 'danger'
  return 'info'
}

const servisKabuleGit = () => {
  router.push('/service-reception')
}

const yeniBorcEklemeyeGit = () => {
  router.push({ path: '/current-accounts', query: { tab: 'borclar', action: 'new-debt' } })
}

const borclaraGit = () => {
  router.push({ path: '/current-accounts', query: { tab: 'borclar' } })
}

const isEmirlerineGit = () => {
  router.push('/work-orders')
}

const isEmriniAc = (isEmri) => {
  if (!isEmri?.id) return
  router.push({ path: '/work-orders', query: { open: String(isEmri.id) } })
}

const genelYenileme = genelVeriYenilemeIsleyicisi(verileriYukle)

onMounted(() => {
  verileriYukle()
  window.addEventListener('click', closeSuggestionsOnOutsideClick)
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
  }
  window.removeEventListener('click', closeSuggestionsOnOutsideClick)
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div class="page dashboard-page">

    <!-- ── Page Header ──────────────────────────────── -->
    <div class="page-header dash-header">
      <div>
        <h1 class="page-title">Servis Yönetim Paneli <HelpButton konu="ekran-duzeni" /></h1>
        <p class="page-subtitle">Günlük servis durumu, açık işler ve müşteri geçmişi</p>
      </div>
      <div class="dash-header-actions">
        <Button
          label="Yeni Servis Kabul"
          icon="pi pi-bolt"
          severity="success"
          @click="servisKabuleGit"
        />
        <Button
          label="Yeni Borç Ekle"
          icon="pi pi-plus"
          severity="danger"
          @click="yeniBorcEklemeyeGit"
        />
      </div>
    </div>

    <!-- ── Stat Cards ──────────────────────────────── -->
    <div class="dash-stat-grid">
      <div
        class="dash-stat-card accent-blue"
        role="button"
        tabindex="0"
        title="İş emirlerine git"
        @click="isEmirlerineGit"
        @keyup.enter="isEmirlerineGit"
      >
        <div class="stat-card-inner">
          <div class="stat-card-body">
            <div class="stat-card-label">Açık İş Emri</div>
            <div class="stat-card-value">{{ istatistikler.acikIsEmri }}</div>
            <div class="stat-card-sub">Tamamlanan: {{ istatistikler.tamamlananIsEmri }}</div>
          </div>
          <i class="pi pi-wrench stat-card-icon"></i>
        </div>
      </div>

      <div
        class="dash-stat-card accent-green"
        role="button"
        tabindex="0"
        title="Müşterilere git"
        @click="router.push('/customers')"
        @keyup.enter="router.push('/customers')"
      >
        <div class="stat-card-inner">
          <div class="stat-card-body">
            <div class="stat-card-label">Kayıtlı Müşteri</div>
            <div class="stat-card-value">{{ istatistikler.musteriAktif }}</div>
            <div class="stat-card-sub">Toplam: {{ istatistikler.musteriToplam }}</div>
          </div>
          <i class="pi pi-users stat-card-icon"></i>
        </div>
      </div>

      <div
        class="dash-stat-card accent-amber"
        role="button"
        tabindex="0"
        title="Araçlara git"
        @click="router.push('/vehicles')"
        @keyup.enter="router.push('/vehicles')"
      >
        <div class="stat-card-inner">
          <div class="stat-card-body">
            <div class="stat-card-label">Servisteki Araç</div>
            <div class="stat-card-value">{{ istatistikler.aracAktif }}</div>
            <div class="stat-card-sub">Tamamlanan: {{ istatistikler.aracToplam }}</div>
          </div>
          <i class="pi pi-car stat-card-icon"></i>
        </div>
      </div>

      <div
        class="dash-stat-card accent-purple"
        role="button"
        tabindex="0"
        title="Parça / Stok'a git"
        @click="router.push('/parts')"
        @keyup.enter="router.push('/parts')"
      >
        <div class="stat-card-inner">
          <div class="stat-card-body">
            <div class="stat-card-label">Aktif Parça Kartı</div>
            <div class="stat-card-value">{{ istatistikler.toplamStok }}</div>
            <div class="stat-card-sub">Kritik: {{ istatistikler.dusukStok }}&nbsp;&nbsp;Biten: {{ istatistikler.bitenStok }}</div>
          </div>
          <i class="pi pi-box stat-card-icon"></i>
        </div>
      </div>
    </div>

    <!-- ── Content Grid ───────────────────────────── -->
    <div class="dashboard-content-grid">

      <!-- ─ Sol: Son Açık İş Emirleri ─ -->
      <div class="info-panel">
        <div class="panel-title-row">
          <div>
            <h2>Son Açık İş Emirleri</h2>
            <p>Tamamlanmamış son 5 iş emri</p>
          </div>
          <Button
            label="Tümünü Gör"
            icon="pi pi-arrow-right"
            size="small"
            severity="secondary"
            outlined
            @click="isEmirlerineGit"
          />
        </div>

        <div v-if="yukleniyor" class="skeleton-list">
          <div class="skeleton-row" v-for="n in 5" :key="n">
            <span class="skeleton-block" style="width:70px"></span>
            <span class="skeleton-block" style="width:90px"></span>
            <span class="skeleton-block" style="flex:1"></span>
            <span class="skeleton-block" style="width:70px"></span>
            <span class="skeleton-block" style="width:80px"></span>
          </div>
        </div>

        <div v-else-if="sonAcikIsEmirleri.length > 0" class="table-panel">
          <DataTable
            :value="sonAcikIsEmirleri"
            responsiveLayout="scroll"
            class="p-datatable-sm clickable-work-orders"
            @row-click="isEmriniAc($event.data)"
          >
            <Column header="Tarih" style="width:130px">
              <template #body="slotProps">
                <span class="cell-date">{{ tarihFormatla(slotProps.data.created_at) }}</span>
              </template>
            </Column>
            <Column header="Plaka" style="width:110px">
              <template #body="slotProps">
                <span class="plate-cell">{{ slotProps.data.plate }}</span>
                <div class="cell-sub">{{ slotProps.data.brand || '-' }} {{ slotProps.data.model || '' }}</div>
              </template>
            </Column>
            <Column header="Müşteri">
              <template #body="slotProps">
                {{ slotProps.data.customer_name || '-' }}
              </template>
            </Column>
            <Column header="KM" style="width:90px">
              <template #body="slotProps">
                {{ slotProps.data.mileage ? Number(slotProps.data.mileage).toLocaleString('tr-TR') : '-' }}
              </template>
            </Column>
            <Column header="Tutar" style="width:110px">
              <template #body="slotProps">
                <strong class="cell-price">{{ tlFormatla(slotProps.data.total_price) }}</strong>
              </template>
            </Column>
            <Column header="Durum" style="width:110px">
              <template #body="slotProps">
                <Tag :value="slotProps.data.status" :severity="getSeverity(slotProps.data.status)" />
              </template>
            </Column>
          </DataTable>
        </div>

        <EmptyState
          v-else
          icon="pi pi-inbox"
          title="Açık iş emri yok"
          description="Şu an serviste bekleyen araç bulunmuyor. Yeni bir araç geldiğinde Servis Kabul ekranından alın; iş emri kendiliğinden açılır."
          action-label="Servis Kabul'e Git"
          action-icon="pi pi-bolt"
          hint-label="Nasıl yapılır?"
          compact
          @action="router.push('/service-reception')"
          @hint="router.push({ path: '/help', query: { konu: 'servis-kabul' } })"
        />
      </div>

      <!-- ─ Sağ: Arama + Kritik Stok ─ -->
      <div class="right-panel">

        <!-- Müşteri / Plaka / Telefon Arama Modulü -->
        <div class="search-module">
          <div class="search-module-header">
            <i class="pi pi-search"></i>
            <span>Müşteri / Plaka / Telefon Ara</span>
          </div>
          <div class="search-module-input-row" style="position: relative;">
            <span class="p-input-icon-left" style="flex: 1;">
              <i class="pi pi-search" />
              <InputText
                v-model="gecmisAramaMetni"
                placeholder="Plaka, telefon, müşteri adı veya işlem yazın..."
                class="search-module-input"
                @keyup.enter="gecmisSorgula"
                @input="onerileriGetir"
                @focus="onerileriGoster"
              />
            </span>
            <Button
              icon="pi pi-search"
              :loading="gecmisYukleniyor"
              @click="gecmisSorgula"
              title="Ara"
            />
            <Button
              v-if="gecmisArandi"
              icon="pi pi-times"
              severity="secondary"
              outlined
              @click="gecmisTemizle"
              title="Temizle"
            />

            <!-- Öneriler Listesi Dropdown -->
            <div
              v-if="onerilerAcik && oneriler.length > 0"
              class="search-suggestions-dropdown"
              style="position: absolute; top: 100%; left: 0; right: 0; z-index: 1000; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 8px; margin-top: 6px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4); max-height: 280px; overflow-y: auto; display: flex; flex-direction: column;"
            >
              <div
                v-for="oneri in oneriler"
                :key="oneri.plate + '-' + oneri.customer_name"
                class="suggestion-row"
                style="padding: 10px 12px; cursor: pointer; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; transition: background 0.15s;"
                @click="oneriSec(oneri)"
              >
                <div style="display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0;">
                  <span style="font-size: 13px; font-weight: 600; color: var(--text-title); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">
                    {{ oneri.customer_name }}
                  </span>
                  <span style="font-size: 11px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;">
                    {{ oneri.customer_phone || '-' }} &bull; <strong style="font-family: monospace; font-size: 11px; color: var(--text-muted);">{{ oneri.plate }}</strong> &bull; {{ oneri.brand || '' }} {{ oneri.model || '' }}
                  </span>
                </div>
                <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 3px; margin-left: 8px;">
                  <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: var(--accent-color, #38bdf8); background: rgba(56, 189, 248, 0.1); padding: 2px 6px; border-radius: 4px;">
                    {{ oneriTuruGetir(oneri) }}
                  </span>
                  <span v-if="oneri.last_visit_date" style="font-size: 10px; color: var(--text-muted);">
                    {{ tarihFormatla(oneri.last_visit_date).split(' ')[0] }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <!-- Arama Sonucu -->
          <div v-if="gecmisYukleniyor" class="search-status">
            <i class="pi pi-spin pi-spinner"></i> Aranıyor...
          </div>

          <div v-else-if="secereVerileri.length > 0" class="search-success-hint" style="padding: 12px; text-align: center; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 8px;">
            <i class="pi pi-check-circle" style="color: #10b981; font-size: 24px; margin-bottom: 8px; display: block;"></i>
            <p style="font-size: 13px; color: var(--text-secondary); margin-bottom: 12px; line-height: 1.4;">
              {{ benzersizAraclar.length }} araç için arama sonuçları bulundu.
            </p>
            <Button
              label="Sonuçları Göster"
              icon="pi pi-external-link"
              class="p-button-sm p-button-secondary w-full"
              @click="aramaSonuclariDialogAcik = true"
            />
          </div>

          <div v-else-if="gecmisArandi" class="search-empty">
            <i class="pi pi-search"></i>
            <p>Eşleşen kayıt bulunamadı.</p>
          </div>

          <div v-else class="search-hint">
            Plaka, müşteri adı, telefon veya yapılan işlem ile geçmiş servisleri bulun.
          </div>
        </div>

        <!-- Açık Borçlar: x86 için yalnızca özet ve en yüksek 3 cari yüklenir. -->
        <div
          class="dashboard-debt-panel"
          role="button"
          tabindex="0"
          title="Finans borçlarına git"
          @click="borclaraGit"
          @keyup.enter="borclaraGit"
        >
          <div class="dashboard-debt-header">
            <div>
              <div class="dashboard-debt-title"><i class="pi pi-wallet"></i> Açık Borçlar</div>
              <div class="dashboard-debt-summary">
                {{ tlFormatla(borcOzeti.toplamBorc) }} · {{ borcOzeti.acikCariSayisi }} açık cari
              </div>
            </div>
            <span class="dashboard-debt-link">Tümünü Gör <i class="pi pi-arrow-right"></i></span>
          </div>

          <div v-if="yukleniyor" class="dashboard-debt-list skeleton-list">
            <div class="skeleton-row" v-for="n in 3" :key="n">
              <span class="skeleton-block" style="flex:1"></span>
              <span class="skeleton-block" style="width:80px"></span>
            </div>
          </div>

          <div v-else-if="borcOzeti.borclar.length" class="dashboard-debt-list">
            <div v-for="borc in borcOzeti.borclar" :key="borc.id" class="dashboard-debt-row">
              <span class="dashboard-debt-name">
                <strong>{{ borc.name || 'İsimsiz Cari' }}</strong>
                <small>{{ borc.type || 'Tedarikçi / Taşeron' }}</small>
              </span>
              <strong class="dashboard-debt-amount">{{ tlFormatla(borc.remaining_debt) }}</strong>
            </div>
          </div>

          <div v-else class="dashboard-debt-empty">
            <i class="pi pi-check-circle"></i> Açık tedarikçi borcu bulunmuyor.
          </div>
        </div>

        <!-- Uzun Süredir Açık İş Emri Uyarısı -->
        <div v-if="!yukleniyor && uzunSureAcikIsEmirleri.length > 0" class="long-open-box">
          <div class="low-stock-header">
            <i class="pi pi-clock"></i>
            <h3>Uzun Süredir Açık İş Emri</h3>
          </div>
          <ul>
            <li v-for="wo in uzunSureAcikIsEmirleri.slice(0, 5)" :key="wo.id" @click="isEmriniAc(wo)">
              <strong>{{ wo.plate || 'PLAKASIZ' }}</strong>
              <span>{{ wo.customer_name || '-' }}</span>
              <em>{{ wo.gecenGun }} gün</em>
            </li>
          </ul>
        </div>

        <!-- Kritik Stok Paneli -->
        <div v-if="yukleniyor" class="low-stock-box skeleton-list" style="border-left-color: var(--border-color);">
          <div class="skeleton-row" v-for="n in 3" :key="n">
            <span class="skeleton-block" style="width:60px"></span>
            <span class="skeleton-block" style="flex:1"></span>
            <span class="skeleton-block" style="width:40px"></span>
          </div>
        </div>

        <div v-else-if="dusukStokParcalari.length > 0" class="low-stock-box">
          <div class="low-stock-header">
            <i class="pi pi-exclamation-triangle"></i>
            <h3>Kritik Stok Uyarısı</h3>
          </div>
          <ul>
            <li v-for="parca in dusukStokParcalari" :key="parca.id">
              <strong>{{ parca.code }}</strong>
              <span>{{ parca.name }}</span>
              <em v-if="parca.critical_stock_enabled !== 0">{{ parca.stock }}/{{ parca.critical_stock ?? 5 }}</em>
              <em v-else style="color: var(--status-open, #ef4444);">{{ parca.stock }}/Tükendi</em>
            </li>
          </ul>
        </div>

        <div v-else class="stock-empty-box">
          <i class="pi pi-check-circle"></i>
          <strong>Kritik stokta parça yok</strong>
        </div>
      </div>
    </div>

    <!-- Arama Sonuçları Modalleri -->
    <Dialog
      v-model:visible="aramaSonuclariDialogAcik"
      modal
      header="Müşteri & Araç Geçmişi Arama Sonuçları"
      :style="{ width: '85vw', maxWidth: '1200px' }"
      :breakpoints="{ '1024px': '95vw', '640px': '100vw' }"
    >
      <div class="search-results-modal-layout" style="display: flex; gap: 20px; height: 65vh; min-height: 450px;">
        
        <!-- Sol Bölüm: Arama Sonuçları Listesi -->
        <div class="results-sidebar" style="flex: 0 0 35%; display: flex; flex-direction: column; border-right: 1px solid var(--border-color); padding-right: 16px; overflow-y: auto;">
          <h4 style="margin: 0 0 12px 0; font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">
            Eşleşen Araçlar ({{ benzersizAraclar.length }})
          </h4>
          
          <div style="display: flex; flex-direction: column; gap: 10px;">
            <div
              v-for="arac in benzersizAraclar"
              :key="arac.plate"
              class="vehicle-result-row"
              :class="{ 'active': seciliArac && seciliArac.plate === arac.plate }"
              style="padding: 12px; border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer; transition: all 0.2s; background: var(--bg-panel);"
              @click="detayGoster(arac)"
            >
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                <span class="plate-cell" style="font-size: 12px; padding: 2px 6px; font-family: monospace; font-weight: 700;">
                  {{ arac.plate || 'PLAKASIZ' }}
                </span>
                <Tag :value="arac.last_visit_status || '-'" :severity="getSeverity(arac.last_visit_status)" />
              </div>
              <div style="font-size: 13.5px; font-weight: 700; color: var(--text-title); margin-bottom: 4px;">
                {{ arac.customer_name || 'Müşteri Bilinmiyor' }}
              </div>
              <div style="font-size: 12px; color: var(--text-secondary); display: flex; justify-content: space-between;">
                <span>{{ arac.brand || '' }} {{ arac.model || '' }}</span>
                <span>{{ tarihFormatla(arac.last_visit_date).split(' ')[0] }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Sağ Bölüm: Seçilen Aracın Servis Geçmişi -->
        <div class="results-detail-pane" style="flex: 1 1 65%; display: flex; flex-direction: column; overflow-y: auto; padding-left: 4px;">
          <div v-if="seciliArac" style="display: flex; flex-direction: column; gap: 16px; height: 100%;">
            
            <!-- Üst Sabit Özet Kartı -->
            <div class="customer-info-banner" style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <div><span style="color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 700; margin-right: 6px;">Müşteri:</span> <strong style="font-size: 13.5px; font-weight: 600; color: var(--text-title);">{{ seciliArac.customer_name || 'Bilinmiyor' }}</strong></div>
                <div><span style="color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 700; margin-right: 6px;">Telefon:</span> <strong style="font-size: 13.5px; font-weight: 600; color: var(--text-title);">{{ seciliArac.customer_phone || '-' }}</strong></div>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center;">
                <div><span style="color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 700; margin-right: 6px;">Plaka:</span> <strong class="plate-cell">{{ seciliArac.plate || 'PLAKASIZ' }}</strong></div>
                <div><span style="color: var(--text-muted); font-size: 11px; text-transform: uppercase; font-weight: 700; margin-right: 6px;">Araç:</span> <strong style="font-size: 13.5px; font-weight: 600; color: var(--text-title);">{{ seciliArac.brand || '' }} {{ seciliArac.model || '' }}</strong></div>
              </div>
            </div>

            <!-- Servis Geçmişi Zaman Çizelgesi -->
            <h4 style="margin: 0; font-size: 13px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700;">
              Servis Geçmişi ({{ seciliAracWorkOrders.length }} Ziyaret)
            </h4>
            
            <div class="visits-timeline" style="display: flex; flex-direction: column; gap: 16px; padding-bottom: 20px;">
              <div
                v-for="(visit, idx) in seciliAracWorkOrders"
                :key="visit.id"
                class="visit-history-card"
                style="background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px;"
              >
                <!-- Üst Kısım -->
                <div class="visit-card-top" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">
                  <div style="display: flex; gap: 10px; align-items: center;">
                    <span style="font-weight: 700; color: var(--accent-color, #38bdf8); font-size: 13.5px;">{{ idx + 1 }}. Servis Kaydı</span>
                    <Tag :value="visit.status || '-'" :severity="getSeverity(visit.status)" />
                  </div>
                  <strong style="color: var(--accent-color, #38bdf8); font-size: 14.5px;">{{ tlFormatla(visit.total_price) }}</strong>
                </div>

                <!-- Detay Grid -->
                <div class="visit-card-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; font-size: 12.5px;">
                  <div><span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 700;">Açılış:</span> <strong style="display: block; margin-top: 2px; color: var(--text-title);">{{ tarihFormatla(visit.created_at) }}</strong></div>
                  <div><span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 700;">Kapanış:</span> <strong style="display: block; margin-top: 2px; color: var(--text-title);">{{ visit.closed_at ? tarihFormatla(visit.closed_at) : '-' }}</strong></div>
                  <div><span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 700;">Açan Usta:</span> <strong style="display: block; margin-top: 2px; color: var(--text-title);">{{ visit.opened_by_master_name || '-' }}</strong></div>
                  <div><span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 700;">Kapatan Usta:</span> <strong style="display: block; margin-top: 2px; color: var(--text-title);">{{ visit.closed_by_master_name || '-' }}</strong></div>
                  <div><span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 700;">Tahsil Edilen:</span> <strong style="display: block; margin-top: 2px; color: #34d399;">{{ tlFormatla(visit.toplam_tahsilat || 0) }}</strong></div>
                  <div><span style="color: var(--text-muted); font-size: 10px; text-transform: uppercase; font-weight: 700;">Kalan Borç:</span> <strong style="display: block; margin-top: 2px; color: #f87171;">{{ tlFormatla((Number(visit.total_price || 0) - Number(visit.toplam_tahsilat || 0)).toFixed(2)) }}</strong></div>
                </div>

                <!-- Şikayet / Açıklama -->
                <div v-if="visit.description" class="visit-complaint-section" style="font-size: 13px; background: var(--bg-panel); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); color: var(--text-secondary); line-height: 1.4;">
                  <span style="color: var(--text-title); font-weight: 700; margin-right: 4px; font-size: 12px;">Şikayet:</span>
                  {{ visit.description }}
                </div>

                <!-- Kalemler -->
                <div v-if="woDetaylari[visit.id]?.kalemler?.length" class="visit-items-section">
                  <span style="font-weight: 700; color: var(--text-title); font-size: 12px; display: block; margin-bottom: 6px;">Kalemler:</span>
                  <div style="display: flex; flex-direction: column; gap: 4px;">
                    <div
                      v-for="kalem in woDetaylari[visit.id].kalemler"
                      :key="kalem.id"
                      style="display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 6px; font-size: 12px;"
                    >
                      <div style="display: flex; flex-direction: column; gap: 1px;">
                        <span style="font-weight: 600;">
                          <i :class="kalem.type === 'Parça' || kalem.type === 'Parca' ? 'pi pi-cog' : 'pi pi-user'" style="font-size: 10px; margin-right: 4px;"></i>
                          {{ kalemBasligiGetir(kalem) }}
                        </span>
                        <span style="font-size: 10.5px; color: var(--text-secondary);">
                          {{ kalem.quantity }} {{ kalem.type === 'Parça' || kalem.type === 'Parca' ? 'Adet' : 'Saat' }} x {{ tlFormatla(kalem.unit_price) }}
                        </span>
                      </div>
                      <strong style="color: var(--text-primary);">{{ tlFormatla(kalem.total_price) }}</strong>
                    </div>
                  </div>
                </div>

                <!-- Eklenen Araç Fotoğrafları Galeri -->
                <div v-if="detayYukleniyor && !woDetaylari[visit.id]" style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 6px;">
                  <i class="pi pi-spin pi-spinner" style="font-size: 11px;"></i> Kalemler ve fotoğraflar yükleniyor...
                </div>

                <div v-if="woDetaylari[visit.id]?.fotograflar?.length" class="visit-photos-section" style="margin-top: 6px;">
                  <span style="font-weight: 700; color: var(--text-title); font-size: 12px; display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
                    <i class="pi pi-camera" style="color: var(--accent-color, #38bdf8);"></i>
                    Fotoğraflar ({{ woDetaylari[visit.id].fotograflar.length }})
                  </span>
                  <div style="display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px;">
                    <div
                      v-for="foto in woDetaylari[visit.id].fotograflar"
                      :key="foto.id"
                      style="position: relative; flex: 0 0 110px; height: 80px; border-radius: 6px; overflow: hidden; border: 1px solid var(--border-color); cursor: pointer;"
                      @click="dashSeciliFotograf = foto"
                    >
                      <img :src="foto.url" :alt="foto.file_name" style="width: 100%; height: 100%; object-fit: cover;" />
                      <span style="position: absolute; bottom: 0; left: 0; right: 0; background: rgba(0,0,0,0.65); color: #fff; font-size: 9px; font-weight: 600; padding: 2px 4px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">
                        {{ foto.category }}
                      </span>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </div>
          <div v-else style="display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100%; color: var(--text-secondary); text-align: center; border: 1px dashed var(--border-color); border-radius: 12px; background: var(--bg-panel); padding: 40px;">
            <i class="pi pi-history" style="font-size: 40px; color: var(--text-muted); opacity: 0.5; margin-bottom: 12px;"></i>
            <h3>Servis Geçmişi</h3>
            <p style="font-size: 13px; margin: 4px 0 0 0;">Lütfen sol taraftaki sonuç listesinden detayını görmek istediğiniz aracı seçin.</p>
          </div>
        </div>

      </div>
    </Dialog>

    <!-- Dashboard Fotoğraf Önizleme Lightbox -->
    <Dialog
      v-model:visible="dashSeciliFotograf"
      modal
      header="Araç Fotoğrafı Önizleme"
      :style="{ width: '650px' }"
    >
      <div v-if="dashSeciliFotograf" style="display: flex; flex-direction: column; gap: 12px;">
        <div style="background: #000; border-radius: 8px; overflow: hidden; text-align: center; max-height: 420px; display: flex; align-items: center; justify-content: center;">
          <img :src="dashSeciliFotograf.url" style="max-width: 100%; max-height: 420px; object-fit: contain;" />
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 13px; padding: 0 4px;">
          <Tag :value="dashSeciliFotograf.category || 'Fotoğraf'" severity="info" />
          <span style="color: var(--text-secondary);">{{ dashSeciliFotograf.note || 'Not girilmemiş' }}</span>
        </div>
      </div>
    </Dialog>

  </div>
</template>

<style scoped>
.dashboard-page {
  color: var(--text-primary);
}

/* ── Header ─────────────────────────────────── */
.dash-header {
  align-items: center;
}

.dash-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
}

:deep(.clickable-work-orders .p-datatable-tbody > tr) {
  cursor: pointer;
}

:deep(.clickable-work-orders .p-datatable-tbody > tr:hover) {
  background: var(--bg-hover, rgba(59, 130, 246, 0.08));
}

/* ── Stat Cards ─────────────────────────────── */
.dash-stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 18px;
}

.dash-stat-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 12px 16px;
  border-left-width: 4px;
  border-left-style: solid;
  cursor: pointer;
  transition: border-color 0.2s ease, box-shadow 0.25s ease, transform 0.2s ease;
}
.dash-stat-card:focus-visible {
  outline: 2px solid var(--accent-color, #38bdf8);
  outline-offset: 2px;
}
.dash-stat-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-3px);
}
.dash-stat-card.accent-blue   { border-left-color: #2d7dd2; }
.dash-stat-card.accent-green  { border-left-color: #10b981; }
.dash-stat-card.accent-amber  { border-left-color: #f59e0b; }
.dash-stat-card.accent-purple { border-left-color: #8b5cf6; }

.dash-stat-card .stat-card-icon {
  transition: transform 0.25s ease, opacity 0.2s ease;
}
.dash-stat-card:hover .stat-card-icon {
  transform: scale(1.15) rotate(-4deg);
  opacity: 0.85;
}
.dash-stat-card:hover .stat-card-value {
  color: var(--accent-color, #38bdf8);
  transition: color 0.2s ease;
}

.stat-card-inner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.stat-card-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}

.stat-card-value {
  font-size: 24px;
  font-weight: 800;
  color: var(--text-title);
  line-height: 1;
}

.stat-card-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.stat-card-icon {
  font-size: 20px;
  color: var(--border-color);
  opacity: 0.6;
  margin-top: 2px;
  flex-shrink: 0;
}

/* ── Content Grid ─────────────────────────────── */
.dashboard-content-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr);
  gap: 18px;
}

.info-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 20px;
}

.info-panel h2 {
  margin: 0 0 4px;
  color: var(--text-title);
  font-size: 18px;
  font-weight: 700;
}

.info-panel p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 14px;
}

.panel-title-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
}

.cell-date { font-size: 13px; color: var(--text-secondary); }
.cell-sub  { font-size: 12.5px; color: var(--text-secondary, #94a3b8); font-weight: 500; margin-top: 5px; }
.cell-price { font-weight: 700; color: var(--status-done); }

/* ── Right Panel & Search Module ────────────────── */
.right-panel {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.search-module {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.search-module-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.search-module-header i {
  color: var(--accent-color);
  font-size: 16px;
}

.search-module-header span {
  font-weight: 700;
  font-size: 15px;
  color: var(--text-title);
}

.search-module-input-row {
  display: flex;
  gap: 8px;
}

.search-module-input {
  flex: 1;
}

.dashboard-debt-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-left: 4px solid #ef4444;
  border-radius: 10px;
  padding: 16px;
  cursor: pointer;
}

.dashboard-debt-panel:focus-visible {
  outline: 2px solid #ef4444;
  outline-offset: 2px;
}

.dashboard-debt-header,
.dashboard-debt-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dashboard-debt-title {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-title);
  font-size: 15px;
  font-weight: 700;
}

.dashboard-debt-title i,
.dashboard-debt-amount {
  color: #f87171;
}

.dashboard-debt-summary {
  margin-top: 4px;
  color: var(--text-secondary);
  font-size: 12px;
}

.dashboard-debt-link {
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.dashboard-debt-list {
  display: flex;
  flex-direction: column;
  gap: 0;
  margin-top: 12px;
  border-top: 1px solid var(--border-color);
}

.dashboard-debt-row {
  min-height: 48px;
  border-bottom: 1px solid var(--border-color);
}

.dashboard-debt-row:last-child {
  border-bottom: 0;
}

.dashboard-debt-name {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.dashboard-debt-name strong,
.dashboard-debt-name small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dashboard-debt-name strong {
  color: var(--text-title);
  font-size: 13px;
}

.dashboard-debt-name small {
  color: var(--text-muted);
  font-size: 11px;
}

.dashboard-debt-amount {
  flex-shrink: 0;
  font-size: 13px;
}

.dashboard-debt-empty {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: 12px;
}

.dashboard-debt-empty i {
  color: #10b981;
}

.search-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px;
  color: var(--text-muted);
  font-size: 14px;
}

.search-results {
  max-height: 450px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 8px;
  padding-right: 4px;
}

/* Custom scrollbar for search results */
.search-results::-webkit-scrollbar {
  width: 6px;
}
.search-results::-webkit-scrollbar-track {
  background: transparent;
}
.search-results::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 3px;
}
.search-results::-webkit-scrollbar-thumb:hover {
  background: var(--text-muted);
}

.search-empty {
  text-align: center;
  color: var(--text-muted);
  padding: 20px;
  font-size: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.search-empty i {
  font-size: 20px;
}

.search-hint {
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.4;
  padding: 4px 2px;
}

.plate-cell {
  background: #f1f5f9 !important;
  color: #0f172a !important;
  border: 1px solid #cbd5e1 !important;
  border-left: 4px solid #1d4ed8 !important; /* TR Plate Blue */
  border-radius: 4px;
  padding: 2px 6px 2px 10px;
  font-family: 'Outfit', 'Inter', monospace;
  font-weight: 800;
  font-size: 12px;
  letter-spacing: 0.08em;
  display: inline-block;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

/* ── Uzun Süredir Açık İş Emri ─────────────────── */
.long-open-box {
  background: var(--bg-panel);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-left: 4px solid #f59e0b;
  color: var(--text-primary);
  padding: 14px 16px;
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.15s ease;
}
.long-open-box:hover {
  transform: translateY(-2px);
}
.long-open-box .low-stock-header i { color: #f59e0b; }
.long-open-box h3 { margin: 0; color: #f59e0b; font-size: 15px; font-weight: 700; }
.long-open-box ul { margin: 0; padding: 0; list-style: none; }
.long-open-box li {
  display: grid;
  grid-template-columns: 80px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 7px 6px;
  margin: 0 -6px;
  border-radius: 6px;
  border-top: 1px solid rgba(245, 158, 11, 0.12);
  font-size: 13.5px;
}
.long-open-box li:first-child { border-top: none; }
.long-open-box strong { color: var(--text-title); font-weight: 600; }
.long-open-box span { color: var(--text-secondary); }
.long-open-box em { font-style: normal; font-weight: 700; color: #f59e0b; }

/* ── Low Stock ────────────────────────────────── */
.low-stock-box {
  background: var(--bg-panel);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-left: 4px solid var(--status-open);
  color: var(--text-primary);
  padding: 14px 16px;
  border-radius: 10px;
}

.low-stock-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.low-stock-header i {
  color: var(--status-open);
  font-size: 16px;
}

.low-stock-box h3 {
  margin: 0;
  color: var(--status-open);
  font-size: 15px;
  font-weight: 700;
}

.low-stock-box p {
  margin: 0 0 10px;
  color: var(--text-secondary);
  font-size: 13.5px;
}

.low-stock-box ul {
  margin: 0;
  padding: 0;
  list-style: none;
}

.low-stock-box li {
  display: grid;
  grid-template-columns: 80px 1fr auto;
  gap: 8px;
  align-items: center;
  padding: 7px 6px;
  margin: 0 -6px;
  border-radius: 6px;
  border-top: 1px solid rgba(239, 68, 68, 0.12);
  font-size: 13.5px;
  transition: background 0.15s ease, transform 0.15s ease;
}

.low-stock-box li:hover {
  background: rgba(239, 68, 68, 0.08);
  transform: translateX(2px);
}

.low-stock-box li:first-child { border-top: none; }
.low-stock-box strong { color: var(--text-title); font-weight: 600; }
.low-stock-box span   { color: var(--text-secondary); }
.low-stock-box em     { font-style: normal; font-weight: 700; color: var(--status-open); }

.stock-empty-box {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  padding: 20px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 6px;
  animation: empty-state-fade-in 0.3s ease;
}

.stock-empty-box i {
  font-size: 20px;
  margin-bottom: 6px;
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(16, 185, 129, 0.12);
  color: var(--status-done);
}
.stock-empty-box strong { color: var(--text-title); font-size: 14.5px; }
.stock-empty-box span   { color: var(--text-muted); font-size: 13px; }

/* ── Empty message ───────────────────────────── */
.empty-message {
  text-align: center;
  color: var(--text-muted);
  padding: 28px 20px;
  background: var(--bg-active-box);
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  font-size: 14px;
  margin-top: 8px;
}

/* ── History Card ───────────────────────────── */
.history-card {
  background: var(--bg-active-box);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 18px;
  color: var(--text-primary);
}

.history-card-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 12px;
  margin-bottom: 14px;
}

.history-card-id {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: flex-start;
}

.history-card-meta {
  text-align: right;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.history-card-meta strong {
  font-size: 14px;
  color: var(--text-title);
}

.history-card-meta span {
  font-size: 12.5px;
  color: var(--text-secondary);
}

.service-title {
  color: var(--text-secondary);
  font-weight: 600;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 12px;
}

.history-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: 8px;
  margin-bottom: 14px;
}

.history-detail-grid div {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 7px;
  padding: 9px 11px;
}

.history-detail-grid span,
.history-total span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
  font-weight: 700;
}

.history-detail-grid strong {
  color: var(--text-title);
  font-size: 13.5px;
  font-weight: 600;
}

.history-desc {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px 12px;
  margin-bottom: 12px;
  font-size: 13.5px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.history-desc span {
  font-weight: 700;
  color: var(--text-title);
  margin-right: 4px;
}

.history-items-row {
  margin-bottom: 12px;
}

.history-items-row > span {
  font-weight: 700;
  color: var(--text-title);
  font-size: 13px;
  display: block;
  margin-bottom: 6px;
}

.history-items-row ul {
  margin: 0;
  padding-left: 18px;
  list-style-type: disc;
}

.history-items-row li {
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.history-items-row li em {
  font-style: normal;
  color: var(--text-muted);
  margin-left: 8px;
}

.history-total {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-top: 1px solid var(--border-color);
  margin-top: 14px;
  padding-top: 14px;
}

.history-total strong {
  color: var(--text-title);
  font-size: 16px;
  font-weight: 700;
}

/* ── Responsive ───────────────────────────────── */
@media (max-width: 1100px) {
  .dash-stat-grid {
    grid-template-columns: repeat(2, minmax(180px, 1fr));
  }
  .dashboard-content-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 700px) {
  .history-search-row { grid-template-columns: 1fr; }
  .history-detail-grid { grid-template-columns: 1fr; }
  .history-card-header { flex-direction: column; }
}

/* ── Light theme ─────────────────────────────── */
:global(html[data-theme="light"] .search-module) {
  background: #ffffff !important;
  border-color: #c8d5e3 !important;
}
:global(html[data-theme="light"] .history-card) {
  background: #f8fafc !important;
  border-color: #c8d5e3 !important;
}
:global(html[data-theme="light"] .history-detail-grid div) {
  background: #ffffff !important;
  border-color: #dde6ef !important;
}
:global(html[data-theme="light"] .history-desc) {
  background: #ffffff !important;
  border-color: #dde6ef !important;
}
:global(html[data-theme="light"] .low-stock-box) {
  background: #fff7ed !important;
  border-color: rgba(239, 68, 68, 0.3) !important;
  border-left-color: #ef4444 !important;
  color: #9a3412 !important;
}
:global(html[data-theme="light"] .low-stock-box h3),
:global(html[data-theme="light"] .low-stock-box strong),
:global(html[data-theme="light"] .low-stock-box em) {
  color: #b91c1c !important;
}
:global(html[data-theme="light"] .low-stock-box p),
:global(html[data-theme="light"] .low-stock-box span) {
  color: #7c2d12 !important;
}

.vehicle-result-row:hover {
  background: var(--bg-panel-hover, rgba(255, 255, 255, 0.05)) !important;
  border-color: var(--accent-color, #38bdf8) !important;
}

.vehicle-result-row.active {
  background: var(--bg-active-box, rgba(56, 189, 248, 0.15)) !important;
  border-color: var(--accent-color, #38bdf8) !important;
}

@media (max-width: 768px) {
  .search-results-modal-layout {
    flex-direction: column !important;
    height: auto !important;
  }
  
  .results-sidebar {
    border-right: none !important;
    border-bottom: 1px solid var(--border-color);
    padding-right: 0 !important;
    padding-bottom: 16px;
    flex: none !important;
    max-height: 200px;
  }
  
  .results-detail-pane {
    padding-left: 0 !important;
    flex: none !important;
  }
}

:global(html[data-theme="light"] .vehicle-result-row) {
  background: #f8fafc !important;
}

:global(html[data-theme="light"] .vehicle-result-row.active) {
  background: #e2e8f0 !important;
  border-color: #3b82f6 !important;
}

:global(html[data-theme="light"] .customer-info-banner) {
  background: #f8fafc !important;
}

:global(html[data-theme="light"] .visit-history-card) {
  background: #f8fafc !important;
}

:global(html[data-theme="light"] .visit-complaint-section),
:global(html[data-theme="light"] .visit-items-section > div > div) {
  background: #ffffff !important;
}

.suggestion-row:hover {
  background: var(--bg-panel-hover, rgba(255, 255, 255, 0.05)) !important;
}

:global(html[data-theme="light"] .search-suggestions-dropdown) {
  background: #ffffff !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1) !important;
}

:global(html[data-theme="light"] .suggestion-row:hover) {
  background: #f1f5f9 !important;
}
</style>
