<script setup>
import { ref, reactive, onMounted, onUnmounted, computed } from 'vue'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Dropdown from 'primevue/dropdown'
import Tag from 'primevue/tag'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import { useRouter } from 'vue-router'
import { useFormatters } from '../composables/useFormatters'
import EmptyState from '../components/EmptyState.vue'
import HelpButton from '../components/HelpButton.vue'
import DestekModuUyarisi from '../components/DestekModuUyarisi.vue'
import { useYetki } from '../composables/useYetki.js'
import { genelVeriYenilemeIsleyicisi } from '../utils/dataRefresh.js'

const router = useRouter()
const yardimaGit = (konu) => router.push({ path: '/help', query: { konu } })

const parcalar = ref([])
const yukleniyor = ref(true)
const dialogAcik = ref(false)
const aramaKelimesi = ref('') // Arama çubuğuna yazılan metni tutar
const hareketDialogAcik = ref(false)
const seciliParca = ref(null)
const stokHareketleri = ref([])
const aktifUsta = ref(null)
const stokFiltresi = ref('aktif')
const seciliMarka = ref('')
const seciliKategori = ref('')

const filtreOzeti = reactive({
  aktif: 0,
  kritik: 0,
  biten: 0,
  pasif: 0,
  hepsi: 0
})

const markalar = ref([])
const kategoriler = ref([])


const toast = useToast()
const confirmDialog = useConfirm()

const { destekModu, destekModundaEngelle } = useYetki()

// Stok kaydı usta işidir: destek (admin) oturumu ve oturumsuz durum tek yerden elenir.
// true dönerse çağıran fonksiyon durmalıdır.
const ustaIsiEngelli = (islemAdi) => {
  if (destekModundaEngelle(toast, `${islemAdi} destek modunda yapılamaz.`)) return true

  if (!aktifUsta.value?.id) {
    uyariMesaji(`${islemAdi} için önce usta girişi yapılmalıdır.`)
    return true
  }

  return false
}

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

const form = reactive({
  id: null,
  code: '',
  name: '',
  brand: '',
  category: '',
  oem_code: '',
  stock: 0,
  unit: 'Adet',
  critical_stock: 5,
  critical_stock_enabled: false,
  buy_price: 0,
  sell_price: 0,
  shelf: '',
  note: ''
})
const formuTemizle = () => {
  Object.assign(form, {
    id: null,
    code: '',
    name: '',
    brand: '',
    category: '',
    oem_code: '',
    stock: 0,
    unit: 'Adet',
    critical_stock: 5,
    critical_stock_enabled: false,
    buy_price: 0,
    sell_price: 0,
    shelf: '',
    note: ''
  })
}

const listeyiGetir = async () => {
  yukleniyor.value = true
  try {
    if (!window.api.parcalariFiltreliGetir) {
      parcalar.value = await window.api.parcalariGetir()
      return
    }

    const res = await window.api.parcalariFiltreliGetir({
      durum: stokFiltresi.value,
      brand: seciliMarka.value,
      category: seciliKategori.value
    })

    if (res?.success) {
      parcalar.value = Array.isArray(res.parcalar) ? res.parcalar : []

      Object.assign(filtreOzeti, {
        aktif: Number(res.ozet?.aktif || 0),
        kritik: Number(res.ozet?.kritik || 0),
        biten: Number(res.ozet?.biten || 0),
        pasif: Number(res.ozet?.pasif || 0),
        hepsi: Number(res.ozet?.hepsi || 0)
      })

      markalar.value = Array.isArray(res.markalar) ? res.markalar : []
      kategoriler.value = Array.isArray(res.kategoriler) ? res.kategoriler : []
    } else {
      parcalar.value = []
      hataMesaji(res?.error || 'Parçalar getirilemedi.')
    }
  } finally {
    yukleniyor.value = false
  }
}
const stokFiltresiDegistir = async (durum) => {
  stokFiltresi.value = durum
  await listeyiGetir()
}

const markaDegisti = async () => {
  await listeyiGetir()
}

const kategoriDegisti = async () => {
  await listeyiGetir()
}

const filtreleriTemizle = async () => {
  stokFiltresi.value = 'aktif'
  seciliMarka.value = ''
  seciliKategori.value = ''
  aramaKelimesi.value = ''
  await listeyiGetir()
}

// ARAMA MOTORU KISMI: Harfe basıldıkça listeyi anında süzer
const filtrelenmisParcalar = computed(() => {
  if (!aramaKelimesi.value) return parcalar.value
  
  const aranan = aramaKelimesi.value.toLowerCase()
return parcalar.value.filter(p => 
  (p.name || '').toLowerCase().includes(aranan) || 
  (p.code || '').toLowerCase().includes(aranan) ||
  (p.brand || '').toLowerCase().includes(aranan) ||
  (p.category || '').toLowerCase().includes(aranan) ||
  (p.oem_code || '').toLowerCase().includes(aranan) ||
  (p.shelf || '').toLowerCase().includes(aranan)
)
})
const duzenle = (parca) => {
  if (ustaIsiEngelli('Parça düzenleme')) return

Object.assign(form, {
  id: parca.id,
  code: parca.code || '',
  name: parca.name || '',
  brand: parca.brand || '',
  category: parca.category || '',
  oem_code: parca.oem_code || '',
  stock: parca.stock || 0,
  unit: parca.unit || 'Adet',
  critical_stock: parca.critical_stock ?? 5,
  critical_stock_enabled: parca.critical_stock_enabled !== 0,
  buy_price: parca.buy_price || 0,
  sell_price: parca.sell_price || 0,
  shelf: parca.shelf || '',
  note: parca.note || ''
})

  dialogAcik.value = true
}
const hareketleriAc = async (parca) => {
  seciliParca.value = parca
  hareketDialogAcik.value = true

  const res = await window.api.stokHareketleriGetir(parca.id)

  if (res && res.success) {
    stokHareketleri.value = res.hareketler
  } else {
    stokHareketleri.value = []
    hataMesaji(res?.error || 'Stok hareketleri getirilemedi.')
  }
}

const { tlFormatla, tarihSaatFormatla: tarihFormatla } = useFormatters()

const hareketSeverity = (type) => {
  if (type === 'Giriş') return 'success'
  if (type === 'Çıkış') return 'danger'
  return 'info'
}
const sil = (id) => {
  if (!id) return
  if (ustaIsiEngelli('Parçayı pasife alma')) return

  confirmDialog.require({
    message: 'Bu parçayı pasife almak istediğinize emin misiniz?',
    header: 'Parça Pasife Al',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Pasife Al',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-danger',
    rejectClass: 'p-button-secondary p-button-text',
    accept: async () => {
      const res = await window.api.parcaSil(id)

      if (res?.success) {
        basariMesaji('Parça pasife alındı.')
        await listeyiGetir()
      } else {
        hataMesaji(res?.error || 'Parça pasife alınamadı.')
      }
    }
  })
}

const mevcuttanAktiflestir = async (id) => {
  if (!id) return
  if (ustaIsiEngelli('Parça aktifleştirme')) return

  confirmDialog.require({
    message: 'Bu parçayı tekrar aktif hale getirmek istediğinize emin misiniz?',
    header: 'Parça Aktifleştir',
    icon: 'pi pi-check-circle',
    acceptLabel: 'Aktifleştir',
    rejectLabel: 'Vazgeç',
    acceptClass: 'p-button-success',
    rejectClass: 'p-button-secondary p-button-text',
    accept: async () => {
      const res = await window.api.parcaAktiflestir(id)

      if (res?.success) {
        basariMesaji('Parça tekrar aktif hale getirildi.')
        await listeyiGetir()
      } else {
        hataMesaji(res?.error || 'Parça aktifleştirilemedi.')
      }
    }
  })
}

const kaydet = async () => {
  if (!form.code || !form.name) {
    uyariMesaji('Parça kodu ve parça adı alanları boş bırakılamaz.')
    return
  }

  if (ustaIsiEngelli('Stok işlemi')) return

  if (form.critical_stock_enabled && Number(form.critical_stock) < 0) {
    uyariMesaji('Kritik stok limiti negatif olamaz.')
    return
  }

  try {
    const temizVeri = {
      ...JSON.parse(JSON.stringify(form)),
      active_master_id: aktifUsta.value.id
    }

    const res = form.id
      ? await window.api.parcaGuncelle(temizVeri)
      : await window.api.parcaEkle(temizVeri)

    if (res && res.success) {
      if (form.id) {
        basariMesaji('Parça güncellendi.')
      } else if (res.wasReactivated) {
        basariMesaji(`Pasife alınmış parça (${form.name}) tekrar aktif hale getirildi ve stok güncellendi.`)
      } else if (res.updatedExisting) {
        basariMesaji(`Bu parça zaten vardı. Stok ${res.oldStock} adetten ${res.newStock} adete çıkarıldı.`)
      } else {
        basariMesaji('Parça kaydedildi.')
      }

      dialogAcik.value = false
      formuTemizle()
      await listeyiGetir()
    } else {
      hataMesaji(res?.error || 'Parça kaydedilemedi.')
    }
  } catch (error) {
    hataMesaji(error instanceof Error ? error.message : String(error))
  }
}

const genelYenileme = genelVeriYenilemeIsleyicisi(listeyiGetir)

onMounted(() => {
  aktifUsta.value = JSON.parse(localStorage.getItem('aktifUsta') || 'null')
  listeyiGetir()
  window.addEventListener('app-data-refreshed', genelYenileme)
})

onUnmounted(() => {
  window.removeEventListener('app-data-refreshed', genelYenileme)
})
</script>

<template>
  <div class="page">
    <div class="page-header">
      <div>
        <h1 class="page-title">Yedek Parça ve Stok Yönetimi <HelpButton konu="parca" /></h1>
        <p class="page-subtitle">Depo stokunu, kritik parçaları ve hareketleri buradan yönetin.</p>
      </div>
      <div style="display: flex; gap: 12px; align-items: center;">
        <span class="p-input-icon-left" style="width: 280px;">
          <i class="pi pi-search" />
          <InputText v-model="aramaKelimesi" placeholder="Kodu, Adı veya Rafı Ara..." />
        </span>
        <Button
          label="Yeni Parça Ekle"
          icon="pi pi-plus"
          severity="success"
          :disabled="destekModu"
          @click="formuTemizle(); dialogAcik = true"
        />
      </div>
    </div>

    <DestekModuUyarisi aciklama="Parça ekleme, düzenleme ve stok değişikliği destek modunda kapalıdır." />

    <div class="table-panel">
      <div class="stock-filter-panel">
        <div class="stock-filter-buttons">
          <Button
            :label="`Tüm Parçalar (${filtreOzeti.aktif})`"
            icon="pi pi-list"
            size="small"
            severity="secondary"
            :outlined="stokFiltresi !== 'aktif'"
            @click="stokFiltresiDegistir('aktif')"
          />

          <Button
            :label="`Kritik Stok (${filtreOzeti.kritik})`"
            icon="pi pi-exclamation-triangle"
            size="small"
            severity="warning"
            :outlined="stokFiltresi !== 'kritik'"
            @click="stokFiltresiDegistir('kritik')"
          />

          <Button
            :label="`Bitenler (${filtreOzeti.biten})`"
            icon="pi pi-times-circle"
            size="small"
            severity="danger"
            :outlined="stokFiltresi !== 'biten'"
            @click="stokFiltresiDegistir('biten')"
          />

          <Button
            :label="`Pasifler (${filtreOzeti.pasif})`"
            icon="pi pi-eye-slash"
            size="small"
            severity="secondary"
            :outlined="stokFiltresi !== 'pasif'"
            @click="stokFiltresiDegistir('pasif')"
          />

          <Button
            label="Filtreleri Temizle"
            icon="pi pi-filter-slash"
            size="small"
            severity="secondary"
            text
            @click="filtreleriTemizle"
          />
        </div>

        <div class="stock-filter-selects">
          <Dropdown
            v-model="seciliMarka"
            :options="markalar"
            placeholder="Markaya Göre"
            showClear
            style="width: 190px;"
            @change="markaDegisti"
          />

          <Dropdown
            v-model="seciliKategori"
            :options="kategoriler"
            placeholder="Kategoriye Göre"
            showClear
            style="width: 190px;"
            @change="kategoriDegisti"
          />
        </div>
      </div>

      <!-- alwaysShowPaginator=false: liste tek sayfaya sığıyorsa sayfalama
           çubuğu görünmez, yani az kayıtlı kurulumlarda görüntü değişmez. -->
      <DataTable
        :value="filtrelenmisParcalar"
        :loading="yukleniyor"
        responsiveLayout="scroll"
        paginator
        :rows="50"
        :alwaysShowPaginator="false"
        :rowClass="(row) => Number(row.stock || 0) <= 0 ? 'row-critical' : (row.critical_stock_enabled !== 0 && Number(row.stock || 0) <= Number(row.critical_stock ?? 5) ? 'row-critical' : '')"
      >
        <template #empty>
          <EmptyState
            v-if="parcalar.length > 0 || aramaKelimesi || seciliMarka || seciliKategori || stokFiltresi !== 'aktif'"
            icon="pi pi-filter-slash"
            title="Bu süzgeçlere uyan parça yok"
            description="Arama kelimesini, marka/kategori seçimini veya stok durumu sekmesini değiştirip yeniden deneyin."
            action-label="Filtreleri Temizle"
            action-icon="pi pi-filter-slash"
            compact
            @action="filtreleriTemizle"
          />
          <EmptyState
            v-else
            icon="pi pi-box"
            title="Stok listeniz boş"
            description="Sık kullandığınız parçaları alış ve satış fiyatlarıyla girin. İş emrine stoktan parça eklediğinizde adet kendiliğinden düşer, kâr hesabı da alış fiyatından yapılır."
            action-label="Yeni Parça Ekle"
            action-icon="pi pi-plus"
            hint-label="Nasıl yapılır?"
            :action-disabled="destekModu"
            @action="formuTemizle(); dialogAcik = true"
            @hint="yardimaGit('parca')"
          />
        </template>

<Column field="code" header="Parça Kodu">
  <template #body="slotProps">
    <span class="plate-cell">{{ slotProps.data.code }}</span>
  </template>
</Column>
<Column field="name" header="Parça Adı"></Column>
<Column field="brand" header="Marka"></Column>
<Column field="category" header="Kategori"></Column>
<Column field="oem_code" header="OEM"></Column>
<Column field="shelf" header="Raf/Konum"></Column>

<Column header="Durum">
  <template #body="slotProps">
    <Tag
      :value="Number(slotProps.data.is_active ?? 1) === 1 ? 'Aktif' : 'Pasif'"
      :severity="Number(slotProps.data.is_active ?? 1) === 1 ? 'success' : 'secondary'"
    />
  </template>
</Column>

        <Column header="Stok">
  <template #body="slotProps">
    <Tag
      v-if="Number(slotProps.data.stock || 0) <= 0"
      value="Tükendi"
      severity="danger"
    />
    <Tag
      v-else-if="slotProps.data.critical_stock_enabled !== 0 && Number(slotProps.data.stock || 0) <= Number(slotProps.data.critical_stock ?? 5)"
      :value="`${slotProps.data.stock} ${slotProps.data.unit || 'Adet'} / Kritik`"
      severity="danger"
    />
    <span v-else>
      {{ slotProps.data.stock }} {{ slotProps.data.unit || 'Adet' }}
    </span>
  </template>
</Column>

<Column header="Kritik Stok">
  <template #body="slotProps">
    <span v-if="slotProps.data.critical_stock_enabled !== 0">
      {{ slotProps.data.critical_stock ?? 5 }} {{ slotProps.data.unit || 'adet' }}
    </span>
    <span v-else style="color: var(--text-muted); opacity: 0.65; font-size: 11.5px;">
      Takip Kapalı
    </span>
  </template>
</Column>
<Column header="Alış">
  <template #body="slotProps">
    {{ tlFormatla(slotProps.data.buy_price) }}
  </template>
</Column>

<Column header="Satış">
  <template #body="slotProps">
    {{ tlFormatla(slotProps.data.sell_price) }}
  </template>
</Column>
        <Column header="İşlem" :exportable="false" style="min-width:9.5rem">
          <template #body="slotProps">
            <Button 
              icon="pi pi-history" 
              outlined 
              rounded 
              severity="secondary" 
              @click="hareketleriAc(slotProps.data)" 
              style="margin-right: 6px;" 
            />
            <Button 
              icon="pi pi-pencil" 
              outlined 
              rounded 
              severity="info" 
              :disabled="destekModu"
              @click="duzenle(slotProps.data)" 
              style="margin-right: 6px;" 
            />
            <Button 
              v-if="Number(slotProps.data.is_active ?? 1) === 0"
              icon="pi pi-check-circle" 
              outlined 
              rounded 
              severity="success" 
              :disabled="destekModu"
              @click="mevcuttanAktiflestir(slotProps.data.id)" 
              style="margin-right: 6px;" 
            />
            <Button 
              v-else
              icon="pi pi-trash" 
              outlined 
              rounded 
              severity="danger" 
              :disabled="destekModu"
              @click="sil(slotProps.data.id)" 
            />
          </template>
        </Column>
      </DataTable>
    </div>

<Dialog
  v-model:visible="dialogAcik"
  :header="form.id ? 'Parça Düzenle' : 'Yeni Parça Ekle'"
  :style="{ width: '780px' }"
  modal
>
  <div style="display: flex; flex-direction: column; gap: 15px; padding-top: 10px;">
    <div class="form-section-title"><i class="pi pi-tag"></i> Parça Kimliği</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
      <div class="form-group">
        <label>Parça Kodu</label>
        <InputText
          v-model="form.code"
          placeholder="Örn: YAG-FLT-01"
          style="width: 100%"
          autofocus
        />
      </div>

      <div class="form-group">
        <label>OEM / Muadil Kod</label>
        <InputText
          v-model="form.oem_code"
          placeholder="Örn: 06A115561B"
          style="width: 100%"
        />
      </div>
    </div>

    <div class="form-group">
      <label>Parça Adı</label>
      <InputText
        v-model="form.name"
        placeholder="Örn: Bosch Yağ Filtresi"
        style="width: 100%"
      />
    </div>

    <div class="form-section-title"><i class="pi pi-box"></i> Sınıflandırma &amp; Konum</div>
    <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px;">
      <div class="form-group">
        <label>Marka</label>
        <InputText
          v-model="form.brand"
          placeholder="Örn: Bosch"
          style="width: 100%"
        />
      </div>

      <div class="form-group">
        <label>Kategori</label>
        <InputText
          v-model="form.category"
          placeholder="Örn: Filtre"
          style="width: 100%"
        />
      </div>

      <div class="form-group">
        <label>Raf / Kutu Konumu</label>
        <InputText
          v-model="form.shelf"
          placeholder="Örn: A-3 Rafı"
          style="width: 100%"
        />
      </div>
    </div>

    <div class="form-section-title"><i class="pi pi-chart-bar"></i> Stok &amp; Fiyat Bilgileri</div>
    <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; align-items: start;">
      
      <!-- Sol blok: Stok / Birim ve Alış / Satış -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        <div class="form-group">
          <label>Stok</label>
          <InputText
            type="number"
            v-model="form.stock"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Birim</label>
          <InputText
            v-model="form.unit"
            placeholder="Adet"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Alış (₺)</label>
          <InputText
            type="number"
            v-model="form.buy_price"
            style="width: 100%"
          />
        </div>

        <div class="form-group">
          <label>Satış (₺)</label>
          <InputText
            type="number"
            v-model="form.sell_price"
            style="width: 100%"
          />
        </div>
      </div>

      <!-- Sağ blok: Kritik Stok Takibi ve Limit -->
      <div style="display: flex; flex-direction: column; gap: 12px; background: var(--bg-panel-hover, rgba(255, 255, 255, 0.02)); border: 1px dashed var(--border-color); padding: 12px 14px; border-radius: 8px; min-height: 110px; justify-content: center;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <input 
            id="critical_stock_enabled" 
            type="checkbox" 
            v-model="form.critical_stock_enabled" 
            style="width: 16px; height: 16px; cursor: pointer; accent-color: var(--accent-color, #38bdf8);"
          />
          <label for="critical_stock_enabled" style="cursor: pointer; user-select: none; font-weight: 600; margin-bottom: 0;">Kritik Stok Takibi Yap</label>
        </div>

        <div class="form-group" v-if="form.critical_stock_enabled" style="margin-top: 4px; margin-bottom: 0;">
          <label style="font-size: 11.5px;">Kritik Stok Limiti</label>
          <InputText
            type="number"
            v-model="form.critical_stock"
            style="width: 100%"
          />
        </div>
      </div>

    </div>

    <div class="form-group">
      <label>Not / Uyumlu Araç / Açıklama</label>
      <InputText
        v-model="form.note"
        placeholder="Örn: Clio 4 uyumlu, benzinli modeller..."
        style="width: 100%"
      />
    </div>
  </div>

  <template #footer>
    <Button
      label="İptal"
      icon="pi pi-times"
      text
      @click="dialogAcik = false"
    />

    <Button
      label="Kaydet"
      icon="pi pi-check"
      :disabled="destekModu"
      @click="kaydet"
    />
  </template>
</Dialog>

    <Dialog
      v-model:visible="hareketDialogAcik"
      :header="seciliParca ? `${seciliParca.code} - Stok Hareketleri` : 'Stok Hareketleri'"
      :style="{ width: '1100px' }"
      modal
      maximizable
    >
      <div v-if="seciliParca" style="display: flex; flex-direction: column; gap: 15px;">
        <div style="background: var(--bg-active-box); border: 1px solid var(--border-color); padding: 15px; border-radius: 8px; color: var(--text-primary);">
          <strong>Parça:</strong> {{ seciliParca.name }} <br>
          <strong>Kod:</strong> {{ seciliParca.code }} <br>
          <strong>Mevcut Stok:</strong> {{ seciliParca.stock }} <br>
          <strong>Kritik Stok:</strong> 
          <span v-if="seciliParca.critical_stock_enabled !== 0">
            {{ seciliParca.critical_stock ?? 5 }}
          </span>
          <span v-else style="color: var(--text-muted); opacity: 0.65;">Takip Kapalı</span>
        </div>

        <DataTable
          :value="stokHareketleri"
          responsiveLayout="scroll"
          emptyMessage="Bu parçaya ait stok hareketi bulunamadı."
        >
          <Column header="Tarih">
            <template #body="slotProps">
              {{ tarihFormatla(slotProps.data.created_at) }}
            </template>
          </Column>

          <Column header="Tip">
            <template #body="slotProps">
              <Tag
                :value="slotProps.data.type"
                :severity="hareketSeverity(slotProps.data.type)"
              />
            </template>
          </Column>

<Column field="quantity" header="Miktar"></Column>

<Column header="Eski Stok">
  <template #body="slotProps">
    {{ slotProps.data.old_stock ?? '-' }}
  </template>
</Column>

<Column header="Yeni Stok">
  <template #body="slotProps">
    {{ slotProps.data.new_stock ?? '-' }}
  </template>
</Column>

<Column header="İşlem Yapan">
  <template #body="slotProps">
    {{ slotProps.data.master_name || '-' }}
  </template>
</Column>

<Column field="note" header="Açıklama"></Column>
<Column field="vehicle_plate" header="Plaka"></Column>
<Column field="customer_name" header="Müşteri"></Column>
        </DataTable>
      </div>
    </Dialog>
  </div>
</template>
<style scoped>
.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.form-group label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-secondary);
}

.table-panel {
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
}

.stock-filter-panel {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.stock-filter-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.stock-filter-selects {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
